import { followups, growth, previousRange, summarize } from './analytics.js';
import { activityTypes, dateLabel, money, number, validDay } from './model.js';
import { details, timelinePanel } from './forms.js';
import { actions, button, el, heading, icon, metric, note, panel, periodControl, svg } from './ui.js';

const colors = ['#536ac8', '#6c4ca9', '#32827b', '#a26630', '#9e5072'];
const month = value => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(value + '-01T00:00:00Z'));
const trendNote = value => value === null ? 'Sem base no período anterior' : (value > 0 ? '+' : '') + number(value) + '% vs. período anterior';
function chart(title, detail, groups, format = number) {
  const max = Math.max(1, ...groups.map(([, value]) => value));
  return el('section', { class: 'panel padded' }, el('div', { class: 'chart-head' }, el('div', {}, el('h2', {}, title), note(detail)), icon('analytics')),
    groups.length ? el('div', { class: 'bar-list' }, groups.slice(0, 14).map(([name, value, color], i) => {
      const track = svg('svg', { viewBox: '0 0 100 7', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      track.append(svg('rect', { width: 100, height: 7, fill: 'var(--line)' }), svg('rect', { width: 100 * value / max, height: 7, fill: color ?? colors[i % colors.length] }));
      return el('div', { class: 'bar-row' }, el('span', {}, name), track, el('strong', {}, format(value)));
    })) : el('p', { class: 'empty' }, 'Sem registros no recorte.'));
}

function welcome(ctx) {
  const graphic = svg('svg', { class: 'welcome-art', viewBox: '0 0 280 150', 'aria-hidden': 'true' });
  graphic.append(svg('rect', { x: 12, y: 12, width: 256, height: 126, rx: 16, fill: '#304578', stroke: '#788fcb', transform: 'rotate(-3 120 66)' }),
    svg('path', { d: 'M38 105h205m-205-23h205m-205-23h205m-205-23h205', stroke: '#6077b0', 'stroke-width': 1 }),
    svg('path', { d: 'M47 101 88 88 121 92 150 51 186 62 222 32', fill: 'none', stroke: '#cbd8ff', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    svg('circle', { cx: 222, cy: 32, r: 6, fill: '#d1deff' }));
  return el('section', { class: 'welcome' }, el('div', {}, el('h2', {}, 'Organize o próximo passo'),
    el('p', {}, 'Explore contatos, oportunidades e tarefas de uma operação fictícia ou comece com um CRM vazio.'),
    actions(button('Carregar demonstração', { id: 'load-demo', kind: 'primary', action: () => ctx.seed() }),
      button('Começar vazio', { id: 'start-empty', action: () => ctx.start() }))), graphic);
}

export function dashboard(ctx, route) {
  const config = ctx.filters[route];
  const detail = route === 'analytics';
  const data = summarize(ctx.state, config.range);
  const past = previousRange(config.range);
  const previous = validDay(past.start) ? summarize(ctx.state, past) : null;
  const next = followups(ctx.state);
  const all = [
    metric('Contatos', number(data.contacts), 'people', 'Total no CRM'),
    metric('Empresas', number(data.companies), 'inventory', 'Total no CRM'),
    metric('Leads ativos', number(data.leads), 'people', 'Carteira atual'),
    metric('Oportunidades abertas', number(data.open), 'template', 'Carteira atual'),
    metric('Valor aberto', money(data.openValue), 'wallet', 'Negociações em aberto'),
    metric('Forecast ponderado', money(data.forecast), 'analytics', 'Estimativa sobre a carteira aberta'),
    metric('Negócios ganhos', number(data.won), 'check', trendNote(growth(data.won, previous?.won))),
    metric('Valor ganho', money(data.wonValue), 'wallet', 'Fechamentos do período'),
    metric('Negócios perdidos', number(data.lost), 'alert', 'Fechamentos do período', 'amber'),
    metric('Taxa de ganho', data.winRate === null ? '—' : number(data.winRate) + '%', 'analytics',
      data.winRate === null ? 'Sem fechamentos no período' : 'Ganhos ÷ encerrados'),
    metric('Tarefas pendentes', number(data.pending), 'clock', 'Carteira atual'),
    metric('Tarefas atrasadas', number(data.late), 'alert', 'Carteira atual', 'amber'),
  ];
  const advanced = [
    metric('Contatos cadastrados', number(data.contactsCreated), 'people', 'No período'),
    metric('Oportunidades criadas', number(data.created), 'template', trendNote(growth(data.created, previous?.created))),
    metric('Taxa de ganho', data.winRate === null ? '—' : number(data.winRate) + '%', 'analytics', 'Ganhos ÷ encerrados'),
    metric('Valor médio ganho', money(data.average), 'wallet', 'Sobre negócios ganhos'),
    metric('Tempo até fechamento', data.closeDays === null ? '—' : number(Math.round(data.closeDays * 10) / 10) + ' dias', 'clock', 'Sobre negócios ganhos'),
    metric('Tarefas concluídas', number(data.done), 'check', 'No período'),
    metric('Tarefas atrasadas', number(data.late), 'alert', 'Carteira atual', 'amber'),
    metric('Valor ganho', money(data.wonValue), 'wallet'), metric('Oportunidades abertas', number(data.open), 'template', 'Carteira atual'),
    metric('Negócios ganhos', number(data.won), 'check'), metric('Negócios perdidos', number(data.lost), 'alert'),
  ];
  const charts = el('div', { class: 'chart-grid' },
    chart('Negócios criados por mês', 'Data de cadastro', data.createdMonths.map(([key, value]) => [month(key), value])),
    chart('Negócios ganhos por mês', 'Data de fechamento', data.wonMonths.map(([key, value]) => [month(key), value])),
    chart('Distribuição por etapa', 'Carteira aberta atual e fechamentos do período', data.stages.map(item => [item.name, item.count, item.color])),
    chart('Valor por etapa', 'Valores estimados dos negócios no recorte', data.stages.map(item => [item.name, item.value, item.color]), money),
    chart('Status das tarefas', 'Concluídas no período e pendentes atuais', [['Concluídas', data.done], ['Pendentes', data.pending]]),
    detail ? chart('Ganhos e perdidos', 'Negócios com fechamento no período', [['Ganhos', data.won], ['Perdidos', data.lost]]) : null,
    detail ? chart('Origem dos negócios', 'Oportunidades criadas no período', data.origin) : null,
    detail ? chart('Interações por tipo', 'Datas registradas no período', data.activity.map(([key, value]) => [activityTypes[key], value])) : null);
  const controls = el('a', { href: detail ? '#pipeline' : '#analytics', class: 'button secondary' }, icon(detail ? 'template' : 'analytics'), detail ? 'Abrir funil' : 'Ver análises');
  const nodes = [heading(detail ? 'Análises' : 'Visão geral', 'Acompanhe o relacionamento comercial e o andamento dos negócios.', controls)];
  if (!ctx.state.started && !detail) nodes.push(welcome(ctx));
  nodes.push(periodControl(config, ctx.render), el('div', { class: 'metrics' }, detail ? advanced : all), charts);
  if (!detail) nodes.push(el('div', { class: 'chart-grid section-title' },
    panel('Acompanhamentos', note('Tarefas em aberto ou negócios sem interação por ' + ctx.state.settings.followDays + ' dias.'), next.deals.length ?
      el('ul', { class: 'linked-list' }, next.deals.slice(0, 6).map(({ deal, task, stale, date }) => el('li', {},
        button(deal.title, { kind: 'secondary small', action: () => details(ctx, 'deals', deal) }),
        note(task ? 'Próxima tarefa · ' + dateLabel(task.due) : 'Último contato · ' + dateLabel(date)), stale ? note('Acompanhamento recomendado') : null))) : note('Nenhum acompanhamento em destaque.'),
      el('a', { href: '#tasks' }, 'Abrir tarefas')),
    panel('Atividade recente', timelinePanel(ctx.state.events.slice(0, 7), 'Últimos eventos'))));
  return nodes;
}
