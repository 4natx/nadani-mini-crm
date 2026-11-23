import assert from 'node:assert/strict';
import { test } from 'node:test';
import { growth, lookup, periodFor, previousRange, summarize, timeline, validRange, weighted } from '../js/analytics.js';
import { parseBackup, validateState } from '../js/backup.js';
import { applyCommand, duplicates, ordered } from '../js/business.js';
import { makeDemo } from '../js/demo.js';
import { cents, initialState, localDay, overdue, probabilityOf, validDay, website } from '../js/model.js';
import { entityCSV, parseCSV, previewImport } from '../js/transfer.js';

function fixture() {
  let state = initialState();
  let sequence = 0;
  const now = new Date(2026, 10, 20, 12, 0, 0);
  const doIt = (type, data) => {
    const next = applyCommand(state, type, data, { now, makeId: () => 'item-' + ++sequence });
    state = validateState(next);
    return state;
  };
  const save = (kind, data) => doIt('save', { kind, ...data })[kind].at(-1);
  const company = save('companies', { name: 'Sabiá Exemplo', segment: 'Tecnologia' });
  const contact = save('contacts', { name: 'João', lastName: 'Exemplo', companyId: company.id, email: 'joao@example.invalid', status: 'lead' });
  const deal = (title, fields) => save('deals', { title, contactId: contact.id, value: '70,50', stage: 'new', ...fields });
  return { get state() { return state; }, company, contact, doIt, save, deal, today: localDay(now) };
}

test('criação, edição, validação e arquivamento preservam relações da empresa', () => {
  const f = fixture();
  assert.throws(() => f.doIt('save', { kind: 'contacts', ...f.contact, companyId: 'ausente' }), /Empresa indisponível/);
  assert.throws(() => f.doIt('entity', { action: 'delete', kind: 'companies', id: f.company.id }), /vínculos/);
  f.doIt('entity', { action: 'archive', kind: 'companies', id: f.company.id });
  f.doIt('save', { kind: 'contacts', ...f.contact, name: 'João Pedro', stamp: f.contact.updatedAt });
  assert.equal(f.state.contacts[0].name, 'João Pedro');
  assert.equal(f.state.contacts[0].companyId, f.company.id);
  assert.equal(f.state.companies[0].archived, true);
  assert.throws(() => f.doIt('save', { kind: 'contacts', ...f.contact, stamp: f.contact.updatedAt }), /mudou/);
});

test('duplicatas por e-mail, telefone e nome/empresa podem ser mescladas com vínculos', () => {
  const f = fixture();
  assert.equal(duplicates(f.state, { ...f.contact, email: 'JOAO@EXAMPLE.INVALID' }).length, 1);
  assert.equal(duplicates(f.state, { name: 'Joao', lastName: 'Exemplo', companyId: f.company.id }).length, 1);
  assert.throws(() => f.save('contacts', { ...f.contact, id: undefined }), /duplicat/i);
  const other = f.save('contacts', { ...f.contact, id: undefined, phone: '+55 00 00000-0000', allowDuplicate: true });
  assert.equal(duplicates(f.state, { phone: '5500000000000' })[0].item.id, other.id);
  const deal = f.deal('Renovação', { contactId: other.id });
  const task = f.save('tasks', { title: 'Retornar', priority: 'high', status: 'pending', due: f.today, contactId: other.id, dealId: deal.id });
  const activity = f.save('activities', { title: 'Reunião', type: 'meeting', day: f.today, contactId: other.id, dealId: deal.id });
  f.doIt('merge', { keep: f.contact.id, remove: other.id });
  assert.equal(f.state.contacts.length, 1);
  assert.equal(f.state.contacts[0].phone, other.phone);
  for (const [kind, item] of [['deals', deal], ['tasks', task], ['activities', activity]]) {
    assert.equal(f.state[kind].find(row => row.id === item.id).contactId, f.contact.id);
  }
  assert.ok(timeline(f.state, 'contacts', f.contact.id).some(entry => entry.type === 'merged'));
});

