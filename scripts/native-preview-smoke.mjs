// Verify user-supplied PAK previews in the packaged WebView2 and real Rust IPC.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';

if (!process.argv[2]) throw new Error('Specify the KshinserverNEO2 PAK directory.');
const source = resolve(process.argv[2]);
const executable = resolve(
  process.env.APP_EXE ?? 'target/preview-distribution/release/simutrans-factory-graph.exe',
);
const output = resolve('test-results/native-previews');
mkdirSync(output, { recursive: true });
const port = await new Promise((resolvePort) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve('.reference/webview-preview-qa'),
  },
  stdio: 'ignore',
  windowsHide: true,
});
let browser;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  if (!browser) throw new Error('Could not connect to WebView2.');
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '産業チェーンを、読み込む。' })).toBeVisible();
  await page.evaluate((source) => {
    return window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
      event: 'tauri://drag-drop',
      payload: { paths: [source], position: { x: 400, y: 400 } },
    });
  }, source);
  await page.getByRole('button', { name: '読み込みを開始' }).click();
  await expect(page.getByRole('button', { name: '起点を選択する' })).toBeEnabled({
    timeout: 60000,
  });
  const stats = await page.evaluate(async (source) => {
    const id = window.__TAURI_INTERNALS__.transformCallback(() => {}, false);
    try {
      const report = await window.__TAURI_INTERNALS__.invoke('load_sources', {
        paths: [source],
        onProgress: `__CHANNEL__:${id}`,
      });
      return {
        industries: Object.keys(report.data.industries).length,
        previews: Object.keys(report.previews).length,
        imageErrors: report.diagnostics.filter((d) => d.code === 'image_error'),
      };
    } finally {
      window.__TAURI_INTERNALS__.unregisterCallback(id);
    }
  }, source);
  expect(stats).toEqual({ industries: 246, previews: 246, imageErrors: [] });
  await page.getByRole('button', { name: '起点を選択する' }).click();
  await page.getByRole('textbox', { name: '名前で検索' }).fill('MaterialsWholesales');
  await page.locator('.object-row').click();
  const detail = page.locator('.preview-panel img');
  await expect(detail).toBeVisible();
  expect(await detail.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: output + '/01-diy-detail.png' });
  await page.getByRole('button', { name: 'この産業から表示' }).click();
  await expect(page.locator('.root-node img')).toBeVisible();
  const lumber = page
    .locator('.react-flow__node')
    .filter({ has: page.locator('small', { hasText: /^Bretter$/ }) });
  await lumber.getByRole('button', { name: /の上流を展開/ }).click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  const sawmill = page
    .locator('.react-flow__node')
    .filter({ has: page.locator('small', { hasText: /^Saegewerk$/ }) });
  await expect(sawmill.locator('img')).toBeVisible();
  const invalid = await page
    .locator('.industry-image img')
    .evaluateAll(
      (images) => images.filter((img) => !img.complete || img.naturalWidth === 0).length,
    );
  expect(invalid).toBe(0);
  await page.screenshot({ path: output + '/02-diy-sawmill.png' });
  expect(errors).toEqual([]);
  console.log(
    'Native preview PASS: 246 industries, 246 PNG previews, no image errors; DIY and sawmill visible.',
  );
} finally {
  if (browser) await browser.close();
  child.kill();
}
