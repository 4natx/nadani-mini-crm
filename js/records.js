import { contextFor, inRange, stageName } from './analytics.js';
import { details, entityForm, options, rowsOptions, singular, titleOf } from './forms.js';
import { activityTypes, cents, contactsStatus, dateLabel, find, fold, localDay, money, nameOf, openDeal, overdue, priorities, probabilityOf,
  shiftDay, sizes, taskStatus } from './model.js';
import { actions, button, el, field, filterControl, heading, label, note, pagedTable, periodControl, searchControl, textField, titles } from './ui.js';

const any = (values, text = 'Todos') => [['', text], ...values];
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(value => [value, value]);
const textMatch = (query, values) => !query?.trim() || values.some(value => fold(value).includes(fold(query).trim()));
const allTags = records => unique(records.flatMap(item => item.tags ?? []));
const status = new Set(['contacts', 'companies', 'deals']);
const prioritiesOrder = ['low', 'medium', 'high', 'urgent'];

function filtersFor(state, kind) {
  const records = state[kind];
  const contacts = () => any(rowsOptions(state, 'contacts'));
  const companies = () => any(rowsOptions(state, 'companies'));
  const tags = () => any(allTags(records));
  if (kind === 'contacts') return [['companyId', 'Empresa', companies()], ['origin', 'Origem', any(unique(records.map(item => item.origin)))],
    ['status', 'Status', any(options(contactsStatus))], ['tag', 'Etiqueta', tags()]];
  if (kind === 'companies') return [['segment', 'Segmento', any(unique(records.map(item => item.segment)))],
    ['city', 'Cidade', any(unique(records.map(item => item.city)))], ['size', 'Porte', any(options(sizes))], ['tag', 'Etiqueta', tags()]];
  if (kind === 'deals') return [['stage', 'Etapa', any(state.stages.map(item => [item.id, item.name]))],
    ['contactId', 'Contato', contacts()], ['companyId', 'Empresa', companies()],
    ['result', 'Resultado', any([['open', 'Em aberto'], ['won', 'Ganhos'], ['lost', 'Perdidos']])]];
  if (kind === 'activities') return [['type', 'Tipo', any(options(activityTypes))], ['contactId', 'Contato', contacts()]];
  return [['status', 'Status', any(options(taskStatus))], ['priority', 'Prioridade', any(options(priorities))],
    ['due', 'Vencimento', any([['late', 'Atrasadas'], ['today', 'Hoje'], ['next', 'Próximas'], ['pending', 'Em aberto']])],
    ['contactId', 'Contato', contacts()], ['dealId', 'Oportunidade', any(rowsOptions(state, 'deals'))]];
}

function matchExtra(kind, item, prefs, today, state, bounds) {
  if (prefs.tag && !item.tags.includes(prefs.tag)) return false;
  if (kind === 'deals') {
    if (item.value < bounds.min || item.value > bounds.max || prefs.prob !== '' && prefs.prob !== undefined && probabilityOf(item, state.stages) < Number(prefs.prob)) return false;
    if (prefs.result && (prefs.result === 'open' ? !openDeal(item) : item.stage !== prefs.result)) return false;
  }
  if (kind === 'tasks' && prefs.due) {
    if (prefs.due === 'late' && !overdue(item, today)) return false;
    if (prefs.due === 'today' && item.due !== today) return false;
    if (prefs.due === 'next' && (item.due <= today || item.status === 'done')) return false;
    if (prefs.due === 'pending' && item.status === 'done') return false;
  }
  if (prefs.from || prefs.to) {
    const day = kind === 'deals' ? item.expected : kind === 'activities' ? item.day : kind === 'tasks' ? item.due : localDay(item.createdAt);
    if (!day || prefs.from && day < prefs.from || prefs.to && day > prefs.to) return false;
  }
  return true;
}

