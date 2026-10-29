// Exercises the packaged Rust backend and real WebView2 with disposable local data.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const data = resolve('.tools', `smoke-${Date.now()}`);
await mkdir(data, { recursive: true });
await mkdir(resolve('artifacts'), { recursive: true });
let active = 0,
  maxActive = 0;
const received = [];
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const content = JSON.parse(body).messages[0].content;
  received.push(content);
  active++;
  maxActive = Math.max(maxActive, active);
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      active--;
    }
  };
  res.on('close', finish);
  setTimeout(
    () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        content.includes('[BAD]')
          ? '{}'
          : JSON.stringify({ choices: [{ message: { content: `Resultado: ${content}` } }] }),
      );
      finish();
    },
    content.includes('[SLOW]') ? 4000 : 80,
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const debugProbe = createServer();
await new Promise((r) => debugProbe.listen(0, '127.0.0.1', r));
const debugPort = debugProbe.address().port;
await new Promise((r) => debugProbe.close(r));
let child, browser, page;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, description, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      last = e;
    }
    await delay(100);
  }
  throw new Error(`Timeout: ${description}${last ? ` (${last.message})` : ''}`);
}
async function launch() {
  child = spawn(
    resolve('src-tauri/target/release/clipboard-manager.exe'),
    ['--data-dir', data, '--no-capture'],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
        WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
      },
      stdio: 'ignore',
    },
  );
  await until(
    async () => {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return r.ok;
    },
    'WebView2 CDP',
    60000,
  );
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  page = await until(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => !p.url().includes('?widget') && p.url().includes('tauri.localhost')),
    'manager page',
  );
  await page.waitForSelector('h1');
}
async function stop() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  }
  await delay(500);
}
async function call(command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
}
async function snapshot() {
  return call('snapshot');
}
async function status(id, expected) {
  return until(
    async () => (await snapshot()).jobs.find((j) => j.id === id)?.status === expected,
    `job ${id}: ${expected}`,
  );
}
const metrics = {};
try {
  // Start from the exact 0.1 schema, without touching the installed app's data.
  execFileSync('python', [
    '-c',
    `import sqlite3,sys,json,time
c=sqlite3.connect(sys.argv[1])
c.executescript("CREATE TABLE clips(id INTEGER PRIMARY KEY AUTOINCREMENT,text TEXT NOT NULL UNIQUE,favorite INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL); CREATE TABLE prompts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,instructions TEXT NOT NULL,favorite INTEGER NOT NULL,position INTEGER NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,input TEXT NOT NULL,prompt_name TEXT NOT NULL,instructions TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,source_ids TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',output TEXT,error TEXT,created INTEGER NOT NULL);")
c.execute('INSERT INTO clips VALUES(1,?,1,?)',('Texto de prueba 0: Árbol 🦀',int(time.time()*1000)))
c.execute('INSERT INTO prompts VALUES(1,?,?,1,0)',('Corregir escritura','Corrige: {{text}}'))
c.execute('INSERT INTO settings VALUES(1,?)',(json.dumps(dict(base_url='http://localhost:9999/v1',model='legacy',limit=1000,shortcut='Ctrl+Alt+Shift+F11',paused=False,autostart=False)),))
c.commit()`,
    resolve(data, 'clipia.sqlite3'),
  ]);
  await launch();
  assert.equal((await snapshot()).settings.model, 'legacy');
  assert.equal((await snapshot()).settings.auto_copy, true);
  execFileSync('python', [
    '-c',
    `import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1]); now=int(time.time()*1000)
c.executemany('INSERT INTO clips(text,created) VALUES(?,?)', [(f'Texto de prueba {i}: Árbol 🦀',now+i) for i in range(1,1000)])
c.execute("UPDATE clips SET text='[SLOW] Texto lento' WHERE id=3")
c.execute("UPDATE clips SET text='[BAD] Respuesta inválida' WHERE id=4")
c.commit()`,
    resolve(data, 'clipia.sqlite3'),
  ]);
  const s = await snapshot();
  await call('save_settings', {
    settings: {
      ...s.settings,
      model: 'fixture-model',
      base_url: endpoint,
      shortcut: 'Ctrl+Alt+Shift+F11',
      limit: 1500,
      notifications: false,
    },
    key: null,
  });
  assert.deepEqual(await call('models', { baseUrl: endpoint }), ['fixture-model']);
  assert.match(
    await call('test_provider', { baseUrl: endpoint, model: 'fixture-model' }),
    /verificadas/,
  );
  assert.equal(
    (await call('list_clips', { query: 'árbol', favorite: false, offset: 0 })).length,
    50,
  );
  assert.equal((await call('list_clips', { query: '', favorite: false, offset: 950 })).length, 50);
  const prompt = s.prompts[0];
  await call('queue_control', { paused: true });
  await call('enqueue', { ids: [1, 2], promptId: prompt.id, join: false });
  const initialJobs = (await snapshot()).jobs;
  assert.equal(initialJobs.filter((j) => j.status === 'pending').length, 2);
  await call('save_prompt', { prompt: { ...prompt, instructions: 'NUEVO PROMPT: {{text}}' } });
  await call('queue_control', { paused: false });
  for (const job of initialJobs) await status(job.id, 'completed');
  const results = await call('list_clips', { query: 'Resultado:', favorite: false, offset: 0 });
  assert.equal(results.length, 2);
  assert(results.every((c) => c.origin === 'ai'));
  const compared = await call('clip_comparison', { id: results[0].id });
  assert(compared.original.startsWith('Texto de prueba'));
  assert.equal(compared.result, await call('clip_text', { id: results[0].id }));
  assert.equal(maxActive, 1, 'normal jobs must run sequentially');
  assert(received.some((t) => t.includes('Texto de prueba 0')));
  assert(
    !received.some((t) => t.startsWith('NUEVO PROMPT')),
    'queued prompts must retain their snapshot',
  );
  await call('enqueue', { ids: [2, 1], promptId: prompt.id, join: true });
  let job = (await snapshot()).jobs[0];
  await status(job.id, 'completed');
  assert.equal(job.input, 'Texto de prueba 1: Árbol 🦀\n\nTexto de prueba 0: Árbol 🦀');
  await call('enqueue', { ids: [4], promptId: prompt.id, join: false });
  job = (await snapshot()).jobs[0];
  await status(job.id, 'failed');
  assert.match((await snapshot()).jobs[0].error, /no devolvió texto/);
  await call('queue_control', { paused: true });
  await call('job_action', { id: job.id, action: 'retry' });
  await status(job.id, 'pending');
  await call('job_action', { id: job.id, action: 'cancel' });
  await status(job.id, 'cancelled');
  await call('enqueue', { ids: [3, 1], promptId: prompt.id, join: false });
  const cancelJobs = (await snapshot()).jobs.filter((j) => j.status === 'pending');
  const slow = cancelJobs.find((j) => j.input.startsWith('[SLOW]'));
  const next = cancelJobs.find((j) => !j.input.startsWith('[SLOW]'));
  await call('queue_control', { paused: false });
  await status(slow.id, 'running');
  await call('job_action', { id: slow.id, action: 'cancel' });
  await status(slow.id, 'cancelled');
  await status(next.id, 'completed');
  // A retry of the same cancelled id must not inherit its old cancellation signal.
  await call('job_action', { id: slow.id, action: 'retry' });
  await status(slow.id, 'running');
  await call('enqueue', { ids: [2], promptId: prompt.id, join: false });
  const pendingId = (await snapshot()).jobs[0].id;
  await stop();
  await launch();
  const restarted = await snapshot();
  assert.equal(restarted.queue_paused, true);
  assert.equal(restarted.jobs.find((j) => j.id === slow.id).status, 'failed');
  assert.equal(restarted.jobs.find((j) => j.id === pendingId).status, 'pending');
  await call('queue_control', { paused: false });
  await status(pendingId, 'completed');
  await until(async () => Boolean((await snapshot()).last_delivery), 'delivery summary');
  assert.match((await snapshot()).last_delivery, /historial/);
  const dictionaryPath = resolve(data, 'equivalences.tsv');
  await writeFile(dictionaryPath, 'prueba\tvalidado\tword\tnocase\n');
  assert.equal((await call('check_mappings', { path: dictionaryPath })).rules, 1);
  await call('save_settings', {
    settings: { ...(await snapshot()).settings, mappings_path: dictionaryPath },
    key: null,
  });
  const applied = await call('apply_mappings', { id: 1 });
  assert.equal(applied.changes, 1);
  assert.equal(applied.id, 1);
  assert.equal(await call('clip_text', { id: 1 }), 'Texto de validado 0: Árbol 🦀');
  const mapped = (await call('list_clips', { query: 'validado', favorite: true, offset: 0 }))[0];
  assert.equal(mapped.origin, 'dictionary');
  assert.equal(mapped.id, 1);
  assert.equal((await call('apply_mappings', { id: 1 })).changes, 0);
  await writeFile(dictionaryPath, 'validado\trecargado\tword\tnocase\n');
  assert.equal((await call('apply_mappings', { id: 1 })).changes, 1);
  assert.equal(await call('clip_text', { id: 1 }), 'Texto de recargado 0: Árbol 🦀');
  await writeFile(dictionaryPath, 'invalid\tline');
  await assert.rejects(() => call('apply_mappings', { id: 1 }));
  assert.equal(await call('clip_text', { id: 1 }), 'Texto de recargado 0: Árbol 🦀');
  await writeFile(dictionaryPath, 'Texto de\tX\tword\tcase\nde recargado 0\tY\tword\tcase\n');
  await call('apply_mappings', { id: 1 });
  assert.equal(await call('clip_text', { id: 1 }), 'Texto Y: Árbol 🦀');
  execFileSync('python', [
    '-c',
    `from PIL import Image
import sqlite3,sys,hashlib,pathlib
p=pathlib.Path(sys.argv[1]);d=p/'media';d.mkdir(exist_ok=True)
im=Image.new('RGBA',(160,100),(115,87,223,120));import io
b=io.BytesIO();im.save(b,format='PNG');raw=b.getvalue();h=hashlib.sha256(raw).hexdigest()
(d/(h+'.png')).write_bytes(raw);(d/(h+'.thumb.png')).write_bytes(raw)
c=sqlite3.connect(p/'clipia.sqlite3');c.execute("INSERT INTO clips(text,kind,width,height,created) VALUES(?,'image',160,100,9999999999999)",('image:'+h,));c.commit()`,
    data,
  ]);
  const imageClip = (await call('list_clips', { query: 'Imagen', favorite: false, offset: 0 }))[0];
  assert.equal(imageClip.kind, 'image');
  assert.match(
    await call('clip_image', { id: imageClip.id, thumbnail: true }),
    /^data:image\/png;base64,/,
  );
  assert.match(
    await call('clip_image', { id: imageClip.id, thumbnail: false }),
    /^data:image\/png;base64,/,
  );
  await assert.rejects(() =>
    call('enqueue', { ids: [imageClip.id], promptId: prompt.id, join: false }),
  );
  // Refresh actual UI, inspect the packaged screens and measure page render at 1000 rows.
  const start = performance.now();
  await page.reload();
  await page.waitForSelector('.clip-card');
  metrics.managerRenderMs = Math.round(performance.now() - start);
  assert.equal(await page.locator('.clip-card').count(), 50);
  await page.screenshot({ path: resolve('artifacts/native-manager.png') });
  const aiCard = page
    .locator('.clip-card')
    .filter({ has: page.locator('.ai-chip') })
    .first();
  await aiCard.getByRole('button', { name: 'Ver cambios' }).click();
  await page.waitForSelector('.diff-text');
  assert(await page.getByRole('dialog').locator('.ai-chip').isVisible());
  await page.screenshot({ path: resolve('artifacts/native-comparison.png') });
  await page.keyboard.press('Escape');
  const widgetStart = performance.now();
  await call('toggle_widget');
  console.log('Native windows:', await call('plugin:window|get_all_windows').catch(String));
  const widget = await until(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('?widget')),
    'widget page',
  );
  if (widget) {
    await widget.waitForSelector('.clip-card');
    metrics.widgetOpenMs = Math.round(performance.now() - widgetStart);
    await widget.screenshot({ path: resolve('artifacts/native-widget.png') });
  }
  await widget.getByRole('button', { name: 'Cerrar widget', exact: true }).click();
  await until(() => widget.isClosed(), 'close button destroys the widget');
  assert.equal(child.exitCode, null, 'close button must keep the application running');
  assert.equal((await snapshot()).settings.paused, false, 'capture preference must stay enabled');
  await call('toggle_widget');
  const reopened = await until(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('?widget')),
    'reopened widget',
  );
  await reopened.getByRole('button', { name: 'Cerrar widget', exact: true }).waitFor();
  await reopened.keyboard.press('Escape');
  await until(() => reopened.isClosed(), 'Escape closes reopened widget');
  metrics.widgetCloseAndReopen = 'passed';
  const processMetrics = () =>
    JSON.parse(
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child.pid}); do {$added=$false; foreach($item in $all){if($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)){$added=$true}}}while($added); $procs=Get-Process -Id @($ids) -ErrorAction SilentlyContinue; @{processes=$procs.Count;workingSetMB=[math]::Round(($procs | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);privateMB=[math]::Round(($procs | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1);cpuSeconds=($procs | Measure-Object CPU -Sum).Sum}|ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' },
      ),
    );
  await delay(1000);
  const before = processMetrics();
  const idleStart = performance.now();
  await delay(2000);
  const after = processMetrics();
  metrics.idle = {
    ...after,
    cpuOneCorePercent:
      Math.round(
        ((after.cpuSeconds - before.cpuSeconds) / ((performance.now() - idleStart) / 1000)) * 1000,
      ) / 10,
  };
  metrics.entries = 1000;
  metrics.jobs = (await snapshot()).jobs.length;
  await call('close_manager').catch(() => {});
  await browser.close().catch(() => {});
  browser = null;
  await delay(3000);
  assert.equal(child.exitCode, null, 'closing all windows must keep the Rust process alive');
  const bgBefore = processMetrics();
  const bgStart = performance.now();
  await delay(2000);
  const bgAfter = processMetrics();
  metrics.background = {
    ...bgAfter,
    cpuOneCorePercent:
      Math.round(
        ((bgAfter.cpuSeconds - bgBefore.cpuSeconds) / ((performance.now() - bgStart) / 1000)) *
          1000,
      ) / 10,
  };
  metrics.result = 'passed';
  metrics.fixtureDirectory = data;
  await writeFile(resolve('artifacts/native-smoke.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} catch (error) {
  console.error(
    'CDP targets:',
    await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      .then((r) => r.json())
      .catch(() => []),
  );
  await writeFile(
    resolve('artifacts/native-smoke.json'),
    JSON.stringify({ result: 'failed', error: String(error), fixtureDirectory: data }, null, 2),
  );
  throw error;
} finally {
  await stop();
  await new Promise((r) => server.close(r));
}
