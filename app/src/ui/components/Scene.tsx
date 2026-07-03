/**
 * 3D viewport (react-three-fiber). Everything visible is driven by worker
 * telemetry + the sized design through the pure helpers in sceneGeometry —
 * no physics is computed here. One sun vector (from the live beta) drives
 * the Earth terminator shader, the scene lighting, the orbit shadow arc and
 * the wing pointing, so they can never disagree; the eclipse dimming of the
 * spacecraft follows the fast-loop's own illumination flag.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AL_DENSITY_KG_M3 } from "../../core/constants";
import { inferno, infernoCssGradient, radT01, RAD_T_MAX_C, RAD_T_MIN_C } from "../colormap";
import { clamp, fmtFixed } from "../format";
import {
  METERS_TO_UNITS,
  R_EARTH_UNITS,
  inShadow,
  spacecraftDims,
  spacecraftPos,
  sunDirection,
  velocityDir,
} from "../sceneGeometry";
import { useStudio } from "../store";

type ViewMode = "earth" | "chase";

// preallocated frame temps (no per-frame allocation)
const _basis = new THREE.Matrix4();
const _rHat = new THREE.Vector3();
const _vHat = new THREE.Vector3();
const _zHat = new THREE.Vector3(0, 0, 1);
const _sun = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();

/** Current phase fraction + live scene inputs, read imperatively per frame. */
function frameState() {
  const s = useStudio.getState();
  const frac = s.periodS > 0 ? (s.tick.phaseS % s.periodS) / s.periodS : 0;
  return {
    frac,
    altKm: s.cfg.orbit.alt_km,
    beta: s.tick.beta,
    illum: s.tick.sample?.illum ?? 1,
    tRadC: s.tick.sample?.t_rad_c ?? 10,
  };
}

// ------------------------------------------------------------------- Earth

