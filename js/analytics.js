import { find, localDay, openDeal, overdue, probabilityOf, shiftDay, validDay } from './model.js';

export function periodFor(days, today = localDay()) { return { start: shiftDay(today, 1 - days), end: today }; }
export function validRange(range) {
  if (!validDay(range.start) || !validDay(range.end) || range.start > range.end ||
      (Date.parse(range.end) - Date.parse(range.start)) / 86400000 > 365) throw new Error('Selecione um intervalo válido de até 366 dias.');
  return range;
}
export const inRange = (day, range) => Boolean(day) && day >= range.start && day <= range.end;
export function previousRange(range) {
  const length = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
  return { start: shiftDay(range.start, -length), end: shiftDay(range.start, -1) };
}
export const growth = (current, prior) => prior > 0 ? Math.round((current / prior - 1) * 1000) / 10 : null;
export const weighted = (value, probability) => Number((BigInt(value) * BigInt(probability) + 50n) / 100n);
const count = (map, key, value = 1) => map.set(key, (map.get(key) ?? 0) + value);

export function contextFor(state) {
  const contacts = new Map(state.contacts.map(item => [item.id, item]));
  const companies = new Map(state.companies.map(item => [item.id, item]));
  const deals = new Map(state.deals.map(item => [item.id, item]));
  const last = new Map();
  const next = new Map();
  for (const activity of state.activities) {
    for (const key of [activity.contactId, activity.companyId, activity.dealId].filter(Boolean)) {
      if (activity.day > (last.get(key) || '')) last.set(key, activity.day);
    }
  }
  for (const task of state.tasks) {
    if (task.status === 'done' || task.archived) continue;
    for (const key of [task.contactId, task.companyId, task.dealId].filter(Boolean)) {
      if (!next.has(key) || task.due < next.get(key).due) next.set(key, task);
    }
  }
  return { contacts, companies, deals, last, next };
}

export function followups(state, today = localDay()) {
  const context = contextFor(state);
  const threshold = shiftDay(today, -state.settings.followDays);
  const deals = state.deals.filter(item => !item.archived && openDeal(item)).flatMap(deal => {
    const task = context.next.get(deal.id);
    const date = context.last.get(deal.id) ?? localDay(deal.createdAt);
    const stale = date <= threshold;
    if (!task && !stale) return [];
    return [{ deal, task, stale, date }];
  });
  const late = state.tasks.filter(task => !task.archived && overdue(task, today));
  return { deals, late };
}

export function summarize(state, range, today = localDay()) {
  const current = state.deals.filter(deal => !deal.archived && openDeal(deal));
  const opened = state.deals.filter(deal => inRange(localDay(deal.createdAt), range));
  const closed = state.deals.filter(deal => inRange(deal.closedOn, range) && !openDeal(deal));
  const won = closed.filter(deal => deal.stage === 'won');
  const lost = closed.length - won.length;
  const sum = values => values.reduce((total, deal) => total + deal.value, 0);
  const createdMonths = new Map();
  const wonMonths = new Map();
  const origin = new Map();
  const activity = new Map();
  for (const deal of opened) { count(createdMonths, localDay(deal.createdAt).slice(0, 7)); count(origin, deal.origin || 'Sem origem'); }
  for (const deal of won) count(wonMonths, deal.closedOn.slice(0, 7));
  for (const entry of state.activities) if (inRange(entry.day, range)) count(activity, entry.type);
  const pending = state.tasks.filter(task => !task.archived && task.status !== 'done');
  const done = state.tasks.filter(task => inRange(task.completedOn, range));
  const stageSelection = new Set([...current, ...closed].map(item => item.id));
  return { contacts: state.contacts.length, companies: state.companies.length, leads: state.contacts.filter(item => !item.archived && item.status === 'lead').length,
    contactsCreated: state.contacts.filter(item => inRange(localDay(item.createdAt), range)).length, created: opened.length, open: current.length,
    openValue: sum(current), forecast: current.reduce((value, deal) => value + weighted(deal.value, probabilityOf(deal, state.stages)), 0),
    won: won.length, lost, wonValue: sum(won), average: won.length ? Math.round(sum(won) / won.length) : 0,
    winRate: closed.length ? Math.round(won.length * 1000 / closed.length) / 10 : null,
    closeDays: won.length ? won.reduce((days, deal) => days + Math.max(0, (Date.parse(deal.closedOn) - Date.parse(localDay(deal.createdAt))) / 86400000), 0) / won.length : null,
    pending: pending.length, done: done.length, late: pending.filter(task => overdue(task, today)).length,
    createdMonths: [...createdMonths].sort(), wonMonths: [...wonMonths].sort(), origin: [...origin].sort((a, b) => b[1] - a[1]),
    activity: [...activity].sort((a, b) => b[1] - a[1]), stages: state.stages.map(stage => {
      const deals = state.deals.filter(deal => deal.stage === stage.id && stageSelection.has(deal.id));
      return { ...stage, count: deals.length, value: sum(deals) };
    }) };
}

export function timeline(state, kind, id) {
  const field = { contacts: 'contactId', companies: 'companyId', deals: 'dealId' }[kind];
  return state.events.filter(item => (item.kind === kind && item.entityId === id) || field && item[field] === id);
}

export function lookup(state, query) {
  const term = query.trim().normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR');
  if (!term) return [];
  const searchable = { contacts: ['name', 'lastName', 'email', 'phone'], companies: ['name', 'segment'], deals: ['title', 'origin'], tasks: ['title', 'description'] };
  return Object.entries(searchable).map(([kind, columns]) => [kind, state[kind].filter(item =>
    columns.map(column => item[column] ?? '').join(' ').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR').includes(term)).slice(0, 6)]).filter(([, matches]) => matches.length);
}
export const stageName = (state, key) => find(state.stages, key)?.name ?? '—';
