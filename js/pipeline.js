import { contextFor } from './analytics.js';
import { ordered } from './business.js';
import { setupDrag } from './drag.js';
import { details, entityForm, moveDealUI } from './forms.js';
import { dateLabel, find, fold, localDay, money, nameOf, openDeal, overdue, probabilityOf } from './model.js';
import { actions, button, el, field, heading, label, note, searchControl, select } from './ui.js';

export function pipelineView(ctx) {
  const { state } = ctx;
  const filters = ctx.filters.pipeline;
  const { contacts, companies, next } = contextFor(state);
  const board = el('section', { class: 'board-scroll', id: 'pipeline-board', 'aria-label': 'Quadro de oportunidades', tabindex: '0' });
  const summary = el('p', { class: 'fine', id: 'board-summary', 'aria-live': 'polite' });
  const picker = select('stage', [['', 'Saltar para etapa'], ...state.stages.map(stage => [stage.id, stage.name])], '', { id: 'jump-stage' });
  picker.addEventListener('change', () => {
    const destination = document.getElementById('column-' + picker.value);
    if (!destination) return;
    board.scrollLeft += destination.getBoundingClientRect().left - board.getBoundingClientRect().left - 3;
    destination.querySelector('h2').focus({ preventScroll: true });
  });
  function draw() {
    if (!board.isConnected && board.childElementCount) return;
    const query = fold(filters.query).trim();
    const columns = state.stages.map(stage => {
      const list = ordered(state, stage.id).filter(deal => !deal.archived &&
        (!query || fold([deal.title, nameOf(contacts.get(deal.contactId)), companies.get(deal.companyId)?.name, ...deal.tags].join(' ')).includes(query)));
      const top = el('div', { class: 'column-head' }, el('div', {}, el('h2', { tabindex: '-1' }, stage.name),
        note(list.length + ' negócio(s) · ' + money(list.reduce((total, item) => total + item.value, 0)))),
      button('', { class: 'icon-button', symbol: 'plus', 'aria-label': 'Adicionar oportunidade em ' + stage.name,
        action: () => entityForm(ctx, 'deals', null, { stage: stage.id }) }));
      top.style.setProperty('--stage-color', stage.color);
      return el('section', { class: 'pipeline-column', id: 'column-' + stage.id, 'data-column': stage.id },
        top, el('div', { class: 'column-items' }, list.length ? list.map(deal => {
          const contact = contacts.get(deal.contactId);
          const company = companies.get(deal.companyId);
          const task = next.get(deal.id);
          const open = () => details(ctx, 'deals', deal);
          const late = (task && overdue(task)) || (openDeal(deal) && deal.expected && deal.expected < localDay());
          return el('article', { class: 'deal-card', 'data-card': deal.id },
            el('div', { class: 'deal-head' }, el('h3', {}, button(deal.title, { class: 'deal-title', id: 'record-' + deal.id, action: open })),
              button('', { class: 'icon-button drag-handle', symbol: 'grip', 'data-id': deal.id, 'aria-label': 'Mover ou reordenar ' + deal.title, action: open })),
            note(company?.name || nameOf(contact)),
            el('div', { class: 'deal-value' }, el('strong', {}, money(deal.value)), label(probabilityOf(deal, state.stages) + '%', 'info')),
            note('Previsão: ' + dateLabel(deal.expected)),
            task ? note('Próxima: ' + task.title + ' · ' + dateLabel(task.due)) : null,
            el('div', { class: 'card-tags' }, ...deal.tags.slice(0, 3).map(tag => label(tag)), late ? label('Atraso', 'warn') : null));
        }) : el('p', { class: 'column-empty' }, 'Nenhuma oportunidade nesta etapa.')));
    });
    board.replaceChildren(...columns);
    summary.textContent = board.querySelectorAll('[data-card]').length + ' cartão(ões) visíveis.';
  }
  const cancel = setupDrag(board, (id, stage, before) => {
    const deal = find(ctx.state.deals, id);
    if (deal) moveDealUI(ctx, deal, stage, before);
  }, ctx.toast);
  ctx.disposeView(cancel);
  draw();
  return [heading('Funil comercial', 'Arraste pela alça ou use os controles de etapa nos detalhes.',
    actions(button('Configurar etapas', { action: () => ctx.editStages() }),
      button('Nova oportunidade', { id: 'new-pipeline-deal', kind: 'primary', symbol: 'plus', action: () => entityForm(ctx, 'deals') }))),
    el('div', { class: 'period panel' }, searchControl(filters, draw, 'Nome ou etiqueta'), field('Navegar pelo quadro', picker), summary), board];
}
