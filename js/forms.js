import { contextFor, stageName, timeline } from './analytics.js';
import { duplicates, isLinked, ordered } from './business.js';
import { activityTypes, contactsStatus, dateLabel, decimal, digits, find, localDay, money, nameOf, openDeal, origins, overdue, priorities,
  probabilityOf, sizes, taskStatus, terminal } from './model.js';
import { actions, button, el, facts, field, input, label, note, select, textField, titles } from './ui.js';

export const singular = { contacts: 'contato', companies: 'empresa', deals: 'oportunidade', tasks: 'tarefa', activities: 'interação' };
export const titleOf = (kind, item) => kind === 'contacts' ? nameOf(item) : item.title ?? item.name;
export const options = object => Object.entries(object);
const txt = (key, name, value, max, required = false) => textField(key, name, value ?? '', { maxlength: max, required });
const area = (key, name, value, max = 1200) => field(name, el('textarea', { name: key, maxlength: max, rows: 3 }, value ?? ''), true);
const day = (key, name, value, required = false) => textField(key, name, value ?? '', { type: 'date', min: '2000-01-01', max: '2099-12-31', required });
const tagsField = item => txt('tags', 'Etiquetas separadas por vírgula', item.tags?.join(', '), 395);
export const rowsOptions = (state, kind, current, activeOnly = false) => state[kind].filter(item => !activeOnly || !item.archived || current === item.id).map(item =>
  [item.id, titleOf(kind, item) + (item.archived ? ' · arquivado' : '')]);
const stageOptions = state => state.stages.map(stage => [stage.id, stage.name]);

function formFields(state, kind, item, editing) {
  const company = field('Empresa', select('companyId', [['', 'Sem empresa'], ...rowsOptions(state, 'companies', item.companyId, true)], item.companyId));
  const contactChoices = rowsOptions(state, 'contacts', item.contactId, true);
  const contact = required => field('Contato', select('contactId', [['', required ? 'Selecione' : 'Sem contato'], ...contactChoices], item.contactId, { required }));
  const deal = field('Oportunidade', select('dealId', [['', 'Sem oportunidade'], ...rowsOptions(state, 'deals', item.dealId, true)], item.dealId));
  const communication = [
    textField('email', 'E-mail', item.email ?? '', { type: 'email', maxlength: 150 }),
    textField('phone', 'Telefone', item.phone ?? '', { type: 'tel', maxlength: 32 }),
  ];
  const formOrigin = () => {
    const origin = input('origin', { list: 'origin-options', value: item.origin ?? '', maxlength: 75 });
    return field('Origem', el('span', {}, origin, el('datalist', { id: 'origin-options' }, origins.map(value => el('option', { value })))));
  };
  if (kind === 'contacts') return [txt('name', 'Nome', item.name, 100, true), txt('lastName', 'Sobrenome', item.lastName, 90), ...communication,
    company, txt('role', 'Cargo', item.role, 80), formOrigin(), field('Status comercial', select('status', options(contactsStatus), item.status ?? 'lead')),
    tagsField(item), area('notes', 'Observações', item.notes, 900)];
  if (kind === 'companies') return [txt('name', 'Nome da empresa', item.name, 110, true), txt('segment', 'Segmento', item.segment, 75, true),
    textField('website', 'Website (https://)', item.website ?? '', { type: 'url', maxlength: 250 }), ...communication,
    txt('city', 'Cidade', item.city, 75), txt('region', 'Estado', item.region, 40),
    field('Porte', select('size', [['', 'Não informado'], ...options(sizes)], item.size)), tagsField(item), area('notes', 'Observações', item.notes, 900)];
  const description = area('description', 'Descrição', item.description);
  const title = txt('title', 'Título', item.title, 125, true);
  if (kind === 'deals') return [title, contact(true), company,
    textField('value', 'Valor estimado (BRL)', editing ? decimal(item.value) : '0,00', { inputmode: 'decimal', maxlength: 15, required: true }),
    field('Etapa', select('stage', stageOptions(state), item.stage)), textField('probability', 'Probabilidade (%) · vazio usa a etapa', item.probability ?? '',
      { type: 'number', min: 0, max: 100, step: 1 }), day('expected', 'Fechamento previsto', item.expected), formOrigin(),
    txt('lostReason', 'Motivo (se perdido)', item.lostReason, 300), tagsField(item), description];
  if (kind === 'activities') return [title, field('Tipo de interação', select('type', options(activityTypes), item.type ?? 'note')),
    contact(true), company, deal, day('day', 'Data da interação', item.day ?? localDay(), true),
    txt('result', 'Resultado', item.result, 300), description];
  return [title, field('Prioridade', select('priority', options(priorities), item.priority ?? 'medium')),
    day('due', 'Vencimento', item.due ?? localDay(), true), field('Status', select('status', options(taskStatus), item.status ?? 'pending')),
    contact(false), company, deal, description];
}

