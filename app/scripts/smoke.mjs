/**
 * Browser smoke test: serves the built app (vite preview), drives it with
 * system Chrome via puppeteer-core, and asserts the worker-driven UI is
 * actually live (projection headline filled, charts painted, telemetry
 * ticking, mission clock advancing under play). Usage:
 *   node scripts/smoke.mjs [--shot /path/screenshot.png]
 * Exits non-zero on any failure or page error.
 */
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const PORT = 4179;
const URL_BASE = `http://localhost:${PORT}/`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shotIdx = process.argv.indexOf("--shot");
const SHOT = shotIdx > -1 ? process.argv[shotIdx + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 15000, pollMs = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(pollMs);
  }
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let browser = null;
let failed = false;

try {
  await waitFor(async () => {
    try {
      const r = await fetch(URL_BASE);
      return r.ok;
    } catch {
      return false;
    }
  }, "preview server");

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-first-run", "--disable-extensions"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000 });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(URL_BASE, { waitUntil: "networkidle0" });

  const text = (sel) => page.$eval(sel, (el) => el.textContent ?? "");

  // 1. projection headline (analysis worker round-trip)
  await waitFor(
    async () => !(await text(".headline-fom b")).includes("–"),
    "projection headline",
  );
  const fom = await text(".headline-fom b");
  console.log(`headline PFLOP-yr/t: ${fom}`);
  if (!(parseFloat(fom) > 0)) throw new Error(`bad figure of merit: ${fom}`);

  // 2. live tick sample flowing (sim worker)
  await waitFor(async () => {
    const v = await page.$$eval(".stat-value", (els) =>
      els.map((e) => e.textContent ?? ""),
    );
    return v.length >= 10 && !v[0].includes("–");
  }, "telemetry strip samples");

  // 3. orbit charts painted
  const nOrbitCanvas = (await page.$$(".chart canvas")).length;
  console.log(`orbit-mode canvases: ${nOrbitCanvas}`);
  if (nOrbitCanvas < 3) throw new Error("orbit charts missing");

  // 4. play advances the mission clock
  const t0 = await text(".time-readouts .ro");
  await page.click(".transport .play");
  await sleep(2500);
  const t1 = await text(".time-readouts .ro");
  console.log(`clock: "${t0}" -> "${t1}"`);
  if (t0 === t1) throw new Error("mission clock did not advance under play");
  await page.click(".transport .play"); // pause

  // 5. mission tab renders its chart stack
  await page.$$eval(".charts-tabs .tab", (btns) => {
    const b = btns.find((x) => x.textContent?.trim() === "Mission");
    if (b) b.click();
  });
  await waitFor(
    async () => (await page.$$(".chart canvas")).length >= 6,
    "mission charts",
  );
  console.log(`mission-mode canvases: ${(await page.$$(".chart canvas")).length}`);

  // 6. move a slider (altitude) -> headline re-projects to a new value
  await page.$$eval(".sidebar .field input[type=range]", (els) => {
    const el = els[0]; // first Orbit field = altitude
    if (!el) throw new Error("no sliders");
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, "900");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitFor(
    async () => (await text(".headline-fom b")) !== fom,
    "projection update after slider move",
  );
  console.log(`headline after altitude change: ${await text(".headline-fom b")}`);

  // 6b. eclipse pipeline: ISS-like profile at t=0 has beta ~0 -> the badge
  // must flip to ECLIPSE within a couple of orbits of play
  await page.select(".sidebar select", "mid_incl");
  await sleep(500); // re-init debounce
  await page.click(".transport .play");
  await waitFor(
    async () => (await text(".vp-badge")).includes("ECLIPSE"),
    "eclipse badge on ISS-like orbit",
    20000,
  );
  console.log("eclipse badge: OK");
  if (SHOT) {
    await page.screenshot({ path: SHOT.replace(/\.png$/, "_eclipse.png") });
  }
  await page.click(".transport .play"); // pause

  // 7. reset, run the full mission, confirm completion at 5 yr
  await page.click("button.ghost"); // reset
  await sleep(500); // debounce + re-init
  await page.$$eval(".transport button", (btns) => {
    const b = btns.find((x) => (x.textContent ?? "").includes("end"));
    if (b) b.click();
  });
  await waitFor(
    async () => (await text(".time-readouts .ro")).includes("5.00 yr"),
    "run to end of mission",
  );
  console.log(`end state: ${await text(".time-readouts")}`);

  // 8. 3D viewport: WebGL canvas alive, badge showing, chase view works
  const vpCanvas = await page.$(".viewport canvas");
  if (!vpCanvas) throw new Error("3D viewport canvas missing");
  const badge = await text(".vp-badge");
  console.log(`viewport badge: ${badge}`);
  if (!/SUNLIT|ECLIPSE/.test(badge)) throw new Error("viewport badge missing");
  const glOk = await page.evaluate(() => {
    const c = document.querySelector(".viewport canvas");
    if (!(c instanceof HTMLCanvasElement)) return false;
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    return gl !== null && !gl.isContextLost();
  });
  if (!glOk) throw new Error("WebGL context lost/missing");
  if (SHOT) {
    await page.screenshot({ path: SHOT.replace(/\.png$/, "_earth.png") });
  }
  await page.$$eval(".vp-views .tab", (btns) => {
    const b = btns.find((x) => x.textContent?.trim() === "Spacecraft");
    if (b) b.click();
  });
  await sleep(800); // let the chase camera settle for the screenshot

  if (SHOT) {
    await page.screenshot({ path: SHOT, fullPage: false });
    console.log(`screenshot: ${SHOT}`);
  }

  if (errors.length) {
    throw new Error(`page errors:\n${errors.join("\n")}`);
  }
  console.log("SMOKE OK");
} catch (e) {
  failed = true;
  console.error(`SMOKE FAILED: ${e.message}`);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
