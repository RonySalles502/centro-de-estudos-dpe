/* Centro de Estudos DPE/RN — PWA local-first. Sem dependências externas. */
(function(){
"use strict";

/* ---------------------------------------------------------------- utils */
const $ = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const el = (t,a,h)=>{const n=document.createElement(t); if(a) for(const k in a){ if(k==='class')n.className=a[k]; else if(k.slice(0,2)==='on')n.addEventListener(k.slice(2),a[k]); else if(a[k]!=null)n.setAttribute(k,a[k]); } if(h!=null)n.innerHTML=h; return n;};
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = ()=> (Date.now().toString(36)+Math.random().toString(36).slice(2,8));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pct = (a,b)=> b>0 ? Math.round(a/b*100) : 0;
const nf = n => (Math.round(n*100)/100).toLocaleString('pt-BR');
const DIAS=['DOM','SEG','TER','QUA','QUI','SEX','SAB'];
const DIAS_L=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
function iso(d){ return d.toISOString().slice(0,10); }
function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(s,n){ const d=parseISO(s); d.setDate(d.getDate()+n); return iso(d); }
function hoje(){ const d=new Date(); return iso(new Date(d.getFullYear(),d.getMonth(),d.getDate())); }
function fmtBR(s){ if(!s) return '—'; const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
function diasEntre(a,b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
function toast(msg,ms){ const t=el('div',{class:'toast'},esc(msg)); document.body.appendChild(t); setTimeout(()=>t.remove(), ms||2600); }
function shuffle(a,seed){ let s=seed||Math.floor(Math.random()*1e9); const r=()=>{s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff;}; const x=a.slice(); for(let i=x.length-1;i>0;i--){const j=Math.floor(r()*(i+1)); [x[i],x[j]]=[x[j],x[i]];} return x; }
function safeUrl(value){
  if(!value) return '';
  try{ const url=new URL(String(value)); return ['http:','https:'].includes(url.protocol)?url.href:''; }
  catch(error){ return ''; }
}
async function sha256Text(value){
  if(!crypto.subtle) throw new Error('Este navegador não oferece verificação criptográfica de conteúdo.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/* ---------------------------------------------------------------- conteúdo publicado */
let DADOS=null, CONTENT_MANIFEST=null, JURIS_META=null;
async function fetchVerified(asset,baseUrl){
  const url=new URL(asset.url,baseUrl);
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(`Não foi possível carregar ${url.pathname} (${response.status}).`);
  const text=await response.text();
  const actual=await sha256Text(text);
  if(actual!==asset.sha256) throw new Error(`O conteúdo ${url.pathname} falhou na verificação de integridade.`);
  return JSON.parse(text);
}
function expandJurisprudence(juris){
  const records=(juris.items||[]).map(item=>({...item}));
  Object.values(juris.datasets||{}).forEach(dataset=>{
    const columns=Array.isArray(dataset.columns)?dataset.columns:[];
    (dataset.rows||[]).forEach(row=>{
      if(!Array.isArray(row)||row.length!==columns.length)return;
      const item={trib:dataset.court||'',source_id:dataset.source_id||'',kind:dataset.record_kind||''};
      columns.forEach((column,index)=>{if(row[index]!==''&&row[index]!=null)item[column]=row[index];});
      records.push(item);
    });
  });
  records.forEach(item=>{
    if(!item.record_type){
      if(item.source_id==='stj-informativo')item.record_type='Informativo STJ';
      else if(item.source_id==='stj-teses')item.record_type='Jurisprudência em Teses';
      else if(item.kind==='REFERENCIA_EDITORIAL')item.record_type='Referência editorial';
      else item.record_type=item.tema||'Publicação oficial';
    }
  });
  return records.sort((a,b)=>String(b.published_at||'').localeCompare(String(a.published_at||''))||String(a.ref||'').localeCompare(String(b.ref||'')));
}
async function carregarConteudo(){
  const manifestUrl=new URL('./content/manifest.json',location.href);
  const response=await fetch(manifestUrl,{cache:'no-store'});
  if(!response.ok) throw new Error(`Manifesto de conteúdo indisponível (${response.status}).`);
  const manifest=await response.json();
  if(manifest.format!=='centro-estudos-dpern-content'||manifest.formatVersion!==1) throw new Error('Manifesto de conteúdo incompatível.');
  const [core,juris]=await Promise.all([
    fetchVerified(manifest.assets.core,manifestUrl),
    fetchVerified(manifest.assets.jurisprudence,manifestUrl)
  ]);
  DADOS=core;
  DADOS.precedentes=expandJurisprudence(juris);
  DADOS.jurisprudence_meta=juris;
  CONTENT_MANIFEST=manifest;
  JURIS_META=juris;
}

/* ---------------------------------------------------------------- persistência */
const LEGACY_LSKEY='dpern_v7_state', IDB='dpern_local', IDB_VERSION=2, STORE='state', SNAPS='snaps';
let idb=null;
function openIDB(){ return new Promise(res=>{ if(!window.indexedDB) return res(null);
  const rq=indexedDB.open(IDB,IDB_VERSION);
  rq.onupgradeneeded=e=>{const db=e.target.result; if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE); if(!db.objectStoreNames.contains(SNAPS))db.createObjectStore(SNAPS,{keyPath:'ts'});};
  rq.onsuccess=e=>res(e.target.result); rq.onerror=()=>res(null); }); }
function idbPut(store,val,key){ return new Promise(res=>{ if(!idb) return res(false);
  try{ const tx=idb.transaction(store,'readwrite'); const s=tx.objectStore(store); key!==undefined?s.put(val,key):s.put(val); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);}catch(e){res(false);} }); }
function idbGet(store,key){ return new Promise(res=>{ if(!idb) return res(null);
  try{ const rq=idb.transaction(store,'readonly').objectStore(store).get(key); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null);}catch(e){res(null);} }); }
function idbAll(store){ return new Promise(res=>{ if(!idb) return res([]);
  try{ const rq=idb.transaction(store,'readonly').objectStore(store).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>res([]);}catch(e){res([]);} }); }
function idbDel(store,key){ return new Promise(res=>{ if(!idb) return res(false);
  try{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);}catch(e){res(false);} }); }

/* ---------------------------------------------------------------- estado */
const SCHEMA=8;
function novoEstado(){
  const tp={}; DADOS.programa.forEach(t=>{ tp[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''}; });
  return {
    schema:SCHEMA, criado:new Date().toISOString(), atualizado:new Date().toISOString(),
    contentVersions:{app:CONTENT_MANIFEST.appVersion,content:CONTENT_MANIFEST.contentVersion,questions:CONTENT_MANIFEST.questionBankVersion,jurisprudence:CONTENT_MANIFEST.jurisprudenceVersion},
    prova:{data:DADOS.meta.data_prova_estimada, confirmada:false, fonte:''},
    topicos:tp,
    diag:{ minutos:{SEG:120,TER:120,QUA:120,QUI:120,SEX:120,SAB:180,DOM:60},
           nivel:'INTERMEDIARIO', bloco:50, horizonte:28,
           pg:{I:25,II:25,III:25,IV:25},
           pc:{LEITURA:25,QUESTOES:25,JURISPRUDENCIA:15,REVISAO:15,DISCURSIVA:10,SIMULADO:10},
           preenchido:false },
    ciclo:null, ciclosAnteriores:[],
    revisoes:{}, exposicao:{}, sessoes:[], sessaoAtiva:null,
    disc:{ temas:[], tentativas:[] },
    juris:[], questoesImportadas:[],
    ui:{ tema:'dark', semana:0 }, audit:[]
  };
}
let S=null;

async function carregar(){
  let raw=await idbGet(STORE,'main');
  let legacy=false;
  if(!raw){ try{ const s=localStorage.getItem(LEGACY_LSKEY); if(s){raw=JSON.parse(s);legacy=true;} }catch(e){} }
  if(raw && raw.schema){ S=migrar(raw); } else { S=novoEstado(); }
  // garante tópicos novos do catálogo sem apagar progresso
  DADOS.programa.forEach(t=>{ if(!S.topicos[t.id]) S.topicos[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''}; });
  S.contentVersions={app:CONTENT_MANIFEST.appVersion,content:CONTENT_MANIFEST.contentVersion,questions:CONTENT_MANIFEST.questionBankVersion,jurisprudence:CONTENT_MANIFEST.jurisprudenceVersion};
  if(legacy){ await idbPut(STORE,S,'main'); try{localStorage.removeItem(LEGACY_LSKEY);}catch(error){} }
}
function migrar(o){
  const version=Number(o.schema||7);
  if(version>SCHEMA) throw new Error(`Os dados usam o esquema ${version}, mais novo que o esquema ${SCHEMA} deste aplicativo.`);
  if(!o.topicos||typeof o.topicos!=='object') throw new Error('Estado local inválido: progresso por tópicos ausente.');
  if(!o.disc||typeof o.disc!=='object')o.disc={temas:[],tentativas:[]};
  if(!Array.isArray(o.disc.temas))o.disc.temas=[]; if(!Array.isArray(o.disc.tentativas))o.disc.tentativas=[];
  if(!Array.isArray(o.juris))o.juris=[]; if(!Array.isArray(o.questoesImportadas))o.questoesImportadas=[];
  if(!o.exposicao||typeof o.exposicao!=='object')o.exposicao={}; if(!Array.isArray(o.ciclosAnteriores))o.ciclosAnteriores=[];
  if(!Array.isArray(o.sessoes))o.sessoes=[]; if(!o.revisoes||typeof o.revisoes!=='object')o.revisoes={};
  if(!o.ui||typeof o.ui!=='object')o.ui={tema:'dark',semana:0}; if(!Array.isArray(o.audit))o.audit=[];
  if(version<8){
    o.contentVersions={app:'0.7.0',content:'legado-v7',questions:'legado-v7',jurisprudence:'legado-v7'};
    o.audit.push({at:new Date().toISOString(),event:'STATE_MIGRATED',from:version,to:8});
  }
  o.schema=SCHEMA;
  return o;
}

let saveT=null;
let persistenceWarning=false;
function salvar(){ if(saveT) clearTimeout(saveT); saveT=setTimeout(()=>gravar().catch(handlePersistenceError),350); }
function handlePersistenceError(error){
  console.error(error);
  if(!persistenceWarning){persistenceWarning=true;toast('Não foi possível salvar no navegador. Exporte um backup antes de fechar.',6000);}
}
async function gravar(){
  S.atualizado=new Date().toISOString();
  const saved=await idbPut(STORE,S,'main');
  if(!saved) throw new Error('Falha ao persistir o estado no IndexedDB.');
  persistenceWarning=false;
  await snapshot();
}
async function snapshot(){
  const snaps=await idbAll(SNAPS);
  const ult=snaps.length?Math.max(...snaps.map(s=>s.ts)):0;
  if(Date.now()-ult < 6*3600e3) return;
  await idbPut(SNAPS,{ts:Date.now(), schema:SCHEMA, data:JSON.stringify(S)});
  const all=(await idbAll(SNAPS)).sort((a,b)=>b.ts-a.ts);
  for(const s of all.slice(7)) await idbDel(SNAPS,s.ts);
}

/* ---------------------------------------------------------------- catálogo de questões */
function bancoQuestoes(){ return DADOS.questoes.concat(S.questoesImportadas||[]); }
function qById(id){ return bancoQuestoes().find(q=>q.id===id); }
function discNome(code){ const t=DADOS.programa.find(x=>x.dc===code); return t?t.di:code; }
function snapshotQuestao(q){
  return {
    id:q.id,g:q.g,d:q.d,disciplina:discNome(q.d),t:q.t||null,n:q.n,e:q.e,o:q.o.slice(),gab:q.gab,
    exp:q.exp,f:q.f,u:safeUrl(q.u),src:q.src||'official-pack',validation_status:q.validation_status||null,
    rights_status:q.rights_status||null,content_version:q.content_version||CONTENT_MANIFEST.questionBankVersion,
    canonical_hash:q.canonical_hash||null
  };
}

/* ---------------------------------------------------------------- métricas */
function metricas(){
  const tp=S.topicos, ids=Object.keys(tp);
  const total=DADOS.programa.length;
  let ini=0, cons=0, feitas=0, acertos=0;
  const porG={}, porD={};
  DADOS.programa.forEach(t=>{
    const p=tp[t.id]; if(!p) return;
    if(p.st!=='NAO_INICIADO') ini++;
    if(p.st==='CONSOLIDADO') cons++;
    feitas+=p.fz||0; acertos+=p.ac||0;
    porG[t.g]=porG[t.g]||{t:0,i:0,f:0,a:0}; porG[t.g].t++; if(p.st!=='NAO_INICIADO')porG[t.g].i++; porG[t.g].f+=p.fz||0; porG[t.g].a+=p.ac||0;
    porD[t.dc]=porD[t.dc]||{t:0,i:0,f:0,a:0,nome:t.di,g:t.g}; porD[t.dc].t++; if(p.st!=='NAO_INICIADO')porD[t.dc].i++; porD[t.dc].f+=p.fz||0; porD[t.dc].a+=p.ac||0;
  });
  const devidas=Object.entries(S.revisoes).filter(([,r])=>r.prox<=hoje()).length;
  const sims=S.sessoes.filter(s=>s.tipo!=='PRATICA'&&s.fim);
  const ultSim=sims.length?sims[sims.length-1]:null;
  return {total,ini,cons,feitas,acertos,porG,porD,devidas,sims,ultSim,
    acc: feitas? acertos/feitas : null,
    cobertura: pct(ini,total)};
}
function notaObjetiva(sessao){ // 0,10 por acerto (art. 40)
  const certos=sessao.itens.filter(i=>i.certo).length;
  return certos*0.10;
}

/* ---------------------------------------------------------------- SRS */
const SRS_LAB={REPETIR:'Repetir',DIFICIL:'Difícil',BOM:'Bom',FACIL:'Fácil'};
function garanteRevisao(tid){ if(!S.revisoes[tid]) S.revisoes[tid]={int:0,ease:2.5,reps:0,prox:hoje(),ult:null,ultAv:null}; }
function avaliarRevisao(tid,av){
  garanteRevisao(tid); const r=S.revisoes[tid]; let {int,ease,reps}=r;
  if(av==='REPETIR'){ int=1; reps=0; ease=Math.max(1.3,ease-0.2); }
  else if(av==='DIFICIL'){ int = reps===0?2:Math.max(2,Math.ceil(Math.max(int,1)*1.2)); reps++; ease=Math.max(1.3,ease-0.15); }
  else if(av==='BOM'){ int = reps===0?3:Math.max(3,Math.round(Math.max(int,1)*ease)); reps++; }
  else { int = reps===0?7:Math.max(7,Math.round(Math.max(int,1)*ease*1.3)); reps++; ease=Math.min(3.5,ease+0.15); }
  r.int=int; r.ease=ease; r.reps=reps; r.ult=hoje(); r.ultAv=av; r.prox=addDays(hoje(),int);
  const p=S.topicos[tid]; if(p){ const d={REPETIR:-2,DIFICIL:-1,BOM:0,FACIL:1}[av]; p.dm=clamp((p.dm||0)+d,0,5); if(p.st==='NAO_INICIADO')p.st='EM_ESTUDO'; }
  salvar();
}

/* ---------------------------------------------------------------- seleção de questões (antirrepetição) */
const COOLDOWN=14;
function poolQuestoes(f){ f=f||{};
  return bancoQuestoes().filter(q=>{
    if(f.grupo && q.g!==f.grupo) return false;
    if(f.disc && q.d!==f.disc) return false;
    if(f.topico && q.t!==f.topico) return false;
    if(f.nivel && q.n!==f.nivel) return false;
    return true;
  });
}
function selecionar(n,f){
  const pool=poolQuestoes(f), h=hoje();
  const rank=q=>{
    const e=S.exposicao[q.id];
    if(!e) return [0,0,0];                                   // inédita: prioridade máxima
    const dias=diasEntre(e.ult,h);
    const dentro = dias<COOLDOWN ? 1 : 0;                    // dentro do resfriamento: evitar
    const acertouUlt = e.certo ? 1 : 0;                      // errou antes: repescar primeiro
    return [1,dentro,acertouUlt];
  };
  const arr=shuffle(pool).map(q=>({q,r:rank(q)}));
  arr.sort((a,b)=> a.r[0]-b.r[0] || a.r[1]-b.r[1] || a.r[2]-b.r[2]);
  return arr.slice(0,n).map(x=>x.q);
}
function selecionarSimuladoGrupo(grupo,n){
  // distribui proporcionalmente às disciplinas do grupo presentes no banco
  const pool=poolQuestoes({grupo:grupo});
  const porD={}; pool.forEach(q=>{porD[q.d]=(porD[q.d]||0)+1;});
  const discs=Object.keys(porD); if(!discs.length) return [];
  const tot=pool.length; const alvo={}; let soma=0;
  discs.forEach(d=>{ alvo[d]=Math.floor(n*porD[d]/tot); soma+=alvo[d]; });
  const ordem=discs.slice().sort((a,b)=>porD[b]-porD[a]);
  let i=0; while(soma<n){ alvo[ordem[i%ordem.length]]++; soma++; i++; }
  let out=[];
  discs.forEach(d=>{ out=out.concat(selecionar(alvo[d],{grupo:grupo,disc:d})); });
  if(out.length<n){ const falta=selecionar(n-out.length,{grupo:grupo}).filter(q=>!out.find(o=>o.id===q.id)); out=out.concat(falta); }
  return shuffle(out).slice(0,n);
}

/* ---------------------------------------------------------------- motor de cronograma */
const TIPOS={LEITURA:'Leitura',QUESTOES:'Questões',JURISPRUDENCIA:'Jurisprudência',REVISAO:'Revisão',DISCURSIVA:'Discursiva',SIMULADO:'Simulado'};
function pesoEscolha(pesos,aloc){
  const ks=Object.keys(pesos).filter(k=>pesos[k]>0); if(!ks.length) return null;
  ks.sort((a,b)=>{ const ra=(aloc[a]||0)/pesos[a], rb=(aloc[b]||0)/pesos[b];
    return ra-rb || (aloc[a]||0)-(aloc[b]||0) || ks.indexOf(a)-ks.indexOf(b); });
  return ks[0];
}
function scoreTopico(t,tipo){
  const p=S.topicos[t.id]||{};
  const pr={ALTA:0,MEDIA:1,BAIXA:2}[p.pr||'MEDIA'];
  const st={NAO_INICIADO:0,EM_ESTUDO:1,REVISAO:2,CONSOLIDADO:3}[p.st||'NAO_INICIADO'];
  const dm=p.dm||0;
  // "nunca testado" NÃO equivale a "sempre errado": vale como neutro (0.5)
  const acc = (p.fz>0) ? (p.ac/p.fz) : 0.5;
  if(tipo==='QUESTOES') return [pr,acc,dm,st,t.it];
  return [pr,st,dm,acc,t.it];
}
function cmpArr(a,b){ for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) return a[i]<b[i]?-1:1; } return 0; }
function leiDoTopico(tid){
  const m=DADOS.legislacao.topicos[tid];
  if(m) return m.map(([c,arts])=>({code:c, nome:(DADOS.legislacao.fontes[c]||[c,''])[0], url:(DADOS.legislacao.fontes[c]||['',''])[1], arts:arts}));
  if(DADOS.legislacao.sem_dispositivo.indexOf(tid)>=0) return [{sem:true}];
  return [];
}
function pesosDeConteudoDisponivel(d,inicio){
  const ativos=Object.keys(d.pg).filter(g=>d.pg[g]>0);
  const contagem={}; ativos.forEach(g=>{contagem[g]=poolQuestoes({grupo:g}).length;});
  const temas=DADOS.temas_discursivos.concat(S.disc.temas||[]);
  const devidas=Object.values(S.revisoes).some(r=>r.prox<=addDays(inicio,d.horizonte));
  const disponivel={
    LEITURA:ativos.every(g=>DADOS.programa.some(t=>t.g===g)),
    QUESTOES:ativos.every(g=>(contagem[g]||0)>0),
    JURISPRUDENCIA:Array.isArray(DADOS.precedentes)&&DADOS.precedentes.length>0,
    REVISAO:devidas,
    DISCURSIVA:ativos.every(g=>temas.some(t=>t.g===g)),
    SIMULADO:ativos.every(g=>(contagem[g]||0)>=25)
  };
  const motivos={
    QUESTOES:'não há questões em todos os grupos selecionados',
    JURISPRUDENCIA:'a base atual de jurisprudência está vazia',
    REVISAO:'não há revisões previstas no horizonte deste ciclo',
    DISCURSIVA:'não há temas discursivos para todos os grupos selecionados',
    SIMULADO:'é necessário ter ao menos 25 questões em cada grupo selecionado'
  };
  const base={}; Object.keys(d.pc).forEach(k=>{base[k]=disponivel[k]===false?0:d.pc[k];});
  let soma=Object.values(base).reduce((a,b)=>a+b,0);
  if(!soma){ base.LEITURA=100; soma=100; }
  const pesos={}, fracoes=[]; let inteiro=0;
  Object.keys(base).forEach(k=>{
    const bruto=base[k]*100/soma; pesos[k]=Math.floor(bruto); inteiro+=pesos[k];
    fracoes.push([k,bruto-pesos[k]]);
  });
  fracoes.sort((a,b)=>b[1]-a[1]);
  for(let i=0;i<100-inteiro;i++) pesos[fracoes[i%fracoes.length][0]]++;
  const ajustes=Object.keys(d.pc).filter(k=>d.pc[k]>0&&pesos[k]===0).map(k=>`${TIPOS[k]}: ${motivos[k]||'conteúdo indisponível'}`);
  return {pesos,ajustes};
}
function gerarCiclo(){
  const d=S.diag, inicio=hoje();
  const conteudo=pesosDeConteudoDisponivel(d,inicio);
  const dias=[]; const alocC={}, alocG={};
  Object.keys(conteudo.pesos).forEach(k=>alocC[k]=0); Object.keys(d.pg).forEach(k=>alocG[k]=0);
  const porGrupo={}; ['I','II','III','IV'].forEach(g=>{ porGrupo[g]=DADOS.programa.filter(t=>t.g===g); });
  const topicosComQuestoes=new Set(bancoQuestoes().map(q=>q.t).filter(Boolean));
  const usados={};
  const devidas=Object.entries(S.revisoes).filter(([,r])=>r.prox<=addDays(inicio,d.horizonte)).map(([k])=>k);
  let devIdx=0;
  for(let i=0;i<d.horizonte;i++){
    const data=addDays(inicio,i); const dw=DIAS[parseISO(data).getDay()];
    const min=d.minutos[dw]||0; const nb=Math.floor(min/d.bloco);
    const blocos=[];
    for(let b=0;b<nb;b++){
      const tipo=pesoEscolha(conteudo.pesos,alocC); if(!tipo) break;
      alocC[tipo]+=d.bloco;
      const grupo=pesoEscolha(d.pg,alocG); alocG[grupo]+=d.bloco;
      const bl={id:uid(),data,tipo,grupo,min:d.bloco,st:'PENDENTE'};
      if(tipo==='REVISAO' && devidas.length){
        const tid=devidas[devIdx++%devidas.length]; const t=DADOS.programa.find(x=>x.id===tid);
        if(t){ bl.tid=t.id; bl.grupo=t.g; bl.tit=t.to; bl.disc=t.di;
               bl.why=`Revisão vencida em ${fmtBR((S.revisoes[tid]||{}).prox||data)}.`; bl.lei=leiDoTopico(t.id); }
      } else if(tipo==='JURISPRUDENCIA'){
        bl.tit='Informativos e precedentes'; bl.why='Bloco fixo de jurisprudência conforme peso do diagnóstico.';
      } else if(tipo==='DISCURSIVA'){
        const tema=(S.disc.temas.concat(DADOS.temas_discursivos)).filter(x=>x.g===grupo);
        bl.tit = tema.length? tema[i%tema.length].tit : 'Treino discursivo livre';
        bl.why='Segunda etapa tem peso 4 na nota final (art. 60, II).';
      } else if(tipo==='SIMULADO'){
        bl.tit=`Simulado do Grupo ${grupo} — 25 questões`; bl.why='Simulação no formato do art. 42 da Resolução nº 344/2025.';
      } else {
        const base=porGrupo[grupo].filter(t=>tipo!=='QUESTOES'||topicosComQuestoes.has(t.id));
        const cand=base.filter(t=>!usados[tipo+'|'+t.id]);
        const lista=(cand.length?cand:base).slice().sort((a,b)=>cmpArr(scoreTopico(a,tipo),scoreTopico(b,tipo)));
        const t=lista[0];
        if(t){ usados[tipo+'|'+t.id]=1; bl.tid=t.id; bl.tit=t.to; bl.disc=t.di; bl.item=t.it;
          const p=S.topicos[t.id]||{};
          const razoes=[];
          if(p.pr==='ALTA')razoes.push('prioridade alta');
          if((p.st||'NAO_INICIADO')==='NAO_INICIADO')razoes.push('ainda não iniciado');
          if(p.fz>0 && p.ac/p.fz<0.7) razoes.push(`acurácia de ${pct(p.ac,p.fz)}%`);
          if((p.dm||0)<=2 && (p.st||'')!=='NAO_INICIADO') razoes.push(`domínio ${p.dm||0}/5`);
          bl.why = razoes.length? ('Selecionado por '+razoes.join(', ')+'.') : 'Sequência programática do Anexo I.';
          bl.lei=leiDoTopico(t.id);
        }
      }
      blocos.push(bl);
    }
    dias.push({data,dw,min,blocos});
  }
  if(S.ciclo) S.ciclosAnteriores.push(JSON.parse(JSON.stringify(S.ciclo)));
  S.ciclo={gerado:new Date().toISOString(), inicio, horizonte:d.horizonte, pesosConteudo:conteudo.pesos, ajustes:conteudo.ajustes, dias};
  S.ui.semana=0; salvar();
}
function semanasDoCiclo(){
  if(!S.ciclo) return [];
  const out=[]; let cur=null;
  S.ciclo.dias.forEach(d=>{
    const dow=parseISO(d.data).getDay();
    if(!cur || dow===1){ cur={dias:[]}; out.push(cur); }
    cur.dias.push(d);
  });
  return out;
}