test('Kanban mantém a ordem e fechamento idempotente após reabertura', () => {
  const f = fixture();
  const first = f.deal('Implantação');
  const second = f.deal('Renovação');
  f.doIt('move', { id: second.id, stage: 'new', before: first.id });
  assert.deepEqual(ordered(f.state, 'new').map(deal => deal.id), [second.id, first.id]);
  f.doIt('move', { id: first.id, stage: 'won' });
  f.doIt('move', { id: first.id, stage: 'won' });
  assert.equal(f.state.events.filter(entry => entry.type === 'won').length, 1);
  assert.equal(f.state.deals[0].closedOn, f.today);
  f.doIt('move', { id: first.id, stage: 'qualified' });
  assert.equal(f.state.deals[0].closedOn, null);
  f.doIt('move', { id: first.id, stage: 'lost', reason: 'Prazo' });
  assert.equal(f.state.deals[0].lostReason, 'Prazo');
  assert.ok(f.state.events.some(entry => entry.type === 'reopened'));
  f.doIt('duplicate', { id: first.id });
  assert.equal(f.state.deals.at(-1).stage, 'new');
  assert.equal(f.state.deals.at(-1).closedOn, null);
});

test('etapa personalizada preserva oportunidades ao exigir destino válido', () => {
  const f = fixture();
  f.doIt('stage', { name: 'Validação', color: '#234560', probability: 35 });
  const stage = f.state.stages.at(-3);
  const deal = f.deal('Novo contrato', { stage: stage.id });
  assert.throws(() => f.doIt('stage', { id: stage.id, action: 'delete' }));
  assert.throws(() => f.doIt('stage', { id: stage.id, action: 'delete', destination: 'won' }), /aberta/);
  assert.throws(() => f.doIt('stage', { id: 'won', action: 'delete' }), /fixas/);
  f.doIt('stage', { id: stage.id, action: 'move', direction: -1 });
  assert.equal(f.state.stages.at(-4).id, stage.id);
  f.doIt('stage', { id: stage.id, action: 'delete', destination: 'qualified' });
  assert.equal(f.state.deals.find(item => item.id === deal.id).stage, 'qualified');
});

test('moeda, data e probabilidade têm validação e arredondamento previsíveis', () => {
  assert.equal(cents('2100,15'), 210015);
  assert.throws(() => cents('-1'));
  assert.throws(() => cents('1,555'));
  assert.equal(validDay('2025-02-29'), false);
  assert.equal(validDay('2024-02-29'), true);
  assert.equal(weighted(101, 50), 51);
  const f = fixture();
  const standard = f.deal('Probabilidade da etapa');
  const zero = f.deal('Probabilidade informada', { probability: '0' });
  assert.equal(probabilityOf(standard, f.state.stages), 10);
  assert.equal(probabilityOf(zero, f.state.stages), 0);
  assert.throws(() => f.deal('Taxa inválida', { probability: 101 }));
});

test('resultados e previsão usam os registros atuais e o intervalo correto', () => {
  const f = fixture();
  f.deal('Aberta', { value: '50' });
  const winner = f.deal('Ganha', { value: '35,99' });
  const loser = f.deal('Perdida');
  f.doIt('move', { id: winner.id, stage: 'won' });
  f.doIt('move', { id: loser.id, stage: 'lost' });
  const range = periodFor(7, f.today);
  const report = summarize(f.state, range, f.today);
  assert.deepEqual([report.won, report.lost, report.winRate, report.wonValue, report.openValue, report.forecast], [1, 1, 50, 3599, 5000, 500]);
  assert.equal(summarize(f.state, previousRange(range), f.today).winRate, null);
  assert.equal(growth(report.won, 0), null);
  assert.throws(() => validRange({ start: range.end, end: range.start }), /intervalo/);
});

