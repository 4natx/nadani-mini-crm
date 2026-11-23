import '../vendor/papaparse.js';
import { duplicates } from './business.js';
import { caps, contactsStatus, fields } from './model.js';

const Papa = globalThis.Papa;
export const importFields = { name: 'Nome', lastName: 'Sobrenome', email: 'E-mail', phone: 'Telefone', role: 'Cargo', origin: 'Origem',
  status: 'Status', tags: 'Etiquetas', notes: 'Observações' };
export function parseCSV(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('O CSV contém dados binários ou usa uma codificação incompatível.');
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t'] });
  if (parsed.errors.some(item => item.code !== 'UndetectableDelimiter')) throw new Error('CSV malformado. Revise as aspas e o delimitador.');
  const [headers, ...rows] = parsed.data;
  if (!headers?.length || !rows.length || headers.length > 80 || rows.length > 1500) throw new Error('Inclua cabeçalhos e de 1 a 1.500 registros com até 80 colunas.');
  return { headers, rows };
}

export function previewImport(state, rows, mapping) {
  if (!Number.isInteger(mapping.name) || mapping.name < 0) throw new Error('Mapeie a coluna Nome.');
  const accepted = [];
  const review = [];
  const candidates = { ...state, contacts: [...state.contacts] };
  const statuses = Object.fromEntries(Object.entries(contactsStatus).flatMap(([key, label]) => [[key, key], [label.toLocaleLowerCase('pt-BR'), key]]));
  rows.forEach((cells, idx) => {
    const raw = Object.fromEntries(Object.keys(importFields).map(key => [key, cells[mapping[key]] ?? '']));
    const source = raw.status.trim().toLocaleLowerCase('pt-BR');
    try {
      if (source && !Object.hasOwn(statuses, source)) throw new Error('Status desconhecido.');
      raw.status = source ? statuses[source] : 'lead';
      const values = fields(state, 'contacts', raw);
      const found = duplicates(candidates, values);
      if (found.length) { review.push({ index: idx + 2, status: 'Duplicado', name: raw.name, note: found[0].reasons.join(', ') }); return; }
      accepted.push({ kind: 'contacts', ...values });
      candidates.contacts.push({ ...values, id: 'staged-' + idx });
      review.push({ index: idx + 2, status: 'Novo', name: raw.name, note: '' });
    } catch (error) {
      review.push({ index: idx + 2, status: 'Inválido', name: raw.name, note: error.message });
    }
  });
  if (state.contacts.length + accepted.length > caps.contacts) throw new Error('Os novos contatos ultrapassariam o limite do CRM.');
  return { accepted, review };
}

export function entityCSV(state, kind) {
  const keys = {
    contacts: ['id', 'name', 'lastName', 'email', 'phone', 'companyId', 'role', 'origin', 'status', 'tags', 'notes'],
    companies: ['id', 'name', 'segment', 'website', 'email', 'phone', 'city', 'region', 'size', 'tags', 'notes'],
    deals: ['id', 'title', 'contactId', 'companyId', 'stage', 'value', 'currency', 'probability', 'expected', 'closedOn', 'lostReason', 'origin', 'tags', 'description'],
    activities: ['id', 'title', 'type', 'day', 'contactId', 'companyId', 'dealId', 'result', 'description'],
    tasks: ['id', 'title', 'status', 'priority', 'due', 'completedOn', 'contactId', 'companyId', 'dealId', 'description'],
  }[kind];
  const protect = value => {
    if (Array.isArray(value)) value = value.join(', ');
    if (typeof value !== 'string') return value;
    return /^[\s\p{Cf}\u0000-\u001f\u007f]*[=+@\-＝＋＠－]|^[\t\r\n]/u.test(value) ? "'" + value : value;
  };
  return '\uFEFF' + Papa.unparse([keys, ...state[kind].map(item => keys.map(key => protect(item[key])))], { quotes: true, delimiter: ';', newline: '\r\n' });
}
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