/* ---------------------------------------------------------------- render: navegação */
const VIEWS=[
  ['painel','Painel'],['programa','Programa'],['cronograma','Cronograma'],['questoes','Questões'],
  ['simulados','Simulados'],['discursivas','Discursivas'],['revisoes','Revisões'],
  ['juris','Jurisprudência'],['dados','Dados']
];
let atual='painel';
function nav(){
  const n=$('#tabs'); n.innerHTML='';
  VIEWS.forEach(([k,l])=>{ n.appendChild(el('button',{class:atual===k?'on':'',onclick:()=>go(k)},esc(l))); });
}
function go(k){ atual=k; nav(); render(); window.scrollTo({top:0,behavior:'instant'}); }
function render(){
  const m=$('#main'); m.innerHTML='';
  ({painel:vPainel,programa:vPrograma,cronograma:vCronograma,questoes:vQuestoes,simulados:vSimulados,
    discursivas:vDiscursivas,revisoes:vRevisoes,juris:vJuris,dados:vDados}[atual]||vPainel)(m);
  $('#chipProva').textContent = `Prova: ${fmtBR(S.prova.data)}${S.prova.confirmada?'':' (estimada)'}`;
  $('#chipBanca').textContent = `Banca: ${DADOS.meta.banca}`;
}

