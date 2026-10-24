/**
 * Publish the built app (dist/) to the gh-pages branch, which GitHub Pages
 * serves at https://pratik-ingle.github.io/Space-data-centers/. The commit is
 * built with git plumbing (temporary index, parent = the remote's current
 * gh-pages tip), so the working tree and checked-out branch are never touched
 * and the branch keeps its history (plain push, never forced). Usage:
 *   npm run deploy        # builds first
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REMOTE = "origin";
const BRANCH = "gh-pages";
const dist = resolve("dist");

const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", ...opts }).trim();

if (!existsSync(join(dist, "index.html"))) {
  throw new Error("dist/index.html missing — run `npm run build` first");
}
writeFileSync(join(dist, ".nojekyll"), ""); // serve files as-is, no Jekyll pass

let parent = null;
try {
  git(["fetch", "--quiet", REMOTE, BRANCH], { stdio: ["ignore", "pipe", "ignore"] });
  parent = git(["rev-parse", "FETCH_HEAD"]);
} catch {
  console.log(`no ${REMOTE}/${BRANCH} yet — creating it`);
}

const src = git(["rev-parse", "--short", "HEAD"]);
const dirty = git(["status", "--porcelain", "--", "."]) !== "";
const tmp = mkdtempSync(join(tmpdir(), "deploy-pages-"));
try {
  const plumbing = {
    cwd: dist,
    env: { ...process.env, GIT_INDEX_FILE: join(tmp, "index") },
  };
  const gitDir = git(["rev-parse", "--absolute-git-dir"]);
  const scoped = ["--git-dir", gitDir, "--work-tree", dist];
  git([...scoped, "add", "--all", "."], plumbing);
  const tree = git([...scoped, "write-tree"], plumbing);

  if (parent && git(["rev-parse", `${parent}^{tree}`]) === tree) {
    console.log(`${BRANCH} already serves this build — nothing to deploy`);
  } else {
    const msg = `Deploy app from ${src}${dirty ? " (+ uncommitted changes)" : ""}`;
    const commit = git(["commit-tree", tree, "-m", msg, ...(parent ? ["-p", parent] : [])]);
    git(["push", "--quiet", REMOTE, `${commit}:refs/heads/${BRANCH}`]);
    console.log(`deployed ${src} -> ${REMOTE}/${BRANCH} ${commit.slice(0, 7)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
