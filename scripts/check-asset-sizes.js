#!/usr/bin/env node
/**
 * Cloudflare Pages hard-caps any single deployed file at 25 MiB
 * ("Pages only supports files up to 25 MiB in size"). This repo ships a
 * couple dozen music/video assets under public/, and it's easy to drop in
 * an oversized export without noticing until Cloudflare's build fails.
 *
 * Run this before pushing (or wire it in as the Cloudflare Pages "Build
 * command") to catch an oversized file locally instead of waiting on a
 * failed deploy: `npm run check:sizes`
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const HARD_LIMIT_MB = 25;
const WARN_LIMIT_MB = 20; // flag anything getting close, even if it still passes

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error(`check-asset-sizes: no public/ directory found at ${ROOT}`);
  process.exit(1);
}

const files = walk(ROOT);
let failed = false;
let warned = false;

for (const file of files) {
  const bytes = fs.statSync(file).size;
  const mb = bytes / (1024 * 1024);
  const rel = path.relative(ROOT, file);
  if (mb > HARD_LIMIT_MB) {
    console.error(`FAIL  ${rel} — ${mb.toFixed(1)} MiB (over the ${HARD_LIMIT_MB} MiB Cloudflare Pages limit)`);
    failed = true;
  } else if (mb > WARN_LIMIT_MB) {
    console.warn(`WARN  ${rel} — ${mb.toFixed(1)} MiB (getting close to the ${HARD_LIMIT_MB} MiB limit)`);
    warned = true;
  }
}

if (failed) {
  console.error(`\ncheck-asset-sizes: one or more files in public/ exceed Cloudflare Pages' ${HARD_LIMIT_MB} MiB per-file limit.`);
  console.error('Compress or remove the file(s) above before deploying (see ffmpeg -b:a for audio, or host large media externally).');
  process.exit(1);
}

console.log(`check-asset-sizes: OK — ${files.length} files under public/, all within the ${HARD_LIMIT_MB} MiB Cloudflare Pages limit.`);
if (warned) console.log('(Some files are within 5 MiB of the limit — worth keeping an eye on.)');
