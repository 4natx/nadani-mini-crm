export const contactsStatus = { lead: 'Lead', prospect: 'Prospect', customer: 'Cliente', inactive: 'Inativo' };
export const activityTypes = { call: 'Ligação', meeting: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', note: 'Nota', proposal: 'Proposta', other: 'Outro' };
export const priorities = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' };
export const taskStatus = { pending: 'Pendente', doing: 'Em andamento', done: 'Concluída' };
export const sizes = { solo: 'Individual', small: 'Pequena', medium: 'Média', large: 'Grande' };
export const origins = ['Website', 'Indicação', 'WhatsApp', 'Instagram', 'LinkedIn', 'Campanha', 'Outro'];
export const terminal = ['won', 'lost'];
export const caps = { contacts: 1500, companies: 1000, deals: 1500, tasks: 2500, activities: 4000, events: 700, stages: 14, value: 10_000_000_000, backup: 24 * 1024 * 1024, csv: 2 * 1024 * 1024 };

export function initialState(started = false) {
  return { version: 1, revision: 0, started, contacts: [], companies: [], deals: [], activities: [], tasks: [], events: [],
    stages: [
      { id: 'new', name: 'Novo lead', color: '#4467bf', probability: 10 },
      { id: 'qualified', name: 'Qualificado', color: '#6947bd', probability: 25 },
      { id: 'proposal', name: 'Proposta', color: '#a35b23', probability: 50 },
      { id: 'negotiation', name: 'Negociação', color: '#9c447d', probability: 75 },
      { id: 'won', name: 'Ganho', color: '#137353', probability: 100 },
      { id: 'lost', name: 'Perdido', color: '#a73d51', probability: 0 },
    ], settings: { theme: 'system', followDays: 14, workspace: 'Nadani Mini CRM' } };
}

export const id = () => crypto.randomUUID();
export const safeId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
export const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR');
export const nameOf = contact => contact ? [contact.name, contact.lastName].filter(Boolean).join(' ') : '—';
export const find = (list, id) => list.find(item => item.id === id);
export const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
export const decimal = value => (value / 100).toFixed(2).replace('.', ',');
export const number = value => Number(value).toLocaleString('pt-BR');
export const stableInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function localDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function validDay(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value;
}
export function shiftDay(value, amount) {
  const d = new Date(value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export const dateLabel = day => day ? day.slice(0, 10).split('-').reverse().join('/') : '—';
export const validStamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

export function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new Error(label + ': informe ' + (required ? 'de 1 a ' : 'até ') + max + ' caracteres.');
  return value.trim().normalize('NFC');
}

export function integer(value, min, max, label) {
  const int = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!stableInt(int, min, max)) throw new Error(label + ': informe um inteiro entre ' + min + ' e ' + max + '.');
  return int;
}

export function cents(value, label = 'Valor') {
  if (typeof value !== 'string' || !/^\d{1,11}(?:[,.]\d{1,2})?$/.test(value.trim())) throw new Error(label + ': informe um valor positivo ou zero, sem separador de milhar.');
  const [units, part = ''] = value.trim().split(/[,.]/);
  return integer(Number(units) * 100 + Number(part.padEnd(2, '0')), 0, caps.value, label);
}
export function dateField(value, label, mandatory = false) {
  if (value === '' && !mandatory) return '';
  if (!validDay(value)) throw new Error(label + ': selecione uma data válida.');
  return value;
}
export function option(value, choices, label) {
  if (!Object.hasOwn(choices, value)) throw new Error(label + ' inválido.');
  return value;
}

export function website(value = '') {
  const raw = text(value, 'Website', 250);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Use um endereço completo com https:// ou http://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Website deve usar http(s), sem credenciais.');
  if (url.href.length > 250) throw new Error('Website: endereço muito longo.');
  return url.href;
}
function contacts(info) {
  const email = text(info.email ?? '', 'E-mail', 150);
  const phone = text(info.phone ?? '', 'Telefone', 32);
  if (email && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email)) throw new Error('Informe um e-mail em formato válido.');
  if (phone && (!/^\+?[\d(). -]+$/.test(phone) || digits(phone).length < 7 || digits(phone).length > 15)) throw new Error('Informe um telefone válido.');
  return { email, phone };
}
export const digits = value => String(value ?? '').replace(/\D/g, '');
export function tags(input = '') {
  const raw = Array.isArray(input) ? input : String(input).split(',');
  const values = [...new Set(raw.map(item => text(item, 'Etiqueta', 30)).filter(Boolean))];
  if (values.length > 12 || values.some(item => item.includes(','))) throw new Error('Use até 12 etiquetas, separadas por vírgula.');
  return values;
}
export const openDeal = deal => !terminal.includes(deal.stage);
export const probabilityOf = (deal, stages) => openDeal(deal) ? deal.probability ?? find(stages, deal.stage).probability : deal.stage === 'won' ? 100 : 0;
export const overdue = (task, today = localDay()) => task.status !== 'done' && task.due < today;