/* ---------------------------------------------------------------- view: painel */
function vPainel(m){
  const k=metricas(); const dias=diasEntre(hoje(),S.prova.data);
  const grid=el('div',{class:'grid g4'});
  const st=(kk,v,s)=>{ const c=el('div',{class:'stat'}); c.appendChild(el('div',{class:'k'},esc(kk))); c.appendChild(el('div',{class:'v'},v)); if(s)c.appendChild(el('div',{class:'s'},s)); return c; };
  grid.appendChild(st('Dias para a prova', dias>=0?dias:'—', S.prova.confirmada?'data confirmada':'estimativa editável'));
  grid.appendChild(st('Cobertura do programa', k.cobertura+'%', `${k.ini} de ${k.total} tópicos iniciados`));
  grid.appendChild(st('Questões respondidas', k.feitas, k.acc!=null?`acurácia de ${Math.round(k.acc*100)}%`:'sem dados ainda'));
  grid.appendChild(st('Revisões vencidas', k.devidas, k.devidas?'há fila para hoje':'em dia'));
  m.appendChild(grid);

  // desempenho por grupo com peso oficial
  const c1=el('div',{class:'card'});
  c1.appendChild(el('h2',null,'Desempenho por grupo objetivo'));
  c1.appendChild(el('p',null,'<small>Cada grupo vale 25 questões na prova objetiva (art. 42 da Resolução nº 344/2025). O peso é igual, mas a massa de conteúdo não — a coluna de tópicos mostra a densidade real.</small>'));
  const tb=el('table'); tb.innerHTML='<thead><tr><th>Grupo</th><th>Disciplinas</th><th>Tópicos</th><th>Iniciados</th><th>Questões</th><th>Acurácia</th></tr></thead>';
  const tbody=el('tbody');
  ['I','II','III','IV'].forEach(g=>{
    const d=k.porG[g]||{t:0,i:0,f:0,a:0};
    const ds=Array.from(new Set(DADOS.programa.filter(t=>t.g===g).map(t=>t.di))).join(', ');
    tbody.appendChild(el('tr',null,`<td><span class="tag g-${g}">Grupo ${g}</span></td><td><small>${esc(ds)}</small></td><td>${d.t}</td><td>${d.i} <small>(${pct(d.i,d.t)}%)</small></td><td>${d.f}</td><td>${d.f?pct(d.a,d.f)+'%':'—'}</td>`));
  });
  tb.appendChild(tbody); c1.appendChild(tb); m.appendChild(c1);

  // pesos das etapas
  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Onde a nota é decidida'));
  c2.appendChild(el('p',null,'<small>Ponderação do art. 60 da Resolução nº 344/2025. A segunda etapa vale o dobro da objetiva.</small>'));
  const et=el('table'); et.innerHTML='<thead><tr><th>Etapa</th><th>Peso</th><th>Corte</th><th>Seu registro</th></tr></thead>';
  const tent=S.disc.tentativas.filter(t=>t.fim);
  const eb=el('tbody');
  eb.innerHTML=`
  <tr><td>1ª — Objetiva (100 questões, A–E)</td><td><b>2</b></td><td>≥ 6,00 e até 400ª posição (art. 43)</td><td>${k.ultSim?nf(notaObjetiva(k.ultSim))+' no último simulado':'—'}</td></tr>
  <tr><td>2ª — Discursivas (2 questões de 30 linhas + peça de 120 linhas)</td><td><b>4</b></td><td>Média ≥ 6,00 e ≥ 5,00 por grupo (art. 47)</td><td>${tent.length?tent.length+' tentativa(s)':'—'}</td></tr>
  <tr><td>4ª — Oral (7 disciplinas do art. 56)</td><td><b>2</b></td><td>≥ 6,00 (art. 57)</td><td>—</td></tr>
  <tr><td>5ª — Títulos</td><td><b>1</b></td><td>classificatória</td><td>—</td></tr>`;
  et.appendChild(eb); c2.appendChild(et);
  c2.appendChild(el('div',{class:'note'},'Disciplinas que caem na prova oral (art. 56): Constitucional, Consumidor, Criança e Adolescente, Penal, Processual Penal, Civil e Processual Civil. Administrativo, Execução Penal, Direitos Humanos, Difusos e Coletivos e Princípios Institucionais não caem na oral.'));
  m.appendChild(c2);

  // hoje
  const c3=el('div',{class:'card'});
  c3.appendChild(el('h2',null,'Hoje'));
  const dh=S.ciclo? S.ciclo.dias.find(d=>d.data===hoje()) : null;
  if(!S.ciclo){ c3.appendChild(el('div',{class:'empty'},'<b>Nenhum ciclo gerado</b>Preencha o diagnóstico no Cronograma e gere seu primeiro ciclo de estudo.')); c3.appendChild(el('button',{class:'btn',onclick:()=>go('cronograma')},'Ir para o cronograma')); }
  else if(!dh || !dh.blocos.length){ c3.appendChild(el('p',null,'Sem carga prevista para hoje neste ciclo.')); }
  else { dh.blocos.forEach(b=>c3.appendChild(blocoCard(b))); }
  m.appendChild(c3);

  // piores disciplinas
  const piores=Object.entries(k.porD).filter(([,d])=>d.f>=5).map(([c,d])=>({c,...d,acc:d.a/d.f})).sort((a,b)=>a.acc-b.acc).slice(0,5);
  if(piores.length){
    const c4=el('div',{class:'card'}); c4.appendChild(el('h2',null,'Disciplinas com menor acurácia'));
    const ul=el('ul',{class:'clean'});
    piores.forEach(p=>ul.appendChild(el('li',null,`<b>${esc(p.nome)}</b> — ${Math.round(p.acc*100)}% em ${p.f} questões <span class="tag g-${p.g}">Grupo ${p.g}</span>`)));
    c4.appendChild(ul); m.appendChild(c4);
  }
}
function blocoCard(b,onChange){
  const d=el('div',{class:'blk'+(b.st==='CONCLUIDO'?' done':'')+(b.st==='PULADO'?' skip':'')});
  const t=el('div',{class:'bt'});
  t.appendChild(el('span',{class:'tag pur'},esc(TIPOS[b.tipo]||b.tipo)));
  if(b.grupo) t.appendChild(el('span',{class:'tag g-'+b.grupo},'Grupo '+b.grupo));
  t.appendChild(el('span',{class:'tag'},b.min+' min'));
  if(b.disc) t.appendChild(el('span',{class:'tag'},esc(b.disc)));
  d.appendChild(t);
  d.appendChild(el('div',null,'<b>'+esc(b.tit||'Bloco de estudo')+'</b>'));
  if(b.why) d.appendChild(el('div',{class:'why'},esc(b.why)));
  if(b.lei && b.lei.length){
    const L=el('div',{class:'lei'});
    if(b.lei[0].sem) L.innerHTML='<b>Leitura legislativa:</b> sem faixa específica — tema predominantemente doutrinário, jurisprudencial ou internacional.';
    else L.innerHTML='<b>Leitura legislativa:</b> '+b.lei.map(x=>`${esc(x.nome)} — ${esc(x.arts)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">texto oficial</a>`:''}`).join(' · ');
    d.appendChild(L);
  }
  const acts=el('div',{class:'row'});
  if(b.st!=='CONCLUIDO') acts.appendChild(el('button',{class:'btn sm',onclick:()=>{b.st='CONCLUIDO'; if(b.tid){const p=S.topicos[b.tid]; if(p&&p.st==='NAO_INICIADO')p.st='EM_ESTUDO'; garanteRevisao(b.tid);} salvar(); onChange?onChange():render();}},'Concluir'));
  if(b.st==='PENDENTE') acts.appendChild(el('button',{class:'btn gho sm',onclick:()=>{b.st='PULADO'; salvar(); onChange?onChange():render();}},'Pular'));
  if(b.st!=='PENDENTE') acts.appendChild(el('button',{class:'btn gho sm',onclick:()=>{b.st='PENDENTE'; salvar(); onChange?onChange():render();}},'Reabrir'));
  if(b.tipo==='QUESTOES'&&b.tid) acts.appendChild(el('button',{class:'btn sec sm',onclick:()=>{iniciarSessao('PRATICA',{topico:b.tid},10);}},'Praticar este tópico'));
  if(b.tipo==='SIMULADO'&&b.grupo) acts.appendChild(el('button',{class:'btn sec sm',onclick:()=>{iniciarSessao('SIMULADO_GRUPO',{grupo:b.grupo},25);}},'Abrir simulado'));
  d.appendChild(acts);
  return d;
}

/* ---------------------------------------------------------------- view: programa */
let fProg={g:'',d:'',st:'',q:''};
function vPrograma(m){
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Programa verticalizado — Anexo I da Resolução nº 344/2025'));
  c.appendChild(el('p',null,`<small>${DADOS.programa.length} tópicos, 12 disciplinas, 4 grupos objetivos de 25 questões cada.</small>`));
  const r=el('div',{class:'row'});
  const selG=el('select'); selG.innerHTML='<option value="">Todos os grupos</option>'+['I','II','III','IV'].map(g=>`<option ${fProg.g===g?'selected':''}>${g}</option>`).join('');
  selG.onchange=()=>{fProg.g=selG.value; fProg.d=''; render();};
  const discs=Array.from(new Set(DADOS.programa.filter(t=>!fProg.g||t.g===fProg.g).map(t=>t.dc+'|'+t.di)));
  const selD=el('select'); selD.innerHTML='<option value="">Todas as disciplinas</option>'+discs.map(x=>{const [c2,n]=x.split('|'); return `<option value="${c2}" ${fProg.d===c2?'selected':''}>${esc(n)}</option>`;}).join('');
  selD.onchange=()=>{fProg.d=selD.value; render();};
  const selS=el('select'); selS.innerHTML=['','NAO_INICIADO','EM_ESTUDO','REVISAO','CONSOLIDADO'].map(s=>`<option value="${s}" ${fProg.st===s?'selected':''}>${s?s.replace('_',' '):'Todas as situações'}</option>`).join('');
  selS.onchange=()=>{fProg.st=selS.value; render();};
  const inp=el('input',{placeholder:'Buscar no texto do tópico...',value:fProg.q});
  inp.oninput=()=>{fProg.q=inp.value; clearTimeout(inp._t); inp._t=setTimeout(render,280);};
  [selG,selD,selS].forEach(x=>{x.style.maxWidth='210px'; r.appendChild(x);});
  inp.style.maxWidth='280px'; r.appendChild(inp);
  c.appendChild(r); m.appendChild(c);

  const lista=DADOS.programa.filter(t=>{
    if(fProg.g&&t.g!==fProg.g) return false;
    if(fProg.d&&t.dc!==fProg.d) return false;
    const p=S.topicos[t.id]||{};
    if(fProg.st&&(p.st||'NAO_INICIADO')!==fProg.st) return false;
    if(fProg.q&&t.to.toLowerCase().indexOf(fProg.q.toLowerCase())<0) return false;
    return true;
  });
  const c2=el('div',{class:'card pad0'});
  const head=el('div',{class:'row'},''); head.style.padding='12px 16px';
  head.appendChild(el('div',null,`<b>${lista.length}</b> tópico(s)`));
  c2.appendChild(head);
  const wrap=el('div'); wrap.style.maxHeight='68vh'; wrap.style.overflow='auto';
  const tb=el('table');
  tb.innerHTML='<thead><tr><th>#</th><th>Tópico</th><th>Situação</th><th>Prior.</th><th>Domínio</th><th>Questões</th><th></th></tr></thead>';
  const tbody=el('tbody');
  lista.slice(0,600).forEach(t=>{
    const p=S.topicos[t.id]||{};
    const tr=el('tr');
    tr.appendChild(el('td',null,`<span class="tag g-${t.g}">${t.g}</span><br><small>${t.it}</small>`));
    tr.appendChild(el('td',null,`<div><b>${esc(t.di)}</b></div><div style="max-width:520px"><small>${esc(t.to.length>190?t.to.slice(0,190)+'…':t.to)}</small></div>`));
    const tdS=el('td'); const sS=el('select'); sS.innerHTML=['NAO_INICIADO','EM_ESTUDO','REVISAO','CONSOLIDADO'].map(s=>`<option ${((p.st||'NAO_INICIADO')===s)?'selected':''}>${s.replace('_',' ')}</option>`).join('');
    sS.onchange=()=>{p.st=sS.value.replace(' ','_'); if(p.st!=='NAO_INICIADO')garanteRevisao(t.id); salvar();}; sS.style.minWidth='130px'; tdS.appendChild(sS); tr.appendChild(tdS);
    const tdP=el('td'); const sP=el('select'); sP.innerHTML=['ALTA','MEDIA','BAIXA'].map(s=>`<option ${((p.pr||'MEDIA')===s)?'selected':''}>${s}</option>`).join('');
    sP.onchange=()=>{p.pr=sP.value; salvar();}; tdP.appendChild(sP); tr.appendChild(tdP);
    const tdD=el('td'); const sD=el('select'); sD.innerHTML=[0,1,2,3,4,5].map(s=>`<option ${((p.dm||0)===s)?'selected':''}>${s}</option>`).join('');
    sD.onchange=()=>{p.dm=+sD.value; salvar();}; tdD.appendChild(sD); tr.appendChild(tdD);
    const nq=bancoQuestoes().filter(q=>q.t===t.id).length;
    tr.appendChild(el('td',null,`${p.fz||0}/${p.ac||0} <small>ac.</small><br><small>${nq} no banco</small>`));
    const tdA=el('td');
    if(nq) tdA.appendChild(el('button',{class:'btn sm sec',onclick:()=>iniciarSessao('PRATICA',{topico:t.id},Math.min(nq,10))},'Praticar'));
    tdA.appendChild(el('button',{class:'btn gho sm',onclick:()=>abrirTopico(t)},'Detalhe'));
    tr.appendChild(tdA);
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody); wrap.appendChild(tb); c2.appendChild(wrap);
  if(lista.length>600) c2.appendChild(el('div',{class:'note'},'Exibindo os primeiros 600 resultados. Refine os filtros.'));
  m.appendChild(c2);
}
function abrirTopico(t){
  const p=S.topicos[t.id]||{}; const lei=leiDoTopico(t.id);
  const bd=el('div',{class:'modal',onclick:e=>{if(e.target===bd)bd.remove();}});
  const inn=el('div',{class:'in'});
  inn.appendChild(el('div',{class:'row'},`<span class="tag g-${t.g}">Grupo ${t.g}</span><span class="tag">${esc(t.di)}</span><span class="tag">item ${t.it}</span>`));
  inn.appendChild(el('h2',null,esc(t.di)+' — '+t.it));
  inn.appendChild(el('p',null,esc(t.to)));
  const L=el('div',{class:'lei'});
  if(!lei.length) L.innerHTML='<b>Leitura legislativa:</b> mapeamento ainda não definido.';
  else if(lei[0].sem) L.innerHTML='<b>Leitura legislativa:</b> sem faixa específica — tema predominantemente doutrinário, jurisprudencial ou internacional.';
  else L.innerHTML='<b>Leitura legislativa:</b> '+lei.map(x=>`${esc(x.nome)} — ${esc(x.arts)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">texto oficial</a>`:''}`).join('<br>');
  inn.appendChild(L);
  inn.appendChild(el('div',{class:'hr'}));
  inn.appendChild(el('label',{class:'f'},'Anotações'));
  const ta=el('textarea',{placeholder:'Suas anotações sobre este tópico...'}); ta.value=p.nt||'';
  ta.oninput=()=>{p.nt=ta.value; salvar();};
  inn.appendChild(ta);
  inn.appendChild(el('p',null,`<small>Fonte: ${esc(DADOS.meta.resolucao)}, p. ${t.pg||'—'} · <a href="${esc(t.url||DADOS.meta.resolucao_url)}" target="_blank" rel="noopener">documento oficial</a></small>`));
  const r=el('div',{class:'row'});
  r.appendChild(el('button',{class:'btn',onclick:()=>bd.remove()},'Fechar'));
  inn.appendChild(r); bd.appendChild(inn); document.body.appendChild(bd);
}

/* ---------------------------------------------------------------- view: cronograma */
function vCronograma(m){
  const d=S.diag;
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Diagnóstico'));
  const g=el('div',{class:'grid g3'});
  DIAS.forEach((k,i)=>{
    const b=el('div'); b.appendChild(el('label',{class:'f'},DIAS_L[i]+' (min)'));
    const inp=el('input',{type:'number',min:0,max:720,step:10,value:d.minutos[k]});
    inp.onchange=()=>{d.minutos[k]=clamp(+inp.value||0,0,720); salvar();};
    b.appendChild(inp); g.appendChild(b);
  });
  const b1=el('div'); b1.appendChild(el('label',{class:'f'},'Nível'));
  const sn=el('select'); sn.innerHTML=['INICIANTE','INTERMEDIARIO','AVANCADO'].map(x=>`<option ${d.nivel===x?'selected':''}>${x}</option>`).join('');
  sn.onchange=()=>{d.nivel=sn.value; salvar();}; b1.appendChild(sn); g.appendChild(b1);
  const b2=el('div'); b2.appendChild(el('label',{class:'f'},'Duração do bloco (min)'));
  const ib=el('input',{type:'number',min:20,max:120,step:5,value:d.bloco}); ib.onchange=()=>{d.bloco=clamp(+ib.value||50,20,120); salvar();}; b2.appendChild(ib); g.appendChild(b2);
  const b3=el('div'); b3.appendChild(el('label',{class:'f'},'Horizonte do ciclo (dias)'));
  const ih=el('input',{type:'number',min:7,max:84,step:7,value:d.horizonte}); ih.onchange=()=>{d.horizonte=clamp(+ih.value||28,7,84); salvar();}; b3.appendChild(ih); g.appendChild(b3);
  c.appendChild(g);

  const pesos=(titulo,obj,key)=>{
    const w=el('div'); w.appendChild(el('h3',null,titulo));
    const gg=el('div',{class:'grid g4'});
    Object.keys(obj).forEach(k=>{
      const b=el('div'); b.appendChild(el('label',{class:'f'},k==='I'||k==='II'||k==='III'||k==='IV'?('Grupo '+k):(TIPOS[k]||k)));
      const inp=el('input',{type:'number',min:0,max:100,value:obj[k]});
      inp.onchange=()=>{obj[k]=clamp(+inp.value||0,0,100); salvar(); render();};
      b.appendChild(inp); gg.appendChild(b);
    });
    w.appendChild(gg);
    const soma=Object.values(obj).reduce((a,b)=>a+b,0);
    w.appendChild(el('div',{class:'note'},`Soma: ${soma}%${soma!==100?' — precisa somar exatamente 100% para gerar o ciclo.':' ✓'}`));
    return w;
  };
  c.appendChild(el('div',{class:'hr'}));
  c.appendChild(pesos('Foco entre os grupos objetivos',d.pg));
  c.appendChild(el('div',{class:'note'},'Cada grupo vale 25 das 100 questões (art. 42). Manter 25/25/25/25 espelha o peso oficial da prova.'));
  c.appendChild(pesos('Divisão por tipo de conteúdo',d.pc));
  const somaG=Object.values(d.pg).reduce((a,b)=>a+b,0), somaC=Object.values(d.pc).reduce((a,b)=>a+b,0);
  const ok = somaG===100 && somaC===100 && Object.values(d.minutos).reduce((a,b)=>a+b,0)>=60;
  const rr=el('div',{class:'row'});
  const bg=el('button',{class:'btn',onclick:()=>{ gerarCiclo(); toast('Ciclo gerado. O anterior foi preservado no histórico.'); render(); }},'Gerar novo ciclo');
  if(!ok) bg.disabled=true;
  rr.appendChild(bg);
  if(!ok) rr.appendChild(el('small',null,'Ajuste os pesos para 100% e garanta ao menos 60 minutos por semana.'));
  c.appendChild(rr);
  m.appendChild(c);

  if(!S.ciclo){ m.appendChild(el('div',{class:'card'},'<div class="empty"><b>Nenhum ciclo ativo</b>Gere o primeiro ciclo acima. O plano cobre de 7 a 84 dias e pode ser regerado a qualquer momento sem apagar o histórico.</div>')); return; }

  const sems=semanasDoCiclo();
  const cc=el('div',{class:'card'});
  const tot=S.ciclo.dias.reduce((a,d2)=>a+d2.blocos.length,0);
  const feitos=S.ciclo.dias.reduce((a,d2)=>a+d2.blocos.filter(b=>b.st==='CONCLUIDO').length,0);
  cc.appendChild(el('h2',null,`Ciclo de ${S.ciclo.horizonte} dias — ${feitos}/${tot} blocos concluídos`));
  cc.appendChild(el('div',{class:'bar'},`<i style="width:${pct(feitos,tot)}%"></i>`));
  cc.appendChild(el('p',null,`<small>Gerado em ${fmtBR(S.ciclo.inicio)}. ${S.ciclosAnteriores.length} ciclo(s) anterior(es) preservado(s) no histórico.</small>`));
  if(S.ciclo.ajustes&&S.ciclo.ajustes.length){
    cc.appendChild(el('div',{class:'note'},`O ciclo redistribuiu automaticamente pesos sem conteúdo disponível: ${esc(S.ciclo.ajustes.join('; '))}. Seus pesos do diagnóstico não foram alterados.`));
  }
  const wk=el('div',{class:'wk'});
  sems.forEach((s,i)=>{ wk.appendChild(el('button',{class:S.ui.semana===i?'on':'',onclick:()=>{S.ui.semana=i; salvar(); render();}},`Sem ${i+1}`)); });
  cc.appendChild(wk);
  const sem=sems[clamp(S.ui.semana,0,sems.length-1)]||sems[0];
  const minSem=sem.dias.reduce((a,d2)=>a+d2.min,0), blSem=sem.dias.reduce((a,d2)=>a+d2.blocos.length,0);
  const okSem=sem.dias.reduce((a,d2)=>a+d2.blocos.filter(b=>b.st==='CONCLUIDO').length,0);
  cc.appendChild(el('div',{class:'row'},`<span class="pill">${fmtBR(sem.dias[0].data)} → ${fmtBR(sem.dias[sem.dias.length-1].data)}</span><span class="pill">${blSem} blocos</span><span class="pill">${Math.round(minSem/60)}h previstas</span><span class="pill">${pct(okSem,blSem)}% concluído</span>`));
  m.appendChild(cc);

  sem.dias.forEach(d2=>{
    const dd=el('div',{class:'day'+(d2.min===0?' zero':'')});
    const dh=el('div',{class:'dh'});
    dh.appendChild(el('b',null,DIAS_L[parseISO(d2.data).getDay()]+', '+fmtBR(d2.data)));
    dh.appendChild(el('span',{class:'tag'},d2.min+' min'));
    if(d2.data===hoje()) dh.appendChild(el('span',{class:'tag ok'},'hoje'));
    dd.appendChild(dh);
    if(!d2.blocos.length) dd.appendChild(el('div',{class:'note'},'Sem carga prevista neste dia.'));
    d2.blocos.forEach(b=>dd.appendChild(blocoCard(b)));
    m.appendChild(dd);
  });
}

/* ---------------------------------------------------------------- sessões de questões */
function iniciarSessao(tipo,filtro,n){
  let qs=[];
  if(tipo==='SIMULADO_COMPLETO'){ ['I','II','III','IV'].forEach(g=>{ qs=qs.concat(selecionarSimuladoGrupo(g,25)); }); }
  else if(tipo==='SIMULADO_GRUPO'){ qs=selecionarSimuladoGrupo(filtro.grupo,25); }
  else { qs=selecionar(n,filtro); }
  if(!qs.length){ toast('Não há questões no banco para esse filtro.'); return; }
  if((tipo==='SIMULADO_GRUPO'&&qs.length<25)||(tipo==='SIMULADO_COMPLETO'&&qs.length<100)){
    if(!confirm(`O banco tem ${qs.length} questões disponíveis para este simulado, menos que o ideal. Abrir mesmo assim?`)) return;
  }
  S.sessaoAtiva={id:uid(),tipo,filtro:filtro||{},inicio:new Date().toISOString(),fim:null,idx:0,
    questionBankVersion:CONTENT_MANIFEST.questionBankVersion,
    itens:qs.map(q=>({q:q.id,snapshot:snapshotQuestao(q),resp:null,certo:null,conf:null,t0:null,dt:0}))};
  salvar(); go('questoes');
}
function vQuestoes(m){
  if(S.sessaoAtiva){ return sessaoUI(m); }
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Prática dirigida'));
  const banco=bancoQuestoes();
  c.appendChild(el('p',null,`<small>Banco com <b>${banco.length}</b> questões autorais referenciadas, adaptadas ao perfil CEBRASPE e ao formato previsto no art. 41 (cinco alternativas, uma correta). Não são questões oficiais da banca; confira a fonte indicada antes de consolidar a matéria.</small>`));
  const g=el('div',{class:'grid g3'});
  const bg=el('div'); bg.appendChild(el('label',{class:'f'},'Grupo'));
  const sg=el('select'); sg.innerHTML='<option value="">Todos</option>'+['I','II','III','IV'].map(x=>`<option>${x}</option>`).join(''); bg.appendChild(sg); g.appendChild(bg);
  const bd=el('div'); bd.appendChild(el('label',{class:'f'},'Disciplina'));
  const sd=el('select'); bd.appendChild(sd); g.appendChild(bd);
  const bn=el('div'); bn.appendChild(el('label',{class:'f'},'Nível'));
  const sn=el('select'); sn.innerHTML='<option value="">Todos</option><option value="facil">Fácil</option><option value="medio">Médio</option><option value="dificil">Difícil</option>'; bn.appendChild(sn); g.appendChild(bn);
  const bq=el('div'); bq.appendChild(el('label',{class:'f'},'Quantidade'));
  const iq=el('input',{type:'number',min:1,max:100,value:10}); bq.appendChild(iq); g.appendChild(bq);
  function refreshD(){
    const ds=Array.from(new Set(banco.filter(q=>!sg.value||q.g===sg.value).map(q=>q.d)));
    sd.innerHTML='<option value="">Todas</option>'+ds.map(d=>`<option value="${d}">${esc(discNome(d))}</option>`).join('');
    upd();
  }
  const info=el('div',{class:'note'});
  function upd(){
    const f={grupo:sg.value||null,disc:sd.value||null,nivel:sn.value||null};
    const pool=poolQuestoes(f);
    const ined=pool.filter(q=>!S.exposicao[q.id]).length;
    info.textContent=`${pool.length} questão(ões) no filtro · ${ined} ainda não respondida(s). A seleção prioriza inéditas, depois as que você errou, respeitando ${COOLDOWN} dias de intervalo antes de repetir.`;
    iq.max=Math.max(1,pool.length);
  }
  sg.onchange=refreshD; sd.onchange=upd; sn.onchange=upd; refreshD();
  c.appendChild(g); c.appendChild(info);
  c.appendChild(el('button',{class:'btn',onclick:()=>iniciarSessao('PRATICA',{grupo:sg.value||null,disc:sd.value||null,nivel:sn.value||null},clamp(+iq.value||10,1,100))},'Iniciar prática'));
  m.appendChild(c);

  // histórico
  const hs=S.sessoes.slice().reverse().slice(0,25);
  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Sessões recentes'));
  if(!hs.length) c2.appendChild(el('div',{class:'empty'},'<b>Nenhuma sessão ainda</b>Suas práticas e simulados aparecem aqui com nota e tempo.'));
  else{
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Data</th><th>Tipo</th><th>Itens</th><th>Acertos</th><th>Nota</th><th>Tempo</th><th></th></tr></thead>';
    const tbody=el('tbody');
    hs.forEach(s=>{
      const certos=s.itens.filter(i=>i.certo).length;
      const tempo=Math.round(s.itens.reduce((a,i)=>a+(i.dt||0),0)/60);
      const tr=el('tr',null,`<td>${fmtBR(s.inicio.slice(0,10))}</td><td>${esc(s.tipo.replace(/_/g,' '))}</td><td>${s.itens.length}</td><td>${certos} <small>(${pct(certos,s.itens.length)}%)</small></td><td>${s.tipo!=='PRATICA'?nf(notaObjetiva(s)):'—'}</td><td>${tempo} min</td>`);
      const td=el('td'); td.appendChild(el('button',{class:'btn gho sm',onclick:()=>revisarSessao(s)},'Rever')); tr.appendChild(td);
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); c2.appendChild(tb);
  }
  m.appendChild(c2);
}
function vSimulados(m){
  if(S.sessaoAtiva){ return sessaoUI(m); }
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Simulados no formato oficial'));
  c.appendChild(el('p',null,'<small>Art. 40: 100 questões, 0,10 ponto cada, 5 horas de duração. Art. 42: quatro grupos de 25 questões. Art. 43: habilitação com nota ≥ 6,00 e classificação até a 400ª posição.</small>'));
  const g=el('div',{class:'grid g2'});
  ['I','II','III','IV'].forEach(gr=>{
    const pool=poolQuestoes({grupo:gr});
    const ds=Array.from(new Set(DADOS.programa.filter(t=>t.g===gr).map(t=>t.di))).join(' · ');
    const b=el('div',{class:'stat'});
    b.appendChild(el('div',{class:'row'},`<span class="tag g-${gr}">Grupo ${gr}</span><span class="tag">${pool.length} questões no banco</span>`));
    b.appendChild(el('div',null,`<small>${esc(ds)}</small>`));
    const bt=el('button',{class:'btn sm',onclick:()=>iniciarSessao('SIMULADO_GRUPO',{grupo:gr},25)},'Simulado de 25 questões');
    bt.style.marginTop='9px'; if(pool.length<25) bt.className='btn sm sec';
    b.appendChild(bt);
    g.appendChild(b);
  });
  c.appendChild(g);
  c.appendChild(el('div',{class:'hr'}));
  const total=bancoQuestoes().length;
  const podeCompleto=['I','II','III','IV'].every(gr=>poolQuestoes({grupo:gr}).length>=25);
  const bc=el('button',{class:'btn',onclick:()=>iniciarSessao('SIMULADO_COMPLETO',{},100)},'Simulado completo — 100 questões');
  if(!podeCompleto) bc.disabled=true;
  c.appendChild(bc);
  c.appendChild(el('div',{class:'note'},podeCompleto?`Banco atual: ${total} questões. O simulado completo sorteia 25 por grupo, distribuídas proporcionalmente entre as disciplinas.`:'É preciso ao menos 25 questões em cada grupo. Importe mais questões na aba Dados.'));
  m.appendChild(c);

  const sims=S.sessoes.filter(s=>s.tipo!=='PRATICA'&&s.fim);
  if(sims.length){
    const c2=el('div',{class:'card'});
    c2.appendChild(el('h2',null,'Evolução nos simulados'));
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Data</th><th>Tipo</th><th>Nota (0–10)</th><th>Acertos</th><th>Corte 6,00</th></tr></thead>';
    const tbody=el('tbody');
    sims.slice().reverse().forEach(s=>{
      const nota=notaObjetiva(s), certos=s.itens.filter(i=>i.certo).length;
      const escala=s.itens.length===100?nota:(certos/s.itens.length*10);
      tbody.appendChild(el('tr',null,`<td>${fmtBR(s.inicio.slice(0,10))}</td><td>${esc(s.tipo.replace(/_/g,' '))}</td><td><b>${nf(s.itens.length===100?nota:escala)}</b></td><td>${certos}/${s.itens.length}</td><td>${escala>=6?'<span class="tag ok">acima</span>':'<span class="tag bad">abaixo</span>'}</td>`));
    });
    tb.appendChild(tbody); c2.appendChild(tb);
    c2.appendChild(el('div',{class:'note'},'Em simulados de 25 questões a nota é reescalonada para a base 0–10 apenas para comparação; a nota oficial do art. 40 pressupõe as 100 questões.'));
    m.appendChild(c2);
  }
}
function sessaoUI(m){
  const s=S.sessaoAtiva, it=s.itens[s.idx], q=it.snapshot||qById(it.q);
  if(!q){ s.idx++; if(s.idx>=s.itens.length){finalizarSessao();} render(); return; }
  if(!it.t0) it.t0=Date.now();
  const head=el('div',{class:'card'});
  const certos=s.itens.filter(i=>i.certo).length, resp=s.itens.filter(i=>i.resp).length;
  head.appendChild(el('div',{class:'row'},`<span class="tag pur">${esc(s.tipo.replace(/_/g,' '))}</span><span class="tag">questão ${s.idx+1} de ${s.itens.length}</span><span class="tag">${resp} respondida(s)</span>${resp?`<span class="tag ok">${pct(certos,resp)}% de acerto</span>`:''}`));
  head.appendChild(el('div',{class:'bar'},`<i style="width:${pct(s.idx,s.itens.length)}%"></i>`));
  const hr=el('div',{class:'row'}); hr.style.marginTop='10px';
  hr.appendChild(el('button',{class:'btn gho sm',onclick:()=>{ if(confirm('Encerrar e registrar a sessão com o que já foi respondido?')) finalizarSessao(); }},'Encerrar sessão'));
  hr.appendChild(el('button',{class:'btn gho sm',onclick:()=>{ if(confirm('Descartar esta sessão sem registrar?')){ S.sessaoAtiva=null; salvar(); render(); } }},'Descartar'));
  head.appendChild(hr);
  m.appendChild(head);

  const c=el('div',{class:'q'});
  c.appendChild(el('div',{class:'row'},`<span class="tag g-${q.g}">Grupo ${q.g}</span><span class="tag">${esc(q.disciplina||discNome(q.d))}</span><span class="tag">${esc(q.n)}</span>${q.src==='import'?'<span class="tag warn">importada</span>':'<span class="tag">autoral referenciada</span>'}`));
  c.appendChild(el('div',{class:'stem'},esc(q.e)));
  const letras=['A','B','C','D','E'];
  const alts=el('div');
  q.o.forEach((o,i)=>{
    const L=letras[i];
    const a=el('div',{class:'alt'+(it.resp===L?' sel':'')+(it.resp?(L===q.gab?' right':(it.resp===L?' wrong':'')):'')});
    a.appendChild(el('b',null,L));
    a.appendChild(el('div',null,esc(o)));
    if(!it.resp) a.onclick=()=>responder(L);
    alts.appendChild(a);
  });
  c.appendChild(alts);
  if(!it.resp){
    const cf=el('div',{class:'row'}); cf.style.marginTop='10px';
    cf.appendChild(el('small',null,'Confiança: '));
    ['CERTEZA','DUVIDA','CHUTE'].forEach(k=>cf.appendChild(el('button',{class:'btn gho sm'+(it.conf===k?' sec':''),onclick:()=>{it.conf=k; salvar(); render();}},k[0]+k.slice(1).toLowerCase())));
    c.appendChild(cf);
  } else {
    const e=el('div',{class:'exp'});
    const fonte=safeUrl(q.u);
    e.innerHTML=`<b>Gabarito: ${q.gab}${it.certo?' — você acertou':' — você errou'}</b><br>${esc(q.exp)}<br><br><small><b>Fonte:</b> ${esc(q.f)} ${fonte?`· <a href="${esc(fonte)}" target="_blank" rel="noopener">texto oficial</a>`:''}</small>`;
    c.appendChild(e);
    const r=el('div',{class:'row'}); r.style.marginTop='10px';
    if(s.idx<s.itens.length-1) r.appendChild(el('button',{class:'btn',onclick:()=>{s.idx++; salvar(); render();}},'Próxima'));
    else r.appendChild(el('button',{class:'btn',onclick:finalizarSessao},'Concluir sessão'));
    if(s.idx>0) r.appendChild(el('button',{class:'btn gho',onclick:()=>{s.idx--; salvar(); render();}},'Anterior'));
    c.appendChild(r);
  }
  m.appendChild(c);

  function responder(L){
    it.resp=L; it.certo = (L===q.gab); it.dt=Math.round((Date.now()-it.t0)/1000);
    S.exposicao[q.id]={ult:hoje(),certo:it.certo,vezes:((S.exposicao[q.id]||{}).vezes||0)+1};
    if(q.t && S.topicos[q.t]){ const p=S.topicos[q.t]; p.fz=(p.fz||0)+1; if(it.certo)p.ac=(p.ac||0)+1; if(p.st==='NAO_INICIADO')p.st='EM_ESTUDO'; garanteRevisao(q.t); }
    salvar(); render();
  }
}
function finalizarSessao(){
  const s=S.sessaoAtiva; if(!s) return;
  s.fim=new Date().toISOString();
  S.sessoes.push(s); S.sessaoAtiva=null; salvar();
  const certos=s.itens.filter(i=>i.certo).length, resp=s.itens.filter(i=>i.resp).length;
  toast(`Sessão registrada: ${certos}/${resp} acertos.`,3400);
  render(); setTimeout(()=>revisarSessao(s),150);
}
function revisarSessao(s){
  const bd=el('div',{class:'modal',onclick:e=>{if(e.target===bd)bd.remove();}});
  const inn=el('div',{class:'in'});
  const certos=s.itens.filter(i=>i.certo).length, resp=s.itens.filter(i=>i.resp).length;
  inn.appendChild(el('h2',null,'Resultado — '+s.tipo.replace(/_/g,' ')));
  inn.appendChild(el('div',{class:'row'},`<span class="pill">${certos}/${resp} acertos</span><span class="pill">${pct(certos,resp)}%</span>${s.tipo!=='PRATICA'?`<span class="pill">nota ${nf(resp===100?notaObjetiva(s):(certos/Math.max(resp,1)*10))}</span>`:''}<span class="pill">${Math.round(s.itens.reduce((a,i)=>a+(i.dt||0),0)/60)} min</span>`));
  // por grupo e disciplina
  const byG={}, byD={};
  s.itens.filter(i=>i.resp).forEach(i=>{ const q=i.snapshot||qById(i.q); if(!q)return;
    byG[q.g]=byG[q.g]||[0,0]; byG[q.g][1]++; if(i.certo)byG[q.g][0]++;
    byD[q.d]=byD[q.d]||[0,0]; byD[q.d][1]++; if(i.certo)byD[q.d][0]++; });
  const tb=el('table'); tb.innerHTML='<thead><tr><th>Disciplina</th><th>Acertos</th><th>%</th></tr></thead>';
  const tbody=el('tbody');
  Object.entries(byD).sort((a,b)=>(a[1][0]/a[1][1])-(b[1][0]/b[1][1])).forEach(([d,v])=>{
    tbody.appendChild(el('tr',null,`<td>${esc(discNome(d))}</td><td>${v[0]}/${v[1]}</td><td>${pct(v[0],v[1])}%</td>`));
  });
  tb.appendChild(tbody); inn.appendChild(tb);
  const err=s.itens.filter(i=>i.resp&&!i.certo);
  if(err.length){
    inn.appendChild(el('div',{class:'hr'}));
    inn.appendChild(el('h3',null,`Questões erradas (${err.length})`));
    err.forEach(i=>{ const q=i.snapshot||qById(i.q); if(!q)return;
      const d=el('div',{class:'exp'});
      d.innerHTML=`<b>${esc(q.disciplina||discNome(q.d))}</b> — sua resposta: ${i.resp} · gabarito: ${q.gab}<br><small>${esc(q.e)}</small><br><small><b>${esc(q.f)}</b></small>`;
      inn.appendChild(d);
    });
    inn.appendChild(el('div',{class:'note'},`As questões erradas voltam com prioridade nas próximas seleções, respeitado o intervalo de ${COOLDOWN} dias.`));
  }
  inn.appendChild(el('button',{class:'btn',onclick:()=>bd.remove()},'Fechar'));
  bd.appendChild(inn); document.body.appendChild(bd);
}

/* ---------------------------------------------------------------- view: discursivas */
const CARACS_LINHA=70;
function linhasDe(txt){
  if(!txt) return 0;
  return txt.split('\n').reduce((a,l)=> a + Math.max(1,Math.ceil(l.length/CARACS_LINHA)), 0);
}
function vDiscursivas(m){
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Treino discursivo — segunda etapa (peso 4)'));
  c.appendChild(el('p',null,'<small>Art. 46: cada prova discursiva vale 10,0 pontos — duas questões de até <b>30 linhas</b> (2,5 cada) e uma <b>peça processual de até 120 linhas</b> (5,0). Duração de 4 horas (art. 44). A contagem abaixo é em linhas, não em palavras.</small>'));
  const g=el('div',{class:'grid g4'});
  const tent=S.disc.tentativas;
  const pecas=tent.filter(t=>t.tipo==='PECA').length, qsts=tent.filter(t=>t.tipo==='QUESTAO').length;
  const st=(k,v,s2)=>{const d=el('div',{class:'stat'});d.appendChild(el('div',{class:'k'},k));d.appendChild(el('div',{class:'v'},v));if(s2)d.appendChild(el('div',{class:'s'},s2));return d;};
  g.appendChild(st('Tentativas',tent.length,'total registrado'));
  g.appendChild(st('Peças processuais',pecas,'valem 5,0 de 10,0'));
  g.appendChild(st('Questões dissertativas',qsts,'valem 2,5 cada'));
  const media=tent.filter(t=>t.nota!=null).length? tent.filter(t=>t.nota!=null).reduce((a,t)=>a+t.nota,0)/tent.filter(t=>t.nota!=null).length : null;
  g.appendChild(st('Autoavaliação média', media!=null?nf(media):'—','escala 0–10'));
  c.appendChild(g);
  m.appendChild(c);

  // novo treino
  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Nova produção'));
  const temas=DADOS.temas_discursivos.concat(S.disc.temas);
  const gg=el('div',{class:'grid g3'});
  const bt=el('div'); bt.appendChild(el('label',{class:'f'},'Tipo'));
  const stp=el('select'); stp.innerHTML='<option value="QUESTAO">Questão dissertativa — 30 linhas / 2,5 pts</option><option value="PECA">Peça processual — 120 linhas / 5,0 pts</option>'; bt.appendChild(stp); gg.appendChild(bt);
  const bg2=el('div'); bg2.appendChild(el('label',{class:'f'},'Grupo discursivo'));
  const sg=el('select'); sg.innerHTML='<option value="I">Grupo I — Const., Adm., Penal, Proc. Penal, Exec. Penal</option><option value="II">Grupo II — Civil, Proc. Civil, Consumidor, DH, Difusos, ECA</option>'; bg2.appendChild(sg); gg.appendChild(bg2);
  const bs=el('div'); bs.appendChild(el('label',{class:'f'},'Tema'));
  const sT=el('select'); bs.appendChild(sT); gg.appendChild(bs);
  function refT(){ const list=temas.filter(t=>t.gd===sg.value||!t.gd);
    sT.innerHTML=list.map((t,i)=>`<option value="${i}">${esc(t.tit)}</option>`).join('')+'<option value="livre">— tema livre —</option>'; }
  sg.onchange=refT; refT();
  c2.appendChild(gg);
  const enun=el('div',{class:'lei'}); c2.appendChild(enun);
  function showEnun(){ const list=temas.filter(t=>t.gd===sg.value||!t.gd); const v=sT.value;
    if(v==='livre'){ enun.innerHTML='<b>Tema livre.</b> Escreva o enunciado que quiser treinar.'; return; }
    const t=list[+v]; if(!t) return; enun.innerHTML=`<b>Enunciado:</b> ${esc(t.en)}<br><small><b>Referência:</b> ${esc(t.ref||'—')} ${t.url?`· <a href="${esc(t.url)}" target="_blank" rel="noopener">fonte oficial</a>`:''}</small>`; }
  sT.onchange=showEnun; showEnun();
  const ta=el('textarea',{placeholder:'Escreva sua resposta aqui. A contagem de linhas segue o padrão de ~70 caracteres por linha manuscrita.'});
  ta.style.minHeight='320px';
  const cont=el('div',{class:'row'});
  const lbl=el('div',{class:'linhas'}); cont.appendChild(lbl);
  const tmr=el('div',{class:'pill'},'⏱ 00:00'); cont.appendChild(tmr);
  let t0=null, tint=null;
  const btT=el('button',{class:'btn gho sm',onclick:()=>{ if(tint){clearInterval(tint);tint=null;btT.textContent='Retomar';} else {t0=t0||Date.now(); tint=setInterval(()=>{const s2=Math.round((Date.now()-t0)/1000); tmr.textContent='⏱ '+String(Math.floor(s2/60)).padStart(2,'0')+':'+String(s2%60).padStart(2,'0');},1000); btT.textContent='Pausar';} }},'Iniciar cronômetro');
  cont.appendChild(btT);
  function updL(){ const n=linhasDe(ta.value); const max=stp.value==='PECA'?120:30;
    lbl.textContent=`${n} de ${max} linhas`; lbl.className='linhas'+(n>max?' over':''); }
  ta.oninput=updL; stp.onchange=()=>{updL(); refT(); showEnun();}; updL();
  c2.appendChild(ta); c2.appendChild(cont);
  const gN=el('div',{class:'grid g3'});
  const bF=el('div'); bF.appendChild(el('label',{class:'f'},'Pontos fortes')); const iF=el('input'); bF.appendChild(iF); gN.appendChild(bF);
  const bM=el('div'); bM.appendChild(el('label',{class:'f'},'A melhorar')); const iM=el('input'); bM.appendChild(iM); gN.appendChild(bM);
  const bN=el('div'); bN.appendChild(el('label',{class:'f'},'Autoavaliação (0–10)')); const iN=el('input',{type:'number',min:0,max:10,step:'0.25'}); bN.appendChild(iN); gN.appendChild(bN);
  c2.appendChild(gN);
  c2.appendChild(el('div',{class:'note'},'Espelho sugerido: conteúdo jurídico e domínio normativo (40%), estrutura e adequação ao tipo de peça (25%), argumentação e uso de precedentes (25%), linguagem e técnica (10%). É autoavaliação — não substitui correção humana.'));
  c2.appendChild(el('button',{class:'btn',onclick:()=>{
    if(!ta.value.trim()){ toast('Escreva algo antes de salvar.'); return; }
    const list=temas.filter(t=>t.gd===sg.value||!t.gd); const t=sT.value==='livre'?{tit:'Tema livre',en:''}:list[+sT.value];
    S.disc.tentativas.push({id:uid(),data:new Date().toISOString(),tipo:stp.value,gd:sg.value,tema:t.tit,
      texto:ta.value,linhas:linhasDe(ta.value),max:stp.value==='PECA'?120:30,
      tempo:t0?Math.round((Date.now()-t0)/1000):0,fortes:iF.value,melhorar:iM.value,
      nota:iN.value!==''?+iN.value:null,fim:true});
    if(tint)clearInterval(tint); salvar(); toast('Produção registrada.'); render();
  }},'Salvar produção'));
  m.appendChild(c2);

  // histórico
  if(tent.length){
    const c3=el('div',{class:'card'});
    c3.appendChild(el('h2',null,'Histórico'));
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Data</th><th>Tipo</th><th>Tema</th><th>Linhas</th><th>Tempo</th><th>Nota</th><th></th></tr></thead>';
    const tbody=el('tbody');
    tent.slice().reverse().forEach(t=>{
      const tr=el('tr',null,`<td>${fmtBR(t.data.slice(0,10))}</td><td>${t.tipo==='PECA'?'Peça':'Questão'}</td><td><small>${esc(t.tema)}</small></td><td class="linhas ${t.linhas>t.max?'over':''}">${t.linhas}/${t.max}</td><td>${Math.round((t.tempo||0)/60)} min</td><td>${t.nota!=null?nf(t.nota):'—'}</td>`);
      const td=el('td');
      td.appendChild(el('button',{class:'btn gho sm',onclick:()=>{
        const bd=el('div',{class:'modal',onclick:e=>{if(e.target===bd)bd.remove();}});
        const inn=el('div',{class:'in'});
        inn.appendChild(el('h3',null,esc(t.tema)));
        inn.appendChild(el('div',{class:'row'},`<span class="pill">${t.tipo==='PECA'?'Peça — 120 linhas':'Questão — 30 linhas'}</span><span class="pill">${t.linhas} linhas</span><span class="pill">${Math.round((t.tempo||0)/60)} min</span>`));
        const pre=el('div',{class:'exp'}); pre.style.whiteSpace='pre-wrap'; pre.textContent=t.texto; inn.appendChild(pre);
        if(t.fortes) inn.appendChild(el('p',null,`<b>Fortes:</b> ${esc(t.fortes)}`));
        if(t.melhorar) inn.appendChild(el('p',null,`<b>A melhorar:</b> ${esc(t.melhorar)}`));
        inn.appendChild(el('button',{class:'btn',onclick:()=>bd.remove()},'Fechar'));
        bd.appendChild(inn); document.body.appendChild(bd);
      }},'Ver'));
      td.appendChild(el('button',{class:'btn gho sm',onclick:()=>{ if(confirm('Excluir esta produção?')){ S.disc.tentativas=S.disc.tentativas.filter(x=>x.id!==t.id); salvar(); render(); } }},'Excluir'));
      tr.appendChild(td); tbody.appendChild(tr);
    });
    tb.appendChild(tbody); c3.appendChild(tb); m.appendChild(c3);
  }
}

/* ---------------------------------------------------------------- view: revisões */
function vRevisoes(m){
  const h=hoje();
  const itens=Object.entries(S.revisoes).map(([tid,r])=>({tid,r,t:DADOS.programa.find(x=>x.id===tid)})).filter(x=>x.t);
  const dev=itens.filter(x=>x.r.prox<=h).sort((a,b)=>a.r.prox<b.r.prox?-1:1);
  const fut=itens.filter(x=>x.r.prox>h).sort((a,b)=>a.r.prox<b.r.prox?-1:1);
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Revisão espaçada'));
  c.appendChild(el('p',null,'<small>Tópicos entram na fila ao serem iniciados. A avaliação ajusta o intervalo até a próxima revisão — é controle de espaçamento, não nota jurídica.</small>'));
  c.appendChild(el('div',{class:'row'},`<span class="pill">${dev.length} vencida(s)</span><span class="pill">${fut.length} agendada(s)</span>`));
  m.appendChild(c);
  if(!itens.length){ m.appendChild(el('div',{class:'card'},'<div class="empty"><b>Fila vazia</b>Marque tópicos como iniciados no Programa, ou conclua blocos do cronograma, para alimentar a fila de revisão.</div>')); return; }
  const box=el('div',{class:'card'});
  box.appendChild(el('h3',null,'Vencidas'));
  if(!dev.length) box.appendChild(el('div',{class:'note'},'Nenhuma revisão vencida. Bom sinal.'));
  dev.slice(0,60).forEach(x=>box.appendChild(revCard(x)));
  m.appendChild(box);
  if(fut.length){
    const b2=el('div',{class:'card'});
    b2.appendChild(el('h3',null,'Próximas'));
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Tópico</th><th>Próxima</th><th>Intervalo</th><th>Última</th></tr></thead>';
    const tbody=el('tbody');
    fut.slice(0,80).forEach(x=>tbody.appendChild(el('tr',null,`<td><span class="tag g-${x.t.g}">${x.t.g}</span> <b>${esc(x.t.di)}</b> — <small>${esc(x.t.to.slice(0,90))}…</small></td><td>${fmtBR(x.r.prox)}</td><td>${x.r.int} d</td><td>${x.r.ultAv?SRS_LAB[x.r.ultAv]:'—'}</td>`)));
    tb.appendChild(tbody); b2.appendChild(tb); m.appendChild(b2);
  }
}
function revCard(x){
  const d=el('div',{class:'blk'});
  d.appendChild(el('div',{class:'row'},`<span class="tag g-${x.t.g}">Grupo ${x.t.g}</span><span class="tag">${esc(x.t.di)}</span><span class="tag warn">venceu ${fmtBR(x.r.prox)}</span>`));
  d.appendChild(el('div',null,`<small>${esc(x.t.to.length>230?x.t.to.slice(0,230)+'…':x.t.to)}</small>`));
  const lei=leiDoTopico(x.tid);
  if(lei.length&&!lei[0].sem) d.appendChild(el('div',{class:'lei'},'<b>Reler:</b> '+lei.map(l=>`${esc(l.nome)} — ${esc(l.arts)} ${l.url?`<a href="${esc(l.url)}" target="_blank" rel="noopener">texto</a>`:''}`).join(' · ')));
  const r=el('div',{class:'row'});
  ['REPETIR','DIFICIL','BOM','FACIL'].forEach(a=>r.appendChild(el('button',{class:'btn sm '+(a==='REPETIR'?'gho':a==='FACIL'?'':'sec'),onclick:()=>{avaliarRevisao(x.tid,a); toast('Próxima revisão em '+S.revisoes[x.tid].int+' dia(s).'); render();}},SRS_LAB[a])));
  const nq=bancoQuestoes().filter(q=>q.t===x.tid).length;
  if(nq) r.appendChild(el('button',{class:'btn gho sm',onclick:()=>iniciarSessao('PRATICA',{topico:x.tid},Math.min(nq,8))},`Praticar (${nq})`));
  d.appendChild(r);
  return d;
}

/* ---------------------------------------------------------------- view: jurisprudência */
function jurisKey(p){ return p.id||`legacy|${p.trib||''}|${p.ref||''}`; }
function jurisSearchText(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');}
function jurisDate(value){return value?fmtBR(String(value).slice(0,10)):'—';}
function openJurisDetail(p,onProgress){
  const key=jurisKey(p),registro=S.juris.find(j=>j.id===key||(!j.id&&j.ref===p.ref));
  const modal=el('div',{class:'modal',role:'dialog','aria-modal':'true'});
  const box=el('div',{class:'in juris-detail'});
  const top=el('div',{class:'row'}); top.style.justifyContent='space-between';
  const title=el('div'); title.appendChild(el('span',{class:'tag'},esc(p.record_type||p.trib||'Jurisprudência'))); title.appendChild(el('h2',null,esc(p.ref||p.tema||'Registro'))); top.appendChild(title);
  top.appendChild(el('button',{class:'btn gho sm',onclick:()=>modal.remove(),'aria-label':'Fechar detalhes'},'Fechar'));
  box.appendChild(top);
  if(p.tema&&p.tema!==p.ref)box.appendChild(el('h3',null,esc(p.tema)));
  const meta=[
    ['Tribunal',p.trib],['Processo',p.processo],['Informativo',p.informativo],['Julgamento',jurisDate(p.published_at)],
    ['Publicação',jurisDate(p.data_publicacao)],['Ramo',p.ramo],['Matéria',p.materia],['Relator(a)',p.relator],
    ['Redator(a)',p.redator],['Órgão julgador',p.orgao],['Repercussão geral',p.repercussao],['Tema RG',p.tema_rg],['UF',p.uf]
  ].filter(([,value])=>value&&value!=='—');
  if(meta.length){const grid=el('div',{class:'grid g3 juris-meta'});meta.forEach(([label,value])=>grid.appendChild(el('div',null,`<small>${esc(label)}</small><br><b>${esc(value)}</b>`)));box.appendChild(grid);}
  box.appendChild(el('div',{class:'hr'}));
  box.appendChild(el('h3',null,'Tese, resumo ou ementa'));
  box.appendChild(el('p',{class:'juris-full'},esc(p.tese||'Síntese não disponível.')));
  if(p.decisao){box.appendChild(el('h3',null,'Decisão'));box.appendChild(el('p',{class:'juris-full'},esc(p.decisao)));}
  if(p.legislacao){box.appendChild(el('h3',null,'Legislação citada'));box.appendChild(el('p',{class:'juris-full'},esc(p.legislacao)));}
  if(p.ods){box.appendChild(el('p',{class:'note'},`<b>ODS ONU 2030:</b> ${esc(p.ods)}`));}
  if(p.observacao){box.appendChild(el('p',{class:'note'},`<b>Observação:</b> ${esc(p.observacao)}`));}
  const actions=el('div',{class:'row'});
  const progress=el('button',{class:'btn '+((registro||{}).lido?'':'gho')+' sm',onclick:()=>{
    let item=S.juris.find(entry=>entry.id===key||(!entry.id&&entry.ref===p.ref));
    if(!item){item={id:key,ref:p.ref,lido:false};S.juris.push(item);}
    item.id=key;item.lido=!item.lido;salvar();modal.remove();if(onProgress)onProgress();
  }},(registro||{}).lido?'Lido':'Marcar lido');
  actions.appendChild(progress);
  const source=safeUrl(p.url);if(source)actions.appendChild(el('a',{class:'btn sec sm',href:source,target:'_blank',rel:'noopener'},'Abrir fonte oficial'));
  box.appendChild(actions);modal.appendChild(box);modal.addEventListener('click',event=>{if(event.target===modal)modal.remove();});document.body.appendChild(modal);
}
function vJuris(m){
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Jurisprudência atualizada'));
  c.appendChild(el('p',null,'<small>Acervo histórico e publicações recentes coletados de fontes oficiais, preservados como um pacote versionado e verificável. A síntese auxilia a triagem; a fonte oficial continua sendo a referência jurídica.</small>'));
  const atualizacao=JURIS_META.last_success_at||JURIS_META.generated_at;
  const statusAtualizado=String(JURIS_META.status||'').startsWith('ATUALIZADO');
  const statusBom=JURIS_META.status==='ATUALIZADO';
  const banner=el('div',{class:'status-banner'});
  banner.appendChild(el('span',{class:'status-lamp'+(statusBom?'':' warn')}));
  const status=el('div');
  status.appendChild(el('b',null,statusBom?'Atualização automática concluída':statusAtualizado?'Atualização parcial — base anterior preservada':'Base inicial disponível'));
  status.appendChild(el('div',null,`<small>Versão ${esc(JURIS_META.version||CONTENT_MANIFEST.jurisprudenceVersion)}${atualizacao?' · última coleta válida em '+esc(new Date(atualizacao).toLocaleString('pt-BR')):''} · ${DADOS.precedentes.length} item(ns). Uma falha de coleta nunca substitui a última base válida.</small>`));
  banner.appendChild(status); c.appendChild(banner);
  if(Array.isArray(JURIS_META.sources)&&JURIS_META.sources.length){
    const fontes=el('div',{class:'row'});
    JURIS_META.sources.forEach(source=>fontes.appendChild(el('span',{class:'tag '+(source.status==='SUCESSO'?'ok':'warn'),title:source.message||''},`${esc(source.name||source.court||'Fonte')} · ${source.status==='SUCESSO'?'coleta válida':'indisponível'}${source.detected!=null?' · '+nf(source.detected):''}`)));
    Object.values(JURIS_META.datasets||{}).filter(dataset=>dataset.automatic===false).forEach(dataset=>fontes.appendChild(el('span',{class:'tag',title:'Exportação incorporada ao pacote; atualize-a com uma nova exportação oficial quando necessário.'},`${esc(dataset.label||dataset.name||'Base importada')} · snapshot${dataset.snapshot_date?' de '+esc(new Date(dataset.snapshot_date+'T12:00:00').toLocaleDateString('pt-BR')):''} · ${nf((dataset.stats||{}).records||0)}`)));
    c.appendChild(fontes);
  }
  const r=el('div',{class:'row'});
  DADOS.juris_links.forEach(l=>{ const url=safeUrl(l.url); if(url)r.appendChild(el('a',{class:'btn sec sm',href:url,target:'_blank',rel:'noopener'},esc(l.nome))); });
  c.appendChild(r);
  m.appendChild(c);

  const c1=el('div',{class:'card pad0'});
  const hd=el('div',{class:'juris-head'});
  hd.appendChild(el('h3',null,`Base pesquisável (${nf(DADOS.precedentes.length)} registros)`));
  const filters=el('div',{class:'grid g3 juris-filters'});
  const queryBox=el('div');queryBox.appendChild(el('label',{class:'f'},'Busca livre'));const query=el('input',{type:'search',placeholder:'processo, assunto, tese, legislação…'});queryBox.appendChild(query);filters.appendChild(queryBox);
  function filterSelect(label,values){const box=el('div');box.appendChild(el('label',{class:'f'},label));const select=el('select');select.appendChild(el('option',{value:''},'Todos'));values.forEach(value=>select.appendChild(el('option',{value},esc(value))));box.appendChild(select);filters.appendChild(box);return select;}
  const types=[...new Set(DADOS.precedentes.map(item=>item.record_type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const courts=[...new Set(DADOS.precedentes.map(item=>item.trib).filter(Boolean))].sort();
  const branches=[...new Set(DADOS.precedentes.flatMap(item=>String(item.ramo||'').split(';').map(value=>value.trim()).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const years=[...new Set(DADOS.precedentes.map(item=>String(item.published_at||'').slice(0,4)).filter(value=>/^\d{4}$/.test(value)))].sort().reverse();
  const type=filterSelect('Tipo de registro',types),court=filterSelect('Tribunal',courts),branch=filterSelect('Ramo do Direito',branches),year=filterSelect('Ano do julgamento',years),group=filterSelect('Grupo DPE/RN',['I','II','III','IV']);
  hd.appendChild(filters);
  const summary=el('div',{class:'row juris-results'});const resultText=el('small');summary.appendChild(resultText);summary.appendChild(el('button',{class:'btn gho sm',onclick:()=>{query.value='';[type,court,branch,year,group].forEach(select=>select.value='');page=1;apply();}},'Limpar filtros'));hd.appendChild(summary);c1.appendChild(hd);
  const wrap=el('div',{class:'juris-table-wrap'});
  const tb=el('table');tb.innerHTML='<thead><tr><th>Origem</th><th>Referência</th><th>Síntese</th><th>Grupo</th><th></th></tr></thead>';const tbody=el('tbody');tb.appendChild(tbody);wrap.appendChild(tb);c1.appendChild(wrap);
  const pager=el('div',{class:'row juris-pager'});const previous=el('button',{class:'btn gho sm'},'Anterior'),pageText=el('small'),next=el('button',{class:'btn gho sm'},'Próxima');pager.appendChild(previous);pager.appendChild(pageText);pager.appendChild(next);c1.appendChild(pager);
  const pageSize=30;let page=1,matches=[];
  function renderRows(){
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));page=clamp(page,1,pages);tbody.innerHTML='';
    matches.slice((page-1)*pageSize,page*pageSize).forEach(p=>{
      const key=jurisKey(p),registro=S.juris.find(item=>item.id===key||(!item.id&&item.ref===p.ref)),lido=(registro||{}).lido,grupo=['I','II','III','IV'].includes(p.g)?p.g:'';
      const tr=el('tr');
      tr.innerHTML=`<td><span class="tag">${esc(p.trib)}</span><br><small>${esc(p.record_type||'')}</small></td><td><b>${esc(p.ref)}</b><br><small>${esc([p.ramo,p.materia,jurisDate(p.published_at)].filter(Boolean).join(' · '))}</small></td><td><small>${esc(String(p.tese||'').slice(0,520))}${String(p.tese||'').length>520?'…':''}</small></td><td>${grupo?`<span class="tag g-${grupo}">${grupo}</span>`:'—'}</td>`;
      const actions=el('td');actions.appendChild(el('button',{class:'btn sec sm',onclick:()=>openJurisDetail(p,renderRows)},'Detalhes'));actions.appendChild(el('button',{class:'btn '+(lido?'':'gho')+' sm',onclick:()=>{let item=S.juris.find(entry=>entry.id===key||(!entry.id&&entry.ref===p.ref));if(!item){item={id:key,ref:p.ref,lido:false};S.juris.push(item);}item.id=key;item.lido=!item.lido;salvar();renderRows();}},lido?'Lido':'Marcar lido'));tr.appendChild(actions);tbody.appendChild(tr);
    });
    if(!matches.length)tbody.appendChild(el('tr',null,'<td colspan="5"><div class="empty"><b>Nenhum registro encontrado</b>Revise os filtros ou tente outros termos.</div></td>'));
    resultText.textContent=`${nf(matches.length)} resultado(s) · página ${page} de ${pages}`;pageText.textContent=`Página ${page} de ${pages}`;previous.disabled=page<=1;next.disabled=page>=pages;
  }
  function apply(){
    const terms=jurisSearchText(query.value).split(/\s+/).filter(Boolean);
    matches=DADOS.precedentes.filter(p=>{
      if(type.value&&p.record_type!==type.value)return false;if(court.value&&p.trib!==court.value)return false;if(branch.value&&!String(p.ramo||'').split(';').map(value=>value.trim()).includes(branch.value))return false;if(year.value&&!String(p.published_at||'').startsWith(year.value))return false;if(group.value&&p.g!==group.value)return false;
      if(!terms.length)return true;const hay=jurisSearchText([p.ref,p.tema,p.tese,p.processo,p.ramo,p.materia,p.relator,p.legislacao,p.ods].filter(Boolean).join(' '));return terms.every(term=>hay.includes(term));
    });renderRows();
  }
  let queryTimer=null;query.addEventListener('input',()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>{page=1;apply();},120);});[type,court,branch,year,group].forEach(select=>select.addEventListener('change',()=>{page=1;apply();}));previous.onclick=()=>{page--;renderRows();};next.onclick=()=>{page++;renderRows();};apply();m.appendChild(c1);

  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Registrar informativo'));
  const g=el('div',{class:'grid g3'});
  const f={};
  [['trib','Tribunal'],['ref','Informativo / precedente'],['tema','Tema']].forEach(([k,l])=>{
    const b=el('div'); b.appendChild(el('label',{class:'f'},l)); const i=el('input'); f[k]=i; b.appendChild(i); g.appendChild(b);
  });
  c2.appendChild(g);
  const bt=el('div'); bt.appendChild(el('label',{class:'f'},'Tese ou síntese')); const ita=el('textarea'); ita.style.minHeight='80px'; bt.appendChild(ita); c2.appendChild(bt);
  const bu=el('div'); bu.appendChild(el('label',{class:'f'},'Link oficial')); const iu=el('input',{placeholder:'https://'}); bu.appendChild(iu); c2.appendChild(bu);
  c2.appendChild(el('button',{class:'btn',onclick:()=>{
    if(!f.ref.value.trim()){ toast('Informe ao menos a referência.'); return; }
    const url=iu.value.trim()?safeUrl(iu.value.trim()):'';
    if(iu.value.trim()&&!url){ toast('Use um link HTTP ou HTTPS válido.'); return; }
    S.juris.push({id:'manual|'+uid(),trib:f.trib.value.trim(),ref:f.ref.value.trim(),tema:f.tema.value.trim(),tese:ita.value.trim(),url,lido:false,manual:true,data:hoje()});
    salvar(); toast('Informativo registrado.'); render();
  }},'Registrar'));
  const meus=S.juris.filter(j=>j.manual);
  if(meus.length){
    c2.appendChild(el('div',{class:'hr'}));
    const tb2=el('table'); tb2.innerHTML='<thead><tr><th>Ref.</th><th>Tema</th><th>Data</th><th></th></tr></thead>';
    const tb2b=el('tbody');
    meus.slice().reverse().forEach(j=>{
      const tr=el('tr',null,`<td><b>${esc(j.ref)}</b><br><small>${esc(j.trib||'')}</small></td><td><small>${esc(j.tema||'')}<br>${esc((j.tese||'').slice(0,140))}</small></td><td>${fmtBR(j.data)}</td>`);
      const td=el('td');
      const url=safeUrl(j.url); if(url) td.appendChild(el('a',{class:'btn gho sm',href:url,target:'_blank',rel:'noopener'},'Abrir'));
      td.appendChild(el('button',{class:'btn gho sm',onclick:()=>{ S.juris=S.juris.filter(x=>x.id!==j.id); salvar(); render(); }},'Excluir'));
      tr.appendChild(td); tb2b.appendChild(tr);
    });
    tb2.appendChild(tb2b); c2.appendChild(tb2);
  }
  m.appendChild(c2);
}

/* ---------------------------------------------------------------- view: dados */
function vDados(m){
  // data da prova
  const c0=el('div',{class:'card'});
  c0.appendChild(el('h2',null,'Data da prova'));
  const g0=el('div',{class:'grid g3'});
  const b1=el('div'); b1.appendChild(el('label',{class:'f'},'Data'));
  const i1=el('input',{type:'date',value:S.prova.data}); i1.onchange=()=>{S.prova.data=i1.value; salvar(); render();}; b1.appendChild(i1); g0.appendChild(b1);
  const b2=el('div'); b2.appendChild(el('label',{class:'f'},'Situação'));
  const s2=el('select'); s2.innerHTML=`<option value="0" ${!S.prova.confirmada?'selected':''}>Estimativa editável</option><option value="1" ${S.prova.confirmada?'selected':''}>Confirmada pelo edital</option>`;
  s2.onchange=()=>{S.prova.confirmada=s2.value==='1'; salvar(); render();}; b2.appendChild(s2); g0.appendChild(b2);
  const b3=el('div'); b3.appendChild(el('label',{class:'f'},'Fonte oficial'));
  const i3=el('input',{value:S.prova.fonte,placeholder:'Edital nº .../2026'}); i3.onchange=()=>{S.prova.fonte=i3.value; salvar();}; b3.appendChild(i3); g0.appendChild(b3);
  c0.appendChild(g0);
  c0.appendChild(el('div',{class:'note'},'O Termo de Dispensa nº 03/2026 (DOE nº 16.216, de 15/08/2026) contratou o CEBRASPE, mas não define data, vagas nem cronograma. Enquanto o edital não sair, a data permanece hipótese de trabalho.'));
  m.appendChild(c0);

  // backup
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Backup e restauração'));
  c.appendChild(el('p',null,'<small>Seus dados ficam apenas no IndexedDB deste navegador, com snapshots automáticos a cada 6 horas. O backup exportado inclui versão de formato e verificação SHA-256; guarde-o em uma pasta sincronizada.</small>'));
  const r=el('div',{class:'row'});
  r.appendChild(el('button',{class:'btn',onclick:exportar},'Exportar backup (.json)'));
  const fi=el('input',{type:'file',accept:'.json'}); fi.style.display='none';
  fi.onchange=async()=>{ const f=fi.files[0]; if(!f)return;
    try{
      if(f.size>20*1024*1024) throw new Error('o arquivo excede o limite de 20 MB');
      const candidato=await validarBackup(JSON.parse(await f.text()));
      if(!confirm('Restaurar substituirá o progresso atual deste navegador. Uma cópia do estado atual será baixada antes. Continuar?')) return;
      await exportar('pre-restauracao');
      S=candidato; DADOS.programa.forEach(t=>{ if(!S.topicos[t.id]) S.topicos[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''}; });
      await gravar(); toast('Backup restaurado e verificado.'); render();
    }catch(e){ alert('Não foi possível restaurar o arquivo: '+e.message); }
    finally{fi.value='';}
  };
  r.appendChild(el('button',{class:'btn sec',onclick:()=>fi.click()},'Restaurar de arquivo'));
  r.appendChild(fi);
  c.appendChild(r);
  c.appendChild(el('div',{class:'hr'}));
  const snapBox=el('div'); snapBox.innerHTML='<small>Carregando snapshots…</small>';
  idbAll(SNAPS).then(sn=>{
    sn.sort((a,b)=>b.ts-a.ts); snapBox.innerHTML='';
    snapBox.appendChild(el('h3',null,`Snapshots automáticos (${sn.length})`));
    if(!sn.length){ snapBox.appendChild(el('div',{class:'note'},'Nenhum snapshot ainda. O primeiro é criado após 6 horas de uso.')); return; }
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Quando</th><th>Tamanho</th><th></th></tr></thead>'; const tbody=el('tbody');
    sn.forEach(s=>{ const tr=el('tr',null,`<td>${new Date(s.ts).toLocaleString('pt-BR')}</td><td>${Math.round(s.data.length/1024)} KB</td>`);
      const td=el('td'); td.appendChild(el('button',{class:'btn gho sm',onclick:async()=>{ if(!confirm('Restaurar este snapshot? O estado atual será baixado antes.'))return;
        try{const candidato=await validarBackup(JSON.parse(s.data)); await exportar('pre-snapshot'); S=candidato; await gravar(); toast('Snapshot restaurado.'); render();}
        catch(error){alert('Não foi possível restaurar o snapshot: '+error.message);}
      }},'Restaurar'));
      tr.appendChild(td); tbody.appendChild(tr); });
    tb.appendChild(tbody); snapBox.appendChild(tb);
  });
  c.appendChild(snapBox);
  m.appendChild(c);

  // importador de questões
  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Importar questões'));
  c2.appendChild(el('p',null,'<small>Cole questões que você já resolve em outras plataformas, ou digite as suas. Elas entram no banco imediatamente e participam das práticas e dos simulados.</small>'));
  const tabs=el('div',{class:'row'});
  const areaCSV=el('div'), areaForm=el('div');
  const tCSV=el('button',{class:'btn sm',onclick:()=>{areaCSV.style.display='';areaForm.style.display='none';tCSV.className='btn sm';tFRM.className='btn gho sm';}},'Colar CSV');
  const tFRM=el('button',{class:'btn gho sm',onclick:()=>{areaCSV.style.display='none';areaForm.style.display='';tFRM.className='btn sm';tCSV.className='btn gho sm';}},'Formulário');
  tabs.appendChild(tCSV); tabs.appendChild(tFRM); c2.appendChild(tabs);

  areaCSV.appendChild(el('div',{class:'note'},'Uma questão por linha, separada por ponto e vírgula:<br><span class="mono">grupo;disciplina;enunciado;A;B;C;D;E;gabarito;explicação;fonte;url</span><br>Grupo = I a IV. Disciplina = código (CON, ADM, PID, PEN, DPP, DEP, CIV, DPC, CDC, DHU, DCO, DCA). Gabarito = letra A a E. Explicação, fonte e url são opcionais.'));
  const taC=el('textarea',{placeholder:'I;CON;Enunciado da questão...;alternativa A;alternativa B;alternativa C;alternativa D;alternativa E;B;explicação;CF/88, art. 5º;https://...'});
  areaCSV.appendChild(taC);
  areaCSV.appendChild(el('button',{class:'btn',onclick:()=>importarCSV(taC.value)},'Importar CSV'));
  c2.appendChild(areaCSV);

  areaForm.style.display='none';
  const fg=el('div',{class:'grid g3'}); const F={};
  const mk=(k,l,tag)=>{ const b=el('div'); b.appendChild(el('label',{class:'f'},l)); const i=el(tag||'input'); F[k]=i; b.appendChild(i); return b; };
  const bG=el('div'); bG.appendChild(el('label',{class:'f'},'Grupo')); const sG=el('select'); sG.innerHTML=['I','II','III','IV'].map(x=>`<option>${x}</option>`).join(''); F.g=sG; bG.appendChild(sG); fg.appendChild(bG);
  const bD=el('div'); bD.appendChild(el('label',{class:'f'},'Disciplina')); const sD=el('select'); F.d=sD; bD.appendChild(sD); fg.appendChild(bD);
  const bGab=el('div'); bGab.appendChild(el('label',{class:'f'},'Gabarito')); const sGab=el('select'); sGab.innerHTML=['A','B','C','D','E'].map(x=>`<option>${x}</option>`).join(''); F.gab=sGab; bGab.appendChild(sGab); fg.appendChild(bGab);
  function refD(){ const ds=Array.from(new Set(DADOS.programa.filter(t=>t.g===sG.value).map(t=>t.dc+'|'+t.di)));
    sD.innerHTML=ds.map(x=>{const [c3,n]=x.split('|'); return `<option value="${c3}">${esc(n)}</option>`;}).join(''); }
  sG.onchange=refD; refD();
  areaForm.appendChild(fg);
  areaForm.appendChild(mk('e','Enunciado','textarea'));
  const alts=el('div',{class:'grid g2'});
  ['A','B','C','D','E'].forEach(L=>{ const b=el('div'); b.appendChild(el('label',{class:'f'},'Alternativa '+L)); const i=el('input'); F['o'+L]=i; b.appendChild(i); alts.appendChild(b); });
  areaForm.appendChild(alts);
  areaForm.appendChild(mk('exp','Explicação (opcional)','textarea'));
  const fg2=el('div',{class:'grid g2'});
  fg2.appendChild(mk('f','Fonte normativa')); fg2.appendChild(mk('u','Link oficial'));
  areaForm.appendChild(fg2);
  areaForm.appendChild(el('button',{class:'btn',onclick:()=>{
    const o=['A','B','C','D','E'].map(L=>F['o'+L].value.trim());
    if(!F.e.value.trim()||o.some(x=>!x)){ toast('Preencha o enunciado e as cinco alternativas.'); return; }
    const url=F.u.value.trim()?safeUrl(F.u.value.trim()):'';
    if(F.u.value.trim()&&!url){ toast('Use um link HTTP ou HTTPS válido.'); return; }
    S.questoesImportadas.push({id:'IMP-'+uid(),g:F.g.value,d:F.d.value,t:null,n:'medio',
      e:F.e.value.trim(),o:o,gab:F.gab.value,exp:F.exp.value.trim()||'Sem explicação registrada.',
      f:F.f.value.trim()||'Importada pelo usuário',u:url,src:'import',authorship_type:'USUARIO',rights_status:'RESPONSABILIDADE_USUARIO'});
    salvar(); toast('Questão adicionada ao banco.'); render();
  }},'Adicionar questão'));
  c2.appendChild(areaForm);

  const imp=S.questoesImportadas||[];
  if(imp.length){
    c2.appendChild(el('div',{class:'hr'}));
    c2.appendChild(el('h3',null,`Questões importadas (${imp.length})`));
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Grupo</th><th>Disciplina</th><th>Enunciado</th><th>Gab.</th><th></th></tr></thead>';
    const tbody=el('tbody');
    imp.slice().reverse().slice(0,80).forEach(q=>{
      const tr=el('tr',null,`<td><span class="tag g-${q.g}">${q.g}</span></td><td><small>${esc(discNome(q.d))}</small></td><td><small>${esc(q.e.slice(0,110))}…</small></td><td>${q.gab}</td>`);
      const td=el('td'); td.appendChild(el('button',{class:'btn gho sm',onclick:()=>{ if(confirm('Remover esta questão do banco?')){ S.questoesImportadas=S.questoesImportadas.filter(x=>x.id!==q.id); salvar(); render(); } }},'Remover'));
      tr.appendChild(td); tbody.appendChild(tr);
    });
    tb.appendChild(tbody); c2.appendChild(tb);
  }
  m.appendChild(c2);

  // sobre / integridade
  const c3=el('div',{class:'card'});
  c3.appendChild(el('h2',null,'Sobre esta versão'));
  const k=metricas();
  c3.appendChild(el('div',{class:'grid g2'},''));
  const ul=el('ul',{class:'clean'});
  [
    `Versão ${DADOS.meta.versao} — PWA estática local-first, sem servidor de aplicação e instalável pelo navegador.`,
    `Programa: ${DADOS.programa.length} tópicos do Anexo I da ${DADOS.meta.resolucao}, 12 disciplinas, 4 grupos.`,
    `Banco ${CONTENT_MANIFEST.questionBankVersion}: ${DADOS.questoes.length} questões autorais referenciadas + ${imp.length} importada(s) por você.`,
    `Mapa legislativo: ${Object.keys(DADOS.legislacao.topicos).length} tópicos com faixa de leitura e ${DADOS.legislacao.sem_dispositivo.length} classificados como sem faixa específica.`,
    `Jurisprudência ${CONTENT_MANIFEST.jurisprudenceVersion}: ${DADOS.precedentes.length} publicações e precedentes.`,
    `Conteúdo ${CONTENT_MANIFEST.contentVersion}, verificado por SHA-256 antes de ser aberto.`,
    `Seu progresso: ${k.ini} tópicos iniciados, ${k.feitas} questões respondidas, ${S.sessoes.length} sessões, ${S.disc.tentativas.length} produções discursivas.`
  ].forEach(t=>ul.appendChild(el('li',null,t)));
  c3.appendChild(ul);
  c3.appendChild(el('div',{class:'note'},'As questões e o mapa legislativo são material de estudo produzido para este aplicativo, com a fonte normativa indicada em cada item. Confira sempre o texto oficial antes de firmar posição em prova ou peça. Este aplicativo não substitui o edital, as normas nem os julgados oficiais.'));
  const rz=el('div',{class:'row'});
  rz.appendChild(el('button',{class:'btn gho sm',onclick:async()=>{
    if(!confirm('Apagar TODO o progresso deste navegador e recomeçar? Uma cópia será baixada antes.')) return;
    try{await exportar('antes-de-zerar'); S=novoEstado(); await gravar(); toast('Estado reiniciado.'); go('painel');}
    catch(error){alert('O progresso não foi apagado: '+error.message);}
  }},'Zerar progresso'));
  c3.appendChild(rz);
  m.appendChild(c3);
}
const BACKUP_FORMAT='centro-estudos-dpern-backup';
async function exportar(sufixo){
  const stateJson=JSON.stringify(S);
  const envelope={
    format:BACKUP_FORMAT,formatVersion:1,appVersion:CONTENT_MANIFEST.appVersion,stateSchemaVersion:SCHEMA,
    exportedAt:new Date().toISOString(),contentVersions:S.contentVersions,stateSha256:await sha256Text(stateJson),state:S
  };
  const blob=new Blob([JSON.stringify(envelope,null,1)],{type:'application/json'});
  const a=el('a',{href:URL.createObjectURL(blob),download:`centro-dpern-backup-${hoje()}${sufixo?'-'+sufixo:''}.json`});
  document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},400);
  return true;
}
async function validarBackup(obj){
  if(!obj||typeof obj!=='object') throw new Error('estrutura JSON inválida');
  if(obj.format===BACKUP_FORMAT){
    if(obj.formatVersion!==1) throw new Error(`formato de backup ${obj.formatVersion} não suportado`);
    if(!obj.state||!obj.stateSha256) throw new Error('backup incompleto');
    const atual=await sha256Text(JSON.stringify(obj.state));
    if(atual!==obj.stateSha256) throw new Error('a verificação SHA-256 falhou; o arquivo pode estar truncado ou alterado');
    return validarEstadoRestaurado(obj.state);
  }
  // Compatibilidade explícita com backups 0.7 e snapshots locais anteriores.
  if(obj.schema&&obj.topicos) return validarEstadoRestaurado(obj);
  throw new Error('o arquivo não é um backup reconhecido deste aplicativo');
}
function validarEstadoRestaurado(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('estado ausente ou inválido');
  if(!Number.isInteger(Number(raw.schema))||Number(raw.schema)<1) throw new Error('versão de esquema inválida');
  if(!raw.topicos||typeof raw.topicos!=='object'||Array.isArray(raw.topicos)) throw new Error('progresso por tópicos inválido');
  if(raw.prova&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.prova.data||'')))) throw new Error('data da prova inválida');
  const arrayLimit=(name,limit)=>{ if(raw[name]!=null&&!Array.isArray(raw[name]))throw new Error(`${name} deve ser uma lista`); if((raw[name]||[]).length>limit)throw new Error(`${name} excede o limite de ${limit} registros`); };
  arrayLimit('questoesImportadas',5000); arrayLimit('sessoes',5000); arrayLimit('juris',10000); arrayLimit('ciclosAnteriores',200);
  const grupos=new Set(['I','II','III','IV']), disciplinas=new Set(DADOS.programa.map(t=>t.dc));
  const validarQuestao=(q,contexto)=>{
    if(!q||typeof q!=='object'||!grupos.has(q.g)||!disciplinas.has(q.d)) throw new Error(`${contexto}: grupo ou disciplina inválidos`);
    if(typeof q.id!=='string'||typeof q.e!=='string'||q.e.length>30000) throw new Error(`${contexto}: identificação ou enunciado inválidos`);
    if(!Array.isArray(q.o)||q.o.length!==5||q.o.some(op=>typeof op!=='string'||op.length>15000)) throw new Error(`${contexto}: alternativas inválidas`);
    if(!['A','B','C','D','E'].includes(q.gab)) throw new Error(`${contexto}: gabarito inválido`);
    if(q.u&&!safeUrl(q.u)) throw new Error(`${contexto}: link de fonte inválido`);
  };
  (raw.questoesImportadas||[]).forEach((q,index)=>validarQuestao(q,`questão importada ${index+1}`));
  const sessoes=(raw.sessoes||[]).concat(raw.sessaoAtiva?[raw.sessaoAtiva]:[]);
  sessoes.forEach((sessao,index)=>{
    if(!sessao||!Array.isArray(sessao.itens)||sessao.itens.length>500) throw new Error(`sessão ${index+1}: itens inválidos`);
    sessao.itens.forEach((item,itemIndex)=>{if(item.snapshot)validarQuestao(item.snapshot,`sessão ${index+1}, item ${itemIndex+1}`);});
  });
  const validarCiclo=(ciclo,contexto)=>{
    if(!ciclo)return; if(Number.isInteger(ciclo.dias))return; // resumo histórico produzido pela versão 0.7
    if(!Array.isArray(ciclo.dias)||ciclo.dias.length>100)throw new Error(`${contexto}: dias inválidos`);
    ciclo.dias.forEach(dia=>{if(!Array.isArray(dia.blocos)||dia.blocos.length>30)throw new Error(`${contexto}: blocos inválidos`);
      dia.blocos.forEach(bloco=>{if(bloco.grupo&&!grupos.has(bloco.grupo))throw new Error(`${contexto}: grupo de bloco inválido`); if(!TIPOS[bloco.tipo])throw new Error(`${contexto}: tipo de bloco inválido`);});});
  };
  validarCiclo(raw.ciclo,'ciclo ativo'); (raw.ciclosAnteriores||[]).forEach((ciclo,index)=>validarCiclo(ciclo,`ciclo histórico ${index+1}`));
  return migrar(raw);
}
function importarCSV(txt){
  const linhas=txt.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!linhas.length){ toast('Cole ao menos uma linha.'); return; }
  const DISCS=new Set(DADOS.programa.map(t=>t.dc));
  let ok=0, erros=[];
  linhas.forEach((l,i)=>{
    const p=l.split(';').map(x=>x.trim());
    if(p.length<9){ erros.push(`linha ${i+1}: são necessários ao menos 9 campos`); return; }
    const [g,d,e,a,b,c,dd,ee,gab]=p;
    if(['I','II','III','IV'].indexOf(g)<0){ erros.push(`linha ${i+1}: grupo inválido "${g}"`); return; }
    if(!DISCS.has(d)){ erros.push(`linha ${i+1}: disciplina inválida "${d}"`); return; }
    if(['A','B','C','D','E'].indexOf(gab.toUpperCase())<0){ erros.push(`linha ${i+1}: gabarito inválido "${gab}"`); return; }
    const o=[a,b,c,dd,ee];
    if(o.some(x=>!x)){ erros.push(`linha ${i+1}: alternativa vazia`); return; }
    const url=p[11]?safeUrl(p[11]):'';
    if(p[11]&&!url){ erros.push(`linha ${i+1}: URL inválida`); return; }
    S.questoesImportadas.push({id:'IMP-'+uid(),g,d,t:null,n:'medio',e,o,gab:gab.toUpperCase(),
      exp:p[9]||'Sem explicação registrada.',f:p[10]||'Importada pelo usuário',u:url,src:'import',authorship_type:'USUARIO',rights_status:'RESPONSABILIDADE_USUARIO'});
    ok++;
  });
  salvar();
  toast(`${ok} questão(ões) importada(s).${erros.length?' '+erros.length+' linha(s) com erro.':''}`,4200);
  if(erros.length) alert('Linhas não importadas:\n\n'+erros.slice(0,20).join('\n'));
  render();
}

