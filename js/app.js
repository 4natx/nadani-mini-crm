import { lookup, periodFor } from './analytics.js';
import { applyCommand } from './business.js';
import { dashboard } from './dashboard.js';
import { makeDemo } from './demo.js';
import { details, entityForm, titleOf } from './forms.js';
import { activityTypes, dateLabel, initialState, localDay } from './model.js';
import { pipelineView } from './pipeline.js';
import { calendarView, listView } from './records.js';
import { settingsView, stagesDialog } from './settings.js';
import { openDatabase, storeFor } from './storage.js';
import { download } from './transfer.js';
import { $, actions, button, el, field, icon, input, note, select, submit, titles, valuesOf } from './ui.js';

const screen = $('#screen');
const modal = $('#modal');
const sidebar = $('#sidebar');
const menu = $('#menu-toggle');
const media = matchMedia('(prefers-color-scheme: dark)');
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nadani-mini-crm:workspace') : null;
const period = days => ({ mode: String(days), range: periodFor(days) });
const filters = { overview: period(90), analytics: period(90), contacts: {}, companies: {}, deals: {}, tasks: {}, activities: {}, pipeline: {} };
const calendar = {};
let calendarOpen = false;
let state = initialState();
let repository;
let route = 'overview';
let ready = false;
let recovery = false;
let busy = false;
let pendingSync = false;
let dispose = null;
let toastTimer;
let opener;
let currentDay = localDay();

const ctx = {
  get state() { return state; },
  get recovery() { return recovery; },
  filters, render, open, close, confirm, form, run, replace, rawBackup, seed, toast, interactionTimeline,
  disposeView(callback) { dispose = callback; },
  editStages() { stagesDialog(ctx); },
  showCalendar(show = true) { calendarOpen = show; render(); $('#view-title')?.focus(); },
  clear(revision) { return replace(initialState(), revision, 'Dados locais apagados.'); },
  async start() {
    try { await run('start', {}, 'Espaço preparado.'); }
    catch (error) { toast(error.message); }
  },
};

const views = {
  overview: () => dashboard(ctx, 'overview'), analytics: () => dashboard(ctx, 'analytics'),
  contacts: () => listView(ctx, 'contacts'), companies: () => listView(ctx, 'companies'),
  deals: () => listView(ctx, 'deals'), activities: () => listView(ctx, 'activities'),
  tasks: () => calendarOpen ? calendarView(ctx, calendar) : listView(ctx, 'tasks'),
  pipeline: () => pipelineView(ctx), settings: () => settingsView(ctx),
};

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  if (message) toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 5000);
}

function theme() {
  const configured = state.settings.theme;
  const dark = configured === 'dark' || configured === 'system' && media.matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-toggle').replaceChildren(icon(dark ? 'sun' : 'moon'));
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
}
media.addEventListener('change', theme);
$('#theme-toggle').addEventListener('click', async () => {
  try { await run('settings', { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }, 'Tema atualizado.'); }
  catch (error) { toast(error.message); }
});

function navOpen(opened, focus = false) {
  sidebar.classList.toggle('open', opened);
  menu.setAttribute('aria-expanded', String(opened));
  menu.setAttribute('aria-label', opened ? 'Fechar menu' : 'Abrir menu');
  menu.replaceChildren(icon(opened ? 'close' : 'menu'));
  if (focus) (opened ? sidebar.querySelector('[aria-current]') : menu)?.focus();
}
menu.addEventListener('click', () => navOpen(!sidebar.classList.contains('open'), true));
document.addEventListener('pointerdown', event => {
  if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && !menu.contains(event.target)) navOpen(false);
});
document.addEventListener('focusin', event => {
  if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && !menu.contains(event.target)) navOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sidebar.classList.contains('open') && !modal.open) navOpen(false, true);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !modal.open) {
    event.preventDefault();
    globalSearch();
  }
});

function open(title, children, target) {
  if (busy) return;
  if (!modal.open) opener = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(...children.filter(Boolean));
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  (target || $('#modal-title')).focus();
}
function close() { if (modal.open && !busy) modal.close(); }
modal.addEventListener('click', event => { if (event.target.closest('[data-close]')) close(); });
modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
modal.addEventListener('close', () => {
  if (modal.open) return;
  $('#modal-body').replaceChildren();
  const target = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
  (target && !target.disabled ? target : $('#view-title') ?? $('#quick-deal')).focus({ preventScroll: true });
  opener = null;
});