const EARTH_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Day/night from the SAME sun vector the physics uses; 15-degree graticule.
const EARTH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormal);
  float d = dot(n, uSunDir);
  float day = smoothstep(-0.03, 0.18, d);
  float latBand = 1.0 - abs(vUv.y - 0.5) * 2.0;
  vec3 ocean = mix(vec3(0.06, 0.14, 0.26), vec3(0.10, 0.23, 0.40),
                   smoothstep(0.0, 0.6, latBand));
  vec3 dayCol = ocean * (0.45 + 0.75 * clamp(d, 0.0, 1.0));
  vec3 nightCol = vec3(0.012, 0.016, 0.035);
  vec2 q = vUv * vec2(24.0, 12.0);
  vec2 g = vec2(0.5) - abs(fract(q) - vec2(0.5));
  vec2 fw = fwidth(q) * 1.2;
  vec2 gline = vec2(1.0) - smoothstep(vec2(0.0), fw, g);
  float grat = max(gline.x, gline.y);
  vec3 col = mix(nightCol, dayCol, day);
  col += vec3(0.35, 0.42, 0.52) * grat * (0.08 + 0.10 * day);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  float fr = pow(1.0 - abs(dot(normalize(vView), n)), 2.6);
  float day = clamp(dot(n, uSunDir) * 0.7 + 0.45, 0.12, 1.0);
  gl_FragColor = vec4(vec3(0.25, 0.5, 0.9) * fr * day, fr * day);
}
`;

function Earth() {
  const earthMat = useRef<THREE.ShaderMaterial>(null);
  const atmoMat = useRef<THREE.ShaderMaterial>(null);
  const earthUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0, 0) } }),
    [],
  );
  const atmoUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0, 0) } }),
    [],
  );
  useFrame(() => {
    const { beta } = frameState();
    const s = sunDirection(beta);
    (earthUniforms.uSunDir.value as THREE.Vector3).set(s[0], s[1], s[2]);
    (atmoUniforms.uSunDir.value as THREE.Vector3).set(s[0], s[1], s[2]);
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R_EARTH_UNITS, 64, 48]} />
        <shaderMaterial
          ref={earthMat}
          uniforms={earthUniforms}
          vertexShader={EARTH_VERT}
          fragmentShader={EARTH_FRAG}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[R_EARTH_UNITS * 1.03, 64, 48]} />
        <shaderMaterial
          ref={atmoMat}
          uniforms={atmoUniforms}
          vertexShader={ATMO_VERT}
          fragmentShader={ATMO_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

// -------------------------------------------------------------- orbit trace

function OrbitTrace() {
  const altKm = useStudio((s) => s.cfg.orbit.alt_km);
  // orbit shadow arc only changes with beta; half-degree quantization
  const betaQ = useStudio((s) => Math.round(s.tick.beta * 2) / 2);

  const line = useMemo(() => {
    const N = 256;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const sun = sunDirection(betaQ);
    for (let i = 0; i < N; i++) {
      const p = spacecraftPos(altKm, i / N);
      pos.set(p, i * 3);
      const dark = inShadow(p, sun);
      col.set(dark ? [0.16, 0.18, 0.24] : [0.42, 0.47, 0.58], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
    });
    return new THREE.LineLoop(geo, mat);
  }, [altKm, betaQ]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

// --------------------------------------------------------------- spacecraft

/**
 * Body frame: x = radial out, y = prograde velocity, z = orbit normal.
 * Radiator panels deploy along ±z with faces radial (edge-on to a
 * high-beta sun); solar wings boom along ±y and rotate about the boom to
 * face the sun (single-axis drive). Panel AREAS are the sized values.
 */
function Spacecraft() {
  const design = useStudio((s) => s.design);
  const shieldMm = useStudio((s) => s.cfg.rad.shield_mm);
  const grp = useRef<THREE.Group>(null);
  const wings = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Sprite>(null);
  // one shared material: both panels are the same thermal node
  const radiatorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1b1f27",
        emissive: "#000000",
        emissiveIntensity: 0.85,
        metalness: 0.1,
        roughness: 0.7,
      }),
    [],
  );
  useEffect(() => () => radiatorMat.dispose(), [radiatorMat]);

  const dims = useMemo(
    () =>
      spacecraftDims(
        design.a_rad_phys,
        design.arr_area_m2,
        design.masses["shielding"] ?? 1,
        shieldMm,
        AL_DENSITY_KG_M3,
      ),
    [design, shieldMm],
  );

  useFrame(({ camera }) => {
    const g = grp.current;
    if (!g) return;
    const { frac, altKm, beta, tRadC } = frameState();
    const p = spacecraftPos(altKm, frac);
    g.position.set(p[0], p[1], p[2]);
    _rHat.set(p[0], p[1], p[2]).normalize();
    const v = velocityDir(frac);
    _vHat.set(v[0], v[1], v[2]);
    _basis.makeBasis(_rHat, _vHat, _zHat);
    g.quaternion.setFromRotationMatrix(_basis);

    // wing drive: rotate about the y boom so the panel normal tracks the
    // sun's projection in the body x-z plane
    const s = sunDirection(beta);
    _sun.set(s[0], s[1], s[2]);
    const sbx = _sun.dot(_rHat);
    const sbz = _sun.dot(_zHat);
    if (wings.current) wings.current.rotation.y = Math.atan2(sbx, sbz);

    // radiator face color from the live radiator temperature
    const [r, gg, b] = inferno(radT01(tRadC));
    radiatorMat.emissive.setRGB(r, gg, b);

    // nav light: constant screen size, only at stand-off range
    const mk = marker.current;
    if (mk) mk.visible = camera.position.distanceTo(g.position) > 5;
  });

  const M = METERS_TO_UNITS;
  const bus = dims.busSide * M;
  const radW = dims.radW * M;
  const radL = dims.radL * M;
  const chord = dims.wingChord * M;
  const wingLen = dims.wingLen * M;
  const gap = 0.35 * bus;
  const panelT = 0.06 * bus;

  return (
    <group ref={grp}>
      {/* nav-light marker so the vehicle is spottable at Earth-view range */}
      <sprite ref={marker} scale={[0.014, 0.014, 1]}>
        <spriteMaterial
          color="#ffb84d"
          sizeAttenuation={false}
          depthTest={false}
        />
      </sprite>
      {/* shielded IT box */}
      <mesh>
        <boxGeometry args={[bus, bus, bus]} />
        <meshStandardMaterial color="#8f97a4" metalness={0.35} roughness={0.55} />
      </mesh>
      {/* radiator panels ±z, thin radially (x), area-true */}
      {([1, -1] as const).map((sz) => (
        <group key={sz}>
          <mesh
            position={[0, 0, sz * (bus / 2 + gap + radL / 2)]}
            material={radiatorMat}
          >
            <boxGeometry args={[panelT, radW, radL]} />
          </mesh>
          <mesh position={[0, 0, sz * (bus / 2 + gap / 2)]}>
            <cylinderGeometry args={[0.05 * bus, 0.05 * bus, gap, 8]} />
            <meshStandardMaterial color="#5c636e" />
          </mesh>
        </group>
      ))}
      {/* solar wings ±y on a single-axis drive */}
      <group ref={wings}>
        {([1, -1] as const).map((sy) => (
          <group key={sy}>
            <mesh position={[0, sy * (bus / 2 + gap + wingLen / 2), 0]}>
              <boxGeometry args={[chord, wingLen, panelT * 0.6]} />
              <meshStandardMaterial
                color="#101c33"
                emissive="#0a1428"
                emissiveIntensity={0.4}
                metalness={0.5}
                roughness={0.35}
              />
            </mesh>
            <mesh
              position={[0, sy * (bus / 2 + gap / 2), 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.04 * bus, 0.04 * bus, gap, 8]} />
              <meshStandardMaterial color="#5c636e" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// ------------------------------------------------------------ sun indicator

function SunIndicator() {
  const disc = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    return new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: "#c9a34a", transparent: true, opacity: 0.8 }),
    );
  }, []);
  useEffect(
    () => () => {
      ray.geometry.dispose();
      (ray.material as THREE.Material).dispose();
    },
    [ray],
  );
  useFrame(() => {
    const { frac, altKm, beta } = frameState();
    const s = sunDirection(beta);
    disc.current?.position.set(s[0] * 150, s[1] * 150, s[2] * 150);
    const p = spacecraftPos(altKm, frac);
    const a = ray.geometry.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(0, p[0], p[1], p[2]);
    a.setXYZ(1, p[0] + s[0] * 1.4, p[1] + s[1] * 1.4, p[2] + s[2] * 1.4);
    a.needsUpdate = true;
  });
  return (
    <>
      <mesh ref={disc}>
        <sphereGeometry args={[3.2, 24, 16]} />
        <meshBasicMaterial color="#ffe9b0" />
      </mesh>
      <primitive object={ray} />
    </>
  );
}

// ----------------------------------------------------------------- lighting

function Lights() {
  const dir = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const { beta, illum } = frameState();
    const s = sunDirection(beta);
    const d = dir.current;
    if (!d) return;
    d.position.set(s[0] * 100, s[1] * 100, s[2] * 100);
    // eclipse: sunlight on the spacecraft follows the fast-loop illum flag
    const target = illum > 0.5 ? 1.7 : 0.1;
    d.intensity += (target - d.intensity) * 0.2;
  });
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight ref={dir} intensity={1.7} color="#fff2dd" />
    </>
  );
}

// -------------------------------------------------------------- camera rig

function CameraRig({ mode }: { mode: ViewMode }) {
  const { camera, gl } = useThree();
  const sph = useRef({ az: -0.9, el: 0.5, r: 17 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    camera.up.set(0, 0, 1);
  }, [camera]);

  useEffect(() => {
    sph.current.r = mode === "chase" ? 2.2 : 17;
  }, [mode]);

  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent): void => {
      dragging.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!dragging.current) return;
      const dx = e.clientX - dragging.current.x;
      const dy = e.clientY - dragging.current.y;
      dragging.current = { x: e.clientX, y: e.clientY };
      sph.current.az -= dx * 0.005;
      sph.current.el = clamp(sph.current.el + dy * 0.005, -1.45, 1.45);
    };
    const up = (): void => {
      dragging.current = null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const minR = 0.4;
      sph.current.r = clamp(sph.current.r * Math.exp(e.deltaY * 0.0012), minR, 70);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl]);

  useFrame(() => {
    const { frac, altKm } = frameState();
    if (mode === "chase") {
      const p = spacecraftPos(altKm, frac);
      _tgt.set(p[0], p[1], p[2]);
    } else {
      _tgt.set(0, 0, 0);
    }
    const { az, el, r } = sph.current;
    _pos
      .set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el))
      .multiplyScalar(r)
      .add(_tgt);
    camera.position.copy(_pos);
    camera.lookAt(_tgt);
  });
  return null;
}

// ----------------------------------------------------------------- overlay

function ViewportOverlay({
  mode,
  setMode,
}: {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}) {
  const tick = useStudio((s) => s.tick);
  const altKm = useStudio((s) => s.cfg.orbit.alt_km);
  const eclipse = (tick.sample?.illum ?? 1) < 0.5;
  return (
    <div className="vp-overlay">
      <div className="vp-row">
        <span className={eclipse ? "vp-badge vp-ecl" : "vp-badge vp-sun"}>
          {eclipse ? "◐ ECLIPSE" : "☀ SUNLIT"}
        </span>
        <span className="vp-ro">β {fmtFixed(tick.beta, 1)}°</span>
        <span className="vp-ro">h {fmtFixed(altKm, 0)} km</span>
        <span className="vp-views">
          <button
            className={mode === "earth" ? "tab active" : "tab"}
            onClick={() => setMode("earth")}
          >
            Earth
          </button>
          <button
            className={mode === "chase" ? "tab active" : "tab"}
            onClick={() => setMode("chase")}
          >
            Spacecraft
          </button>
        </span>
      </div>
      <div className="vp-bottom">
        <span className="vp-legend">
          radiator T
          <i className="vp-grad" style={{ background: infernoCssGradient() }} />
          {RAD_T_MIN_C}…{RAD_T_MAX_C} °C
        </span>
        <span className="vp-note">
          spacecraft ×50 000 scale — panel proportions are the sized areas
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- viewport

export function Viewport() {
  const [mode, setMode] = useState<ViewMode>("earth");
  return (
    <div className="viewport">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 42, near: 0.02, far: 600, position: [10, -12, 7] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Lights />
        <Earth />
        <OrbitTrace />
        <Spacecraft />
        <SunIndicator />
        <CameraRig mode={mode} />
      </Canvas>
      <ViewportOverlay mode={mode} setMode={setMode} />
    </div>
  );
}
