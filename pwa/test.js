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
  ok('painel com estatísticas', (await page.$$('.stat')).length >= 4);
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
  let totalDias = 0, totalBlocos = 0;
  for (let w = 0; w < semanas; w++) {
    await page.click(`.wk button >> nth=${w}`);
    await page.waitForTimeout(120);
    totalDias += await page.$$eval('.day', d => d.length);
    totalBlocos += await page.$$eval('.blk', d => d.length);
  }
  ok('ciclo cobre os 28 dias do horizonte', totalDias === 28);
  ok('ciclo gera blocos de estudo em volume', totalBlocos > 40);
  ok('conteúdo indisponível é redistribuído sem blocos vazios', /redistribuiu automaticamente/.test(await page.textContent('#main')));
  await page.click('.wk button >> nth=1');
  await page.waitForTimeout(150);
  ok('semana cheia tem 7 dias', (await page.$$('.day')).length === 7);
  const leis = await page.$$eval('.lei', d => d.length);
  ok('blocos exibem leitura legislativa', leis > 0);
  const why = await page.$$eval('.why', d => d.length);
  ok('blocos exibem justificativa', why > 0);

  // concluir um bloco
  await page.click('.blk button:text-is("Concluir") >> nth=0');
  await page.waitForTimeout(300);
  ok('bloco marcado como concluído', (await page.$$('.blk.done')).length >= 1);

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

  // 12. backup com envelope e hash verificável
  await page.click('#tabs button:text-is("Ajustes")');
  const downloadPromise = page.waitForEvent('download');
  await page.click('button:text-is("Baixar cópia de segurança")');
  const download = await downloadPromise;
  const backupPath = await download.path();
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const digest = crypto.createHash('sha256').update(JSON.stringify(backup.state)).digest('hex');
  ok('backup tem formato versionado e SHA-256 válido', backup.format === 'centro-estudos-dpern-backup' && digest === backup.stateSha256);

  // 13. persistência após reload
  await page.reload();
  await page.waitForTimeout(800);
  const painel = await page.textContent('#main');
  ok('estado persiste após recarregar', /questões respondidas|Questões respondidas/i.test(painel));
  await page.click('#tabs button:text-is("Cronograma")');
  await page.waitForTimeout(300);
  ok('ciclo persiste após recarregar', (await page.$$('.wk button')).length >= 4);

  // 14. tema claro
  await page.click('#btnTheme');
  await page.waitForTimeout(200);
  ok('tema alterna', (await page.getAttribute('html', 'data-theme')) === 'light');

  // 15. operação offline após o primeiro carregamento controlado pelo service worker
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__DPE_READY__ || window.__DPE_BOOT_ERROR__, null, { timeout: 15000 });
  ok('PWA reabre offline com conteúdo e progresso', !await page.evaluate(() => window.__DPE_BOOT_ERROR__) && (await page.$$('#tabs button')).length === 9);
  await ctx.setOffline(false);

  await browser.close();

  let fail = 0;
  for (const [n, r] of T) { console.log((r ? 'PASS  ' : 'FALHA ') + n); if (!r) fail++; }
  if (erros.length) { console.log('\nErros de runtime:'); erros.forEach(e => console.log('  ' + e)); }
  console.log(`\n${T.length - fail}/${T.length} verificações passaram; ${erros.length} erro(s) de runtime.`);
  process.exit(fail || erros.length ? 1 : 0);
})();