function form(title, fields, label, update, id, description) {
  const error = el('p', { class: 'error', role: 'alert', tabindex: '-1', id: 'form-error' });
  const save = submit(label, id);
  const content = el('form', {}, description ? note(description) : null, el('div', { class: 'form-grid' }, fields), error,
    el('div', { class: 'modal-actions' }, button('Cancelar', { 'data-close': true }), save));
  content.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    error.textContent = '';
    try { await update(valuesOf(content)); close(); }
    catch (problem) { error.textContent = problem.message; error.focus(); }
    finally { save.disabled = false; }
  });
  open(title, [content], content.querySelector('input,select,textarea'));
}

function confirm(title, message, label, operation) {
  const error = el('p', { class: 'error', role: 'alert', tabindex: '-1' });
  const cancel = button('Cancelar', { 'data-close': true });
  const accept = button(label, { kind: 'danger', id: 'confirm-action', action: async () => {
    if (accept.disabled) return;
    accept.disabled = true;
    try { await operation(); close(); }
    catch (reason) { error.textContent = reason.message; error.focus(); }
    finally { accept.disabled = false; }
  } });
  open(title, [note(message), error, el('div', { class: 'modal-actions' }, cancel, accept)], cancel);
}

function warning(message, revision) {
  recovery = true;
  state.revision = Number.isSafeInteger(revision) ? revision : 0;
  $('#storage-alert').textContent = message;
  $('#storage-alert').hidden = false;
}

async function sync() {
  if (!repository) return;
  if (busy) { pendingSync = true; return; }
  try {
    const next = await repository.read();
    if (recovery || next.revision > state.revision) {
      state = next;
      recovery = false;
      $('#storage-alert').hidden = true;
      render();
    }
  } catch (error) {
    const raw = await repository.raw().catch(() => null);
    warning(error.message + ' Os dados originais permanecem no navegador. Abra Configurações para recuperar a base.', raw?.revision);
    render();
  }
}
channel?.addEventListener('message', sync);

async function perform(operation, message, replaced = false) {
  if (!repository) throw new Error('O armazenamento local está indisponível. Verifique as permissões do navegador.');
  if (busy) throw new Error('Aguarde a gravação em andamento.');
  busy = true;
  screen.setAttribute('aria-busy', 'true');
  if (modal.open) modal.setAttribute('aria-busy', 'true');
  try {
    state = await operation();
    if (replaced) {
      for (const key of ['contacts', 'companies', 'deals', 'activities', 'tasks', 'pipeline']) filters[key] = {};
    }
    recovery = false;
    $('#storage-alert').hidden = true;
    render();
    channel?.postMessage({ revision: state.revision });
    if (message) toast(message);
    return state;
  } finally {
    busy = false;
    screen.removeAttribute('aria-busy');
    modal.removeAttribute('aria-busy');
    if (pendingSync) { pendingSync = false; sync(); }
  }
}

function run(type, data, message) {
  if (recovery) throw new Error('Recupere a base em Configurações antes de salvar.');
  return perform(() => repository.update(snapshot => applyCommand(snapshot, type, data)), message);
}
function replace(next, revision, message) {
  return perform(() => repository.replace(next, revision), message, true);
}
async function rawBackup() {
  try {
    if (!repository) throw new Error('Armazenamento local indisponível.');
    const raw = await repository.raw();
    download('nadani-original-' + localDay() + '.json', JSON.stringify(raw) ?? 'null', 'application/json');
    toast('Cópia original exportada.');
  } catch (error) { toast(error.message); }
}
async function seed() {
  const revision = state.revision;
  const update = () => replace(makeDemo(), revision, 'Demonstração carregada.');
  if (state.started || revision || recovery) {
    confirm('Carregar demonstração?', 'Os registros e preferências atuais serão substituídos pela base fictícia.', 'Carregar demonstração', update);
  } else {
    try { await update(); }
    catch (error) { toast(error.message); }
  }
}

