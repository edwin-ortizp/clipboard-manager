// Read-only live check using an isolated instance of the supplied application binary.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const binary = resolve(process.argv[2] || 'src-tauri/target/release/clipboard-manager.exe');
const fixture = resolve('.tools', `live-updater-${Date.now()}`);
await mkdir(fixture, { recursive: true });
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const child = spawn(binary, ['--data-dir', fixture, '--no-capture'], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve(fixture, 'webview'),
  },
});
let browser;
try {
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error('Isolated app did not start');
    await new Promise((done) => setTimeout(done, 150));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  while (
    !(page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('tauri.localhost')))
  ) {
    if (Date.now() > deadline) throw new Error('Manager did not open');
    await new Promise((done) => setTimeout(done, 100));
  }
  await page.getByRole('button', { name: 'Ajustes', exact: false }).click();
  await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Tienes la última versión' })
    .waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('button', { name: 'Actualizar y reiniciar' }).count(), 0);
  const installedVersion = await page.getByText(/^Versión instalada:/).innerText();
  const result = {
    result: 'passed',
    binary,
    installedVersion,
    status: 'Tienes la última versión',
    fixture,
  };
  await writeFile(resolve(fixture, 'result.json'), JSON.stringify(result, null, 2));
  await page.screenshot({ path: resolve(fixture, 'settings.png') });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
  }
}
