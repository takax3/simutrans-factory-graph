// Run the packaged WebView2 UI against the real Rust IPC, without a web server.
// A Tauri drag-drop event supplies fixture paths; parsing and IPC are not mocked.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';

const executable = resolve(process.env.APP_EXE ?? 'target/release/simutrans-factory-graph.exe');
const source = resolve(process.argv[2] ?? '.reference/paksets/japan/pak128.japan');
const output = resolve('test-results/native');
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
    WEBVIEW2_USER_DATA_FOLDER: resolve('.reference/webview-qa'),
  },
  stdio: 'ignore',
  windowsHide: true,
});
let browser;
const errors = [];
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  if (!browser) throw new Error('Could not connect to the application WebView2.');
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 10000 }));
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '産業チェーンを、読み込む。' })).toBeVisible();
  await page.screenshot({ path: `${output}/01-sources.png` });
  await page.evaluate(
    (source) =>
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
        event: 'tauri://drag-drop',
        payload: { paths: [source], position: { x: 300, y: 400 } },
      }),
    source,
  );
  await expect(page.getByRole('button', { name: '読み込みを開始' }))
    .toBeEnabled({ timeout: 5000 })
    .catch(async (error) => {
      console.error(await page.locator('body').innerText());
      console.error(
        await page.evaluate(() => ({
          url: location.href,
          isTauri: window.isTauri,
          invoke: String(window.__TAURI_INTERNALS__?.invoke),
        })),
      );
      throw error;
    });
  await page.getByRole('button', { name: '読み込みを開始' }).click();
  await expect(page.getByText('読み込みが完了しました')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.metrics')).toContainText('48');
  await expect(page.locator('.metrics')).toContainText('63');
  await page.getByRole('button', { name: '起点を選択する' }).click();
  await page.getByRole('textbox', { name: '名前で検索' }).fill('スーパーマーケット');
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.getByRole('textbox', { name: '名前で検索' }).fill('supermarket');
  await page.locator('.object-row').click();
  await expect(page.locator('.preview-panel')).toContainText('要求する貨物');
  await page.screenshot({ path: `${output}/02-selection.png` });
  await page.getByRole('button', { name: 'この産業から表示' }).click();
  await expect(page.locator('.canvas-caption')).toContainText('6 / 1,000');
  const food = page.locator('.react-flow__node').filter({ hasText: 'bento12' });
  expect((await page.locator('.react-flow').boundingBox()).height).toBeGreaterThan(300);
  await food.getByRole('button', { name: /の上流を/ }).click();
  await expect(page.locator('.canvas-caption')).toContainText('7 / 1,000');
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  const plant = page.locator('.react-flow__node').filter({ hasText: 'bento_plant' });
  await plant.getByRole('button', { name: /の上流を/ }).click();
  await expect(page.locator('.canvas-caption')).toContainText('10 / 1,000');
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await page.screenshot({ path: `${output}/03-graph.png` });
  await food.getByRole('button', { name: /の上流を/ }).click();
  await expect(page.locator('.canvas-caption')).toContainText('6 / 1,000');
  await page.getByRole('button', { name: '起点へ戻る' }).click();
  await page.getByRole('button', { name: '起点変更', exact: true }).click();
  await page.getByRole('tab', { name: /貨物/ }).click();
  await page.getByRole('textbox', { name: '名前で検索' }).fill('Bucher3');
  await page.locator('.object-row').click();
  await page.getByRole('button', { name: 'この貨物から表示' }).click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: 'Bucher43' })
    .getByRole('button', { name: /の上流を/ })
    .click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: 'Bucher4' })
    .filter({ hasNotText: 'Bucher43' })
    .getByRole('button', { name: /の上流を/ })
    .click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: 'Bucher34' })
    .getByRole('button', { name: /の上流を/ })
    .click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await expect(page.getByText('循環参照・展開停止')).toBeVisible();
  await page.screenshot({ path: `${output}/04-cycle.png` });
  await page.getByRole('button', { name: '起点変更', exact: true }).click();
  await page.getByRole('tab', { name: /産業/ }).click();
  await page.getByRole('textbox', { name: '名前で検索' }).fill('bento_plant');
  await page.locator('.object-row').click();
  await page.getByRole('button', { name: 'この産業から表示' }).click();
  await expect(page.getByRole('combobox', { name: '探索方向' })).toHaveCount(0);
  await expect(page.locator('.root-node')).toHaveCount(1);
  await expect(page.locator('.root-node .root-label')).toHaveText('起点');
  const rootNode = page.locator('[data-id="root"]');
  const upstreamNode = page.locator('[data-id="root/u0"]');
  const downstreamNode = page.locator('[data-id="root/d0"]');
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  const rootBox = await rootNode.boundingBox();
  expect((await upstreamNode.boundingBox()).y).toBeLessThan(rootBox.y);
  expect((await downstreamNode.boundingBox()).y).toBeGreaterThan(rootBox.y + rootBox.height);
  await downstreamNode.getByRole('button', { name: /の下流を展開/ }).click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'supermarket' })).toBeVisible();
  const childBox = await page.locator('[data-id="root/d0/d0"]').boundingBox();
  expect(childBox.y).toBeGreaterThan((await downstreamNode.boundingBox()).y);
  await rootNode.getByRole('button', { name: /の上流を折り畳む/ }).click();
  await expect(page.locator('[data-id="root/u0"]')).toHaveCount(0);
  await expect(page.locator('[data-id="root/d0/d0"]')).toHaveCount(1);
  await rootNode.getByRole('button', { name: /の上流を展開/ }).click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  await upstreamNode.getByRole('button', { name: /の上流を展開/ }).click();
  await page.getByRole('button', { name: '表示中のノードを全体表示' }).click();
  expect((await page.locator('[data-id="root/u0/u0"]').boundingBox()).y).toBeLessThan(
    (await upstreamNode.boundingBox()).y,
  );
  await page.screenshot({ path: output + '/05-bidirectional.png' });
  assertNoErrors();
  console.log(
    'Native smoke PASS: embedded UI, real IPC, Japan import, Japanese search, simultaneous upstream/downstream expansion, independent collapse, vertical layout and highlighted root, goods root and cycle stop.',
  );
  console.log(`Screenshots: ${output}`);
} finally {
  if (browser) await browser.close();
  child.kill();
}
function assertNoErrors() {
  if (errors.length) throw new Error(errors.join('\n'));
}
