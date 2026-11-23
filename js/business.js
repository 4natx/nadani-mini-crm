import { activityTypes, caps, digits, fields, find, fold, hex, id, initialState, integer, localDay, money, nameOf, openDeal, refs, settingsFields, tags, terminal, text } from './model.js';

const kinds = Object.keys(refs);
const room = (state, kind) => { if (state[kind].length >= caps[kind]) throw new Error('Limite de registros atingido.'); };
const record = (list, key) => {
  const item = find(list, key);
  if (!item) throw new Error('Registro indisponível. Atualize a tela.');
  return item;
};
const fresh = (item, expected) => {
  if (expected !== undefined && item.updatedAt !== expected) throw new Error('O registro mudou em outra operação. Reabra o formulário.');
};
const titleOf = item => item.title || (item.lastName === undefined ? item.name : nameOf(item));
function event(state, kind, entityId, type, label, ctx, data = {}, detail = '') {
  state.events.unshift({ id: ctx.id(), kind, entityId, type, label, detail, at: ctx.at,
    contactId: data.contactId ?? null, dealId: data.dealId ?? null, companyId: data.companyId ?? null });
  state.events.length = Math.min(state.events.length, caps.events);
}

export function duplicates(state, input, except) {
  const email = fold(input.email).trim();
  const phone = digits(input.phone);
  const name = fold(nameOf(input));
  return state.contacts.flatMap(item => {
    if (item.id === except) return [];
    const reasons = [];
    if (email && email === fold(item.email)) reasons.push('e-mail');
    if (phone && phone === digits(item.phone)) reasons.push('telefone');
    if (input.companyId && input.companyId === item.companyId && name && name === fold(nameOf(item))) reasons.push('nome e empresa');
    return reasons.length ? [{ item, reasons }] : [];
  });
}

export const ordered = (state, stage) => state.deals.filter(deal => deal.stage === stage).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
export const isLinked = (state, kind, key) => {
  const field = { contacts: 'contactId', companies: 'companyId', deals: 'dealId' }[kind];
  return field ? kinds.some(list => state[list].some(item => item[field] === key)) : false;
};

function setDealStage(state, deal, next, before, reason, ctx, create = false) {
  const stage = record(state.stages, next);
  const previous = deal.stage;
  if (before === deal.id) return;
  const target = ordered(state, next).filter(item => item.id !== deal.id);
  const index = before ? target.findIndex(item => item.id === before) : target.length;
  if (index < 0) throw new Error('O cartão de destino mudou. Tente de novo.');
  const moved = create || next !== previous;
  if (!moved && ordered(state, next).findIndex(item => item.id === deal.id) === index) return;
  if (moved) {
    deal.stage = next;
    deal.closedOn = terminal.includes(next) ? ctx.day : null;
    deal.lostReason = next === 'lost' ? text(reason ?? '', 'Motivo da perda', 300) : '';
    if (!create) {
      const label = terminal.includes(next) ? (next === 'won' ? 'Negócio ganho' : 'Negócio perdido') :
        terminal.includes(previous) ? 'Negócio reaberto' : 'Etapa alterada';
      event(state, 'deals', deal.id, next === 'won' ? 'won' : next === 'lost' ? 'lost' : terminal.includes(previous) ? 'reopened' : 'stage',
        label + ' · ' + stage.name + ' · ' + deal.title, ctx, deal, deal.lostReason);
    }
  }
  target.splice(index, 0, deal);
  for (const [i, item] of target.entries()) item.order = i;
  if (moved && !create) ordered(state, previous).forEach((item, i) => { item.order = i; });
  deal.updatedAt = ctx.at;
}

