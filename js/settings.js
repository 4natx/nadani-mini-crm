import { parseBackup } from './backup.js';
import { ordered } from './business.js';
import { caps, fold, localDay, terminal } from './model.js';
import { download, entityCSV, importFields, parseCSV, previewImport } from './transfer.js';
import { actions, button, el, field, heading, input, label, note, panel, select, submit, table, textField, titles, valuesOf } from './ui.js';

export function stagesDialog(ctx) {
  function show() {
    const all = ctx.state.stages;
    ctx.open('Configurar etapas abertas', [
      note('Ganho e Perdido são resultados fixos. A probabilidade padrão só vale para propostas sem probabilidade própria.'),
      el('ul', { class: 'stage-list' }, all.map((stage, index) => el('li', {}, el('div', {},
        el('strong', {}, stage.name), note(stage.probability + '% · ' + ordered(ctx.state, stage.id).length + ' oportunidade(s)')),
        terminal.includes(stage.id) ? label('Resultado fixo') : actions(
          button('Subir', { kind: 'secondary small', disabled: index === 0, action: () => update('move', stage.id, -1) }),
          button('Descer', { kind: 'secondary small', disabled: index >= all.length - 3, action: () => update('move', stage.id, 1) }),
          button('Editar', { kind: 'secondary small', action: () => edit(stage) }),
          button('Excluir', { kind: 'secondary small', disabled: all.length <= 3, action: () => remove(stage) })) ))),
      actions(button('Nova etapa', { id: 'new-stage', kind: 'primary', action: () => edit() }))]);
  }
  async function update(action, id, direction) {
    try { await ctx.run('stage', { action, id, direction }, 'Ordem das etapas atualizada.'); show(); }
    catch (error) { ctx.toast(error.message); }
  }
  function edit(stage) {
    ctx.form(stage ? 'Editar etapa' : 'Nova etapa', [
      textField('name', 'Nome da etapa', stage?.name ?? '', { maxlength: 40, required: true }),
      textField('probability', 'Probabilidade (%)', stage?.probability ?? 25, { type: 'number', min: 0, max: 100, required: true }),
      field('Cor', input('color', { type: 'color', value: stage?.color ?? '#546aca' })),
    ], 'Salvar etapa', raw => ctx.run('stage', { ...raw, id: stage?.id }, 'Etapa salva.'), 'save-stage', 'As probabilidades são parâmetros de estimativa.');
  }
  function remove(stage) {
    const count = ordered(ctx.state, stage.id).length;
    const target = ctx.state.stages.filter(item => item.id !== stage.id && !terminal.includes(item.id));
    const remove = destination => ctx.run('stage', { id: stage.id, action: 'delete', destination }, 'Etapa excluída.');
    if (!count) {
      ctx.confirm('Excluir etapa vazia?', stage.name, 'Excluir etapa', () => remove());
      return;
    }
    ctx.form('Excluir etapa e mover oportunidades', [field('Etapa aberta de destino', select('destination', [['', 'Selecione'], ...target.map(item => [item.id, item.name])], '', { required: true }))],
      'Mover e excluir', raw => remove(raw.destination), 'delete-stage', count + ' oportunidade(s) e seus históricos serão preservados.');
  }
  show();
}

function csvDialog(ctx, content) {
  const { headers, rows } = parseCSV(content);
  const choose = [['-1', 'Ignorar'], ...headers.map((heading, i) => [i, heading || 'Coluna ' + (i + 1)])];
  const fields = Object.entries(importFields).map(([key, label]) => {
    const simple = name => fold(name).replace(/[^a-z]/g, '');
    const index = headers.findIndex(heading => [simple(key), simple(label)].includes(simple(heading)));
    return field(label, select(key, choose, index));
  });
  const target = el('div', { id: 'import-preview' });
  const error = el('p', { class: 'error', role: 'alert' });
  const form = el('form', { id: 'csv-map' }, el('div', { class: 'form-grid' }, fields), submit('Gerar prévia', 'preview-csv'));
  form.addEventListener('change', () => target.replaceChildren());
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    try {
      const mapping = Object.fromEntries(Object.entries(valuesOf(form)).map(([key, value]) => [key, Number(value)]));
      const result = previewImport(ctx.state, rows, mapping);
      const counts = result.review.reduce((map, entry) => (map[entry.status]++, map), { Novo: 0, Duplicado: 0, Inválido: 0 });
      const buttonImport = button('Confirmar importação', { id: 'confirm-csv', kind: 'primary', disabled: !counts.Novo, action: async () => {
        buttonImport.disabled = true;
        try {
          const previous = ctx.state.contacts.length;
          const current = await ctx.run('importContacts', { contacts: result.accepted }, '');
          ctx.close();
          ctx.toast((current.contacts.length - previous) + ' contato(s) importado(s). Duplicados e inválidos foram ignorados.');
        } catch (problem) { error.textContent = problem.message; buttonImport.disabled = false; }
      } });
      target.replaceChildren(note(counts.Novo + ' novos · ' + counts.Duplicado + ' duplicados · ' + counts.Inválido + ' inválidos. Prévia de até 20 linhas, com erros primeiro.'),
        table(['Linha', 'Nome', 'Situação', 'Observação'], result.review.slice().sort((a, b) => Number(a.status === 'Novo') - Number(b.status === 'Novo'))
          .slice(0, 20).map(entry => [String(entry.index), entry.name, entry.status, entry.note]), 'Prévia da importação'), actions(buttonImport));
    } catch (problem) { error.textContent = problem.message; target.replaceChildren(); }
  });
  ctx.open('Mapear colunas do CSV', [note('Escolha as colunas de origem. Nome é obrigatório. O CRM ignora duplicatas e linhas inválidas sem mesclar registros.'),
    form, error, target]);
}

