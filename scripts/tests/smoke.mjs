import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastro-smoke-'));
process.env.LASTRO_DB_PATH = ':memory:';
const { startServer } = await import(pathToFileURL(path.resolve('server.js')));
const { server, url } = await startServer(0, '127.0.0.1', {
  fetch: async source => {
    assert.match(String(source), /bcdata\.sgs\.433/);
    return new Response(JSON.stringify([
      { data: '01/08/2026', valor: '-0.32' },
      { data: '01/09/2026', valor: '0.82' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});
const errors = [];
const results = [];
let chrome;
let socket;
let cdp;

function record(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function waitFor(read, label, timeout = 10000) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

class DevTools {
  nextId = 0;
  pending = new Map();

  constructor(ws) {
    this.ws = ws;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') {
        this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async run(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  }

  async click(selector) {
    const quoted = JSON.stringify(selector);
    assert.equal(await this.run(`(()=>{const e=document.querySelector(${quoted});if(!e)throw Error('Missing '+${quoted});e.click();return true})()`), true);
    record(selector);
  }
}

async function post(route, data) {
  const response = await fetch(url + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}

try {
  const investment = await post('/api/investments', { name: 'Carteira inicial', category: 'CDB / RDB' });
  for (const row of [
    { date: '2026-10-27', gross_value: 1010, net_value: 1000 },
    { date: '2026-10-28', gross_value: 1020, net_value: 1010 },
    { date: '2026-10-29', gross_value: 1120, net_value: 1110, contribution: 100 }
  ]) await post('/api/records', { investment_id: investment.id, ...row });

  const analytics = await (await fetch(url + '/api/analytics')).json();
  assert.equal(analytics.summary.net_invested_capital, 1100);
  assert.equal(analytics.summary.accumulated_net_yield, 10);
  record('capital investido inclui saldo inicial e exclui rendimento');

  const featureInvestment = await post('/api/investments', { name: 'Ativo com movimentações', institution: 'Banco de teste', category: 'CDB', liquidity: 'D+1' });
  await post('/api/records', { investment_id: featureInvestment.id, date: '2026-10-28', gross_value: 1010, net_value: 1000 });
  await post('/api/records', { investment_id: featureInvestment.id, date: '2026-10-29', gross_value: 1020, net_value: 1010 });
  const movementIds = [];
  for (const movement of [
    { type: 'application', amount: 50, balance_includes: true },
    { type: 'interest', amount: 5, balance_includes: false },
    { type: 'fee', amount: 2, balance_includes: false },
    { type: 'tax', amount: 1, balance_includes: false }
  ]) {
    const response = await fetch(url + '/api/movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ investment_id: featureInvestment.id, date: '2026-10-30', ...movement }) });
    assert.equal(response.status, 201);
    movementIds.push((await response.json()).id);
  }
  await post('/api/records', { investment_id: featureInvestment.id, date: '2026-10-30', gross_value: 1072, net_value: 1062 });
  const movementAnalytics = await (await fetch(url + '/api/analytics')).json();
  const featureAsset = movementAnalytics.investments.find(item => item.id === featureInvestment.id);
  assert.equal(featureAsset.records.at(-1).daily_net_yield, 4, 'contributions, interest, fees, and taxes are reflected in net return');
  assert.equal(featureAsset.records.at(-1).tax_amount, 11, 'external tax is included in the tax summary');
  assert.equal((await (await fetch(url + '/api/movements')).json()).length, 4);
  record('movimentações alteram rendimento e imposto com tratamento de caixa');

  const scheduled = await post('/api/calendar', { investment_id: featureInvestment.id, type: 'interest', event_date: '2026-11-15', title: 'Juros de teste', estimated_amount: 20 });
  let calendar = await (await fetch(url + '/api/calendar')).json();
  assert.equal(calendar.some(item => item.id === scheduled.id && item.status === 'expected' && item.estimated_amount === 20), true);
  const receivedResponse = await fetch(url + `/api/calendar/${scheduled.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'received', amount: 19, received_date: '2026-10-30' }) });
  assert.equal(receivedResponse.ok, true);
  calendar = await (await fetch(url + '/api/calendar')).json();
  assert.equal(calendar.find(item => item.id === scheduled.id)?.received_amount, 19);
  assert.equal((await (await fetch(url + '/api/movements')).json()).some(item => item.type === 'interest' && item.amount === 19), true);
  record('agenda distingue estimativa e recebimento real');

  const removedMovement = await fetch(url + `/api/movements/${movementIds[2]}`, { method: 'DELETE' });
  const removedMovementResult = await removedMovement.json();
  assert.equal(removedMovementResult.success, true);
  let deletedItems = await (await fetch(url + '/api/deleted')).json();
  assert.equal(deletedItems.some(item => item.id === removedMovementResult.deleted_id), true);
  const restoredMovement = await fetch(url + `/api/deleted/${removedMovementResult.deleted_id}`, { method: 'POST' });
  assert.equal(restoredMovement.ok, true);
  assert.equal((await (await fetch(url + '/api/movements')).json()).some(item => item.type === 'fee' && item.amount === 2), true);
  record('movimentação excluída pode ser restaurada');

  const recoverable = await post('/api/investments', { name: 'Ativo recuperável' });
  await post('/api/records', { investment_id: recoverable.id, date: '2026-10-29', gross_value: 100, net_value: 95 });
  const investmentDeleteResponse = await fetch(url + `/api/investments/${recoverable.id}`, { method: 'DELETE' });
  const investmentDelete = await investmentDeleteResponse.json();
  assert.equal(investmentDelete.success, true);
  const investmentRestore = await fetch(url + `/api/deleted/${investmentDelete.deleted_id}`, { method: 'POST' });
  assert.equal(investmentRestore.ok, true);
  const restoredInvestment = await investmentRestore.json();
  const recoveredAssetRecords = await (await fetch(url + `/api/records?investment_id=${restoredInvestment.id}`)).json();
  assert.equal(recoveredAssetRecords.length, 1, 'restoring an investment also restores its balances');
  assert.ok(Array.isArray(await (await fetch(url + '/api/inflation')).json()));
  const ipcaSyncResponse = await fetch(url + '/api/inflation/sync', { method: 'POST' });
  const ipcaSyncResult = await ipcaSyncResponse.json();
  assert.equal(ipcaSyncResponse.status, 200);
  assert.equal(ipcaSyncResult.latest_month, '2026-09');
  const cachedIpca = await (await fetch(url + '/api/inflation')).json();
  assert.deepEqual(cachedIpca.map(item => [item.reference_month, item.rate]), [['2026-08', -0.32], ['2026-09', 0.82]]);
  assert.match(await (await fetch(url + '/compact.html')).text(), /Próximos eventos/);
  record('ativo apagado restaura saldo e os serviços de IPCA e visão rápida respondem');
  await fetch(url + `/api/investments/${featureInvestment.id}`, { method: 'DELETE' });
  await fetch(url + `/api/investments/${restoredInvestment.id}`, { method: 'DELETE' });

  const chromePath = path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  assert.ok(fs.existsSync(chromePath), 'Chrome is required for the UI smoke test');
  const portProbe = net.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const debugPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(tempDir, 'chrome')}`, '--window-size=1280,960', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    return response?.ok ? response.json() : null;
  }, 'Chrome DevTools', 15000);
  const target = targets.find(item => item.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target exists');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  cdp = new DevTools(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,fn,opts){if(type==='click'&&this instanceof HTMLButtonElement)this.dataset.testClickWired='1';if(type==='submit'&&this instanceof HTMLFormElement)this.dataset.testSubmitWired='1';return add.call(this,type,fn,opts)}})()` });
  const navigation = await cdp.send('Page.navigate', { url });
  assert.equal(navigation.errorText, undefined, `Navigation failed: ${navigation.errorText || ''}`);
  await waitFor(() => cdp.run(`!!document.querySelector('#kpiInvested')`), 'dashboard document');
  await waitFor(() => cdp.run(`!('serviceWorker' in navigator)||!!navigator.serviceWorker.controller`), 'service worker activation');
  await waitFor(() => cdp.run(`document.querySelector('#kpiInvested').textContent.includes('1.100,00')`), 'capital display');

  const unhandled = await cdp.run(`Array.from(document.querySelectorAll('button')).filter(b=>!b.hasAttribute('onclick')&&!b.dataset.testClickWired&&!b.classList.contains('nav-item')&&!(b.type==='submit'&&b.form?.dataset.testSubmitWired)).map(b=>b.outerHTML)`);
  assert.deepEqual(unhandled, [], `Buttons without an action: ${JSON.stringify(unhandled)}`);
  record('auditoria de ações de todos os botões da página');

  await cdp.run(`window.confirm=()=>true;window.alert=()=>{}`);
  await cdp.click('#btnTogglePrivacy');
  assert.equal(await cdp.run(`document.body.classList.contains('privacy-active')`), true);
  await cdp.click('#btnTogglePrivacy');
  await cdp.click('#themeToggleBtn');
  assert.equal(await cdp.run(`document.documentElement.dataset.theme==='light'`), true);
  await cdp.click('#themeToggleBtn');
  await cdp.click('#btnRefreshData');
  await waitFor(() => cdp.run(`!document.getElementById('toastNotification').classList.contains('hidden')`), 'refresh action');

  const maturityDate = await cdp.run(`(()=>{const d=new Date(getTodayString()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+10);return d.toISOString().slice(0,10)})()`);
  await cdp.click('#btnOpenNewInvestment');
  await cdp.run(`document.getElementById('invName').value='Ativo de teste';document.getElementById('invMaturityDate').value='${maturityDate}';document.getElementById('formInvestment').requestSubmit()`);
  await waitFor(() => cdp.run(`document.getElementById('modalInvestment').classList.contains('hidden')`), 'investment save');
  await cdp.click('#btnOpenNewInvestment');
  await cdp.run(`document.getElementById('invName').value='Ativo isento';document.getElementById('invTaxExempt').checked=true;document.getElementById('formInvestment').requestSubmit()`);
  await waitFor(() => fetch(url + '/api/investments').then(response => response.json()).then(items => items.some(item => item.name === 'Ativo isento' && item.tax_exempt === 1)), 'save tax-exempt investment');
  const taxExemptInvestment = (await (await fetch(url + '/api/investments')).json()).find(item => item.name === 'Ativo isento');
  record('cadastro de ativo com isenção de IR');
  await cdp.click('#btnEditGoalDirect');
  await cdp.run(`document.getElementById('settingPatrimonyGoal').value='50000';document.getElementById('settingCdiRate').value='10.75';document.getElementById('formSettings').requestSubmit()`);
  await waitFor(() => cdp.run(`document.getElementById('modalSettings').classList.contains('hidden')`), 'settings save');

  await cdp.click('#btnEditUsdAmount');
  await cdp.run(`document.getElementById('inputUsdAmount').value='100';document.getElementById('formUsd').requestSubmit()`);
  await waitFor(() => cdp.run(`document.getElementById('usdAmountDisplay').textContent.includes('100,00')`), 'dollar balance save')
    .catch(async error => { console.error('USD DEBUG', await cdp.run(`({modal:document.getElementById('modalUsd').className,input:document.getElementById('inputUsdAmount').value,amount:document.getElementById('usdAmountDisplay').textContent,privacy:document.body.className,toast:document.getElementById('toastNotification').textContent})`), errors); throw error; });
  await cdp.run(`document.getElementById('dollarLastUpdate').textContent='Atualização pendente'`);
  await cdp.click('#btnRefreshDollarRate');
  await waitFor(() => cdp.run(`document.getElementById('dollarLastUpdate').textContent!=='Atualização pendente'`), 'dollar quote refresh');
  await cdp.run(`state.dollarRate=5.5;updateDollarValuesUI();document.getElementById('checkIncludeUsdInPatrimony').click()`);
  await waitFor(() => cdp.run(`document.getElementById('kpiNet').textContent.includes('1.660,00')`), 'include dollar balance');
  assert.equal(await cdp.run(`!document.getElementById('portfolioExcludingUsd').hidden&&document.getElementById('kpiNetWithoutUsd').textContent.includes('1.110,00')`), true, 'show total without the dollar reserve');
  await cdp.click('#checkIncludeUsdInPatrimony');
  assert.equal(await cdp.run(`document.getElementById('portfolioExcludingUsd').hidden`), true, 'hide comparison when dollar is excluded');
  record('comparação de patrimônio com e sem reserva em dólar');
  await cdp.click('#btnTogglePieAsset');
  assert.equal(await cdp.run(`document.getElementById('btnTogglePieAsset').classList.contains('active')`), true);
  await cdp.click('#btnTogglePieCategory');
  assert.equal(await cdp.run(`document.getElementById('btnTogglePieCategory').classList.contains('active')`), true);

  for (const tab of ['quick-entry', 'import-inter', 'history', 'investments', 'planning', 'backup', 'dashboard']) {
    await cdp.click(`.nav-item[data-tab="${tab}"]`);
    await waitFor(() => cdp.run(`document.getElementById('tab-${tab}').classList.contains('active')`), `tab ${tab}`);
  }
  await cdp.click('#btnProcessInterText');
  await cdp.run(`document.getElementById('interPasteText').value='CDB TESTE 102% CDI; 1.000,00; 990,00';document.getElementById('btnProcessInterText').click()`);
  assert.equal(await cdp.run(`!document.getElementById('interPreviewContainer').classList.contains('hidden')`), true);
  await cdp.click('#btnConfirmInterImport');
  await waitFor(() => cdp.run(`document.getElementById('interPreviewContainer').classList.contains('hidden')`), 'confirm statement import');

  await cdp.click('.nav-item[data-tab="quick-entry"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('.quick-row').length>0`), 'quick entry rows');
  await cdp.run(`const row=document.querySelector('.quick-row[data-inv-id="${investment.id}"]');row.querySelector('.input-gross').value='1140';row.querySelector('.input-net').value='1130'`);
  await cdp.click('#btnSaveQuickBatch');
  await waitFor(() => cdp.run(`document.getElementById('tab-dashboard').classList.contains('active')`), 'quick entry save');
  await cdp.click('.nav-item[data-tab="history"]');
  await cdp.click('#btnOpenSingleEntryModal');
  await cdp.run(`document.getElementById('singleEntryInv').value='${investment.id}';document.getElementById('singleEntryDate').value='2026-10-30';document.getElementById('singleEntryGross').value='1150';document.getElementById('singleEntryNet').value='1140';document.getElementById('formSingleEntry').requestSubmit()`);
  await waitFor(() => cdp.run(`document.getElementById('modalSingleEntry').classList.contains('hidden')`), 'manual record save');
  await cdp.click('#btnOpenSingleEntryModal');
  await cdp.run(`document.getElementById('singleEntryInv').value='${taxExemptInvestment.id}';document.getElementById('singleEntryInv').dispatchEvent(new Event('change'));document.getElementById('singleEntryDate').value='2026-10-31';document.getElementById('singleEntryNet').value='900';`);
  assert.equal(await cdp.run(`document.getElementById('singleEntryGrossGroup').hidden&&document.getElementById('singleEntryGross').required===false`), true, 'tax-exempt manual entry only requests net amount');
  await cdp.run(`document.getElementById('formSingleEntry').requestSubmit()`);
  await waitFor(() => fetch(url + '/api/records').then(response => response.json()).then(rows => rows.some(row => row.investment_id === taxExemptInvestment.id && row.date === '2026-10-31' && row.gross_value === 900 && row.net_value === 900)), 'tax-exempt manual record');
  record('lançamento manual isento pede apenas líquido e salva bruto igual');

  await cdp.click('.nav-item[data-tab="quick-entry"]');
  await waitFor(() => cdp.run(`!!document.querySelector('.quick-row[data-inv-id="${taxExemptInvestment.id}"]')`), 'tax-exempt quick entry row');
  const quickEntryDate = await cdp.run(`document.getElementById('quickEntryDate').value`);
  await cdp.run(`(()=>{const row=document.querySelector('.quick-row[data-inv-id="${taxExemptInvestment.id}"]');row.querySelector('.input-net').value='910';row.querySelector('.input-net').dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await cdp.click('#btnSaveQuickBatch');
  await waitFor(() => fetch(url + '/api/records').then(response => response.json()).then(rows => rows.some(row => row.investment_id === taxExemptInvestment.id && row.date === quickEntryDate && row.gross_value === 910 && row.net_value === 910)), 'tax-exempt quick record');
  record('lançamento diário isento salva bruto igual ao líquido');

  assert.equal((await fetch(url + '/api/export')).ok, true, 'backup export endpoint');
  record('exportação de backup');
  await cdp.click('.nav-item[data-tab="backup"]');
  const backupPath = path.join(tempDir, 'restore-test.json');
  fs.writeFileSync(backupPath, JSON.stringify({
    version: '2.0',
    settings: [{ key: 'usd_amount', value: '33' }, { key: 'include_usd_in_patrimony', value: 'false' }, { key: 'user_name', value: 'Jane' }],
    investments: [{ id: 901, name: 'Ativo restaurado', institution: 'Lastro QA', category: 'CDB / RDB' }],
    records: [{ investment_id: 901, date: '2026-10-29', gross_value: 125, net_value: 120, contribution: 100, withdrawal: 0, notes: 'backup QA' }]
  }));
  const documentRoot = await cdp.send('DOM.getDocument');
  const inputNode = await cdp.send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#fileImportInput' });
  await cdp.send('DOM.setFileInputFiles', { files: [backupPath], nodeId: inputNode.nodeId });
  await cdp.run(`document.getElementById('fileImportInput').dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor(() => cdp.run(`document.getElementById('toastNotification').textContent.includes('Backup restaurado')`), 'JSON backup restore');
  const restoredAssets = await (await fetch(url + '/api/investments')).json();
  const restoredRecords = await (await fetch(url + '/api/records')).json();
  assert.ok(restoredAssets.some(item => item.name === 'Ativo restaurado'));
  assert.ok(restoredRecords.some(item => item.notes === 'backup QA'));
  assert.equal(await cdp.run(`state.usdAmount===33&&state.includeUsdInPatrimony===false&&state.userName==='Jane'`), true, 'backup settings restored to app state');
  record('seleciona e restaura backup JSON com ativos, lançamentos e configurações');
  await cdp.click('.nav-item[data-tab="dashboard"]');
  await waitFor(() => cdp.run(`document.getElementById('pageTitle').textContent==='Olá, Jane'`), 'personalized dashboard greeting from backup');
  await cdp.click('.nav-item[data-tab="backup"]');
  await cdp.run(`document.getElementById('settingUserName').value='Diogo';document.getElementById('formProfileName').requestSubmit()`);
  await waitFor(() => cdp.run(`state.userName==='Diogo'`), 'save profile name');
  await cdp.click('.nav-item[data-tab="dashboard"]');
  await waitFor(() => cdp.run(`document.getElementById('pageTitle').textContent==='Olá, Diogo'`), 'personalized greeting');
  await cdp.send('Page.reload');
  await waitFor(() => cdp.run(`document.getElementById('pageTitle')?.textContent==='Olá, Diogo'`), 'greeting persists after reload');
  record('nome personalizado salvo e mantido ao recarregar');
  await cdp.run(`(async()=>{localStorage.setItem('lastro_user_name','Diogo');const original=window.fetch;window.fetch=async(url,...args)=>String(url)==='/api/settings'?{ok:true,json:async()=>({})}:original(url,...args);try{await loadDashboardGreeting()}finally{window.fetch=original}})()`);
  assert.equal(await cdp.run(`state.userName==='Diogo'&&document.getElementById('pageTitle').textContent==='Olá, Diogo'`), true, 'legacy server settings do not erase local profile name');
  record('nome local permanece se servidor antigo ainda não devolver a configuração');
  await cdp.click('#btnLoadDemoData');
  await waitFor(() => fetch(url + '/api/investments').then(response => response.json()).then(items => items.length >= 5), 'demo data action');

  await cdp.click('.nav-item[data-tab="history"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('#tableFullHistory tr').length>0`), 'history rows');
  await waitFor(() => cdp.run(`!!document.querySelector('#tableFullHistory .btn-danger-sm')`), 'history delete button');
  const recordsBeforeDelete = await (await fetch(url + '/api/records')).json();
  await cdp.click('#tableFullHistory .btn-danger-sm');
  await waitFor(() => fetch(url + '/api/records').then(response => response.json()).then(records => records.length < recordsBeforeDelete.length), 'delete record action');
  record('delete record button');

  await cdp.click('.nav-item[data-tab="investments"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('#investmentsCardsContainer .inv-card').length>0`), 'investment cards');
  await waitFor(() => cdp.run(`document.getElementById('chartPortfolioValue').width>0&&document.getElementById('walletTotal').textContent.includes('R$')`), 'portfolio overview and chart');
  for (const range of ['all', '30', '6m', '1y']) {
    await cdp.click(`[data-wallet-range="${range}"]`);
    assert.equal(await cdp.run(`document.querySelector('[data-wallet-range="${range}"]').classList.contains('active')`), true);
  }
  assert.ok(await cdp.run(`document.querySelectorAll('.wallet-asset-row').length>0`));
  record('tela de carteira, gráfico de patrimônio e filtros de período');
  await cdp.click('[data-wallet-group="institution"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('.wallet-institution-group').length>0`), 'institution grouping', 20000);
  const institutionGroups = await cdp.run(`Array.from(document.querySelectorAll('.wallet-institution-heading h4')).map(heading=>heading.textContent)`);
  assert.ok(institutionGroups.includes('Banco Inter'), `Banco Inter group missing: ${JSON.stringify(institutionGroups)}`);
  assert.ok(institutionGroups.includes('Tesouro Direto'), `Tesouro Direto group missing: ${JSON.stringify(institutionGroups)}`);
  await cdp.click('[data-wallet-group="all"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('.wallet-institution-group').length===0`), 'flat asset list');
  record('wallet assets grouped by institution and ungrouped again');

  const detailAsset = await cdp.run(`(()=>{const button=Array.from(document.querySelectorAll('.wallet-asset-identity')).find(item=>state.analytics?.investments?.find(asset=>asset.name===item.querySelector('h3')?.textContent)?.records?.length>1);if(!button)return null;const name=button.querySelector('h3')?.textContent;const asset=state.investments.find(item=>item.name===name);button.click();return {name,isExempt:Boolean(asset?.tax_exempt),animations:button.getAnimations().length}})()`);
  assert.ok(detailAsset, 'an asset with balance history is available');
  assert.equal(await cdp.run(`document.getElementById('walletListView').hidden&&!document.getElementById('assetDetailView').hidden`), true, 'asset detail replaces wallet list');
  await waitFor(() => cdp.run(`document.getElementById('assetDetailName').textContent===${JSON.stringify(detailAsset.name)}&&document.querySelectorAll('#assetHistoryRecords .asset-history-record').length>0`), 'asset detail and balance history');
  assert.equal(await cdp.run(`document.getElementById('assetDetailCdi').textContent.includes('% do CDI')&&document.getElementById('assetDetailTax').textContent==${JSON.stringify(detailAsset.isExempt ? 'Isento de IR' : 'Tributável')}&&document.getElementById('assetDetailLiquidity').textContent.length>0&&document.getElementById('assetDetailMaturity').textContent.length>0`), true, 'asset details include CDI, tax condition, liquidity, and maturity');
  if (!await cdp.run(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) assert.ok(detailAsset.animations > 0, 'clicked button plays a fluid animation');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const detailMobile = await cdp.run(`({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})`);
  assert.ok(detailMobile.scrollWidth <= detailMobile.width + 1, `Asset detail overflows on mobile: ${JSON.stringify(detailMobile)}`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const range of ['all', '30', '6m', '1y']) {
    await cdp.click(`[data-asset-range="${range}"]`);
    assert.equal(await cdp.run(`document.querySelector('[data-asset-range="${range}"]').classList.contains('active')`), true);
  }
  await cdp.run(`(()=>{const canvas=document.getElementById('chartAssetBalance');const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}))})()`);
  assert.equal(await cdp.run(`!document.getElementById('assetBalanceTooltip').hidden`), true, 'balance chart shows values on hover');
  await cdp.click('#btnBackToWallet');
  assert.equal(await cdp.run(`document.getElementById('walletListView').hidden===false&&document.getElementById('assetDetailView').hidden`), true, 'back button returns to wallet');
  record('asset details, CDI, interactive history, and return to wallet');

  await waitFor(() => cdp.run(`document.querySelector('.maturity-item')?.innerText.includes('Ativo de teste')`), 'upcoming maturity schedule');
  assert.equal(await cdp.run(`document.querySelector('.inv-card-freshness')?.textContent.includes('Sem saldo registrado')`), true, 'asset shows missing balance status');
  record('lista de vencimentos e data de atualização por ativo');
  await cdp.run(`Array.from(document.querySelectorAll('.inv-card')).find(card=>card.innerText.includes('Ativo de teste'))?.querySelector('.btn-danger-sm').click()`);
  await waitFor(() => fetch(url + '/api/investments').then(response => response.json()).then(items => !items.some(item => item.name === 'Ativo de teste')), 'investment delete');
  record('delete investment button');

  await cdp.click('.nav-item[data-tab="dashboard"]');
  await waitFor(() => cdp.run(`!!document.querySelector('#tableCdiComparison tr[data-investment-id]')`), 'dashboard asset rows');
  const dashboardAssetName = await cdp.run(`document.querySelector('#tableCdiComparison tr[data-investment-id] .asset-detail-link').textContent`);
  const dashboardScrollTop = await cdp.run(`(()=>{const main=document.querySelector('.main-content');main.scrollTop=260;return main.scrollTop})()`);
  await cdp.click('#tableCdiComparison tr[data-investment-id] td:nth-child(2)');
  await waitFor(() => cdp.run(`document.getElementById('tab-investments').classList.contains('active')&&document.getElementById('walletListView').hidden&&!document.getElementById('assetDetailView').hidden&&document.getElementById('assetDetailName').textContent===${JSON.stringify(dashboardAssetName)}`), 'dashboard asset opens wallet detail');
  await cdp.click('#btnBackToWallet');
  await waitFor(() => cdp.run(`document.getElementById('tab-dashboard').classList.contains('active')&&document.getElementById('assetDetailView').hidden&&Math.abs(document.querySelector('.main-content').scrollTop-${dashboardScrollTop})<2`), 'dashboard detail returns to the previous screen and position');
  record('rentabilidade por ativo abre o detalhe correspondente na Carteira');
  for (const range of ['30', '90', 'ytd', 'all']) {
    await cdp.click(`[data-performance-range="${range}"]`);
    assert.equal(await cdp.run(`document.querySelector('[data-performance-range="${range}"]').classList.contains('active')`), true);
  }
  assert.equal(await cdp.run(`document.getElementById('performanceYield').textContent!=='—'`), true, 'period yield is calculated');
  record('filtros de período, rendimento líquido e comparação CDI');
  assert.equal(await cdp.run(`getComputedStyle(document.getElementById('dashboardStats')).gridTemplateColumns.split(' ').length`), 5, 'desktop KPI layout has five columns');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await waitFor(() => cdp.run(`window.innerWidth===390?({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,nav:getComputedStyle(document.querySelector('.sidebar')).position,navHeight:Math.round(document.querySelector('.sidebar').getBoundingClientRect().height),statColumns:getComputedStyle(document.getElementById('dashboardStats')).gridTemplateColumns.split(' ').length}):null`), 'mobile layout');
  assert.ok(mobile.scrollWidth <= mobile.width + 1, `Horizontal overflow: ${JSON.stringify(mobile)}`);
  assert.equal(mobile.nav, 'fixed');
  assert.equal(mobile.navHeight, 64);
  assert.equal(mobile.statColumns, 2, 'mobile KPI layout has two columns');
  record('layout móvel a 390px, sem rolagem horizontal');

  await cdp.click('.nav-item[data-tab="investments"]');
  await waitFor(() => cdp.run(`document.getElementById('tab-investments').classList.contains('active')&&document.querySelectorAll('#investmentsCardsContainer .wallet-asset-row').length>0`), 'mobile wallet list');
  await cdp.click('[data-wallet-group="institution"]');
  await waitFor(() => cdp.run(`document.querySelectorAll('.wallet-institution-group').length>0`), 'mobile institution grouping', 20000);
  const mobileWallet = await cdp.run(`({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})`);
  assert.ok(mobileWallet.scrollWidth <= mobileWallet.width + 1, `Grouped wallet overflows on mobile: ${JSON.stringify(mobileWallet)}`);
  assert.equal(await cdp.run(`document.querySelectorAll('#walletConcentration .concentration-column').length===3`), true, 'wallet has institution, asset type, and liquidity breakdowns');
  await cdp.click('[data-wallet-group="all"]');
  record('grouped wallet at mobile width without horizontal overflow');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.click('.nav-item[data-tab="planning"]');
  await waitFor(() => cdp.run(`document.getElementById('tab-planning').classList.contains('active')&&document.querySelectorAll('#scenarioResults .scenario-result').length===3`), 'scenario projections');
  assert.equal(await cdp.run(`!document.querySelector('#tab-dashboard .dashboard-followups')`), true, 'scenario and calendar no longer occupy the home tab');
  await cdp.run(`window.lastroDesktop={openCompactWindow:()=>window.__compactOpened=true};document.getElementById('scenarioMonthlyContribution').value='600';document.getElementById('scenarioMonthlyContribution').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await cdp.run(`document.getElementById('scenarioResults').textContent.includes('Otimista')&&document.getElementById('scenarioResults').textContent.includes('Base')`), true, 'scenario model renders three named outcomes');
  await cdp.click('#btnOpenCompactView');
  assert.equal(await cdp.run(`window.__compactOpened===true`), true, 'desktop quick-view action is connected');
  const syntheticRates = await cdp.run(`state.ipcaRates=[{reference_month:'2026-10',rate:1}];state.performanceRange='all';updatePeriodPerformance();document.getElementById('performanceRealReturn').textContent`);
  assert.notEqual(syntheticRates, 'â€”', 'real return compares portfolio results with monthly IPCA');
  record('simulador, visão rápida e rendimento acima do IPCA');

  await cdp.run(`(()=>{const select=document.getElementById('calendarInvestment');const option=[...select.options].find(item=>item.textContent.includes('Carteira inicial'));if(!option)throw Error('Test investment not available');select.value=option.value;document.getElementById('calendarType').value='dividend';document.getElementById('calendarDate').value='2026-11-15';document.getElementById('calendarAmount').value='12';document.getElementById('calendarTitle').value='Dividendo interface';document.getElementById('formCalendarEvent').requestSubmit()})()`);
  await waitFor(async () => (await (await fetch(url + '/api/calendar')).json()).some(item => item.title === 'Dividendo interface' && item.status === 'expected'), 'calendar event created through UI');
  const calendarForUi = await (await fetch(url + '/api/calendar')).json();
  const uiEvent = calendarForUi.find(item => item.title === 'Dividendo interface');
  await cdp.click(`[data-calendar-receive="${uiEvent.id}"]`);
  await cdp.run(`(()=>{const form=document.querySelector('[data-calendar-receipt-form="${uiEvent.id}"]');if(!form)throw Error('Receipt form did not open');form.elements.amount.value='11.75';form.elements.received_date.value='2026-10-30';form.requestSubmit()})()`);
  await waitFor(async () => (await (await fetch(url + '/api/calendar')).json()).some(item => item.id === uiEvent.id && item.status === 'received' && item.received_amount === 11.75), 'calendar receipt saved through UI');
  record('agendamento e confirmação de recebimento pela interface');

  await cdp.click('.nav-item[data-tab="history"]');
  await waitFor(() => cdp.run(`document.getElementById('tab-history').classList.contains('active')`), 'movement history tab');
  await cdp.run(`(()=>{const select=document.getElementById('movementInvestment');const option=[...select.options].find(item=>item.textContent.includes('Carteira inicial'));select.value=option.value;document.getElementById('movementType').value='contribution';document.getElementById('movementDate').value='2026-10-30';document.getElementById('movementAmount').value='13.37';document.getElementById('movementNotes').value='Movimento pela interface';document.getElementById('formMovement').requestSubmit()})()`);
  const uiMovement = await waitFor(async () => (await (await fetch(url + '/api/movements')).json()).find(item => item.notes === 'Movimento pela interface'), 'movement saved through UI');
  await waitFor(() => cdp.run(`document.getElementById('tableMovements').textContent.includes('Movimento pela interface')`), 'movement is visible in the ledger');
  await cdp.run(`window.confirm=()=>true`);
  await cdp.click(`[data-delete-movement="${uiMovement.id}"]`);
  const trashedMovement = await waitFor(async () => (await (await fetch(url + '/api/deleted')).json()).find(item => item.entity_type === 'movement' && item.label.includes('Carteira inicial')), 'movement moved to recovery');
  await cdp.click('.nav-item[data-tab="backup"]');
  await waitFor(() => cdp.run(`!!document.querySelector('[data-restore-item="${trashedMovement.id}"]')`), 'movement visible in trash');
  await cdp.click(`[data-restore-item="${trashedMovement.id}"]`);
  await waitFor(async () => (await (await fetch(url + '/api/movements')).json()).some(item => item.notes === 'Movimento pela interface'), 'movement restored through UI');
  const fullBackup = await (await fetch(url + '/api/export')).json();
  assert.equal(fullBackup.movements.some(item => item.notes === 'Movimento pela interface'), true);
  assert.equal(fullBackup.calendar_events.some(item => item.title === 'Dividendo interface' && item.status === 'received'), true);
  assert.ok(fullBackup.activity_log.length > 0);
  record('histórico, recuperação e backup incluem movimentos, agenda e atividade');

  await cdp.send('Page.navigate', { url: `${url}/compact.html` });
  await waitFor(() => cdp.run(`document.title.includes('Visão rápida')&&document.getElementById('compactTotal').textContent.includes('R$')`), 'compact quick-view loads local totals');
  assert.equal(await cdp.run(`document.getElementById('compactEvents').textContent.length>0`), true, 'compact view displays next events or a clear empty state');
  record('painel compacto local carrega patrimônio e agenda');

  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(errors, [], `Browser errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ passed: results.length, results, mobile }, null, 2));
} finally {
  try { await cdp?.send('Browser.close'); } catch {}
  try { socket?.close(); } catch {}
  if (chrome) chrome.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
