import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

process.env.LASTRO_DB_PATH = ':memory:';
const { startServer } = await import(pathToFileURL(path.resolve('server.js')));
const { server, url } = await startServer(0, '127.0.0.1', {
  fetch: async () => new Response('Unavailable in screenshot fixture', { status: 503 })
});

const chromePath = path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
assert.ok(fs.existsSync(chromePath), 'Install Google Chrome to regenerate the README screenshots.');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastro-readme-'));
const screenshotsDir = path.resolve('docs/screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });
let chrome;
let socket;
let requestId = 0;
const pending = new Map();

function cdp(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`DevTools request timed out: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function waitFor(read, label, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await read().catch(() => false);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function post(route, data) {
  const response = await fetch(url + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  assert.ok(response.ok, `${route} returned ${response.status}`);
  return response.json();
}

async function capture(filename) {
  const result = await cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  });
  fs.writeFileSync(path.join(screenshotsDir, filename), Buffer.from(result.data, 'base64'));
}

try {
  const assets = [
    { name: 'Tesouro Selic 2029', institution: 'Tesouro Nacional', category: 'Tesouro Direto', liquidity: 'D+1' },
    { name: 'CDB Liquidez Diária', institution: 'Banco Horizonte', category: 'CDB / RDB', liquidity: 'Diária' },
    { name: 'LCI 2027', institution: 'Banco Horizonte', category: 'LCI / LCA', liquidity: 'No vencimento', tax_exempt: true }
  ];
  const ids = [];
  for (const asset of assets) ids.push((await post('/api/investments', asset)).id);

  const today = new Date();
  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  for (let offset = 29; offset >= 0; offset--) {
    const current = new Date(day);
    current.setUTCDate(current.getUTCDate() - offset);
    const date = current.toISOString().slice(0, 10);
    const index = 29 - offset;
    const values = [
      48200 + index * 21,
      35600 + index * 16,
      24300 + index * 8
    ];
    for (let assetIndex = 0; assetIndex < ids.length; assetIndex++) {
      const net = values[assetIndex];
      const tax = assets[assetIndex].tax_exempt ? 0 : Math.round(net * 0.045 * 100) / 100;
      const response = await fetch(url + '/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investment_id: ids[assetIndex],
          date,
          gross_value: net + tax,
          net_value: net
        })
      });
      assert.ok(response.ok, `/api/records returned ${response.status}`);
    }
  }
  await post('/api/settings', { patrimony_goal: '150000' });

  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const debugPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1440,1000',
    '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(tempDir, 'chrome')}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    return response?.ok ? response.json() : null;
  }, 'Chrome DevTools');
  const target = targets.find(item => item.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target exists');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url });
  await waitFor(async () => {
    const result = await cdp('Runtime.evaluate', {
      expression: `document.fonts.ready.then(()=>document.querySelector('#dashboardEmptyState')?.hidden===true)`,
      awaitPromise: true,
      returnByValue: true
    });
    return result.result?.value;
  }, 'dashboard with sample totals');
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('inicio.png');

  await cdp('Runtime.evaluate', {
    expression: `document.querySelector('[data-tab="investments"]').click()`,
    returnByValue: true
  });
  await waitFor(async () => {
    const result = await cdp('Runtime.evaluate', {
      expression: `document.querySelector('#tab-investments')?.classList.contains('active')`,
      returnByValue: true
    });
    return result.result?.value;
  }, 'portfolio view');
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('carteira.png');

  console.log(`Saved README screenshots to ${screenshotsDir}`);
} finally {
  try { socket?.close(); } catch {}
  if (chrome && chrome.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      chrome.once('exit', () => { clearTimeout(timer); resolve(); });
      chrome.kill();
    });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error.code !== 'EPERM' || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}