function upsert(state, kind, raw, ctx) {
  if (!kinds.includes(kind)) throw new Error('Tipo de cadastro inválido.');
  const old = raw.id ? record(state[kind], raw.id) : null;
  if (old) fresh(old, raw.stamp); else room(state, kind);
  const values = fields(state, kind, raw);
  if (kind === 'contacts' && !raw.allowDuplicate && duplicates(state, values, old?.id).length) {
    const error = new Error('Possível contato duplicado. Revise os vínculos ou confirme o cadastro separado.');
    error.name = 'DuplicateContact';
    throw error;
  }
  const current = old ?? { id: ctx.id(), createdAt: ctx.at, archived: false };
  const previousStage = old?.stage;
  const previousValue = old?.value;
  const previousTask = old?.status;
  Object.assign(current, values, { updatedAt: ctx.at });
  if (!old) state[kind].push(current);
  if (kind === 'deals') {
    if (old) current.stage = previousStage;
    if (!old || previousStage !== values.stage) setDealStage(state, current, values.stage, null, raw.lostReason, ctx, !old);
    else if (values.stage === 'lost' && raw.lostReason !== undefined) current.lostReason = text(raw.lostReason, 'Motivo da perda', 300);
    if (old && previousValue !== values.value) event(state, kind, current.id, 'value', 'Valor atualizado · ' + current.title, ctx, current, money(previousValue) + ' → ' + money(current.value));
  }
  if (kind === 'tasks') current.completedOn = values.status === 'done' ? current.completedOn || ctx.day : null;
  const baseLabel = { contacts: old ? 'Contato atualizado' : 'Contato cadastrado',
    companies: old ? 'Empresa atualizada' : 'Empresa cadastrada',
    deals: old ? 'Oportunidade atualizada' : 'Oportunidade criada',
    activities: old ? 'Interação atualizada' : 'Interação registrada (' + activityTypes[current.type] + ')',
    tasks: old ? 'Tarefa atualizada' : 'Tarefa criada' }[kind];
  if (kind === 'tasks' && values.status === 'done' && previousTask !== 'done') {
    event(state, kind, current.id, 'completed', 'Tarefa concluída · ' + current.title, ctx, current);
  } else if (kind !== 'deals' || !old || previousStage === values.stage) {
    event(state, kind, current.id, old ? 'updated' : 'created', baseLabel + ' · ' + titleOf(current), ctx, current);
  }
  if (kind === 'deals' && !old && !openDeal(current)) {
    event(state, kind, current.id, current.stage, (current.stage === 'won' ? 'Negócio ganho' : 'Negócio perdido') + ' · ' + current.title, ctx, current, current.lostReason);
  }
  return current;
}