function reference(state, list, value, label, mandatory = false) {
  if ((value === null || value === undefined || value === '') && !mandatory) return null;
  if (!safeId(value) || !find(state[list], value)) throw new Error(label + ' indisponível.');
  return value;
}
export const refs = {
  contacts: [['companyId', 'companies']], companies: [],
  deals: [['contactId', 'contacts'], ['companyId', 'companies']],
  activities: [['contactId', 'contacts'], ['companyId', 'companies'], ['dealId', 'deals']],
  tasks: [['contactId', 'contacts'], ['companyId', 'companies'], ['dealId', 'deals']],
};

export function fields(state, kind, raw) {
  const linked = Object.fromEntries(refs[kind].map(([key, list]) => [key, reference(state, list, raw[key], { contactId: 'Contato', companyId: 'Empresa', dealId: 'Oportunidade' }[key],
    key === 'contactId' && ['deals', 'activities'].includes(kind))]));
  if (kind === 'contacts') return { ...linked, name: text(raw.name, 'Nome', 100, true), lastName: text(raw.lastName ?? '', 'Sobrenome', 90),
    ...contacts(raw), role: text(raw.role ?? '', 'Cargo', 80), origin: text(raw.origin ?? '', 'Origem', 75), status: option(raw.status, contactsStatus, 'Status'),
    tags: tags(raw.tags), notes: text(raw.notes ?? '', 'Observações', 900) };
  if (kind === 'companies') return { name: text(raw.name, 'Nome', 110, true), segment: text(raw.segment, 'Segmento', 75, true), ...contacts(raw),
    website: website(raw.website), city: text(raw.city ?? '', 'Cidade', 75), region: text(raw.region ?? '', 'Estado', 40),
    size: raw.size ? option(raw.size, sizes, 'Porte') : '', tags: tags(raw.tags), notes: text(raw.notes ?? '', 'Observações', 900) };
  const title = text(raw.title, 'Título', 125, true);
  const description = text(raw.description ?? '', 'Descrição', 1200);
  if (kind === 'deals') {
    if (!find(state.stages, raw.stage)) throw new Error('Etapa inválida.');
    return { ...linked, title, description, stage: raw.stage, value: cents(raw.value), currency: 'BRL',
      probability: raw.probability === '' || raw.probability === null || raw.probability === undefined ? null :
        integer(raw.probability, 0, 100, 'Probabilidade'), expected: dateField(raw.expected ?? '', 'Previsão de fechamento'),
      origin: text(raw.origin ?? '', 'Origem', 75), tags: tags(raw.tags) };
  }
  if (kind === 'activities') return { ...linked, title, description, type: option(raw.type, activityTypes, 'Tipo'),
    day: dateField(raw.day, 'Data da interação', true), result: text(raw.result ?? '', 'Resultado', 300) };
  return { ...linked, title, description, priority: option(raw.priority, priorities, 'Prioridade'), status: option(raw.status, taskStatus, 'Status'),
    due: dateField(raw.due, 'Vencimento', true) };
}

export function settingsFields(value) {
  if (!['system', 'light', 'dark'].includes(value.theme)) throw new Error('Tema inválido.');
  return { theme: value.theme, followDays: integer(value.followDays, 1, 365, 'Intervalo de acompanhamento'),
    workspace: text(value.workspace, 'Nome do espaço', 64, true) };
}