export function entityForm(ctx, kind, item, preset = {}) {
  const data = item ?? preset;
  let approval = '';
  ctx.form((item ? 'Editar ' : 'Cadastrar ') + singular[kind], formFields(ctx.state, kind, data, Boolean(item)),
    'Salvar ' + singular[kind], async raw => {
      const payload = { ...raw, kind, id: item?.id, stamp: item?.updatedAt };
      if (kind === 'contacts') {
        const matches = duplicates(ctx.state, raw, item?.id);
        const signature = JSON.stringify([raw.name, raw.lastName, raw.email, raw.phone, raw.companyId, matches.map(({ item }) => item.id)]);
        const duplicateApproved = matches.length > 0 && approval === signature;
        if (matches.length && !duplicateApproved) {
          approval = signature;
          throw new Error('Possível duplicata: ' + matches.slice(0, 3).map(({ item, reasons }) => nameOf(item) + ' (' + reasons.join(', ') + ')').join(' · ') +
            '. Clique em Salvar novamente para manter separado, ou cancele para revisar os cadastros.');
        }
        payload.allowDuplicate = duplicateApproved;
      }
      await ctx.run('save', payload, 'Cadastro salvo.');
    }, 'save-' + kind, kind === 'activities' ? 'Registro manual. Nenhuma comunicação é executada pelo CRM.' : undefined);
}

function linkRow(name, href) { return href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, name) : null; }
function integrations(item) {
  const normalized = digits(item.phone);
  const international = item.phone.startsWith('+');
  return actions(
    item.email ? linkRow('Abrir e-mail', 'mailto:' + encodeURIComponent(item.email).replace(/%40/g, '@')) : null,
    normalized ? linkRow('Ligar', 'tel:' + (international ? '+' : '') + normalized) : null,
    international && /^[1-9]\d{7,14}$/.test(normalized) ? linkRow('Abrir WhatsApp', 'https://wa.me/' + normalized +
      '?text=' + encodeURIComponent('Olá! Gostaria de retomar nossa conversa.')) : null,
    item.website ? linkRow('Abrir website', item.website) : null);
}

export function timelinePanel(entries, title = 'Timeline') {
  const rows = entries.slice(0, 14);
  return el('section', { class: 'timeline' }, el('h3', {}, title), rows.length ?
    el('ul', {}, rows.map(event => el('li', {}, el('div', { class: 'event-text' }, el('span', {}, event.label), event.detail ? note(event.detail) : null), el('time', { datetime: event.at, class: 'fine' }, dateLabel(localDay(event.at)))))) : note('Nenhum evento registrado.'));
}

export function moveDealUI(ctx, deal, stage, before, close = false) {
  const apply = async reason => {
    await ctx.run('move', { id: deal.id, stamp: deal.updatedAt, stage, before, reason }, stage === 'lost' && deal.stage !== stage ? 'Negócio marcado como perdido.' :
      stage === 'won' && deal.stage !== stage ? 'Negócio marcado como ganho.' : deal.stage === stage ? 'Ordem atualizada.' : 'Etapa atualizada.');
    if (close) ctx.close();
  };
  if (stage === 'lost' && deal.stage !== 'lost') {
    ctx.form('Registrar perda', [area('reason', 'Motivo da perda (opcional)', '', 300)], 'Confirmar perda', data => apply(data.reason), 'confirm-lost');
    return;
  }
  apply().catch(error => ctx.toast(error.message));
}

function dealMoveControls(ctx, item, state) {
  const destination = select('stage', stageOptions(state), item.stage, { id: 'deal-destination' });
  const move = button('Mover para etapa', { id: 'move-stage', action: () => moveDealUI(ctx, item, destination.value, null, true) });
  const list = ordered(state, item.stage).filter(deal => !deal.archived);
  const index = list.findIndex(deal => deal.id === item.id);
  return [el('div', { class: 'actions move-controls' }, field('Etapa de destino', destination), move,
    button('Subir', { id: 'order-up', disabled: index <= 0, action: () => moveDealUI(ctx, item, item.stage, list[index - 1].id, true) }),
    button('Descer', { id: 'order-down', disabled: index < 0 || index >= list.length - 1, action: () => moveDealUI(ctx, item, item.stage, list[index + 2]?.id, true) })),
    actions(...(!openDeal(item) ? [button('Reabrir', { action: () => moveDealUI(ctx, item, state.stages[0].id, null, true) })] :
      [button('Marcar como ganho', { action: () => moveDealUI(ctx, item, 'won', null, true) }),
        button('Marcar como perdido', { action: () => moveDealUI(ctx, item, 'lost', null, true) })]))];
}