export function listView(ctx, kind) {
  const state = ctx.state;
  const prefs = ctx.filters[kind];
  const references = contextFor(state);
  const today = localDay();
  const datasets = {
    contacts: ['Contato', 'Empresa', 'E-mail', 'Origem', 'Status', 'Última interação', 'Ações'],
    companies: ['Empresa', 'Segmento', 'Cidade', 'Porte', 'Vínculos', 'Ações'],
    deals: ['Oportunidade', 'Contato / empresa', 'Etapa', 'Valor', 'Prob.', 'Previsão', 'Ações'],
    activities: ['Interação', 'Tipo', 'Contato', 'Data', 'Resultado', 'Ações'],
    tasks: ['Tarefa', 'Contato', 'Prioridade', 'Vencimento', 'Status', 'Ações'],
  };
  const slot = el('div', { id: 'record-results' });
  const error = el('p', { class: 'error', role: 'alert' });
  const rules = filtersFor(state, kind);
  if (status.has(kind)) rules.push(['archive', 'Arquivo', [['', 'Ativos'], ['archived', 'Arquivados'], ['all', 'Todos']]]);
  function draw() {
    let bounds = { min: 0, max: Infinity };
    try {
      if (kind === 'deals') {
        bounds = { min: prefs.min ? cents(prefs.min) : 0, max: prefs.max ? cents(prefs.max) : Infinity };
        if (bounds.min > bounds.max) throw new Error('O valor mínimo supera o máximo.');
      }
      if (prefs.from && prefs.to && prefs.from > prefs.to) throw new Error('O início do filtro deve ser anterior ao fim.');
      error.textContent = '';
    } catch (problem) {
      error.textContent = problem.message;
      slot.replaceChildren();
      return;
    }
    const list = state[kind].filter(item => {
      const searchable = [titleOf(kind, item), item.email, item.phone, item.origin, item.description, item.segment,
        nameOf(references.contacts.get(item.contactId)), references.companies.get(item.companyId)?.name, item.tags?.join(' ')];
      if (!textMatch(prefs.query, searchable)) return false;
      if (status.has(kind) && prefs.archive !== 'all' && Boolean(item.archived) !== (prefs.archive === 'archived')) return false;
      return rules.every(([key]) => ['tag', 'archive', 'result', 'due'].includes(key) || !prefs[key] || item[key] === prefs[key]) &&
        matchExtra(kind, item, prefs, today, state, bounds);
    });
    const compare = (a, b) => titleOf(kind, a).localeCompare(titleOf(kind, b), 'pt-BR', { sensitivity: 'base' });
    const sort = ({
      name: compare, recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      value: (a, b) => b.value - a.value, priority: (a, b) => prioritiesOrder.indexOf(b.priority) - prioritiesOrder.indexOf(a.priority),
      date: (a, b) => kind === 'activities' ? b.day.localeCompare(a.day) : (a.due || a.expected || '9999').localeCompare(b.due || b.expected || '9999'),
    })[prefs.sort ?? (kind === 'tasks' || kind === 'activities' ? 'date' : 'name')];
    list.sort(sort);
    pagedTable(slot, { list, name: titles[kind], paging: prefs, size: 10, headers: datasets[kind], rows: item => {
      const title = el('div', {}, el('strong', {}, titleOf(kind, item)), item.archived ? el('div', {}, label('Arquivado')) : null);
      const show = button('Detalhes', { id: 'record-' + item.id, kind: 'secondary small',
        'aria-label': 'Detalhes de ' + titleOf(kind, item), action: () => details(ctx, kind, item) });
      const company = references.companies.get(item.companyId)?.name ?? '—';
      const contact = nameOf(references.contacts.get(item.contactId));
      if (kind === 'contacts') return [title, company, item.email || '—', item.origin || '—', label(contactsStatus[item.status], item.status === 'customer' ? 'good' : 'info'),
        dateLabel(references.last.get(item.id)), show];
      if (kind === 'companies') return [title, item.segment, item.city || '—', sizes[item.size] || '—',
        state.contacts.filter(contact => contact.companyId === item.id).length + ' contato(s)', show];
      if (kind === 'deals') return [title, contact + (item.companyId ? ' · ' + company : ''), label(stageName(state, item.stage),
        item.stage === 'won' ? 'good' : item.stage === 'lost' ? 'bad' : 'info'), money(item.value), probabilityOf(item, state.stages) + '%', dateLabel(item.expected), show];
      if (kind === 'activities') return [title, label(activityTypes[item.type]), contact, dateLabel(item.day), item.result || '—', show];
      return [title, contact, label(priorities[item.priority], item.priority === 'urgent' ? 'bad' : ''), dateLabel(item.due),
        actions(label(taskStatus[item.status], item.status === 'done' ? 'good' : ''), overdue(item, today) ? label('Atrasada', 'warn') : null), show];
    } });
  }
  const rangeName = kind === 'deals' ? 'Fechamento previsto' : kind === 'tasks' ? 'Vencimento' : kind === 'activities' ? 'Data da interação' : 'Cadastro';
  const inputFilter = (name, label, attributes) => {
    const field = textField(name, label, prefs[name] ?? '', attributes);
    const control = field.querySelector('input');
    control.addEventListener('change', () => { prefs[name] = control.value; prefs.page = 0; draw(); });
    return field;
  };
  const dates = kind === 'companies' ? [] : [inputFilter('from', rangeName + ' de', { type: 'date' }), inputFilter('to', 'Até', { type: 'date' })];
  const amounts = kind === 'deals' ? [inputFilter('min', 'Valor mínimo', { inputmode: 'decimal' }),
    inputFilter('max', 'Valor máximo', { inputmode: 'decimal' }), inputFilter('prob', 'Prob. mínima (%)', { type: 'number', min: 0, max: 100 })] : [];
  const choose = [['name', 'Nome ou título'], ['recent', 'Mais recentes'], ...(kind === 'deals' ? [['value', 'Maior valor'], ['date', 'Previsão']] : []),
    ...(kind === 'tasks' ? [['date', 'Vencimento'], ['priority', 'Prioridade']] : []), ...(kind === 'activities' ? [['date', 'Data da interação']] : [])];
  const clear = button('Limpar filtros', { id: 'clear-filters', action: () => {
    for (const key of Object.keys(prefs)) delete prefs[key];
    ctx.render();
  } });
  const top = actions(kind === 'tasks' ? button('Calendário', { id: 'open-calendar', action: () => ctx.showCalendar() }) : null,
    kind === 'activities' ? button('Timeline de interações', { id: 'open-interaction-timeline', action: () => ctx.interactionTimeline() }) : null,
    button('Cadastrar ' + singular[kind], { id: 'new-' + kind, kind: 'primary', symbol: 'plus', action: () => entityForm(ctx, kind) }));
  const descriptions = { contacts: 'Gerencie leads e mantenha vínculos com empresas e negociações.', companies: 'Consulte organizações e relacionamentos.',
    deals: 'Acompanhe valores, fechamento e resultados comerciais.', activities: 'Histórico de interações registradas manualmente.',
    tasks: 'Organize prazos, prioridades e acompanhamentos comerciais.' };
  const filters = el('details', { class: 'filter-group', open: rules.some(([key]) => prefs[key]) || dates.some(node => node.querySelector('input').value) || amounts.some(node => node.querySelector('input').value) || prefs.sort },
    el('summary', {}, 'Filtros e ordenação'), el('div', { class: 'toolbar' },
      rules.map(([key, label, choices]) => filterControl(prefs, key, label, choices, draw)), ...dates, ...amounts,
      filterControl(prefs, 'sort', 'Ordenar', choose, draw)));
  draw();
  return [heading(titles[kind], descriptions[kind], top), el('section', { class: 'panel table-shell' },
    el('div', { class: 'toolbar' }, searchControl(prefs, draw, 'Pesquisar ' + titles[kind].toLowerCase()), clear), filters, error, slot)];
}