test('tarefas vencidas mudam indicadores ao concluir e reabrir', () => {
  const f = fixture();
  const task = f.save('tasks', { title: 'Retornar', due: '2026-11-19', priority: 'medium', status: 'pending' });
  const report = () => summarize(f.state, periodFor(7, f.today), f.today);
  assert.equal(overdue(task, f.today), true);
  assert.equal(report().late, 1);
  f.doIt('taskStatus', { id: task.id, status: 'done' });
  assert.equal(report().late, 0);
  assert.equal(report().done, 1);
  f.doIt('taskStatus', { id: task.id, status: 'pending' });
  assert.equal(report().done, 0);
  assert.equal(report().late, 1);
});

test('pesquisa é tolerante a acentos, com resultado agrupado por entidade', () => {
  const f = fixture();
  f.deal('Renovação');
  assert.equal(lookup(f.state, '  joao ')[0][1][0].id, f.contact.id);
  assert.equal(lookup(f.state, 'renovacao')[0][0], 'deals');
  assert.deepEqual(lookup(f.state, 'sem correspondência'), []);
});

test('CSV com mapeamento interpreta aspas e pula linhas duplicadas e inválidas', () => {
  const f = fixture();
  const csv = parseCSV(['Nome;E-mail;Notas', 'Lívia;livia@example.invalid;"Linha 1', 'Linha 2"', 'João;joao@example.invalid;igual', 'Vazio;inválido;erro'].join('\n'));
  const result = previewImport(f.state, csv.rows, { name: 0, email: 1, notes: 2 });
  assert.deepEqual(result.review.map(row => row.status), ['Novo', 'Duplicado', 'Inválido']);
  assert.match(result.accepted[0].notes, /Linha 1\nLinha 2/);
  f.doIt('importContacts', { contacts: result.accepted });
  assert.equal(f.state.contacts.length, 2);
  assert.throws(() => f.doIt('importContacts', { contacts: result.accepted }), /Nenhum contato/);
  assert.throws(() => parseCSV('nome,email\n"aspas inválidas'), /malformado/);
});

test('exportação CSV desarma fórmulas e website bloqueia esquemas perigosos', () => {
  const f = fixture();
  f.save('contacts', { name: '＝SOMA(A1:A2)', status: 'lead', notes: '  @SUM(1,2)' });
  const csv = entityCSV(f.state, 'contacts');
  assert.ok(csv.includes("'＝SOMA(A1:A2)"));
  assert.ok(csv.includes("'@SUM(1,2)"));
  assert.throws(() => website('javascript:console.log(1)'));
  assert.equal(website('https://exemplo.example.invalid'), 'https://exemplo.example.invalid/');
});

test('backup validado preserva a versão e rejeita JSON, vínculos e IDs inconsistentes', () => {
  const f = fixture();
  const deal = f.deal('Contrato');
  assert.deepEqual(parseBackup(JSON.stringify(f.state)), f.state);
  assert.throws(() => parseBackup('{'), /JSON malformado/);
  assert.throws(() => validateState({ ...f.state, version: 932 }), /versão/);
  assert.throws(() => validateState({ ...f.state, deals: [{ ...deal, contactId: 'ausente' }] }), /Contato/);
  assert.throws(() => validateState({ ...f.state, deals: [deal, deal] }), /IDs repetidos/);
});

test('demonstração tem volumes, vínculos e domínios sintéticos verificáveis', () => {
  const demo = validateState(makeDemo(new Date(2026, 10, 20, 12)));
  assert.deepEqual([demo.companies.length, demo.contacts.length, demo.deals.length, demo.activities.length, demo.tasks.length], [15, 40, 35, 80, 25]);
  assert.ok(demo.contacts.every(contact => contact.email.endsWith('@example.invalid')));
  assert.ok(demo.stages.every(stage => demo.deals.some(deal => deal.stage === stage.id)));
  assert.ok(demo.deals.filter(deal => deal.closedOn).every(deal => deal.closedOn > localDay(deal.createdAt)));
  assert.ok(demo.deals.some(deal => deal.probability !== null));
});