function relatedButtons(ctx, kind, list) {
  if (!list.length) return note('Sem registros vinculados.');
  return el('ul', { class: 'linked-list' }, list.slice(0, 10).map(item => el('li', {},
    button(titleOf(kind, item), { kind: 'secondary small', action: () => details(ctx, kind, item) }))));
}

function mergeDialog(ctx, keep, duplicate) {
  const conflicts = ['lastName', 'email', 'phone', 'companyId', 'role', 'origin'].filter(key => keep[key] && duplicate[key] && keep[key] !== duplicate[key]);
  const refs = ['deals', 'tasks', 'activities'].reduce((sum, kind) => sum + ctx.state[kind].filter(item => item.contactId === duplicate.id).length, 0);
  const choose = () => ctx.confirm('Mesclar estes contatos?', 'O cadastro duplicado será removido e seus vínculos passarão ao principal.',
    'Confirmar mesclagem', () => ctx.run('merge', { keep: keep.id, remove: duplicate.id, keepStamp: keep.updatedAt, removeStamp: duplicate.updatedAt }, 'Contatos mesclados.'));
  ctx.open('Prévia da mesclagem', [facts([['Manter', nameOf(keep)], ['Incorporar', nameOf(duplicate)], ['Vínculos a transferir', refs]]),
    note('Campos preenchidos do principal prevalecem. Campos vazios são completados, notas distintas são unidas e etiquetas são combinadas.'),
    conflicts.length ? note('Campos diferentes: ' + conflicts.map(key => ({ lastName: 'sobrenome', companyId: 'empresa', role: 'cargo', origin: 'origem', email: 'e-mail', phone: 'telefone' }[key])).join(', ') + '.') : null,
    actions(button('Continuar', { id: 'preview-merge', kind: 'primary', action: choose }))]);
}