const commands = {
  start() {},
  settings(state, raw) { state.settings = settingsFields({ ...state.settings, ...raw }); },
  save(state, raw, ctx) { upsert(state, raw.kind, raw, ctx); },
  entity(state, raw, ctx) {
    if (!kinds.includes(raw.kind) || !['archive', 'restore', 'delete'].includes(raw.action)) throw new Error('Ação inválida.');
    const list = state[raw.kind];
    const item = record(list, raw.id);
    fresh(item, raw.stamp);
    if (raw.action === 'delete') {
      if (isLinked(state, raw.kind, item.id)) throw new Error('Há vínculos com outros registros. Arquive para preservar o histórico.');
      list.splice(list.indexOf(item), 1);
      if (raw.kind === 'deals') ordered(state, item.stage).forEach((deal, i) => { deal.order = i; });
    } else {
      item.archived = raw.action === 'archive';
      item.updatedAt = ctx.at;
    }
    event(state, raw.kind, item.id, raw.action, ({ delete: 'Registro excluído', archive: 'Registro arquivado', restore: 'Registro reativado' })[raw.action] + ' · ' + titleOf(item), ctx, item);
  },
  move(state, raw, ctx) {
    const deal = record(state.deals, raw.id);
    if (deal.archived) throw new Error('Reative a oportunidade antes de movê-la.');
    fresh(deal, raw.stamp);
    setDealStage(state, deal, raw.stage, raw.before, raw.reason, ctx);
  },
  duplicate(state, raw, ctx) {
    const source = record(state.deals, raw.id);
    const title = source.title.slice(0, 116) + ' · cópia';
    upsert(state, 'deals', { ...source, id: undefined, title, value: decimalForInput(source.value), stage: state.stages[0].id, lostReason: '' }, ctx);
  },
  taskStatus(state, raw, ctx) {
    const task = record(state.tasks, raw.id);
    if (task.status === raw.status) return;
    upsert(state, 'tasks', { ...task, ...raw, status: raw.status }, ctx);
  },
  merge(state, raw, ctx) {
    const keep = record(state.contacts, raw.keep);
    const removed = record(state.contacts, raw.remove);
    if (keep.id === removed.id) throw new Error('Escolha dois contatos diferentes.');
    fresh(keep, raw.keepStamp);
    fresh(removed, raw.removeStamp);
    for (const key of ['lastName', 'email', 'phone', 'role', 'origin', 'companyId']) keep[key] ||= removed[key];
    keep.tags = tags([...new Set([...keep.tags, ...removed.tags])]);
    if (removed.notes && removed.notes !== keep.notes) keep.notes = [keep.notes, removed.notes].filter(Boolean).join('\n');
    if (keep.notes.length > 900) throw new Error('As observações combinadas ultrapassam 900 caracteres. Revise as notas antes de mesclar.');
    for (const kind of ['deals', 'tasks', 'activities']) {
      for (const item of state[kind]) if (item.contactId === removed.id) { item.contactId = keep.id; item.updatedAt = ctx.at; }
    }
    for (const entry of state.events) {
      if (entry.contactId === removed.id) entry.contactId = keep.id;
      if (entry.kind === 'contacts' && entry.entityId === removed.id) entry.entityId = keep.id;
    }
    state.contacts.splice(state.contacts.indexOf(removed), 1);
    keep.updatedAt = ctx.at;
    event(state, 'contacts', keep.id, 'merged', 'Contatos mesclados · ' + nameOf(keep), ctx);
  },
  importContacts(state, raw, ctx) {
    let added = 0;
    for (const input of raw.contacts) {
      const candidate = fields(state, 'contacts', input);
      if (duplicates(state, candidate).length) continue;
      upsert(state, 'contacts', input, ctx);
      added++;
    }
    if (!added) throw new Error('Nenhum contato novo pôde ser importado.');
  },
  stage(state, raw, ctx) {
    const list = state.stages;
    const existing = raw.id ? record(list, raw.id) : null;
    if (existing && terminal.includes(existing.id)) throw new Error('Etapas finais são fixas.');
    if (raw.action === 'delete') {
      const activeOpen = list.filter(stage => !terminal.includes(stage.id));
      if (!existing || activeOpen.length < 2) throw new Error('Mantenha ao menos uma etapa aberta.');
      const assigned = ordered(state, existing.id);
      if (assigned.length) {
        const destination = record(list, raw.destination);
        if (destination.id === existing.id || terminal.includes(destination.id)) throw new Error('Escolha outra etapa aberta.');
        for (const deal of assigned) setDealStage(state, deal, destination.id, null, '', ctx);
      }
      list.splice(list.indexOf(existing), 1);
      return;
    }
    if (raw.action === 'move') {
      if (!existing) throw new Error('Etapa indisponível.');
      const from = list.indexOf(existing);
      const to = from + integer(raw.direction + 1, 0, 2, 'Direção') - 1;
      if (to < 0 || to >= list.length - 2) return;
      [list[from], list[to]] = [list[to], list[from]];
      return;
    }
    const name = text(raw.name, 'Nome da etapa', 40, true);
    if (list.some(stage => stage !== existing && fold(stage.name) === fold(name))) throw new Error('Já existe uma etapa com esse nome.');
    if (!hex(raw.color)) throw new Error('Cor inválida.');
    const values = { name, color: raw.color, probability: integer(raw.probability, 0, 100, 'Probabilidade') };
    if (existing) Object.assign(existing, values);
    else {
      room(state, 'stages');
      list.splice(list.length - 2, 0, { id: ctx.id(), ...values });
    }
  },
};
const decimalForInput = value => (value / 100).toFixed(2);

export function applyCommand(before, type, raw = {}, { now = new Date(), makeId = id } = {}) {
  if (!Object.hasOwn(commands, type)) throw new Error('Operação desconhecida.');
  const next = structuredClone(before);
  const latest = next.events[0]?.at ?? '';
  const actual = now.toISOString();
  const at = latest >= actual ? new Date(Date.parse(latest) + 1).toISOString() : actual;
  commands[type](next, raw, { at, id: makeId, day: localDay(now) });
  next.revision++;
  if (type !== 'settings') next.started = true;
  return next;
}

export { initialState };
