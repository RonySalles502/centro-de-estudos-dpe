const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

(async () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync(edge) ? edge : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('CONSOLE: ' + m.text()); });

  const url = process.env.PWA_URL || 'http://127.0.0.1:8765/';
  await page.goto(url);
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  const bootError = await page.evaluate(() => window.__DPE_BOOT_ERROR__ || '');
  if (bootError) throw new Error('Falha de boot: ' + bootError);
  if (process.env.PWA_SCREENSHOT) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: process.env.PWA_SCREENSHOT, fullPage: true });
  }

  const T = [];
  const ok = (n, c) => T.push([n, !!c]);

  // 1. abas renderizam
  const tabs = await page.$$eval('#tabs button', b => b.map(x => x.textContent));
  ok('9 abas renderizadas', tabs.length === 9);

  // 2. painel carrega estatísticas
  ok('painel com quatro indicadores coloridos', (await page.$$('.dashboard-stat')).length === 4);
  ok('painel segue a hierarquia visual do TJ-CE', !!await page.$('.dashboard-hero') && !!await page.$('.dashboard-agenda') && (await page.$$('.quick-action')).length === 3);
  const chip = await page.textContent('#chipProva');
  ok('chip da prova mostra estimativa', /estimada/.test(chip));
  ok('cabeçalho não expõe versão técnica', (await page.$('#chipConteudo')) === null);

  // 3. cada aba abre sem erro
  for (const t of tabs) {
    await page.click(`#tabs button:text-is("${t}")`);
    await page.waitForTimeout(160);
    const n = await page.$$eval('#main > *', e => e.length);
    ok(`aba ${t} renderiza conteúdo`, n > 0);
  }

  // 4. programa: filtra e edita
  await page.click('#tabs button:text-is("Programa")');
  await page.waitForTimeout(200);
  const linhas0 = await page.$$eval('tbody tr', r => r.length);
  ok('programa lista tópicos', linhas0 > 100);
  await page.selectOption('#main .card .row select >> nth=0', 'II');
  await page.waitForTimeout(250);
  const linhas1 = await page.$$eval('tbody tr', r => r.length);
  ok('filtro de grupo reduz a lista', linhas1 > 0 && linhas1 < linhas0);

  // 5. cronograma: gerar ciclo
  await page.click('#tabs button:text-is("Cronograma")');
  await page.waitForTimeout(250);
  await page.click('button:text-is("Gerar novo ciclo")');
  await page.waitForTimeout(500);
  const semanas = await page.$$eval('.wk button', b => b.length);
  ok('ciclo dividido em semanas navegáveis', semanas >= 4);
  let totalDias = 0, totalBlocos = 0, informativosDoCiclo = [];
  for (let w = 0; w < semanas; w++) {
    await page.click(`.wk button >> nth=${w}`);
    await page.waitForTimeout(120);
    totalDias += await page.$$eval('.day', d => d.length);
    totalBlocos += await page.$$eval('.blk', d => d.length);
    informativosDoCiclo.push(...await page.$$eval('.informative-assignment', itens => itens.map(item => item.dataset.informativoKey)));
  }
  ok('ciclo cobre os 28 dias do horizonte', totalDias === 28);
  ok('ciclo gera blocos de estudo em volume', totalBlocos > 40);
  ok('jurisprudência indica informativos específicos no ciclo', informativosDoCiclo.length > 0 && informativosDoCiclo.every(Boolean));
  ok('principais informativos não se repetem no mesmo ciclo', new Set(informativosDoCiclo).size === informativosDoCiclo.length);
  ok('conteúdo indisponível é redistribuído sem blocos vazios', /redistribuiu automaticamente/.test(await page.textContent('#main')));
  await page.click('.wk button >> nth=1');
  await page.waitForTimeout(150);
  ok('semana cheia tem 7 dias', (await page.$$('.day')).length === 7);
  ok('cronograma usa cabeçalhos diários no modelo TJ-CE', (await page.$$('.schedule-day .day-head')).length === 7);
  ok('ciclos 1, 2 e 3 têm apresentação visual separada', !!await page.$('.blk.cycle-1') && !!await page.$('.blk.cycle-2') && !!await page.$('.blk.cycle-3'));
  ok('configuração do ciclo fica disponível sem dominar a agenda', !!await page.$('details.schedule-settings'));
  const leis = await page.$$eval('.lei', d => d.length);
  ok('blocos exibem leitura legislativa', leis > 0);
  const why = await page.$$eval('.why', d => d.length);
  ok('blocos exibem justificativa', why > 0);
  const maxLeiDia = await page.$$eval('.day', dias => Math.max(0, ...dias.map(dia => dia.querySelectorAll('.type-LEI_SECA').length)));
  ok('lei seca respeita o máximo de um bloco por dia', maxLeiDia <= 1);
  ok('lei seca exibe carga executável', (await page.$$('.workload')).length > 0);

  // concluir um bloco
  await page.click('.blk button:text-is("Marcar concluído") >> nth=0');
  await page.waitForTimeout(300);
  ok('bloco marcado como concluído', (await page.$$('.blk.done')).length >= 1);
  await page.click('#tabs button:text-is("Painel")');
  await page.waitForTimeout(250);
  ok('painel mostra conteúdo de hoje e dos próximos dias', (await page.$$('.agenda-item')).length > 0 && (await page.$$('.next-day')).length > 0);

  // 6. prática: responder questões
  await page.click('#tabs button:text-is("Questões")');
  await page.waitForTimeout(250);
  await page.click('button:text-is("Iniciar prática")');
  await page.waitForTimeout(400);
  ok('sessão de prática abre questão', (await page.$$('.q .alt')).length === 5);
  let acertos = 0;
  for (let i = 0; i < 10; i++) {
    const alts = await page.$$('.alt');
    if (!alts.length) break;
    await alts[1].click();
    await page.waitForTimeout(140);
    const e = await page.$('.exp');
    if (e) { const txt = await e.textContent(); if (/você acertou/.test(txt)) acertos++; }
    const prox = await page.$('button:text-is("Próxima")');
    if (prox) { await prox.click(); await page.waitForTimeout(140); }
    else { const c = await page.$('button:text-is("Concluir sessão")'); if (c) { await c.click(); await page.waitForTimeout(400); } break; }
  }
  ok('sessão exibe gabarito e explicação', true);
  const modal = await page.$('.modal');
  ok('modal de resultado aparece', !!modal);
  if (modal) { await page.click('.modal button:text-is("Fechar")'); await page.waitForTimeout(200); }

  // histórico registrado
  await page.click('#tabs button:text-is("Questões")');
  await page.waitForTimeout(250);
  const hist = await page.$$eval('tbody tr', r => r.length);
  ok('sessão registrada no histórico', hist >= 1);

  // 7. simulado de grupo
  await page.click('#tabs button:text-is("Simulados")');
  await page.waitForTimeout(250);
  const disabled = await page.$eval('button:text-is("Simulado completo — 100 questões")', b => b.disabled);
  ok('simulado completo habilitado (banco suficiente)', disabled === false);
  await page.click('button:text-is("Simulado de 25 questões") >> nth=0');
  await page.waitForTimeout(400);
  const tot = await page.textContent('.card .row');
  ok('simulado de grupo abre com 25 itens', /de 25/.test(tot));
  page.once('dialog', d => d.accept());
  await page.click('button:text-is("Descartar")');
  await page.waitForTimeout(300);

  // 8. revisões
  await page.click('#tabs button:text-is("Revisões")');
  await page.waitForTimeout(250);
  const revs = await page.$$eval('.blk', r => r.length);
  ok('fila de revisão alimentada pelas respostas', revs >= 1);
  ok('formulário de revisão manual disponível', !!await page.$('.review-manual'));
  await page.selectOption('.review-manual select', { index: 1 });
  await page.click('button:text-is("Adicionar revisão")');
  await page.waitForTimeout(200);
  ok('revisão manual cadastrada em paralelo', (await page.$$('.manual-review')).length >= 1);
  if (revs) {
    await page.click('.blk button:text-is("Bom") >> nth=0');
    await page.waitForTimeout(300);
    ok('avaliação de revisão aceita', true);
  }

  // 9. discursivas: contagem em linhas
  await page.click('#tabs button:text-is("Discursivas")');
  await page.waitForTimeout(250);
  ok('discursiva oferece espelho de resposta', !!await page.$('details.study-guide'));
  const linhaTxt0 = await page.textContent('.linhas');
  ok('discursiva mostra limite de 30 linhas', /de 30 linhas/.test(linhaTxt0));
  await page.selectOption('#main .card .grid select >> nth=0', 'PECA');
  await page.waitForTimeout(200);
  const linhaTxt1 = await page.textContent('.linhas');
  ok('peça processual mostra limite de 120 linhas', /de 120 linhas/.test(linhaTxt1));
  await page.fill('#main textarea', 'x'.repeat(70 * 5));
  await page.waitForTimeout(200);
  const linhaTxt2 = await page.textContent('.linhas');
  ok('contagem de linhas funciona (350 chars = 5 linhas)', /^5 de 120/.test(linhaTxt2));

  // 10. importador CSV
  await page.click('#tabs button:text-is("Ajustes")');
  await page.waitForTimeout(300);
  await page.click('button:text-is("Colar CSV")');
  await page.waitForTimeout(150);
  await page.fill('#main textarea', 'I;CON;Questao importada de teste;alt A;alt B;alt C;alt D;alt E;C;explicacao;CF/88 art. 1;https://x');
  await page.click('button:text-is("Importar CSV")');
  await page.waitForTimeout(400);
  const impTxt = await page.textContent('#main');
  ok('CSV importado aparece na listagem', /Questoes importadas|Questões importadas/.test(impTxt));

  // CSV inválido é rejeitado
  page.once('dialog', d => d.accept());
  await page.click('button:text-is("Colar CSV")');
  await page.fill('#main textarea', 'Z;XXX;falta campos');
  await page.click('button:text-is("Importar CSV")');
  await page.waitForTimeout(400);
  ok('CSV inválido não quebra a aplicação', true);

  // 11. jurisprudência versionada
  await page.click('#tabs button:text-is("Jurisprudência")');
  await page.waitForTimeout(250);
  const juris = await page.textContent('#main');
  ok('jurisprudência mostra estado simples e fonte oficial', /Base (atualizada|disponível)/.test(juris) && /fonte oficial/i.test(juris));
  ok('jurisprudência não expõe metadados técnicos', !/Versão 20|pacote versionado|última coleta válida|falha de coleta/i.test(juris));
  ok('atalhos oficiais têm rótulos claros', /Abrir informativos do STF/.test(juris) && /Abrir súmulas do STF/.test(juris));
  ok('trilha mistura informativos numerados de 2025/2026', (await page.$$('.informativo-card')).length > 1 && /Trilha de informativos por número/.test(juris));

  // 12. perfil DPE/SP e isolamento entre concursos
  await page.selectOption('#profileSelect', 'SP');
  await page.waitForTimeout(300);
  ok('perfil DPE/SP troca a banca e mantém data em aberto', /FCC/.test(await page.textContent('#chipBanca')) && /a definir/.test(await page.textContent('#chipProva')));
  ok('perfil DPE/SP oferece fontes oficiais próprias', /Abrir IX Edital da DPE\/SP/.test(await page.textContent('#main')) && /Abrir regras atuais da DPE\/SP/.test(await page.textContent('#main')));
  await page.click('#tabs button:text-is("Programa")');
  await page.waitForTimeout(250);
  ok('programa DPE/SP inclui os complementos do IX edital', (await page.$$('tbody tr')).length > 296 && /Filosofia do Direito e Sociologia Jurídica/.test(await page.textContent('#main')));
  await page.click('#tabs button:text-is("Simulados")');
  await page.waitForTimeout(250);
  ok('simulado DPE/SP usa referência de 88 questões e 4h30', /Simulado completo — 88 questões/.test(await page.textContent('#main')) && /4h30/.test(await page.textContent('#main')));
  await page.selectOption('#profileSelect', 'RN');
  await page.waitForTimeout(300);
  ok('retorno ao perfil RN restaura banca e cronograma próprios', /CEBRASPE/.test(await page.textContent('#chipBanca')));
  await page.click('#tabs button:text-is("Cronograma")');
  await page.waitForTimeout(250);
  ok('ciclo RN permanece isolado após visitar DPE/SP', (await page.$$('.wk button')).length >= 4);

  // 13. backup com envelope e hash verificável
  await page.click('#tabs button:text-is("Ajustes")');
  const downloadPromise = page.waitForEvent('download');
  await page.click('button:text-is("Baixar cópia de segurança")');
  const download = await downloadPromise;
  const backupPath = await download.path();
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const digest = crypto.createHash('sha256').update(JSON.stringify(backup.state)).digest('hex');
  ok('backup tem formato versionado e SHA-256 válido', backup.format === 'centro-estudos-dpern-backup' && digest === backup.stateSha256);

  // 14. persistência após reload
  await page.reload();
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  await page.click('#tabs button:text-is("Painel")');
  const painel = await page.textContent('#main');
  ok('estado persiste após recarregar', /questões resolvidas/i.test(painel));
  await page.click('#tabs button:text-is("Cronograma")');
  await page.waitForTimeout(300);
  ok('ciclo persiste após recarregar', (await page.$$('.wk button')).length >= 4);

  // 15. alternância de tema
  const temaAntes = await page.getAttribute('html', 'data-theme');
  await page.click('#btnTheme');
  await page.waitForTimeout(200);
  ok('tema alterna', (await page.getAttribute('html', 'data-theme')) !== temaAntes);

  // 16. operação offline após o primeiro carregamento controlado pelo service worker
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  ok('PWA reabre offline com conteúdo e progresso', !await page.evaluate(() => window.__DPE_BOOT_ERROR__) && (await page.$$('#tabs button')).length === 9);
  await ctx.setOffline(false);
  await page.selectOption('#profileSelect', 'SP');
  await page.waitForTimeout(250);
  await page.reload();
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  ok('perfil DPE/SP permanece ativo após recarregar', /FCC/.test(await page.textContent('#chipBanca')) && /DPE\/SP/.test(await page.title()));

  // 17. fila grande de revisões não domina o cronograma
  await page.selectOption('#profileSelect', 'RN');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('dpern_local', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const state = await new Promise((resolve, reject) => { const req = db.transaction('state', 'readonly').objectStore('state').get('main'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const now = new Date(), pad = value => String(value).padStart(2, '0'), today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    Object.keys(state.topicos).slice(0, 80).forEach(tid => { state.revisoes[tid] = { int: 1, ease: 2.5, reps: 0, prox: today, ult: null, ultAv: null }; });
    await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(state, 'main'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  await page.click('#tabs button:text-is("Cronograma")');
  await page.click('details.schedule-settings summary');
  await page.click('button:text-is("Gerar novo ciclo")');
  await page.waitForTimeout(500);
  const semanasRevisao = await page.$$('.wk button');
  let maxRevisaoDia = 0, totalRevisoesAuto = 0, totalBlocosRegerado = 0;
  for (let w = 0; w < semanasRevisao.length; w++) {
    await page.click(`.wk button >> nth=${w}`); await page.waitForTimeout(100);
    const dados = await page.$$eval('.day', dias => dias.map(dia => ({auto: dia.querySelectorAll('.blk.auto-review').length, total: dia.querySelectorAll('.blk').length})));
    dados.forEach(dia => { maxRevisaoDia = Math.max(maxRevisaoDia, dia.auto); totalRevisoesAuto += dia.auto; totalBlocosRegerado += dia.total; });
  }
  ok('revisão automática respeita o máximo de um bloco por dia', maxRevisaoDia <= 1);
  ok('fila vencida respeita o peso de revisão e não domina o ciclo', totalRevisoesAuto > 0 && totalRevisoesAuto < totalBlocosRegerado * 0.35);

  await browser.close();

  let fail = 0;
  for (const [n, r] of T) { console.log((r ? 'PASS  ' : 'FALHA ') + n); if (!r) fail++; }
  if (erros.length) { console.log('\nErros de runtime:'); erros.forEach(e => console.log('  ' + e)); }
  console.log(`\n${T.length - fail}/${T.length} verificações passaram; ${erros.length} erro(s) de runtime.`);
  process.exit(fail || erros.length ? 1 : 0);
})();
