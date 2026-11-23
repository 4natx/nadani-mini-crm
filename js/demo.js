import { applyCommand } from './business.js';
import { activityTypes, initialState, localDay, origins, priorities } from './model.js';

const companies = ['Horizonte', 'Bruma', 'Claro', 'Pomar', 'Neblina', 'Rota', 'Farol', 'Maré', 'Nexo', 'Cedro', 'Órbita', 'Prisma', 'Linha', 'Vértice', 'Sabiá'];
const names = ['Marina', 'Caio', 'Helena', 'Luís', 'Iara', 'Rafael', 'Bia', 'Nina', 'João', 'Sofia', 'Miguel', 'Aline', 'Bruno', 'Eva', 'Paulo',
  'Luísa', 'Luca', 'Alice', 'Daniel', 'Iris'];
const projects = ['Portal comercial', 'Automação de leads', 'Consultoria estratégica', 'Dashboard de resultados', 'Website institucional',
  'Pesquisa de clientes', 'Integração de dados'];
export function makeDemo(today = new Date()) {
  let state = initialState(true);
  const ago = days => {
    const date = new Date(today);
    date.setDate(date.getDate() - days);
    return date;
  };
  const set = (operation, raw, days) => { state = applyCommand(state, operation, raw, { now: ago(days) }); };
  const save = (kind, data, days) => set('save', { ...data, kind }, days);
  companies.forEach((name, i) => save('companies', { name: name + ' Exemplo', segment: ['Tecnologia', 'Comércio', 'Marketing', 'Serviços', 'Educação'][i % 5],
    city: ['Salvador', 'Recife', 'Curitiba', 'São Paulo'][i % 4], size: ['small', 'medium', 'solo'][i % 3], tags: 'Demonstração' }, 91));
  for (let i = 0; i < 40; i++) save('contacts', { name: names[i % names.length], lastName: 'Exemplo ' + (i + 1), email: 'contato' + (i + 1) + '@example.invalid',
    companyId: state.companies[i % companies.length].id, status: ['lead', 'lead', 'prospect', 'customer'][i % 4], origin: origins[i % origins.length],
    role: ['Gestão', 'Comercial', 'Operações'][i % 3], tags: ['Demonstração', i % 2 ? 'Digital' : 'B2B'] }, 88 - Math.floor(i / 4));
  const schedule = [];
  for (let i = 0; i < 35; i++) {
    const contact = state.contacts[i];
    const stage = state.stages[i % state.stages.length].id;
    const days = 71 - i * 2;
    const closed = ['won', 'lost'].includes(stage);
    let dealId;
    schedule.push([days, () => {
      save('deals', { title: projects[i % projects.length] + ' · ' + companies[i % companies.length],
        contactId: contact.id, companyId: contact.companyId, stage: closed ? 'proposal' : stage,
        value: String(800 + ((i * 1739) % 16500)) + ',00', probability: !closed && i % 5 === 1 ? 33 + i : '',
        expected: localDay(ago(8 - i % 23)), origin: contact.origin,
        tags: i % 3 ? 'Demonstração, Serviços' : 'Demonstração, Prioritário' }, days);
      dealId = state.deals.at(-1).id;
    }]);
    if (closed) {
      const end = Math.max(0, days - (5 + i % 16));
      schedule.push([end, () => set('move', { id: dealId, stage, reason: stage === 'lost' ? 'Prioridades revistas pelo cliente fictício.' : '' }, end)]);
    }
  }
  schedule.sort(([a], [b]) => b - a).forEach(([, execute]) => execute());

  for (let i = 0; i < 80; i++) {
    const deal = state.deals[i * 7 % 34];
    const type = Object.keys(activityTypes)[i % Object.keys(activityTypes).length];
    save('activities', { title: activityTypes[type] + ' de acompanhamento', type, contactId: deal.contactId, companyId: deal.companyId,
      dealId: deal.id, day: localDay(ago(24 - Math.floor(i * 24 / 80))), description: 'Interação sintética para apresentação do CRM.',
      result: i % 2 ? 'Próxima conversa combinada.' : '' }, 3);
  }
  for (let i = 0; i < 25; i++) {
    const deal = state.deals[i];
    save('tasks', { title: ['Retornar ao cliente', 'Revisar proposta', 'Confirmar reunião', 'Alinhar escopo'][i % 4] + ' · ' + companies[i % companies.length],
      contactId: deal.contactId, companyId: deal.companyId, dealId: deal.id, status: ['pending', 'doing', 'done', 'pending'][i % 4],
      priority: Object.keys(priorities)[i % 4], due: localDay(ago(6 - i)), description: 'Tarefa demonstrativa.' }, 1);
  }
  return state;
}
