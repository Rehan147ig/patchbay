/**
 * Gate 0 real-repo precision probe (Gap #3).
 * Clones 5 uncurated public repos and measures findHttpCallsites recall/precision.
 * Not a certification gate - a development measurement to make Gate 0 claims real.
 * Run: npx tsx packages/repo-analysis/scripts/eval-http-matcher.ts
 */
import { findHttpCallsites } from "../src/http-matcher";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const REPOS = [
  "https://github.com/vercel/next.js",
  "https://github.com/prisma/prisma",
  "https://github.com/supabase/supabase",
  "https://github.com/axios/axios",
  "https://github.com/twilio/twilio-node",
];

async function cloneAndScan(
  url: string,
  tmpRoot: string,
): Promise<{ repo: string; hits: number; files: number }> {
  const name = url.split("/").pop() ?? "repo";
  const dir = path.join(tmpRoot, name);
  execSync(`git clone --depth 1 ${url} ${dir}`, { stdio: "ignore" });
  let files = 0;
  let hits = 0;
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
        await walk(path.join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) {
        files++;
        const src = await fs.readFile(path.join(d, e.name), "utf8");
        hits += findHttpCallsites(src, path.relative(dir, path.join(d, e.name))).length;
      }
    }
  }
  await walk(dir);
  return { repo: name, hits, files };
}

async function main(): Promise<void> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "patch-eval-http-"));
  console.log(`Cloning 5 repos into ${tmpRoot}...`);
  for (const url of REPOS) {
    try {
      const { repo, hits, files } = await cloneAndScan(url, tmpRoot);
      console.log(`${repo}: ${hits} literal HTTP callsites in ${files} files`);
    } catch (e) {
      console.error(`Failed ${url}: ${String(e)}`);
    }
  }
  console.log("Done. Gate 0 claim is theoretical until this is run and precision measured.");
  // Keep tmp for inspection; remove manually.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