export function settingsView(ctx) {
  const state = ctx.state;
  const settings = state.settings;
  const save = submit('Salvar preferências', 'save-settings');
  const feedback = el('p', { class: 'error', role: 'alert', id: 'settings-error' });
  const form = el('form', { id: 'preferences' }, el('div', { class: 'form-grid' },
    textField('workspace', 'Nome do espaço', settings.workspace, { maxlength: 64, required: true }),
    field('Tema', select('theme', [['system', 'Acompanhar sistema'], ['light', 'Claro'], ['dark', 'Escuro']], settings.theme, { id: 'theme-choice' })),
    textField('followDays', 'Dias sem interação para alerta', settings.followDays, { type: 'number', min: 1, max: 365, required: true })), feedback, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try { await ctx.run('settings', valuesOf(form), 'Preferências salvas.'); }
    catch (error) { feedback.textContent = error.message; }
    finally { save.disabled = false; }
  });
  const raw = input('backup', { type: 'file', hidden: true, accept: '.json,application/json', id: 'backup-file' });
  const csv = input('csv', { type: 'file', hidden: true, accept: '.csv,text/csv', id: 'csv-file' });
  const fileStatus = el('p', { id: 'file-feedback', class: 'fine', role: 'status' });
  const issue = async (control, format) => {
    const file = control.files[0];
    control.value = '';
    if (!file) return;
    fileStatus.textContent = 'Lendo arquivo…';
    const revision = state.revision;
    try {
      if (!file.name.toLowerCase().endsWith('.' + format) || file.size > (format === 'csv' ? caps.csv : caps.backup)) {
        throw new Error(format === 'csv' ? 'Use CSV UTF-8 de até 2 MiB.' : 'Use JSON de até 24 MiB.');
      }
      let value;
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('O arquivo precisa estar em UTF-8.'); }
      if (!control.isConnected) return;
      if (format === 'csv') { csvDialog(ctx, value); fileStatus.textContent = ''; return; }
      const next = parseBackup(value);
      ctx.confirm('Restaurar backup?', next.contacts.length + ' contato(s), ' + next.companies.length + ' empresa(s), ' + next.deals.length +
        ' oportunidade(s), ' + next.tasks.length + ' tarefa(s) e ' + next.activities.length + ' interação(ões) substituem os dados atuais.',
        'Restaurar backup', () => ctx.replace(next, revision, 'Backup restaurado.'));
      fileStatus.textContent = '';
    } catch (error) { fileStatus.textContent = error.message; }
  };
  raw.addEventListener('change', () => issue(raw, 'json'));
  csv.addEventListener('change', () => issue(csv, 'csv'));
  const kind = select('entity', ['contacts', 'companies', 'deals', 'activities', 'tasks'].map(key => [key, titles[key]]), 'contacts', { id: 'csv-kind' });
  return [heading('Configurações', 'Gerencie preferências, estrutura do funil e dados locais.'), el('div', { class: 'settings-grid' },
    panel('Preferências', form),
    panel('Funil comercial', note('Crie etapas abertas e ajuste a probabilidade padrão de cada etapa.'),
      actions(button('Configurar etapas', { id: 'manage-stages', action: () => stagesDialog(ctx) }))),
    panel('Planilhas', field('Exportar registros', kind), csv, actions(
      button('Exportar CSV', { id: 'export-csv', symbol: 'download', action: () => {
        download('nadani-' + kind.value + '-' + localDay() + '.csv', entityCSV(ctx.state, kind.value), 'text/csv;charset=utf-8');
        ctx.toast('CSV exportado.');
      } }), button('Importar contatos CSV', { id: 'import-csv', action: () => csv.click() })), fileStatus),
    panel('Backup e limpeza', raw, note('Backup versionado dos dados e preferências. A restauração substitui a base local.'),
      actions(button('Exportar backup JSON', { id: 'export-backup', symbol: 'download', disabled: ctx.recovery, action: () => {
        download('nadani-backup-' + localDay() + '.json', JSON.stringify(ctx.state), 'application/json');
        ctx.toast('Backup exportado.');
      } }), button('Importar backup', { action: () => raw.click() }), ctx.recovery ? button('Baixar cópia original', { action: ctx.rawBackup }) : null),
      actions(button('Restaurar demonstração', { id: 'reset-demo', action: () => ctx.seed() }),
        button('Apagar dados', { id: 'clear-data', action: () => ctx.confirm('Apagar a base local?',
          'Esta ação remove os registros e as preferências deste navegador e perfil.', 'Apagar dados', () => ctx.clear(state.revision)) }))),
    panel('Privacidade', note('Este CRM é uma demonstração de portfólio. Os dados são armazenados localmente neste navegador e não são sincronizados com servidores.'),
      note('Use dados fictícios para demonstrações. Registros de conversa e tarefas não acionam comunicações automáticas.'),
      el('a', { href: 'https://nadani.space' }, 'Developed by Nadani Productions')))];
}