export function details(ctx, kind, item) {
  const state = ctx.state;
  const { contacts, companies, deals, next, last } = contextFor(state);
  const company = companies.get(item.companyId);
  const contact = contacts.get(item.contactId);
  const deal = deals.get(item.dealId);
  const linked = (list, key) => list.filter(row => row[key] === item.id);
  const nextTask = next.get(item.id);
  const related = [];
  const controls = [];
  let info = [];
  if (kind === 'contacts' || kind === 'companies') {
    info = [['E-mail', item.email || '—'], ['Telefone', item.phone || '—'], ['Etiquetas', item.tags.join(', ') || '—']];
    if (kind === 'contacts') {
      info.push(['Empresa', company?.name ?? '—'], ['Cargo', item.role || '—'], ['Origem', item.origin || '—'], ['Status', contactsStatus[item.status]]);
      const candidates = duplicates(state, item, item.id).filter(entry => !entry.item.archived);
      if (candidates.length) related.push(el('h3', {}, 'Possíveis duplicatas'), actions(...candidates.slice(0, 6).map(entry =>
        button(nameOf(entry.item) + ' · ' + entry.reasons.join(', '), { action: () => mergeDialog(ctx, item, entry.item) }))));
    } else {
      info.push(['Segmento', item.segment], ['Cidade / Estado', [item.city, item.region].filter(Boolean).join(' / ') || '—'], ['Porte', sizes[item.size] || '—'],
        ['Website', item.website || '—']);
      const records = linked(state.deals, 'companyId');
      const opened = records.filter(row => !row.archived && openDeal(row));
      info.push(['Negócios abertos', opened.length], ['Ganhos', records.filter(row => row.stage === 'won').length],
        ['Perdidos', records.filter(row => row.stage === 'lost').length], ['Valor aberto', money(opened.reduce((sum, row) => sum + row.value, 0))]);
      related.push(el('h3', {}, 'Contatos associados'), relatedButtons(ctx, 'contacts', linked(state.contacts, 'companyId')));
    }
    related.push(integrations(item), el('h3', {}, 'Oportunidades'), relatedButtons(ctx, 'deals', linked(state.deals, kind === 'contacts' ? 'contactId' : 'companyId')));
    const relation = kind === 'contacts' ? 'contactId' : 'companyId';
    related.push(el('h3', {}, 'Interações recentes'), relatedButtons(ctx, 'activities', linked(state.activities, relation).sort((a, b) => b.day.localeCompare(a.day))),
      el('h3', {}, 'Próximas tarefas'), relatedButtons(ctx, 'tasks', linked(state.tasks, relation).filter(task => task.status !== 'done').sort((a, b) => a.due.localeCompare(b.due))));
    if (kind === 'contacts') controls.push(button('Registrar interação', { id: 'linked-activity', action: () => entityForm(ctx, 'activities', null, { contactId: item.id, companyId: item.companyId }) }));
  }
  if (kind === 'deals') {
    info = [['Contato', nameOf(contact)], ['Empresa', company?.name ?? '—'], ['Valor estimado', money(item.value)], ['Etapa', stageName(state, item.stage)],
      ['Probabilidade', probabilityOf(item, state.stages) + '%'], ['Fechamento previsto', dateLabel(item.expected)], ['Fechamento registrado', dateLabel(item.closedOn)],
      ['Origem', item.origin || '—'], ['Etiquetas', item.tags.join(', ') || '—'], ['Motivo da perda', item.lostReason || '—']];
    related.push(el('h3', {}, 'Tarefas vinculadas'), relatedButtons(ctx, 'tasks', linked(state.tasks, 'dealId')),
      el('h3', {}, 'Interações vinculadas'), relatedButtons(ctx, 'activities', linked(state.activities, 'dealId')));
    const preset = { contactId: item.contactId, companyId: item.companyId, dealId: item.id };
    controls.push(button('Registrar interação', { id: 'linked-activity', action: () => entityForm(ctx, 'activities', null, preset) }),
      button('Criar tarefa', { id: 'linked-task', action: () => entityForm(ctx, 'tasks', null, preset) }),
      button('Duplicar', { id: 'duplicate-deal', action: async () => {
        try { await ctx.run('duplicate', { id: item.id }, 'Cópia criada em etapa aberta.'); ctx.close(); }
        catch (error) { ctx.toast(error.message); }
      } }));
    if (!item.archived) related.push(...dealMoveControls(ctx, item, state));
  }
  if (kind === 'activities' || kind === 'tasks') {
    info = [['Contato', nameOf(contact)], ['Empresa', company?.name ?? '—'], ['Oportunidade', deal?.title ?? '—']];
    if (kind === 'activities') info.push(['Tipo', activityTypes[item.type]], ['Data', dateLabel(item.day)], ['Resultado', item.result || '—']);
    else {
      info.push(['Status', taskStatus[item.status]], ['Prioridade', priorities[item.priority]], ['Vencimento', dateLabel(item.due)],
        ['Conclusão', dateLabel(item.completedOn)]);
      controls.push(button(item.status === 'done' ? 'Reabrir' : 'Concluir tarefa', { id: 'complete-task', kind: 'primary', action: async () => {
        try { await ctx.run('taskStatus', { id: item.id, stamp: item.updatedAt, status: item.status === 'done' ? 'pending' : 'done' },
          item.status === 'done' ? 'Tarefa reaberta.' : 'Tarefa concluída.'); ctx.close(); }
        catch (error) { ctx.toast(error.message); }
      } }));
    }
  }
  if (['contacts', 'companies', 'deals'].includes(kind)) {
    info.push(['Última interação', dateLabel(last.get(item.id))], ['Próxima tarefa', nextTask ? nextTask.title + ' · ' + dateLabel(nextTask.due) : '—']);
    if (nextTask && overdue(nextTask)) related.push(label('Acompanhamento atrasado', 'warn'));
    related.push(timelinePanel(timeline(state, kind, item.id)));
  }
  const change = (action, labelText) => ctx.confirm(labelText + ' registro?', titleOf(kind, item), labelText,
    () => ctx.run('entity', { kind, id: item.id, stamp: item.updatedAt, action }, 'Registro alterado.'));
  const archive = ['contacts', 'companies', 'deals'].includes(kind) ? button(item.archived ? 'Reativar' : 'Arquivar', { id: 'archive-record',
    action: () => change(item.archived ? 'restore' : 'archive', item.archived ? 'Reativar' : 'Arquivar') }) : null;
  const remove = isLinked(state, kind, item.id) ? null : button('Excluir', { id: 'delete-record', action: () => change('delete', 'Excluir') });
  ctx.open(titleOf(kind, item), [facts(info), note(item.description || item.notes || ''), ...related,
    el('div', { class: 'modal-actions' }, remove, archive, button('Editar', { id: 'edit-record', action: () => entityForm(ctx, kind, item) }), ...controls)].filter(Boolean));
}
