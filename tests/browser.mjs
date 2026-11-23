import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { basePath, serve } from '../tools/serve.mjs';

const candidates = [
  process.env.BROWSER_PATH,
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome',
];
const executable = candidates.find(path => path && existsSync(path));
if (!executable) throw new Error('Defina BROWSER_PATH para o executável do Chrome, Chromium ou Edge.');

const profileRoot = resolve(tmpdir());
const profile = await mkdtemp(join(profileRoot, 'nadani-browser-'));
const browser = spawn(executable, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
browser.on('error', error => console.error(error.message));
const problems = [];
let server;
let socket;
let cdp;

async function until(callback, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await delay(45);
  }
  throw new Error(`Tempo excedido: ${description}`);
}

async function connect(port) {
  const [page] = await fetch(`http://127.0.0.1:${port}/json/list`).then(res => res.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveConnection, reject) => {
    socket.addEventListener('open', resolveConnection, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id: messageId, method, params, result, error } = JSON.parse(data);
    if (pending.has(messageId)) {
      const { resolveCall, reject } = pending.get(messageId);
      pending.delete(messageId);
      if (error) reject(new Error(error.message));
      else resolveCall(result);
    }
    if (method === 'Runtime.exceptionThrown') {
      problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(params.entry.text);
    if (method === 'Network.requestWillBeSent' && ['XHR', 'Fetch', 'Ping'].includes(params.type)) problems.push(params.request.url);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      problems.push(`${params.response.status} ${params.response.url}`);
    }
  });
  return (method, params = {}) => new Promise((resolveCall, reject) => {
    pending.set(++id, { resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? expression);
  return response.result.value;
}

async function key(name, code) {
  const args = { key: name, code: name, windowsVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...args, text: name === 'Enter' ? '\r' : undefined });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...args });
}

