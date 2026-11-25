/**
 * Engine regression check.
 *   npx tsx scripts/regression/run.ts --write   # store snapshot (run on main)
 *   npx tsx scripts/regression/run.ts           # compare against snapshot
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTranscript } from '../../server/analysis/engine.js';
import { podcastFixtures } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapFile = path.join(here, 'podcast.snapshot.json');
const write = process.argv.includes('--write');

const log = console.log;
const results: Record<string, unknown> = {};
for (const f of podcastFixtures(fs.mkdtempSync(path.join(os.tmpdir(), 'niclip-reg-')))) {
  console.log = () => {};
  const moments = await analyzeTranscript(f.transcript, undefined, f.audioPath, undefined, undefined,
    { title: f.title, url: 'https://youtu.be/x' }, f.words.length ? f.words : undefined);
  console.log = log;
  results[f.name] = moments;
}

if (write) {
  fs.writeFileSync(snapFile, JSON.stringify(results, null, 1));
  log(`Snapshot written: ${Object.keys(results).length} fixtures`);
} else {
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  let ok = true;
  for (const [name, got] of Object.entries(results)) {
    const same = JSON.stringify(got) === JSON.stringify(snap[name]);
    ok &&= same;
    log(`${same ? 'SAME' : 'DIFF'}  ${name}  (${(got as unknown[]).length} clips)`);
  }
  process.exit(ok ? 0 : 1);
}
