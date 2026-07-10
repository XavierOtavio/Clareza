import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type PackageManifest = {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("uses the standard Next.js lifecycle", () => {
  const manifest = JSON.parse(read("package.json")) as PackageManifest;

  assert.equal(manifest.scripts.dev, "next dev");
  assert.equal(manifest.scripts.build, "next build");
  assert.equal(manifest.scripts.start, "next start");
});

test("has no Cloudflare or Vinext runtime dependencies", () => {
  const manifest = JSON.parse(read("package.json")) as PackageManifest;
  const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
  const forbidden = ["cloudflare", "d1", "drizzle", "vinext", "vite", "wrangler"];

  for (const name of names) {
    assert.equal(forbidden.some((term) => name.toLowerCase().includes(term)), false, `${name} is not Vercel runtime-neutral`);
  }

  assert.doesNotMatch(read("db/index.ts"), /cloudflare:workers|env\.DB/);
});

test("declares Vercel and Supabase deployment assets", () => {
  const vercel = JSON.parse(read("vercel.json")) as { framework: string; regions: string[] };

  assert.equal(vercel.framework, "nextjs");
  assert.deepEqual(vercel.regions, ["fra1"]);
  assert.match(read("supabase/migrations/202607100001_clareza_foundation.sql"), /enable row level security/i);
  assert.match(read(".env.example"), /SUPABASE_SERVICE_ROLE_KEY=/);
});