async function capture(name) {
  if (!process.argv.includes('--screenshots')) return;
  await until(() => evaluate('document.querySelector("#toast").textContent === ""'), 'aguardar o aviso temporário antes da captura');
  await evaluate('document.activeElement?.blur()');
  await mkdir(new URL('../docs/screenshots/', import.meta.url), { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../docs/screenshots/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}

const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const value = (selector, text, event = 'input') => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  input.value = ${JSON.stringify(text)};
  input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
})()`);
const has = expression => until(() => evaluate(expression), expression);
const content = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
const stored = () => evaluate(`(async () => {
  const { openDatabase, storeFor } = await import('./js/storage.js');
  const db = await openDatabase();
  try { return await storeFor(db).read(); } finally { db.close(); }
})()`);
async function visit(route) {
  await evaluate(`location.hash = ${JSON.stringify(route)}`);
  await has(`document.querySelector('[data-route="${route}"]')?.hasAttribute('aria-current') && document.querySelector('#view-title')`);
}
async function viewport(width, height = 960) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
  await evaluate('window.scrollTo(0, 0)');
}
async function upload(selector, path) {
  const { root } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  await cdp('DOM.setFileInputFiles', { files: [path], nodeId });
}
async function fill(form, fields) {
  for (const [key, text] of Object.entries(fields)) await value(form + ' [name="' + key + '"]', text);
}
const closed = () => has('!document.querySelector("#modal").open');

try {
  server = await serve(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + basePath;
  const port = await until(async () => Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]), 'inicializar Chromium');
  cdp = await connect(port);
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await cdp(`${domain}.enable`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await viewport(1440);
  await cdp('Page.navigate', { url });
  await has('document.querySelector("#load-demo") && document.readyState === "complete"');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  await click('#load-demo');
  await has('!document.querySelector("#load-demo") && document.querySelector(".metrics")');
  const demo = await stored();
  assert.deepEqual(['companies', 'contacts', 'deals', 'activities', 'tasks'].map(kind => demo[kind].length), [15, 40, 35, 80, 25]);
  await capture('visao-geral');

  await visit('companies');
  await focus('#new-companies');
  await key('Enter', 13);
  assert.equal(await evaluate('document.activeElement.name'), 'name');
  await key('Escape', 27);
  await has('document.activeElement.id === "new-companies"');
  await click('#new-companies');
  await fill('#modal', { name: 'Laboratório Fictício QA', segment: 'Tecnologia' });
  await click('#save-companies');
  await closed();
  const company = (await stored()).companies.at(-1);
  assert.equal(company.name, 'Laboratório Fictício QA');

  await visit('contacts');
  await click('#new-contacts');
  await fill('#modal', { name: '  ', lastName: 'QA', companyId: company.id });
  await click('#save-contacts');
  await has('document.querySelector("#form-error").textContent.includes("Nome")');
  await fill('#modal', { name: 'Érica Teste', email: 'erica@example.invalid' });
  await click('#save-contacts');
  await closed();
  const contact = (await stored()).contacts.at(-1);
  assert.equal(contact.companyId, company.id);

  await click('#quick-deal');
  await fill('#modal', { title: 'Proposta verificável QA', value: '4321,35', contactId: contact.id, companyId: company.id, tags: 'Teste, Portfólio' });
  await click('#save-deals');
  await closed();
  const deal = (await stored()).deals.at(-1);
  const card = '#record-' + deal.id;
  assert.equal(deal.value, 432135);

  await viewport(1440, 1850);
  await visit('pipeline');
  const point = (selector, offset = 0) => evaluate('(() => { const rect = document.querySelector(' + JSON.stringify(selector) +
    ').getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2 + ' + offset + ') }; })()');
  const dragHandle = '[data-id="' + deal.id + '"]';
  const mouse = (type, p, buttons) => cdp('Input.dispatchMouseEvent', { type, ...p, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, buttons });
  const start = await point(dragHandle);
  const target = await point('#column-qualified .column-head');
  await mouse('mousePressed', start, 1);
  await mouse('mouseMoved', { x: start.x + 12, y: start.y - 10 }, 1);
  await mouse('mouseMoved', target, 1);
  await has('document.querySelector("#column-qualified").classList.contains("drop-active")');
  await mouse('mouseReleased', target, 0);
  await has('document.querySelector("#column-qualified").contains(document.querySelector(' + JSON.stringify(card) + '))');
  assert.equal((await stored()).deals.find(item => item.id === deal.id).order, 0);

  await viewport(768, 1100);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touchStart = await point(dragHandle);
  const touchDestination = await point('#column-qualified [data-card]:nth-child(3) .deal-value');
  const touch = (type, p) => cdp('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ ...p, id: 0 }] : [] });
  await touch('touchStart', touchStart);
  await touch('touchMove', { x: touchStart.x - 15, y: touchStart.y + 12 });
  await touch('touchMove', touchDestination);
  await has('document.querySelector("#column-qualified").classList.contains("drop-active")');
  await touch('touchEnd');
  await until(async () => (await stored()).deals.find(item => item.id === deal.id).order > 0, 'reordenação por toque');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await viewport(1440);
  await capture('funil');

  await value('#jump-stage', 'lost', 'change');
  assert.ok(await evaluate('document.querySelector("#pipeline-board").scrollLeft') > 0);
  await value('#jump-stage', 'qualified', 'change');
  await focus(card);
  await key('Enter', 13);
  await fill('#modal', { stage: 'lost' });
  await click('#move-stage');
  await fill('#modal', { reason: 'Escopo revisto durante QA' });
  await click('#confirm-lost');
  await closed();
  assert.equal((await stored()).deals.find(item => item.id === deal.id).lostReason, 'Escopo revisto durante QA');

  await click(card);
  await value('#deal-destination', 'proposal', 'change');
  await click('#move-stage');
  await closed();
  await click(card);
  await value('#deal-destination', 'won', 'change');
  await click('#move-stage');
  await closed();
  const won = await stored();
  assert.equal(won.deals.find(item => item.id === deal.id).stage, 'won');
  assert.equal(won.events.filter(event => event.entityId === deal.id && event.type === 'won').length, 1);
  assert.ok(won.events.some(event => event.entityId === deal.id && event.detail === 'Escopo revisto durante QA'));
  await click('#quick-deal');
  await fill('#modal', { title: 'Outra oportunidade QA', value: '94,20', stage: 'lost', contactId: contact.id, lostReason: 'Fora do prazo' });
  await click('#save-deals');
  await closed();
  assert.equal((await stored()).deals.at(-1).stage, 'lost');

  await visit('deals');
  await value('#context-search', 'proposta verificavel');
  await has('document.querySelector(' + JSON.stringify(card) + ') !== null');
  await click(card);
  await click('#linked-activity');
  await fill('#modal', { title: 'Ligação de verificação', type: 'call', result: 'Dados vinculados.' });
  await click('#save-activities');
  await closed();
  await click(card);
  await click('#linked-task');
  await fill('#modal', { title: 'Verificar proposta', due: '2025-01-01', priority: 'urgent' });
  await click('#save-tasks');
  await closed();

  await click('#search-global');
  await value('#global-query', 'erica teste');
  await has('document.querySelector(".search-results").textContent.includes("Érica Teste QA")');
  await value('#global-query', 'verificar proposta');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.className'), 'record-link');
  await key('Enter', 13);
  await click('#complete-task');
  await closed();
  const task = (await stored()).tasks.at(-1);
  await visit('tasks');
  await evaluate('document.querySelector(".filter-group").open = true');
  await value('#filter-status', 'done', 'change');
  await value('#filter-priority', 'urgent', 'change');
  await value('#filter-contactId', contact.id, 'change');
  await has('document.querySelector("#record-results").textContent.includes("Verificar proposta")');
  assert.equal(await evaluate('document.querySelectorAll("#record-results tbody tr").length'), 1);
  await click('#clear-filters');
  assert.equal(task.status, 'done');
  assert.equal(task.dealId, deal.id);
  assert.equal((await stored()).activities.at(-1).dealId, deal.id);

  await visit('activities');
  await click('#open-interaction-timeline');
  assert.match(await content('#modal-body'), /Ligação de verificação/);
  await key('Escape', 27);
  await closed();
  await visit('tasks');
  await click('#open-calendar');
  await has('document.querySelector(".calendar-grid")');
  await value('#calendar-mode', 'week', 'change');
  assert.equal(await evaluate('document.querySelectorAll(".calendar-day").length'), 7);
  await click('#calendar-next');
  await value('#calendar-mode', 'agenda', 'change');
  await has('document.querySelector(".agenda")');
  await click('#calendar-add-task');
  assert.match(await evaluate('document.querySelector("#modal [name=due]").value'), /^\d{4}-\d\d-\d\d$/);
  await key('Escape', 27);
  await closed();

  await visit('analytics');
  await value('#period-mode', '7', 'change');
  await has('document.querySelector("#period-mode").value === "7"');
  assert.match(await content('#screen'), /Taxa de ganho/);
  await value('#period-mode', '90', 'change');
  const expectedRate = Math.round((demo.deals.filter(item => item.stage === 'won').length + 1) * 1000 /
    (demo.deals.filter(item => ['won', 'lost'].includes(item.stage)).length + 2)) / 10;
  const displayed = await evaluate('[...document.querySelectorAll(".metric")].find(node => node.textContent.includes("Taxa de ganho"))?.querySelector("strong").textContent');
  assert.equal(displayed, expectedRate.toLocaleString('pt-BR') + '%');

  await visit('settings');
  await click('#manage-stages');
  await click('#new-stage');
  await fill('#modal', { name: 'Validação QA', probability: '33' });
  await click('#save-stage');
  await closed();
  assert.equal((await stored()).stages.at(-3).probability, 33);
  await click('#theme-toggle');
  await has('document.documentElement.dataset.theme === "dark"');
  await cdp('Page.reload');
  await has('document.querySelector("#export-backup") && document.documentElement.dataset.theme === "dark"');
  assert.equal((await stored()).deals.find(item => item.id === deal.id).stage, 'won');

  const folder = join(profile, 'downloads');
  await mkdir(folder);
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
  const day = await evaluate('new Intl.DateTimeFormat("sv-SE").format(new Date())');
  const backupFile = join(folder, 'nadani-backup-' + day + '.json');
  await click('#export-backup');
  await until(() => existsSync(backupFile), 'exportação JSON');
  const backup = JSON.parse(await readFile(backupFile, 'utf8'));
  assert.equal(backup.version, 1);
  assert.equal(backup.tasks.at(-1).status, 'done');
  await click('#export-csv');
  const csvFile = join(folder, 'nadani-contacts-' + day + '.csv');
  await until(() => existsSync(csvFile), 'exportação CSV');
  assert.match(await readFile(csvFile, 'utf8'), /erica@example.invalid/);
  const csvImport = join(folder, 'mapped.csv');
  await writeFile(csvImport, 'Nome;Email\nImportada QA;importada@example.invalid\nDuplicada;erica@example.invalid\nInválida;malformada\n');
  await upload('#csv-file', csvImport);
  await has('document.querySelector("#csv-map")');
  await value('#csv-map [name=email]', '1', 'change');
  await click('#preview-csv');
  assert.match(await content('#import-preview'), /1 novos · 1 duplicados · 1 inválidos/);
  await click('#confirm-csv');
  await closed();
  assert.equal((await stored()).contacts.at(-1).email, 'importada@example.invalid');
  await upload('#backup-file', backupFile);
  await has('document.querySelector("#confirm-action")');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).contacts.length, backup.contacts.length);

  const malformed = join(folder, 'invalid.json');
  await writeFile(malformed, JSON.stringify({ ...backup, version: 500 }));
  await upload('#backup-file', malformed);
  await has('document.querySelector("#screen").textContent.includes("versão ou estrutura incompatível")');
  assert.equal((await stored()).contacts.length, backup.contacts.length);

  await visit('contacts');
  await click('#new-contacts');
  await fill('#modal', { name: '<em>Contato sintético QA</em>' });
  await evaluate('window.qaPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException("Gravação indisponível", "QuotaExceededError"); }');
  await click('#save-contacts');
  await has('document.querySelector("#form-error").textContent.includes("Gravação indisponível")');
  assert.equal((await stored()).contacts.length, backup.contacts.length);
  await evaluate('IDBObjectStore.prototype.put = window.qaPut; delete window.qaPut');
  await click('#save-contacts');
  await closed();
  await value('#context-search', 'Contato sintético QA');
  await has('document.querySelector("#record-results strong")?.textContent === "<em>Contato sintético QA</em>"');
  assert.equal(await evaluate('document.querySelector("#record-results em")'), null);

  await visit('settings');
  await click('#clear-data');
  await key('Escape', 27);
  await closed();
  assert.equal((await stored()).contacts.length, backup.contacts.length + 1);
  await click('#clear-data');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).contacts.length, 0);
  await upload('#backup-file', backupFile);
  await has('document.querySelector("#confirm-action")');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).deals.length, backup.deals.length);

  await evaluate(`(async () => {
    const { openDatabase } = await import('./js/storage.js');
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        const request = store.get('workspace');
        request.onsuccess = () => store.put({ ...request.result, version: 999 }, 'workspace');
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    } finally { db.close(); }
  })()`);
  await cdp('Page.reload');
  await has('document.querySelector("#export-backup")?.disabled && !document.querySelector("#storage-alert").hidden');
  const pristine = await evaluate(`(async () => {
    const { openDatabase, storeFor } = await import('./js/storage.js');
    const db = await openDatabase();
    try { return await storeFor(db).raw(); } finally { db.close(); }
  })()`);
  assert.equal(pristine.version, 999);
  assert.equal(pristine.contacts.length, backup.contacts.length);
  await upload('#backup-file', backupFile);
  await has('document.querySelector("#confirm-action")');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).version, 1);
  await has('document.querySelector("#storage-alert").hidden');

  for (const width of [320, 375, 430, 768, 1024, 1440]) {
    await viewport(width);
    for (const route of ['overview', 'contacts', 'companies', 'deals', 'pipeline', 'activities', 'tasks', 'analytics', 'settings']) {
      await visit(route);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, route + ' em ' + width + ' px');
    }
    if (width === 375) {
      await focus('#menu-toggle');
      await key('Enter', 13);
      assert.equal(await evaluate('document.activeElement.dataset.route'), 'settings');
      await key('Escape', 27);
      assert.equal(await evaluate('document.activeElement.id'), 'menu-toggle');
      await visit('overview');
      await capture('mobile');
      await click('#quick-deal');
      assert.equal(await evaluate('document.querySelector("#modal").getBoundingClientRect().width <= innerWidth'), true);
      await key('Escape', 27);
      await closed();
    }
  }
  assert.deepEqual(problems, []);
  const { product } = await cdp('Browser.getVersion');
  console.log(product + ': cadastros, funil com mouse e toque, teclado, tarefas, calendário, análises, CSV, backup, IndexedDB e nove telas em seis larguras.');
} finally {
  if (cdp && socket.readyState === WebSocket.OPEN) {
    await Promise.race([cdp('Browser.close').catch(() => {}), delay(700)]);
    socket.close();
  }
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(2000)]);
  }
  if (browser.exitCode === null) browser.kill();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (dirname(profile) === profileRoot) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