export function calendarView(ctx, config) {
  const today = localDay();
  const mode = config.mode ?? 'month';
  const selectedDay = config.day ?? today;
  const month = selectedDay.slice(0, 7);
  const first = month + '-01';
  const firstDay = new Date(first + 'T00:00:00Z').getUTCDay();
  const monthLength = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const weekStart = shiftDay(selectedDay, -new Date(selectedDay + 'T00:00:00Z').getUTCDay());
  const weekEnd = shiftDay(weekStart, 6);
  const title = mode === 'week' ? dateLabel(weekStart) + ' – ' + dateLabel(weekEnd) :
    new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first + 'T00:00:00Z'));
  const records = new Map();
  for (const [kind, date] of [['tasks', 'due'], ['activities', 'day']]) {
    for (const item of ctx.state[kind]) {
      const day = item[date];
      const visible = mode === 'week' ? day >= weekStart && day <= weekEnd : day.startsWith(month);
      if (item.archived || !visible) continue;
      if (!records.has(day)) records.set(day, []);
      records.get(day).push([kind, item]);
    }
  }
  const move = amount => {
    let next;
    if (mode === 'week') next = shiftDay(selectedDay, amount * 7);
    else {
      const date = new Date(first + 'T00:00:00Z');
      date.setUTCMonth(date.getUTCMonth() + amount);
      const nextMonth = date.toISOString().slice(0, 7);
      next = nextMonth === today.slice(0, 7) ? today : nextMonth + '-01';
    }
    if (next < '2000-01-01' || next > '2099-12-31') return;
    config.day = next;
    ctx.render();
  };
  const choose = day => { config.day = day; ctx.render(); document.getElementById('calendar-' + day)?.focus({ preventScroll: true }); };
  const selected = records.get(selectedDay) ?? [];
  const entries = items => items.length ? el('ul', { class: 'linked-list' }, items.map(([kind, item]) => el('li', {},
    button(titleOf(kind, item), { kind: 'secondary small', action: () => details(ctx, kind, item) }),
    label(kind === 'tasks' ? taskStatus[item.status] : 'Interação', kind === 'tasks' && overdue(item) ? 'warn' : ''),
    kind === 'tasks' && overdue(item) ? label('Atrasada', 'warn') : null))) : note('Nenhuma atividade para esta data.');
  const dateCells = Array.from({ length: mode === 'week' ? 7 : monthLength }, (_, index) => {
    const day = shiftDay(mode === 'week' ? weekStart : first, index);
    const items = records.get(day) ?? [];
    const hasLate = items.some(([kind, item]) => kind === 'tasks' && overdue(item));
    const text = el('span', {}, Number(day.slice(8)), items.length ? el('small', { class: 'calendar-count', 'aria-hidden': 'true' }, items.length) : null);
    return button(text, { id: 'calendar-' + day, kind: 'calendar-day' + (hasLate ? ' late' : ''), 'aria-pressed': String(day === selectedDay),
      disabled: day < '2000-01-01' || day > '2099-12-31',
      'aria-label': dateLabel(day) + ' · ' + items.length + ' registro(s)' + (hasLate ? ' · atraso' : ''), action: () => choose(day) });
  });
  const agenda = [...records].sort(([a], [b]) => a.localeCompare(b));
  const modeSwitch = el('select', { id: 'calendar-mode' }, [['month', 'Mês'], ['week', 'Semana'], ['agenda', 'Agenda']].map(([value, name]) => el('option', { value }, name)));
  modeSwitch.value = mode;
  modeSwitch.addEventListener('change', () => { config.mode = modeSwitch.value; ctx.render(); });
  return [heading('Calendário comercial', 'Vencimentos de tarefas e datas das interações registradas.',
    button('Voltar à lista de tarefas', { action: () => ctx.showCalendar(false) })),
    el('section', { class: 'panel padded' }, el('div', { class: 'calendar-header' }, el('h2', {}, title), actions(
      button(mode === 'week' ? 'Semana anterior' : 'Mês anterior', { id: 'calendar-prev', action: () => move(-1) }),
      button(mode === 'week' ? 'Próxima semana' : 'Próximo mês', { id: 'calendar-next', action: () => move(1) }),
      button('Hoje', { id: 'calendar-today', action: () => { config.day = today; ctx.render(); } }))),
    field('Visualização', modeSwitch),
    mode === 'agenda' ? el('div', { class: 'agenda' }, agenda.length ? agenda.map(([day, items]) => el('section', {},
      el('h3', {}, dateLabel(day)), entries(items))) : note('Nenhum registro no mês.')) :
      el('div', { class: 'calendar-grid', 'aria-label': mode === 'week' ? 'Dias da semana' : 'Dias do mês' },
        ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => el('strong', {}, day)),
        mode === 'month' ? Array.from({ length: firstDay }, () => el('span', { 'aria-hidden': 'true' })) : [], dateCells)),
    el('section', { class: 'panel padded day-detail' }, el('h2', {}, 'Registros de ' + dateLabel(selectedDay)), entries(selected),
      actions(button('Criar tarefa neste dia', { id: 'calendar-add-task', kind: 'primary', action: () => entityForm(ctx, 'tasks', null, { due: selectedDay }) })))];
}
