// Integration check with user-supplied, separately downloaded PAK assets.
// Usage: node scripts/verify-paksets.mjs <Japan dir> <pak64 dir> [Japan 112 source dir]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const [japanDir, pak64Dir, sourceDir] = process.argv.slice(2);
if (!japanDir || !pak64Dir) throw new Error('Specify Japan 120.0 and pak64 124.3 directories.');
const baseline = JSON.parse(
  readFileSync(new URL('../docs/pakset-baselines.json', import.meta.url), 'utf8'),
);
const reports = [];
for (const [name, directory] of [
  ['japan', japanDir],
  ['pak64', pak64Dir],
]) {
  const cli = process.env.PAK_CLI ?? resolve('target/debug/pak-cli.exe');
  const run = spawnSync(cli, [directory], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const report = JSON.parse(run.stdout);
  const graph = report.data;
  assert.equal(report.files_failed, 0);
  assert.equal(report.diagnostics.length, 0);
  assert.equal(report.files_loaded, baseline[name].files);
  assert.equal(Object.keys(graph.industries).length, baseline[name].industries);
  assert.equal(Object.keys(graph.goods).length, baseline[name].goods);
  let edges = 0;
  for (const industry of Object.values(graph.industries)) {
    edges += industry.inputs.length + industry.outputs.length;
    for (const good of industry.inputs)
      assert.ok(graph.goods[good].consumers.includes(industry.id));
    for (const good of industry.outputs)
      assert.ok(graph.goods[good].producers.includes(industry.id));
  }
  assert.equal(edges, baseline[name].edges);
  // File hashes make the selected release exact, even if archive mirrors change.
  const hash = createHash('sha256');
  for (const file of readdirSync(directory)
    .filter((f) => f.toLowerCase().endsWith('.pak'))
    .sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(directory, file)));
  }
  assert.equal(hash.digest('hex'), baseline[name].pak_files_sha256);
  console.log(
    `${name}: ${report.files_loaded} files, ${Object.keys(graph.industries).length} industries, ${Object.keys(graph.goods).length} goods, ${edges} edges; PASS`,
  );
  reports.push(report);
}

if (sourceDir) {
  const graph = reports[0].data;
  const expectedNames = new Set([
    'suiden',
    'komesouko',
    'hatake',
    'noukyou_souko',
    'supermarket',
    'bento_plant',
    'fish_processing_plant',
    'uoichiba',
  ]);
  const verified = new Set();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.name.endsWith('.dat')) continue;
      const data = readFileSync(path, 'utf8');
      for (const block of data.split(/^\s*-{3,}.*$/m)) {
        const fields = new Map(
          [...block.matchAll(/^\s*([^#=\r\n]+?)\s*=\s*([^\r\n]*)/gm)].map((m) => [
            m[1].toLowerCase(),
            m[2].trim(),
          ]),
        );
        const name = fields.get('name');
        if (fields.get('obj')?.toLowerCase() !== 'factory' || !expectedNames.has(name)) continue;
        const industry = graph.industries[`industry:${name}`];
        assert.ok(industry, `Missing ${name}`);
        for (const [prefix, actual] of [
          ['inputgood', industry.inputs],
          ['outputgood', industry.outputs],
        ]) {
          const expected = [...fields]
            .filter(([key]) => key.startsWith(prefix + '['))
            .map(([, value]) => `goods:${value}`)
            .sort();
          assert.deepEqual(actual, expected, `${name} ${prefix} mismatch against published DAT`);
        }
        verified.add(name);
      }
    }
  }
  visit(sourceDir);
  assert.equal(verified.size, expectedNames.size);
  console.log(`Japan published DAT: ${verified.size} representative factories matched; PASS`);
}
