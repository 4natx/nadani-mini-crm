import { caps, decimal, fields, fold, hex, safeId, settingsFields, stableInt, terminal, text, validDay, validStamp } from './model.js';

const fail = reason => { throw new Error('Backup inválido: ' + reason + '.'); };

export function validateState(raw) {
  if (!raw || raw.version !== 1 || !stableInt(raw.revision, 0, Number.MAX_SAFE_INTEGER - 2) || typeof raw.started !== 'boolean') fail('versão ou estrutura incompatível');
  const keys = ['contacts', 'companies', 'deals', 'activities', 'tasks', 'stages', 'events'];
  const seen = new Set();
  for (const kind of keys) {
    if (!Array.isArray(raw[kind]) || raw[kind].length > caps[kind]) fail(kind);
    for (const item of raw[kind]) {
      if (!item || !safeId(item.id) || seen.has(item.id)) fail('IDs repetidos ou inválidos');
      seen.add(item.id);
    }
  }
  if (raw.stages.length < 3 || raw.stages.at(-2).id !== 'won' || raw.stages.at(-1).id !== 'lost') fail('etapas finais');
  const names = new Set();
  const stages = raw.stages.map(stage => {
    const name = text(stage.name, 'Nome da etapa', 40, true);
    if (!hex(stage.color) || !stableInt(stage.probability, 0, 100) || names.has(fold(name)) ||
      stage.id === 'won' && (stage.probability !== 100 || name !== 'Ganho') ||
      stage.id === 'lost' && (stage.probability !== 0 || name !== 'Perdido')) fail('definição das etapas');
    names.add(fold(name));
    return { id: stage.id, name, color: stage.color, probability: stage.probability };
  });
  const order = new Map(stages.map(stage => [stage.id, new Set()]));
  const result = { version: 1, revision: raw.revision, started: raw.started, stages, settings: settingsFields(raw.settings) };
  for (const kind of keys.slice(0, 5)) {
    result[kind] = raw[kind].map(item => {
      if (!validStamp(item.createdAt) || !validStamp(item.updatedAt) || item.createdAt > item.updatedAt || typeof item.archived !== 'boolean') fail('datas ou estado de cadastro');
      const standard = { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, archived: item.archived };
      const state = { ...raw, stages };
      if (kind === 'tasks') {
        if (item.status === 'done' ? !validDay(item.completedOn) : item.completedOn !== null) fail('conclusão da tarefa');
        standard.completedOn = item.completedOn;
      }
      if (kind === 'deals') {
        const column = order.get(item.stage);
        if (item.currency !== 'BRL' || !stableInt(item.value, 0, caps.value) || !column || !stableInt(item.order, 0, caps.deals) || column.has(item.order) ||
            (terminal.includes(item.stage) ? !validDay(item.closedOn) : item.closedOn !== null) ||
            (item.stage !== 'lost' && item.lostReason !== '')) fail('oportunidade ou posição inconsistente');
        column.add(item.order);
        Object.assign(standard, { order: item.order, closedOn: item.closedOn, lostReason: text(item.lostReason, 'Motivo da perda', 300) });
        return { ...fields(state, kind, { ...item, value: decimal(item.value) }), ...standard };
      }
      return { ...fields(state, kind, item), ...standard };
    });
  }
  for (const values of order.values()) if ([...values].some(value => value >= values.size)) fail('ordens de cartão não contíguas');
  result.events = raw.events.map(entry => {
    if (!keys.slice(0, 5).includes(entry.kind) || !safeId(entry.entityId) || !validStamp(entry.at) ||
      !['created', 'updated', 'archive', 'restore', 'delete', 'stage', 'won', 'lost', 'reopened', 'value', 'completed', 'merged'].includes(entry.type) ||
      [entry.contactId, entry.dealId, entry.companyId].some(value => value !== null && !safeId(value))) fail('timeline');
    return { id: entry.id, kind: entry.kind, entityId: entry.entityId, at: entry.at, type: entry.type,
      label: text(entry.label, 'Evento', 220, true), detail: text(entry.detail ?? '', 'Detalhe do evento', 350), contactId: entry.contactId, dealId: entry.dealId, companyId: entry.companyId };
  });
  if (result.events.some((entry, index) => index && entry.at > result.events[index - 1].at)) fail('cronologia da timeline');
  return result;
}
export function parseBackup(value) {
  let data;
  try { data = JSON.parse(value); } catch { fail('JSON malformado'); }
  return validateState(data);
}