/* ---------------------------------------------------------------- boot */
function tema(){
  document.documentElement.dataset.theme = S.ui.tema==='light'?'light':'dark';
}
async function init(){
  try{
    await carregarConteudo();
    idb=await openIDB();
    if(!idb) throw new Error('O armazenamento local do navegador (IndexedDB) não está disponível. Verifique as permissões de dados deste site.');
    await carregar();
    await gravar();
    tema();
    $('#chipConteudo').textContent=`Conteúdo: ${CONTENT_MANIFEST.questionBankVersion}`;
    $('#btnTheme').onclick=()=>{ S.ui.tema = S.ui.tema==='light'?'dark':'light'; tema(); salvar(); };
    nav(); render();
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Service worker indisponível:',error));
    }
    window.__DPE_READY__=true;
  }catch(error){
    console.error(error); window.__DPE_BOOT_ERROR__=error.message;
    const main=$('#main'); main.innerHTML='';
    const card=el('section',{class:'card'}); card.appendChild(el('h2',null,'Não foi possível abrir o Centro de Estudos'));
    const p=el('p'); p.textContent=error.message; card.appendChild(p);
    card.appendChild(el('div',{class:'note'},'Recarregue a página. Se o problema persistir, confirme que o site está sendo servido por HTTPS ou por um servidor local e que o navegador permite armazenamento para este endereço.'));
    main.appendChild(card);
  }
}
init();
})();