function globalSearch() {
  if (!ready || modal.open) return;
  const box = input('global-query', { id: 'global-query', type: 'search', placeholder: 'Nome, e-mail, empresa ou tarefa', maxlength: 120, autocomplete: 'off' });
  const results = el('div', { class: 'search-results', 'aria-live': 'polite' });
  const draw = () => {
    if (!results.isConnected) return;
    const groups = lookup(state, box.value);
    results.replaceChildren(...(groups.length ? groups.map(([kind, matches]) => el('section', {}, el('h3', {}, titles[kind]),
      el('ul', {}, matches.map(item => el('li', {}, button(titleOf(kind, item) + (item.archived ? ' · Arquivado' : ''), {
        class: 'record-link', action: () => details(ctx, kind, item),
      })))))) : [note(box.value.trim() ? 'Nenhum registro encontrado.' : 'Pesquise contatos, empresas, oportunidades e tarefas.')]));
  };
  let timer;
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 135); });
  box.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); clearTimeout(timer); draw(); results.querySelector('button')?.focus(); }
  });
  open('Pesquisa global', [field('Buscar no CRM', box), results], box);
  draw();
}
function interactionTimeline() {
  const type = select('type', [['', 'Todos os tipos'], ...Object.entries(activityTypes)], '');
  const list = el('ol', { class: 'interaction-timeline' });
  const draw = () => {
    const items = state.activities.filter(item => !item.archived && (!type.value || item.type === type.value))
      .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt));
    list.replaceChildren(...(items.length ? items.slice(0, 100).map(item => el('li', {},
      el('time', { datetime: item.day }, dateLabel(item.day)), note(activityTypes[item.type]),
      button(item.title, { class: 'record-link', action: () => details(ctx, 'activities', item) }))) :
      [el('li', {}, note('Nenhuma interação neste filtro.'))]));
  };
  type.addEventListener('change', draw);
  draw();
  open('Timeline de interações', [field('Tipo', type), note('Até 100 registros recentes. Use a lista para consultar todo o histórico.'), list], type);
}

function render() {
  theme();
  $('#company-name').textContent = state.settings.workspace;
  if (!ready) return;
  const focused = screen.contains(document.activeElement) ? document.activeElement.id : '';
  const position = $('#pipeline-board')?.scrollLeft;
  dispose?.();
  dispose = null;
  screen.replaceChildren(...views[route]());
  if (position && route === 'pipeline') $('#pipeline-board').scrollLeft = position;
  if (focused && !modal.open) document.getElementById(focused)?.focus({ preventScroll: true });
}

function routeChange(focus = false) {
  const key = location.hash.slice(1);
  if (key === 'main' && focus) { $('#main').focus(); return; }
  const next = Object.hasOwn(views, key) ? key : 'overview';
  if (route !== next) calendarOpen = false;
  route = next;
  $('#breadcrumb').textContent = titles[route];
  for (const link of sidebar.querySelectorAll('[data-route]')) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  navOpen(false);
  render();
  if (focus && ready) { window.scrollTo(0, 0); $('#view-title')?.focus({ preventScroll: true }); }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-route], a.brand');
  if (link && link.hash === location.hash) { event.preventDefault(); routeChange(true); }
});
window.addEventListener('hashchange', () => routeChange(true));
$('#quick-deal').addEventListener('click', () => { if (ready) entityForm(ctx, 'deals'); });
$('#search-global').addEventListener('click', globalSearch);
function refreshDay() {
  const today = localDay();
  if (!ready || currentDay === today) return;
  currentDay = today;
  for (const key of ['overview', 'analytics']) {
    if (filters[key].mode !== 'custom') filters[key].range = periodFor(Number(filters[key].mode), today);
  }
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshDay(); sync(); } });
setInterval(refreshDay, 60000);

theme();
routeChange();
try {
  repository = storeFor(await openDatabase());
  state = await repository.read();
} catch (error) {
  const raw = await repository?.raw().catch(() => null);
  warning(error.message + (repository ? ' A base original foi preservada para recuperação em Configurações.' : ''), raw?.revision);
}
ready = true;
screen.removeAttribute('aria-busy');
render();
