import { dateLabel } from './model.js';
const quantity = value => Number(value).toLocaleString('pt-BR');
import { periodFor, validRange } from './analytics.js';

export const $ = selector => document.querySelector(selector);
export const titles = { overview: 'Visão geral', contacts: 'Contatos', companies: 'Empresas', deals: 'Oportunidades',
  pipeline: 'Funil', activities: 'Interações', tasks: 'Tarefas', analytics: 'Análises', settings: 'Configurações' };

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== false && child !== undefined && child !== null) node.append(child);
  return node;
}

export function svg(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function icon(name) {
  const node = svg('svg', { class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
  node.append(svg('use', { href: './assets/icons.svg#' + name }));
  return node;
}

export function button(label, { action, kind = 'secondary', symbol, ...attrs } = {}) {
  const node = el('button', { type: 'button', class: 'button ' + kind, ...attrs }, symbol ? icon(symbol) : null, label);
  if (action) node.addEventListener('click', action);
  return node;
}

export const submit = (label, id = 'save-form') => el('button', { id, type: 'submit', class: 'button primary' }, label);
export const input = (name, attrs) => el('input', { name, ...attrs });
export const field = (label, control, wide = false) => el('label', { class: wide ? 'field wide' : 'field' }, el('span', {}, label), control);
export const textField = (name, label, value = '', attrs = {}, wide = false) => field(label, input(name, { value, ...attrs }), wide);
export const area = (name, label, value = '') => field(label, el('textarea', { name, rows: 3, maxlength: 600 }, value), true);
export const actions = (...children) => el('div', { class: 'actions' }, children);
export const label = (text, tone = '') => el('span', { class: 'badge ' + tone }, text);
export const note = text => el('p', { class: 'fine' }, text);
export const valuesOf = form => Object.fromEntries(new FormData(form));

export function select(name, options, value, attrs) {
  const node = el('select', { name, ...attrs }, options.map(([key, label]) => el('option', { value: key }, label)));
  if (value !== undefined && [...node.options].some(option => option.value === String(value))) node.value = value;
  return node;
}

export function heading(title, detail, control) {
  return el('div', { class: 'page-heading' }, el('div', {}, el('h1', { id: 'view-title', tabindex: '-1' }, title), el('p', {}, detail)), control);
}

export function panel(title, ...contents) {
  return el('section', { class: 'panel padded' }, el('h2', {}, title), ...contents);
}

export function facts(rows, className = 'facts') {
  return el('dl', { class: className }, rows.map(([name, value]) => el('div', {}, el('dt', {}, name), el('dd', {}, value))));
}

export function table(headers, rows, name = 'Dados', id) {
  return el('div', { class: 'table-region', role: 'region', tabindex: '0', 'aria-label': name },
    el('table', { id, 'aria-label': name },
      el('thead', {}, el('tr', {}, headers.map(head => el('th', { scope: 'col', 'data-small': head === 'Selecionar' }, head === 'Selecionar' ? el('span', { class: 'sr' }, head) : head)))),
      el('tbody', {}, rows.map(row => el('tr', {}, row.map((value, index) => el('td', { 'data-small': headers[index] === 'Selecionar' }, value)))))));
}

function pager(render, paging, count, size, name, extra, prefix) {
  const pages = Math.max(1, Math.ceil(count / size));
  paging.page = Math.max(0, Math.min(paging.page ?? 0, pages - 1));
  const move = direction => { paging.page += direction; render(); };
  return el('div', { class: 'pagination', 'aria-live': 'polite', tabindex: '-1', id: prefix + '-pages' },
    el('span', {}, quantity(count) + ' ' + name + extra),
    actions(button('Anterior', { id: prefix + '-prev', disabled: paging.page === 0, kind: 'secondary small', action: () => move(-1) }),
      el('span', {}, (paging.page + 1) + ' / ' + pages),
      button('Próxima', { id: prefix + '-next', disabled: paging.page + 1 === pages, kind: 'secondary small', action: () => move(1) })));
}

export function pagedTable(target, { list, rows, headers, name, paging, size, extra }) {
  const prefix = name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[^a-z0-9]+/g, '-');
  const draw = () => {
    const restore = target.contains(document.activeElement) ? document.activeElement.id : '';
    const pages = pager(draw, paging, list.length, size, 'registro(s)', (typeof extra === 'function' ? extra() : extra) ?? '', prefix);
    const subset = list.slice(paging.page * size, (paging.page + 1) * size);
    if (!subset.length) target.replaceChildren(el('p', { class: 'empty' }, 'Nenhum registro corresponde aos filtros atuais.'), pages);
    else target.replaceChildren(table(headers, subset.map(rows), name), pages);
    if (restore) {
      const next = document.getElementById(restore);
      (next && !next.disabled ? next : pages).focus({ preventScroll: true });
    }
  };
  draw();
}

export function searchControl(prefs, redraw, placeholder) {
  const node = input('query', { id: 'context-search', type: 'search', value: prefs.query ?? '', placeholder, autocomplete: 'off', maxlength: 120 });
  let timer;
  node.addEventListener('input', () => {
    prefs.query = node.value;
    prefs.page = 0;
    clearTimeout(timer);
    timer = setTimeout(redraw, 105);
  });
  return field('Pesquisar', node);
}

export function filterControl(prefs, key, title, options, redraw) {
  const current = prefs[key];
  const choices = current && !options.some(([value]) => value === current) ?
    [...options, [current, 'Seleção anterior (indisponível)']] : options;
  const node = select(key, choices, current, { id: 'filter-' + key });
  node.addEventListener('change', () => { prefs[key] = node.value; prefs.page = 0; redraw(); });
  return field(title, node);
}

export function periodControl(config, onUpdate, filters = []) {
  const selectMode = select('period', [['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['custom', 'Personalizado']], config.mode, { id: 'period-mode' });
  const start = input('start', { type: 'date', value: config.range.start, id: 'period-start', required: true });
  const end = input('end', { type: 'date', value: config.range.end, id: 'period-end', required: true });
  const custom = [field('De', start), field('Até', end)];
  const apply = submit('Aplicar', 'apply-period');
  const error = el('p', { class: 'error', role: 'alert' });
  const result = el('form', { class: 'panel period', id: 'period-form' },
    el('div', { class: 'period-caption' }, el('strong', {}, 'Período'), note(dateLabel(config.range.start) + ' – ' + dateLabel(config.range.end))),
    field('Janela', selectMode), custom[0], custom[1], apply, ...filters, error);
  function reflect() {
    const visible = selectMode.value === 'custom';
    for (const node of [...custom, apply]) node.hidden = !visible;
    start.disabled = end.disabled = !visible;
  }
  selectMode.addEventListener('change', () => {
    reflect();
    if (selectMode.value !== 'custom') {
      config.mode = selectMode.value;
      config.range = periodFor(Number(config.mode));
      onUpdate();
    }
  });
  result.addEventListener('submit', event => {
    event.preventDefault();
    if (selectMode.value !== 'custom') return;
    try { config.range = validRange({ start: start.value, end: end.value }); config.mode = 'custom'; onUpdate(); }
    catch (problem) { error.textContent = problem.message; }
  });
  reflect();
  return result;
}

export function metric(name, value, symbol, detail, tone = '') {
  return el('div', { class: 'panel metric', 'data-metric': name },
    el('span', { class: 'metric-label' }, el('span', { class: 'tile ' + tone }, icon(symbol)), name),
    el('strong', {}, value), detail ? el('small', {}, detail) : null);
}

