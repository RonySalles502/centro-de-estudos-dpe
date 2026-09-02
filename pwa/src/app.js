/* Centro de Estudos DPE/RN — PWA local-first. Sem dependências externas. */
(function(){
"use strict";

/* ---------------------------------------------------------------- utils */
const $ = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const el = (t,a,h)=>{const n=document.createElement(t); if(t==='button')n.type='button'; if(a) for(const k in a){ if(k==='class')n.className=a[k]; else if(k.slice(0,2)==='on')n.addEventListener(k.slice(2),a[k]); else if(a[k]!=null)n.setAttribute(k,a[k]); } if(h!=null)n.innerHTML=h; return n;};
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
let DADOS=null, DADOS_BASE=null, CONTENT_MANIFEST=null, JURIS_META=null;
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
function configurarPerfil(perfil){
  if(!DADOS_BASE){
    DADOS_BASE={meta:DADOS.meta,programa:DADOS.programa,legislacao:DADOS.legislacao};
  }
  const cfg=((DADOS.perfis||{})[perfil]||{}),meta=cfg.meta||DADOS_BASE.meta;
  DADOS.meta={...DADOS_BASE.meta,...meta};
  if(perfil==='SP'){
    const excluidos=new Set(cfg.exclude_topic_ids||[]);
    DADOS.programa=DADOS_BASE.programa.filter(t=>!excluidos.has(t.id)).concat((cfg.supplement_topics||[]).map(t=>({...t})));
    const leg=cfg.legislation||{};
    DADOS.legislacao={...DADOS_BASE.legislacao,
      topicos:{...DADOS_BASE.legislacao.topicos,...(leg.topics||{})},
      fontes:{...DADOS_BASE.legislacao.fontes,...(leg.sources||{})},
      sem_dispositivo:Array.from(new Set(DADOS_BASE.legislacao.sem_dispositivo.concat(leg.no_specific_articles||[])))};
  }else{
    DADOS.programa=DADOS_BASE.programa;
    DADOS.legislacao=DADOS_BASE.legislacao;
  }
}
async function carregarConteudo(){
  const manifestUrl=new URL('./content/manifest.json',location.href);
  const response=await fetch(manifestUrl,{cache:'no-store'});
  if(!response.ok) throw new Error(`Não foi possível carregar o conteúdo (${response.status}).`);
  const manifest=await response.json();
  if(manifest.format!=='centro-estudos-dpern-content'||manifest.formatVersion!==1) throw new Error('Este conteúdo não é compatível com o aplicativo.');
  const [core,juris]=await Promise.all([
    fetchVerified(manifest.assets.core,manifestUrl),
    fetchVerified(manifest.assets.jurisprudence,manifestUrl)
  ]);
  DADOS=core;
  DADOS.precedentes=expandJurisprudence(juris);
  DADOS.jurisprudence_meta=juris;
  CONTENT_MANIFEST=manifest;
  JURIS_META=juris;
  configurarPerfil('RN');
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
const SCHEMA=9;
function novoEstado(){
  const tp={}; DADOS.programa.forEach(t=>{ tp[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''}; });
  return {
    schema:SCHEMA, criado:new Date().toISOString(), atualizado:new Date().toISOString(),
    perfil:'RN', perfilEstados:{RN:null,SP:null},
    contentVersions:{app:CONTENT_MANIFEST.appVersion,content:CONTENT_MANIFEST.contentVersion,questions:CONTENT_MANIFEST.questionBankVersion,jurisprudence:CONTENT_MANIFEST.jurisprudenceVersion},
    prova:{data:DADOS.meta.data_prova_estimada, confirmada:false, fonte:''},
    topicos:tp,
    diag:{ minutos:{SEG:120,TER:120,QUA:120,QUI:120,SEX:120,SAB:180,DOM:60},
           nivel:'INTERMEDIARIO', bloco:50, horizonte:28, leiMinArt:2, leiMaxDia:1,
           pg:{I:25,II:25,III:25,IV:25},
           pc:{LEITURA:25,QUESTOES:25,JURISPRUDENCIA:15,REVISAO:15,DISCURSIVA:10,SIMULADO:10},
           preenchido:false },
    ciclo:null, ciclosAnteriores:[],
    revisoes:{}, revisoesManuais:[], informativos:{}, exposicao:{}, sessoes:[], sessaoAtiva:null,
    disc:{ temas:[], tentativas:[] },
    juris:[], questoesImportadas:[],
    ui:{ tema:'light', semana:0 }, audit:[]
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
  if(version>SCHEMA) throw new Error('Esta cópia foi criada por uma versão mais nova do aplicativo.');
  if(!o.topicos||typeof o.topicos!=='object') throw new Error('Estado local inválido: progresso por tópicos ausente.');
  if(!o.disc||typeof o.disc!=='object')o.disc={temas:[],tentativas:[]};
  if(!Array.isArray(o.disc.temas))o.disc.temas=[]; if(!Array.isArray(o.disc.tentativas))o.disc.tentativas=[];
  if(!Array.isArray(o.juris))o.juris=[]; if(!Array.isArray(o.questoesImportadas))o.questoesImportadas=[];
  if(!o.exposicao||typeof o.exposicao!=='object')o.exposicao={}; if(!Array.isArray(o.ciclosAnteriores))o.ciclosAnteriores=[];
  if(!Array.isArray(o.sessoes))o.sessoes=[]; if(!o.revisoes||typeof o.revisoes!=='object')o.revisoes={};
  if(!Array.isArray(o.revisoesManuais))o.revisoesManuais=[];
  if(!o.informativos||typeof o.informativos!=='object'||Array.isArray(o.informativos))o.informativos={};
  if(!o.diag||typeof o.diag!=='object')throw new Error('Estado local inválido: diagnóstico ausente.');
  o.diag.leiMinArt=clamp(Number(o.diag.leiMinArt)||2,1,5);
  o.diag.leiMaxDia=1;
  if(!o.ui||typeof o.ui!=='object')o.ui={tema:'dark',semana:0}; if(!Array.isArray(o.audit))o.audit=[];
  if(!['RN','SP'].includes(o.perfil))o.perfil='RN';
  if(!o.perfilEstados||typeof o.perfilEstados!=='object'||Array.isArray(o.perfilEstados))o.perfilEstados={RN:null,SP:null};
  if(!('RN' in o.perfilEstados))o.perfilEstados.RN=null;if(!('SP' in o.perfilEstados))o.perfilEstados.SP=null;
  if(version<8){
    o.contentVersions={app:'0.7.0',content:'legado-v7',questions:'legado-v7',jurisprudence:'legado-v7'};
    o.audit.push({at:new Date().toISOString(),event:'STATE_MIGRATED',from:version,to:8});
  }
  if(version<9)o.audit.push({at:new Date().toISOString(),event:'STATE_MIGRATED',from:version,to:9});
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
function notaObjetiva(sessao){
  const certos=sessao.itens.filter(i=>i.certo).length;
  return (sessao.perfil||'RN')==='SP'?(certos/Math.max(sessao.itens.length,1))*10:certos*0.10;
}

/* ---------------------------------------------------------------- SRS */
const SRS_LAB={REPETIR:'Repetir',DIFICIL:'Difícil',BOM:'Bom',FACIL:'Fácil'};
function garanteRevisao(tid){
  if(!S.revisoes[tid]){
    S.revisoes[tid]={int:0,ease:2.5,reps:0,prox:hoje(),ult:null,ultAv:null};
    sincronizarRevisaoNoCiclo(tid,hoje());
  }
}
function avaliarRevisao(tid,av){
  garanteRevisao(tid); const r=S.revisoes[tid]; let {int,ease,reps}=r;
  if(av==='REPETIR'){ int=1; reps=0; ease=Math.max(1.3,ease-0.2); }
  else if(av==='DIFICIL'){ int = reps===0?2:Math.max(2,Math.ceil(Math.max(int,1)*1.2)); reps++; ease=Math.max(1.3,ease-0.15); }
  else if(av==='BOM'){ int = reps===0?3:Math.max(3,Math.round(Math.max(int,1)*ease)); reps++; }
  else { int = reps===0?7:Math.max(7,Math.round(Math.max(int,1)*ease*1.3)); reps++; ease=Math.min(3.5,ease+0.15); }
  r.int=int; r.ease=ease; r.reps=reps; r.ult=hoje(); r.ultAv=av; r.prox=addDays(hoje(),int);
  sincronizarRevisaoNoCiclo(tid,r.prox);
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
const TIPOS={LEITURA:'Teoria',LEI_SECA:'Lei seca',QUESTOES:'Questões',JURISPRUDENCIA:'Jurisprudência',REVISAO:'Revisão',DISCURSIVA:'Discursiva',SIMULADO:'Simulado'};
const FOCOS_PRE_EDITAL={
  MUITO_ALTA:{rotulo:'Muito alto',ordem:0,classe:'foco-muito-alto'},
  ALTA:{rotulo:'Alto',ordem:1,classe:'foco-alto'},
  MEDIA:{rotulo:'Médio',ordem:2,classe:'foco-medio'}
};
const BASES_PRE_EDITAL={
  NUCLEO_RECORRENTE_E_FASE_APLICADA:'núcleo recorrente com incidência discursiva, oral ou prática',
  RECORRENCIA_INSTITUCIONAL:'núcleo institucional recorrente nos concursos de Defensoria',
  RECORRENCIA_PROGRAMATICA:'conteúdo recorrente nos programas Cebraspe analisados',
  COMPLEMENTO_OU_AMPLIACAO_ESPECIFICA:'complemento teórico ou ampliação específica da Resolução nº 344/2025'
};
function focoDoTopico(tid){
  if(S&&S.perfil==='SP'&&String(tid).startsWith('SP-')){
    const meta=FOCOS_PRE_EDITAL.ALTA;
    return {tier:'ALTA',base:'PROGRAMA_IX_DPE_SP',rotulo:meta.rotulo,ordem:meta.ordem,classe:meta.classe,explicacao:'conteúdo específico do programa do IX Concurso DPE/SP'};
  }
  const raw=(((DADOS||{}).priorizacao||{}).topicos||{})[tid]||['ALTA','RECORRENCIA_PROGRAMATICA'];
  const tier=raw[0], meta=FOCOS_PRE_EDITAL[tier]||FOCOS_PRE_EDITAL.ALTA;
  return {tier,base:raw[1],rotulo:meta.rotulo,ordem:meta.ordem,classe:meta.classe,explicacao:BASES_PRE_EDITAL[raw[1]]||raw[1]};
}
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
  const pe=focoDoTopico(t.id).ordem;
  // "nunca testado" NÃO equivale a "sempre errado": vale como neutro (0.5)
  const acc = (p.fz>0) ? (p.ac/p.fz) : 0.5;
  if(tipo==='QUESTOES') return [pr,acc,pe,dm,st,t.it];
  return [pr,st,dm,pe,acc,t.it];
}
function cmpArr(a,b){ for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) return a[i]<b[i]?-1:1; } return 0; }
function leiDoTopico(tid){
  const m=DADOS.legislacao.topicos[tid];
  if(m) return m.map(([c,arts])=>({code:c, nome:(DADOS.legislacao.fontes[c]||[c,''])[0], url:(DADOS.legislacao.fontes[c]||['',''])[1], arts:arts}));
  if(DADOS.legislacao.sem_dispositivo.indexOf(tid)>=0) return [{sem:true}];
  return [];
}
function numeroArtigo(value){return Number(String(value||'').replace(/\./g,''))||0;}
function estimarArtigos(referencia){
  const texto=String(referencia||'').replace(/[º°]/g,'');
  let total=0, encontrou=false;
  const ocupados=[];
  const faixa=/(\d{1,4}(?:\.\d{3})?)(?:-[A-Z])?\s*(?:a|até|-)\s*(\d{1,4}(?:\.\d{3})?)(?:-[A-Z])?/gi;
  let match;
  while((match=faixa.exec(texto))){
    const inicio=numeroArtigo(match[1]),fim=numeroArtigo(match[2]);
    if(inicio&&fim>=inicio&&fim-inicio<500){total+=fim-inicio+1;encontrou=true;ocupados.push([match.index,faixa.lastIndex]);}
  }
  const restante=texto.split('').map((char,index)=>ocupados.some(([a,b])=>index>=a&&index<b)?' ':char).join('');
  const avulsos=restante.match(/\b\d{1,4}(?:\.\d{3})?(?:-[A-Z])?\b/g)||[];
  if(avulsos.length){total+=avulsos.length;encontrou=true;}
  return encontrou?Math.max(1,total):1;
}
const ALIASES_NORMAS={
  CF:['cf','constituicao federal'],CP:['cp','codigo penal'],CPP:['cpp','codigo de processo penal'],LEP:['lep','lei de execucao penal'],
  CC:['cc','cc/2002','codigo civil'],CPC:['cpc','codigo de processo civil'],CDC:['cdc','codigo de defesa do consumidor'],
  ECA:['eca','estatuto da crianca e do adolescente'],LC80:['lc 80','lc nº 80','lei complementar 80']
};
function textoBuscaLei(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');}
function segmentoCitaNorma(segmento,codigo){
  const texto=textoBuscaLei(segmento),aliases=ALIASES_NORMAS[codigo]||[];
  if(aliases.some(alias=>new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(texto)))return true;
  const numero=String(codigo||'').match(/^(?:LC|L|D)(\d{2,6})$/);if(!numero)return false;
  const digitos=texto.replace(/\D/g,'');return digitos.includes(numero[1]);
}
function artigosCitados(segmento){
  const marcador=String(segmento||'').match(/\b(?:arts?|artigos?)\.?\s+(.+)$/i);if(!marcador)return [];
  const corpo=marcador[1].split(/§|incisos?|al[ií]neas?|par[aá]grafo/i)[0],artigos=[];let match;
  const faixas=/\b(\d{1,4})(?:-[A-Z])?\s*(?:a|at[eé]|-)\s*(\d{1,4})(?:-[A-Z])?/gi;
  const ocupados=[];
  while((match=faixas.exec(corpo))){const inicio=Number(match[1]),fim=Number(match[2]);if(inicio&&fim>=inicio&&fim-inicio<250){for(let n=inicio;n<=fim;n++)artigos.push(n);ocupados.push([match.index,faixas.lastIndex]);}}
  const restante=corpo.split('').map((char,index)=>ocupados.some(([a,b])=>index>=a&&index<b)?' ':char).join('');
  (restante.match(/\b\d{1,4}(?:-[A-Z])?\b/g)||[]).forEach(value=>{const numero=Number(value.match(/\d+/)[0]);if(numero)artigos.push(numero);});
  return artigos;
}
function artigosPrioritarios(tid,lei,inicio,fim){
  const pesos=new Map(),somar=(artigo,peso)=>{if(artigo>=inicio&&artigo<=fim)pesos.set(artigo,(pesos.get(artigo)||0)+peso);};
  const enfase=String(lei.arts||'').split(/(?:com\s+)?[eê]nfase(?:\s+n[oa]s?)?/i)[1];
  if(enfase)artigosCitados(`arts. ${enfase}`).forEach(artigo=>somar(artigo,100));
  const topico=DADOS.programa.find(item=>item.id===tid),questoes=DADOS.questoes||[];
  const relacionadas=questoes.filter(q=>q.t===tid),disciplina=topico?questoes.filter(q=>q.d===topico.dc):[];
  relacionadas.concat(disciplina).forEach((q,index)=>{
    const peso=index<relacionadas.length?18:3;
    String(q.f||'').split(';').filter(segmento=>segmentoCitaNorma(segmento,lei.code)).forEach(segmento=>artigosCitados(segmento).forEach(artigo=>somar(artigo,peso)));
  });
  return [...pesos.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([artigo])=>artigo);
}
function rotuloArtigos(artigos){return `${artigos.length===1?'art.':'arts.'} ${artigos.join(', ')}`;}
function dividirFaixaSimples(lei,capacidade,tid){
  const texto=String(lei.arts||'').trim();
  const match=texto.match(/^\s*(arts?\.?\s*)?(\d{1,4}(?:\.\d{3})?)([º°]?)(?:-([A-Z]))?\s*(?:a|até|-)\s*(\d{1,4}(?:\.\d{3})?)([º°]?)(?:-([A-Z]))?\s*$/i);
  if(!match)return null;
  const inicio=numeroArtigo(match[2]),fim=numeroArtigo(match[5]);
  if(!inicio||fim<inicio||fim-inicio>=500)return null;
  const partes=[],prioritarios=artigosPrioritarios(tid,lei,inicio,fim),jaPriorizados=new Set(prioritarios);
  for(let i=0;i<prioritarios.length;i+=capacidade){
    const artigos=prioritarios.slice(i,i+capacidade);
    partes.push({...lei,arts:rotuloArtigos(artigos),artigos:artigos.length,prioridadeLei:'NUCLEO',criterioLei:'artigos relacionados ao tema e às referências do banco de questões'});
  }
  let atual=inicio;
  while(atual<=fim){
    while(atual<=fim&&jaPriorizados.has(atual))atual++;
    if(atual>fim)break;
    const artigos=[];
    while(atual<=fim&&artigos.length<capacidade){if(!jaPriorizados.has(atual))artigos.push(atual);atual++;}
    if(artigos.length)partes.push({...lei,arts:artigos.length===1?`art. ${artigos[0]}º`:`arts. ${artigos[0]}º a ${artigos[artigos.length-1]}º`,artigos:artigos.length,prioridadeLei:'COBERTURA',criterioLei:'complementação da faixa legislativa vinculada ao tópico'});
  }
  return partes;
}
function fragmentosLei(tid,minutosBloco){
  const leis=leiDoTopico(tid);
  if(!leis.length||leis[0].sem)return [];
  const ritmo=clamp(Number(S.diag.leiMinArt)||2,1,5);
  const capacidade=Math.max(1,Math.floor(minutosBloco/ritmo));
  const partes=[];
  leis.forEach(lei=>{
    const exatas=dividirFaixaSimples(lei,capacidade,tid);
    if(exatas){partes.push(...exatas);return;}
    const artigos=estimarArtigos(lei.arts),quantidade=Math.max(1,Math.ceil(artigos/capacidade));
    for(let i=0;i<quantidade;i++)partes.push({...lei,arts:quantidade===1?lei.arts:`${lei.arts} — parte ${i+1}/${quantidade}`,artigos:Math.min(capacidade,Math.max(1,artigos-i*capacidade))});
  });
  return partes.map((parte,index)=>({...parte,seq:index+1,total:partes.length,ritmo,minEstimados:Math.ceil((parte.artigos||1)*ritmo)}));
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
    SIMULADO:ativos.every(g=>(contagem[g]||0)>=simuladoConfig().porGrupo)
  };
  const motivos={
    QUESTOES:'não há questões em todos os grupos selecionados',
    JURISPRUDENCIA:'a base atual de jurisprudência está vazia',
    REVISAO:'não há revisões previstas no horizonte deste ciclo',
    DISCURSIVA:'não há temas discursivos para todos os grupos selecionados',
    SIMULADO:`é necessário ter ao menos ${simuladoConfig().porGrupo} questões em cada grupo selecionado`
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
function blocoRevisao(tid,data,minutos,extra){
  const t=DADOS.programa.find(x=>x.id===tid);if(!t)return null;
  return {id:uid(),data,tipo:'REVISAO',grupo:t.g,min:minutos,st:'PENDENTE',tid:t.id,tit:t.to,disc:t.di,lei:leiDoTopico(t.id),...extra};
}
function minutosAlocados(dia){return dia.blocos.reduce((total,bloco)=>total+(Number(bloco.min)||0),0);}
function inserirBlocoNoCiclo(bloco,dataMinima){
  if(!S.ciclo)return null;
  const ultimo=addDays(S.ciclo.inicio,S.ciclo.horizonte-1);
  if(dataMinima>ultimo)return null;
  const candidato=S.ciclo.dias.find(dia=>dia.data>=dataMinima&&minutosAlocados(dia)+bloco.min<=dia.min&&(!bloco.autoReview||!dia.blocos.some(item=>item.autoReview&&item.st!=='CONCLUIDO')));
  if(!candidato)return null;
  bloco.data=candidato.data;candidato.blocos.push(bloco);return candidato.data;
}
function sincronizarRevisaoNoCiclo(tid,data){
  if(!S.ciclo)return null;
  const existente=S.ciclo.dias.flatMap(dia=>dia.blocos).find(bloco=>bloco.tipo==='REVISAO'&&bloco.tid===tid&&bloco.autoReview&&bloco.st!=='CONCLUIDO');
  if(existente)return existente.data;
  const bloco=blocoRevisao(tid,data,20,{autoReview:true,why:`Revisão automática prevista para ${fmtBR(data)}.`});
  return bloco?inserirBlocoNoCiclo(bloco,data):null;
}
function gerarCiclo(){
  const d=S.diag, inicio=hoje(),fim=addDays(inicio,d.horizonte-1);
  const conteudo=pesosDeConteudoDisponivel(d,inicio);
  const dias=[]; const alocC={}, alocG={};
  Object.keys(conteudo.pesos).forEach(k=>alocC[k]=0); Object.keys(d.pg).forEach(k=>alocG[k]=0);
  const porGrupo={}; ['I','II','III','IV'].forEach(g=>{ porGrupo[g]=DADOS.programa.filter(t=>t.g===g); });
  const topicosComQuestoes=new Set(bancoQuestoes().map(q=>q.t).filter(Boolean));
  const usados={},pendentesLei=[],pendentesQuestoes=[],manuaisUsadas=new Set();let ultimoTidLei='';
  const autoRevisoes=Object.entries(S.revisoes).filter(([,r])=>r.prox<=fim).map(([tid,r])=>({tid,due:r.prox,usada:false})).sort((a,b)=>a.due.localeCompare(b.due));
  const filaInformativos=trilhaInformativos().sort((a,b)=>Number(!!(S.informativos[a.key]||{}).lido)-Number(!!(S.informativos[b.key]||{}).lido));let indiceInformativo=0;
  const ajustes=conteudo.ajustes.slice();
  for(let i=0;i<d.horizonte;i++){
    const data=addDays(inicio,i),dw=DIAS[parseISO(data).getDay()],min=d.minutos[dw]||0,blocos=[];
    const manuais=(S.revisoesManuais||[]).filter(item=>item.data<=data&&item.st!=='CONCLUIDO'&&!manuaisUsadas.has(item.id));
    manuais.forEach(item=>{
      const duracao=clamp(Number(item.min)||30,20,120);
      const bloco=blocoRevisao(item.tid,data,duracao,{manualId:item.id,manualReview:true,why:item.nota?`Revisão manual: ${item.nota}`:'Revisão manual adicionada pelo estudante.'});
      if(bloco&&minutosAlocados({blocos})+duracao<=min){blocos.push(bloco);manuaisUsadas.add(item.id);}
    });
    let leisHoje=0,revisoesHoje=0;
    while(min-minutosAlocados({blocos})>=d.bloco){
      let bl=null;
      const candidatasLei=pendentesLei.filter(item=>!item.usada&&item.due<=data&&leisHoje<d.leiMaxDia).sort((a,b)=>
        Number(b.parte.prioridadeLei==='NUCLEO')-Number(a.parte.prioridadeLei==='NUCLEO')||
        Number(a.tid===ultimoTidLei)-Number(b.tid===ultimoTidLei)||
        focoDoTopico(a.tid).ordem-focoDoTopico(b.tid).ordem||a.due.localeCompare(b.due)||a.parte.seq-b.parte.seq);
      const leiPendente=candidatasLei[0];
      const questaoPendente=pendentesQuestoes.find(item=>!item.usada&&item.due<=data);
      if(leiPendente){
        leiPendente.usada=true;leisHoje++;ultimoTidLei=leiPendente.tid;
        const t=DADOS.programa.find(x=>x.id===leiPendente.tid),parte=leiPendente.parte;
        bl={id:uid(),data,tipo:'LEI_SECA',grupo:t.g,min:d.bloco,st:'PENDENTE',tid:t.id,tit:t.to,disc:t.di,etapa:'LEI_SECA',lei:[parte],origemData:leiPendente.origemData,cargaLei:parte,
          why:parte.prioridadeLei==='NUCLEO'?`Lei seca focada: núcleo prioritário do tema alocado antes da cobertura complementar, com até ${d.bloco} min no ritmo de ${nf(parte.ritmo)} min por artigo.`:`Lei seca complementar ${parte.seq}/${parte.total}, alternada com outros tópicos e limitada a ${d.bloco} min.`};
        alocC.LEITURA=(alocC.LEITURA||0)+d.bloco;alocG[t.g]=(alocG[t.g]||0)+d.bloco;
      }else if(questaoPendente){
        questaoPendente.usada=true;
        const t=DADOS.programa.find(x=>x.id===questaoPendente.tid);
        bl={id:uid(),data,tipo:'QUESTOES',grupo:t.g,min:d.bloco,st:'PENDENTE',tid:t.id,tit:t.to,disc:t.di,etapa:'QUESTOES',origemData:questaoPendente.origemData,
          why:`Questões automáticas: consolidação programada 8 dias após a teoria de ${fmtBR(questaoPendente.origemData)}.`};
        alocC.QUESTOES=(alocC.QUESTOES||0)+d.bloco;alocG[t.g]=(alocG[t.g]||0)+d.bloco;
      }else{
        let tipo=pesoEscolha(conteudo.pesos,alocC);if(!tipo)break;
        if(tipo==='REVISAO'){
          const revisaoPendente=revisoesHoje<1?autoRevisoes.find(item=>!item.usada&&item.due<=data):null;
          if(revisaoPendente){
            revisaoPendente.usada=true;revisoesHoje++;
            bl=blocoRevisao(revisaoPendente.tid,data,d.bloco,{autoReview:true,why:`Revisão automática prevista para ${fmtBR(revisaoPendente.due)}. Limitada a um bloco automático neste dia e distribuída conforme o peso de revisão do ciclo.`});
            if(bl){alocC.REVISAO=(alocC.REVISAO||0)+d.bloco;alocG[bl.grupo]=(alocG[bl.grupo]||0)+d.bloco;}
          }else tipo=pesoEscolha({...conteudo.pesos,REVISAO:0},alocC)||'LEITURA';
          if(!bl)tipo=pesoEscolha({...conteudo.pesos,REVISAO:0},alocC)||'LEITURA';
        }
        if(bl){blocos.push(bl);continue;}
        alocC[tipo]=(alocC[tipo]||0)+d.bloco;
        const grupo=pesoEscolha(d.pg,alocG);alocG[grupo]=(alocG[grupo]||0)+d.bloco;
        bl={id:uid(),data,tipo,grupo,min:d.bloco,st:'PENDENTE'};
        if(tipo==='JURISPRUDENCIA'){
          const info=filaInformativos.length?filaInformativos[indiceInformativo++%filaInformativos.length]:null;
          if(info){
            const prioridade=info.score>=40?'muito alta':info.score>=24?'alta':'regular',fonte=info.itens.find(item=>safeUrl(item.url));
            bl.tit=`Informativo ${info.trib} nº ${info.numero} (${info.ano})`;
            bl.informativo={key:info.key,trib:info.trib,numero:info.numero,ano:info.ano,itens:info.itens.length,prioridade,grupos:Array.from(info.grupos),url:fonte?safeUrl(fonte.url):''};
            bl.why=`Leitura dirigida de ${info.itens.length} julgamento(s), com prioridade ${prioridade} para provas de Defensoria. A sequência intercala STF e STJ e antecipa os informativos de maior afinidade temática.`;
          }else{bl.tit='Informativos STF/STJ priorizados';bl.why='Atualize a base oficial para vincular este bloco a um número de informativo.';}
        }else if(tipo==='DISCURSIVA'){
          const tema=(S.disc.temas.concat(DADOS.temas_discursivos)).filter(x=>x.g===grupo);
          bl.tit=tema.length?tema[i%tema.length].tit:'Treino discursivo livre';bl.why='Segunda etapa tem peso 4 na nota final (art. 60, II).';
        }else if(tipo==='SIMULADO'){
          bl.tit=`Simulado do Grupo ${grupo} — ${simuladoConfig().porGrupo} questões`;bl.why=S.perfil==='SP'?'Simulação proporcional do formato de 88 questões do último edital DPE/SP.':'Simulação no formato do art. 42 da Resolução nº 344/2025.';
        }else{
          const base=porGrupo[grupo].filter(t=>tipo!=='QUESTOES'||topicosComQuestoes.has(t.id));
          const cand=base.filter(t=>!usados[tipo+'|'+t.id]);
          const lista=(cand.length?cand:base).slice().sort((a,b)=>cmpArr(scoreTopico(a,tipo),scoreTopico(b,tipo)));
          const t=lista[0];
          if(t){
            usados[tipo+'|'+t.id]=1;bl.tid=t.id;bl.tit=t.to;bl.disc=t.di;bl.item=t.it;bl.etapa=tipo==='LEITURA'?'TEORIA':tipo;
            const p=S.topicos[t.id]||{},foco=focoDoTopico(t.id);bl.foco=foco.tier;
            const razoes=[];
            if(p.pr==='ALTA')razoes.push('prioridade alta');if((p.st||'NAO_INICIADO')==='NAO_INICIADO')razoes.push('ainda não iniciado');
            if(p.fz>0&&p.ac/p.fz<0.7)razoes.push(`acurácia de ${pct(p.ac,p.fz)}%`);if((p.dm||0)<=2&&(p.st||'')!=='NAO_INICIADO')razoes.push(`domínio ${p.dm||0}/5`);
            if(foco.tier==='MUITO_ALTA')razoes.push('foco pré-edital muito alto');else if(foco.tier==='ALTA')razoes.push('foco pré-edital alto');
            bl.why=razoes.length?('Selecionado por '+razoes.join(', ')+'.'):'Sequência programática do Anexo I.';
            if(tipo==='LEITURA'){
              const partes=fragmentosLei(t.id,d.bloco);
              partes.forEach(parte=>pendentesLei.push({tid:t.id,parte,due:addDays(data,1),origemData:data,usada:false}));
              if(topicosComQuestoes.has(t.id))pendentesQuestoes.push({tid:t.id,due:addDays(data,8),origemData:data,usada:false});
              bl.why+=partes.length?` A lei seca foi separada em ${partes.length} bloco(s) executável(is), a partir do próximo dia de estudo.`:' Sem faixa específica de lei seca.';
            }
          }
        }
      }
      if(bl)blocos.push(bl);else break;
    }
    dias.push({data,dw,min,blocos});
  }
  const leiRestante=pendentesLei.filter(item=>!item.usada).length,questoesRestantes=pendentesQuestoes.filter(item=>!item.usada).length,revisoesRestantes=autoRevisoes.filter(item=>!item.usada).length;
  const manuaisRestantes=(S.revisoesManuais||[]).filter(item=>item.st!=='CONCLUIDO'&&item.data<=fim&&!manuaisUsadas.has(item.id)).length;
  if(leiRestante)ajustes.push(`${leiRestante} bloco(s) de lei seca ultrapassaram o horizonte e serão considerados no próximo ciclo.`);
  if(questoesRestantes)ajustes.push(`${questoesRestantes} bloco(s) de questões automáticas ficaram para o próximo ciclo.`);
  if(revisoesRestantes)ajustes.push(`${revisoesRestantes} revisão(ões) automática(s) ficaram para o próximo ciclo.`);
  if(manuaisRestantes)ajustes.push(`${manuaisRestantes} revisão(ões) manual(is) aguardam espaço em um próximo ciclo.`);
  if(S.ciclo)S.ciclosAnteriores.push(JSON.parse(JSON.stringify(S.ciclo)));
  S.ciclo={gerado:new Date().toISOString(),inicio,horizonte:d.horizonte,pesosConteudo:conteudo.pesos,ajustes,dias,regrasCarga:{leiMinArt:d.leiMinArt,leiMaxDia:d.leiMaxDia,revisaoAutomaticaMaxDia:1}};
  S.ui.semana=0;salvar();
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
function configPerfil(){return ((DADOS.perfis||{})[S.perfil]||{});}
function simuladoConfig(){return {total:Number(DADOS.meta.simulado_total)||100,porGrupo:Number(DADOS.meta.simulado_por_grupo)||25,duracao:DADOS.meta.simulado_duracao||'5h'};}
function trocarPerfil(novo){
  if(novo===S.perfil||!['RN','SP'].includes(novo))return;
  S.perfilEstados[S.perfil]={prova:JSON.parse(JSON.stringify(S.prova)),diag:JSON.parse(JSON.stringify(S.diag)),ciclo:S.ciclo?JSON.parse(JSON.stringify(S.ciclo)):null};
  const anterior=S.perfil;S.perfil=novo;configurarPerfil(novo);
  const salvo=S.perfilEstados[novo];
  if(salvo){S.prova=salvo.prova;S.diag=salvo.diag;S.ciclo=salvo.ciclo;}
  else{
    S.prova={data:DADOS.meta.data_prova_estimada||'',confirmada:false,fonte:''};
    S.diag=JSON.parse(JSON.stringify(S.diag));
    if(novo==='SP')S.diag.pc={LEITURA:20,QUESTOES:25,JURISPRUDENCIA:15,REVISAO:15,DISCURSIVA:20,SIMULADO:5};
    S.ciclo=null;
  }
  DADOS.programa.forEach(t=>{if(!S.topicos[t.id])S.topicos[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''};});
  fProg={g:'',d:'',st:'',f:'',q:''};
  S.ui.semana=0;S.audit.push({at:new Date().toISOString(),event:'PROFILE_CHANGED',from:anterior,to:novo});
  if(saveT){clearTimeout(saveT);saveT=null;}gravar().catch(handlePersistenceError);nav();render();
}

/* ---------------------------------------------------------------- render: navegação */
const VIEWS=[
  ['painel','Painel'],['programa','Programa'],['cronograma','Cronograma'],['questoes','Questões'],
  ['simulados','Simulados'],['discursivas','Discursivas'],['revisoes','Revisões'],
  ['juris','Jurisprudência'],['dados','Ajustes']
];
let atual='painel';
function nav(){
  const n=$('#tabs'); n.innerHTML='';
  VIEWS.forEach(([k,l])=>{ n.appendChild(el('button',{class:atual===k?'on':'',onclick:()=>go(k),'aria-current':atual===k?'page':null},esc(l))); });
}
function go(k){ atual=k; nav(); render(); window.scrollTo({top:0,behavior:'instant'}); $('#main').focus({preventScroll:true}); }
function render(){
  const m=$('#main'); m.innerHTML='';
  ({painel:vPainel,programa:vPrograma,cronograma:vCronograma,questoes:vQuestoes,simulados:vSimulados,
    discursivas:vDiscursivas,revisoes:vRevisoes,juris:vJuris,dados:vDados}[atual]||vPainel)(m);
  $('#chipProva').textContent = S.prova.data?`Prova: ${fmtBR(S.prova.data)}${S.prova.confirmada?'':' (estimada)'}`:'Prova: a definir';
  $('#chipBanca').textContent = `Banca: ${DADOS.meta.banca}`;
  $('#brandContext').textContent=S.perfil==='SP'?'DPE / São Paulo':'DPE / Rio Grande do Norte';
  $('#profileSelect').value=S.perfil;
  document.title=`Centro de Estudos ${DADOS.meta.sigla||('DPE/'+S.perfil)}`;
}

/* ---------------------------------------------------------------- view: painel */
function cicloVisual(b){
  if(b.tipo==='LEITURA'||b.etapa==='TEORIA')return {n:1,classe:'cycle-1',rotulo:'Ciclo 1 — Teoria'};
  if(b.tipo==='LEI_SECA'||b.etapa==='LEI_SECA')return {n:2,classe:'cycle-2',rotulo:'Ciclo 2 — Lei seca focada'};
  if(b.tipo==='QUESTOES')return {n:3,classe:'cycle-3',rotulo:'Ciclo 3 — Questões'};
  const extras={REVISAO:['cycle-review','Revisão programada'],JURISPRUDENCIA:['cycle-juris','Jurisprudência e informativos'],DISCURSIVA:['cycle-writing','Treino discursivo'],SIMULADO:['cycle-sim','Simulado']};
  const extra=extras[b.tipo]||['cycle-extra',TIPOS[b.tipo]||b.tipo];
  return {n:4,classe:extra[0],rotulo:extra[1]};
}
function agendaCompacta(b){
  const visual=cicloVisual(b),item=el('div',{class:'agenda-item '+visual.classe});
  item.appendChild(el('span',{class:'agenda-dot','aria-hidden':'true'}));
  const copy=el('div');copy.appendChild(el('b',null,esc(visual.rotulo)));
  copy.appendChild(el('small',null,esc(b.disc||b.tit||'Atividade programada')));item.appendChild(copy);
  item.appendChild(el('span',{class:'agenda-time'},`${b.min} min`));return item;
}
function vPainel(m){
  const k=metricas(); const dias=S.prova.data?diasEntre(hoje(),S.prova.data):null;
  const todosBlocos=S.ciclo?S.ciclo.dias.flatMap(d=>d.blocos):[],concluidos=todosBlocos.filter(b=>b.st==='CONCLUIDO').length;
  const progresso=pct(concluidos,todosBlocos.length),hojeISO=hoje(),diaHoje=S.ciclo?S.ciclo.dias.find(d=>d.data===hojeISO):null;
  const hero=el('section',{class:'dashboard-hero'});
  hero.appendChild(el('h1',null,'Olá, Candidato! <span aria-hidden="true">👋</span>'));
  hero.appendChild(el('p',null,`Pronto para mais um dia de preparação para a ${esc(DADOS.meta.sigla||('DPE/'+S.perfil))}.`));m.appendChild(hero);

  const grid=el('div',{class:'dashboard-stats'});
  const st=(classe,kk,v,s)=>{const c=el('div',{class:'stat dashboard-stat '+classe});c.appendChild(el('div',{class:'k'},esc(kk)));c.appendChild(el('div',{class:'v'},esc(v)));c.appendChild(el('div',{class:'s'},esc(s)));return c;};
  grid.appendChild(st('stat-deadline','Dias até a prova',dias!=null&&dias>=0?dias:'—',S.prova.data?fmtBR(S.prova.data):'Aguardando edital'));
  grid.appendChild(st('stat-progress','Progresso do cronograma',progresso+'%',`${concluidos} de ${todosBlocos.length} blocos cumpridos`));
  grid.appendChild(st('stat-questions','Questões resolvidas',String(k.feitas),`de ${bancoQuestoes().length} disponíveis`));
  grid.appendChild(st('stat-accuracy','% acerto geral',k.acc!=null?Math.round(k.acc*100)+'%':'0%',`${k.acertos}/${k.feitas}`));m.appendChild(grid);

  const agenda=el('section',{class:'dashboard-agenda'});
  const todayCard=el('div',{class:'card agenda-today'}),todayHead=el('div',{class:'agenda-head'});
  todayHead.appendChild(el('h2',null,`🗓️ Hoje · ${fmtBR(hojeISO)}`));todayHead.appendChild(el('button',{class:'link-button',onclick:()=>go('cronograma')},'Ver cronograma →'));todayCard.appendChild(todayHead);
  if(!S.ciclo){todayCard.appendChild(el('div',{class:'agenda-empty'},'Nenhum ciclo ativo. Gere seu cronograma para ver a agenda diária.'));todayCard.appendChild(el('button',{class:'btn sm',onclick:()=>go('cronograma')},'Montar cronograma'));}
  else if(!diaHoje||!diaHoje.blocos.length)todayCard.appendChild(el('div',{class:'agenda-empty'},'Sem atividade programada para hoje.'));
  else{diaHoje.blocos.slice(0,4).forEach(b=>todayCard.appendChild(agendaCompacta(b)));if(diaHoje.blocos.length>4)todayCard.appendChild(el('small',{class:'agenda-more'},`+ ${diaHoje.blocos.length-4} atividade(s) no cronograma`));}
  agenda.appendChild(todayCard);
  const nextCard=el('div',{class:'card agenda-next'});nextCard.appendChild(el('h2',null,'⏩ Próximos dias'));
  const proximos=S.ciclo?S.ciclo.dias.filter(d=>d.data>hojeISO&&d.blocos.length).slice(0,3):[];
  if(!proximos.length)nextCard.appendChild(el('div',{class:'agenda-empty'},'Nenhuma atividade futura programada.'));
  else proximos.forEach(d=>{const row=el('button',{class:'next-day',onclick:()=>{const sems=semanasDoCiclo(),idx=sems.findIndex(s=>s.dias.some(x=>x.data===d.data));S.ui.semana=Math.max(0,idx);go('cronograma');}});row.appendChild(el('span',null,`<b>${DIAS_L[parseISO(d.data).getDay()]}</b><small>${fmtBR(d.data)}</small>`));row.appendChild(el('span',null,`<b>${d.blocos.length}</b><small>${nf(minutosAlocados(d)/60)}h</small>`));nextCard.appendChild(row);});
  agenda.appendChild(nextCard);m.appendChild(agenda);

  const quick=el('section',{class:'quick-actions'});
  const quickCard=(icone,titulo,sub,destino)=>{const b=el('button',{class:'quick-action',onclick:()=>go(destino)});b.appendChild(el('span',{class:'quick-icon','aria-hidden':'true'},icone));b.appendChild(el('span',null,`<b>${esc(titulo)}</b><small>${esc(sub)}</small>`));return b;};
  const ineditas=bancoQuestoes().filter(q=>!S.exposicao[q.id]).length,sims=S.sessoes.filter(s=>s.tipo!=='PRATICA'&&s.fim).length,redacoes=S.disc.tentativas.filter(t=>t.fim).length;
  quick.appendChild(quickCard('◎','Resolver questões',`${ineditas} inéditas`,'questoes'));
  quick.appendChild(quickCard('▣','Aplicar simulado',`${sims} realizado(s)`,'simulados'));
  quick.appendChild(quickCard('✎','Treinar redação',`${redacoes} produção(ões)`,'discursivas'));m.appendChild(quick);

  const detalhes=el('details',{class:'card dashboard-details'});detalhes.appendChild(el('summary',null,'Ver desempenho detalhado e fases da prova'));
  const detailBody=el('div',{class:'dashboard-detail-body'});
  const c1=el('section',{class:'dashboard-analysis'});
  c1.appendChild(el('h2',null,'Desempenho por grupo objetivo'));
  c1.appendChild(el('p',{class:'section-lead'},S.perfil==='SP'?'Os quatro grupos são uma organização de estudo do Centro; o último edital da DPE/SP não fixou distribuição de questões por matéria.':'Cada grupo vale 25 questões. Compare sua cobertura e seus acertos para decidir onde estudar primeiro.'));
  const tb=el('table'); tb.innerHTML='<thead><tr><th>Grupo</th><th>Disciplinas</th><th>Tópicos</th><th>Iniciados</th><th>Questões</th><th>Acurácia</th></tr></thead>';
  const tbody=el('tbody');
  ['I','II','III','IV'].forEach(g=>{
    const d=k.porG[g]||{t:0,i:0,f:0,a:0};
    const ds=(DADOS.meta.grupos[g]||Array.from(new Set(DADOS.programa.filter(t=>t.g===g).map(t=>t.di)))).join(', ');
    tbody.appendChild(el('tr',null,`<td><span class="tag g-${g}">Grupo ${g}</span></td><td><small>${esc(ds)}</small></td><td>${d.t}</td><td>${d.i} <small>(${pct(d.i,d.t)}%)</small></td><td>${d.f}</td><td>${d.f?pct(d.a,d.f)+'%':'—'}</td>`));
  });
  tb.appendChild(tbody);c1.appendChild(el('div',{class:'table-scroll'},tb));detailBody.appendChild(c1);

  const c2=el('section',{class:'dashboard-analysis'});
  c2.appendChild(el('h2',null,'Onde a nota é decidida'));
  c2.appendChild(el('p',{class:'section-lead'},S.perfil==='SP'?'O IX edital e a regra atual mantêm duas provas dissertativas densas, além da objetiva e da oral.':'A etapa discursiva tem o maior peso. Use esta visão para equilibrar objetiva, escrita e prova oral.'));
  const et=el('table'); et.innerHTML='<thead><tr><th>Etapa</th><th>Formato</th><th>Corte/referência</th><th>Seu registro</th></tr></thead>';
  const tent=S.disc.tentativas.filter(t=>t.fim);
  const eb=el('tbody');
  eb.innerHTML=S.perfil==='SP'?`
  <tr><td>1ª — Objetiva FCC</td><td><b>88 questões · 4h30</b></td><td>IX edital: ≥ 44 acertos na lista geral</td><td>${k.ultSim?`${k.ultSim.itens.filter(i=>i.certo).length} acertos no último simulado`:'—'}</td></tr>
  <tr><td>2ª — Dissertativa</td><td>8 questões + peça de Processo Civil</td><td>Constitucional, Penal, Difusos e DCA</td><td>${tent.length?tent.length+' tentativa(s)':'—'}</td></tr>
  <tr><td>3ª — Dissertativa</td><td>8 questões + peça de Processo Penal</td><td>DH, Civil, Institucional e Filosofia/Sociologia</td><td>—</td></tr>
  <tr><td>Prova oral + títulos</td><td>arguição e classificação</td><td>programa das provas escritas</td><td>—</td></tr>`:`
  <tr><td>1ª — Objetiva (100 questões, A–E)</td><td><b>2</b></td><td>≥ 6,00 e até 400ª posição (art. 43)</td><td>${k.ultSim?nf(notaObjetiva(k.ultSim))+' no último simulado':'—'}</td></tr>
  <tr><td>2ª — Discursivas (2 questões de 30 linhas + peça de 120 linhas)</td><td><b>4</b></td><td>Média ≥ 6,00 e ≥ 5,00 por grupo (art. 47)</td><td>${tent.length?tent.length+' tentativa(s)':'—'}</td></tr>
  <tr><td>4ª — Oral (7 disciplinas do art. 56)</td><td><b>2</b></td><td>≥ 6,00 (art. 57)</td><td>—</td></tr>
  <tr><td>5ª — Títulos</td><td><b>1</b></td><td>classificatória</td><td>—</td></tr>`;
  et.appendChild(eb);c2.appendChild(el('div',{class:'table-scroll'},et));
  c2.appendChild(el('div',{class:'note'},S.perfil==='SP'?'Fontes do perfil: IX Edital DPE/SP (2022/2023) e Deliberação CSDP nº 454/2025. A data e o conteúdo definitivo do próximo concurso dependerão do novo edital.':'Disciplinas que caem na prova oral (art. 56): Constitucional, Consumidor, Criança e Adolescente, Penal, Processual Penal, Civil e Processual Civil. Administrativo, Execução Penal, Direitos Humanos, Difusos e Coletivos e Princípios Institucionais não caem na oral.'));
  detailBody.appendChild(c2);detalhes.appendChild(detailBody);m.appendChild(detalhes);

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
  const visual=cicloVisual(b),d=el('div',{class:`blk type-${b.tipo} ${visual.classe}${b.autoReview?' auto-review':''}${b.manualReview?' manual-review-block':''}${b.st==='CONCLUIDO'?' done':''}${b.st==='PULADO'?' skip':''}`});
  const layout=el('div',{class:'blk-layout'}),main=el('div',{class:'blk-main'}),t=el('div',{class:'bt'});
  t.appendChild(el('span',{class:'cycle-label'},`<i aria-hidden="true"></i>${esc(visual.rotulo)} <small>(${b.min} min)</small>`));
  if(b.grupo) t.appendChild(el('span',{class:'tag g-'+b.grupo},'Grupo '+b.grupo));
  if(b.foco){const f=FOCOS_PRE_EDITAL[b.foco]||FOCOS_PRE_EDITAL.ALTA; t.appendChild(el('span',{class:'tag '+f.classe},'Foco '+f.rotulo.toLowerCase()));}
  if(b.manualReview)t.appendChild(el('span',{class:'tag pur'},'manual'));
  main.appendChild(t);
  if(b.disc)main.appendChild(el('div',{class:'blk-title'},`<b>${b.grupo?'G'+esc(b.grupo)+' · ':''}${b.item?esc(b.item)+' — ':''}${esc(b.disc)}</b>`));
  main.appendChild(el('div',{class:'blk-topic'},esc(b.tit||'Bloco de estudo')));
  if(b.why)main.appendChild(el('div',{class:'why'},esc(b.why)));
  if(b.informativo){
    const info=el('div',{class:'informative-assignment','data-informativo-key':b.informativo.key});
    info.appendChild(el('b',null,`Leitura indicada: Informativo ${esc(b.informativo.trib)} nº ${esc(b.informativo.numero)} · ${esc(b.informativo.ano)}`));
    info.appendChild(el('span',null,`${b.informativo.itens} julgamento(s) · prioridade ${esc(b.informativo.prioridade)}${b.informativo.grupos.length?' · grupos '+esc(b.informativo.grupos.join(', ')):''}`));main.appendChild(info);
  }
  if(b.cargaLei)main.appendChild(el('div',{class:`workload${b.cargaLei.prioridadeLei==='NUCLEO'?' prioritized':''}`,'data-reading-priority':b.cargaLei.prioridadeLei||'PADRAO'},`<b>${b.cargaLei.prioridadeLei==='NUCLEO'?'Núcleo prioritário':'Carga executável'}:</b> ${b.cargaLei.artigos||1} artigo(s) estimado(s) · ${b.cargaLei.minEstimados} min de leitura atenta · parte ${b.cargaLei.seq}/${b.cargaLei.total}${b.cargaLei.criterioLei?` · ${esc(b.cargaLei.criterioLei)}`:''}`));
  if(b.lei && b.lei.length){
    const L=el('div',{class:'lei'});
    if(b.lei[0].sem) L.innerHTML='<b>Leitura legislativa:</b> sem faixa específica — tema predominantemente doutrinário, jurisprudencial ou internacional.';
    else L.innerHTML='<b>Leitura legislativa:</b> '+b.lei.map(x=>`${esc(x.nome)} — ${esc(x.arts)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">texto oficial</a>`:''}`).join(' · ');
    main.appendChild(L);
  }
  const acts=el('div',{class:'blk-actions'});
  if(b.st!=='CONCLUIDO') acts.appendChild(el('button',{class:'btn sm',onclick:()=>{b.st='CONCLUIDO'; if(b.tid){const p=S.topicos[b.tid]; if(p&&p.st==='NAO_INICIADO')p.st='EM_ESTUDO'; garanteRevisao(b.tid);} if(b.manualId){const manual=S.revisoesManuais.find(item=>item.id===b.manualId);if(manual)manual.st='CONCLUIDO';} salvar(); onChange?onChange():render();}},'Marcar concluído'));
  if(b.st==='PENDENTE') acts.appendChild(el('button',{class:'btn gho sm',onclick:()=>{b.st='PULADO'; salvar(); onChange?onChange():render();}},'Pular'));
  if(b.st!=='PENDENTE') acts.appendChild(el('button',{class:'btn gho sm',onclick:()=>{b.st='PENDENTE'; salvar(); onChange?onChange():render();}},'Reabrir'));
  if(b.tipo==='QUESTOES'&&b.tid) acts.appendChild(el('button',{class:'btn sec sm',onclick:()=>{iniciarSessao('PRATICA',{topico:b.tid},10);}},'Praticar este tópico'));
  if(b.tipo==='SIMULADO'&&b.grupo) acts.appendChild(el('button',{class:'btn sec sm',onclick:()=>{iniciarSessao('SIMULADO_GRUPO',{grupo:b.grupo},simuladoConfig().porGrupo);}},'Abrir simulado'));
  if(b.tipo==='JURISPRUDENCIA'&&b.informativo)acts.appendChild(el('button',{class:'btn sec sm',onclick:()=>{jurisAgenda={key:b.informativo.key,trib:b.informativo.trib,ano:b.informativo.ano,numero:b.informativo.numero};go('juris');}},'Ver informativo'));
  layout.appendChild(main);layout.appendChild(acts);d.appendChild(layout);
  return d;
}

/* ---------------------------------------------------------------- view: programa */
let fProg={g:'',d:'',st:'',f:'',q:''};
function vPrograma(m){
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Mapa completo'));
  c.appendChild(el('h2',null,'Programa de estudos'));
  c.appendChild(el('p',{class:'section-lead'},S.perfil==='SP'?`${DADOS.programa.length} tópicos: núcleo comum da DPE/RN mais complementos específicos do IX edital DPE/SP para Tributário, Empresarial, Institucional paulista e as cinco obras de Filosofia/Sociologia.`:`${DADOS.programa.length} tópicos organizados por grupo, disciplina e recorrência em concursos Cebraspe. Nenhum conteúdo da Resolução nº 344/2025 foi excluído.`));
  const r=el('div',{class:'row'});
  const selG=el('select'); selG.innerHTML='<option value="">Todos os grupos</option>'+['I','II','III','IV'].map(g=>`<option ${fProg.g===g?'selected':''}>${g}</option>`).join('');
  selG.onchange=()=>{fProg.g=selG.value; fProg.d=''; render();};
  const discs=Array.from(new Set(DADOS.programa.filter(t=>!fProg.g||t.g===fProg.g).map(t=>t.dc+'|'+t.di)));
  const selD=el('select'); selD.innerHTML='<option value="">Todas as disciplinas</option>'+discs.map(x=>{const [c2,n]=x.split('|'); return `<option value="${c2}" ${fProg.d===c2?'selected':''}>${esc(n)}</option>`;}).join('');
  selD.onchange=()=>{fProg.d=selD.value; render();};
  const selS=el('select'); selS.innerHTML=['','NAO_INICIADO','EM_ESTUDO','REVISAO','CONSOLIDADO'].map(s=>`<option value="${s}" ${fProg.st===s?'selected':''}>${s?s.replace('_',' '):'Todas as situações'}</option>`).join('');
  selS.onchange=()=>{fProg.st=selS.value; render();};
  const selF=el('select'); selF.innerHTML='<option value="">Todos os focos pré-edital</option>'+Object.entries(FOCOS_PRE_EDITAL).map(([k,v])=>`<option value="${k}" ${fProg.f===k?'selected':''}>Foco ${v.rotulo.toLowerCase()}</option>`).join('');
  selF.onchange=()=>{fProg.f=selF.value; render();};
  const inp=el('input',{placeholder:'Buscar no texto do tópico...',value:fProg.q});
  inp.oninput=()=>{fProg.q=inp.value; clearTimeout(inp._t); inp._t=setTimeout(render,280);};
  [selG,selD,selS,selF].forEach(x=>{x.style.maxWidth='210px'; r.appendChild(x);});
  inp.style.maxWidth='280px'; r.appendChild(inp);
  c.appendChild(r); m.appendChild(c);

  const lista=DADOS.programa.filter(t=>{
    if(fProg.g&&t.g!==fProg.g) return false;
    if(fProg.d&&t.dc!==fProg.d) return false;
    const p=S.topicos[t.id]||{};
    if(fProg.st&&(p.st||'NAO_INICIADO')!==fProg.st) return false;
    if(fProg.f&&focoDoTopico(t.id).tier!==fProg.f) return false;
    if(fProg.q&&t.to.toLowerCase().indexOf(fProg.q.toLowerCase())<0) return false;
    return true;
  });
  const c2=el('div',{class:'card pad0'});
  const head=el('div',{class:'row'},''); head.style.padding='12px 16px';
  head.appendChild(el('div',null,`<b>${lista.length}</b> tópico(s)`));
  c2.appendChild(head);
  const wrap=el('div'); wrap.style.maxHeight='68vh'; wrap.style.overflow='auto';
  const tb=el('table');
  tb.innerHTML='<thead><tr><th>#</th><th>Tópico</th><th>Foco pré-edital</th><th>Situação</th><th>Prior. pessoal</th><th>Domínio</th><th>Questões</th><th></th></tr></thead>';
  const tbody=el('tbody');
  lista.slice(0,600).forEach(t=>{
    const p=S.topicos[t.id]||{};
    const tr=el('tr');
    tr.appendChild(el('td',null,`<span class="tag g-${t.g}">${t.g}</span><br><small>${t.it}</small>`));
    tr.appendChild(el('td',null,`<div><b>${esc(t.di)}</b></div><div style="max-width:520px"><small>${esc(t.to.length>190?t.to.slice(0,190)+'…':t.to)}</small></div>`));
    const foco=focoDoTopico(t.id);
    tr.appendChild(el('td',null,`<span class="tag ${foco.classe}" title="${esc(foco.explicacao)}">${esc(foco.rotulo)}</span>`));
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
  const foco=focoDoTopico(t.id); const disc=(((DADOS.priorizacao||{}).disciplinas||{})[t.dc]||{});
  const bd=el('div',{class:'modal',onclick:e=>{if(e.target===bd)bd.remove();}});
  const inn=el('div',{class:'in'});
  inn.appendChild(el('div',{class:'row'},`<span class="tag g-${t.g}">Grupo ${t.g}</span><span class="tag">${esc(t.di)}</span><span class="tag">item ${t.it}</span><span class="tag ${foco.classe}">Foco ${esc(foco.rotulo.toLowerCase())}</span>`));
  inn.appendChild(el('h2',null,esc(t.di)+' — '+t.it));
  inn.appendChild(el('p',null,esc(t.to)));
  const leituraPerfil=S.perfil==='SP'&&t.id.startsWith('SP-')
    ?`Complemento específico extraído do programa do IX Concurso DPE/SP. ${foco.explicacao}.`
    :`${foco.explicacao}. A disciplina apareceu em ${esc(disc.presence_in_notices||'—')} dos ${esc(disc.notices_analyzed||6)} editais analisados${disc.discursive?' e integra a prova discursiva':''}${disc.oral?' e a prova oral':''}.`;
  inn.appendChild(el('div',{class:'note'},`<b>Leitura pré-edital:</b> ${leituraPerfil}`));
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
  const documento=S.perfil==='SP'&&t.id.startsWith('SP-')?(configPerfil().sources||{}).last_notice:(t.url||DADOS.meta.resolucao_url);
  inn.appendChild(el('p',null,`<small>Fonte: ${esc(DADOS.meta.resolucao)}, p. ${t.pg||'—'} · <a href="${esc(documento)}" target="_blank" rel="noopener">documento oficial</a></small>`));
  const r=el('div',{class:'row'});
  r.appendChild(el('button',{class:'btn',onclick:()=>bd.remove()},'Fechar'));
  inn.appendChild(r); bd.appendChild(inn); document.body.appendChild(bd);
}

/* ---------------------------------------------------------------- view: cronograma */
function vCronograma(m){
  const d=S.diag;
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Planejamento pessoal'));
  c.appendChild(el('h2',null,'Monte seu ciclo'));
  c.appendChild(el('p',{class:'section-lead'},'Informe o tempo disponível e distribua seu foco. O plano poderá ser ajustado a qualquer momento.'));
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
  const b4=el('div'); b4.appendChild(el('label',{class:'f'},'Ritmo de lei seca (min por artigo)'));
  const il=el('input',{type:'number',min:1,max:5,step:.5,value:d.leiMinArt});il.onchange=()=>{d.leiMinArt=clamp(+il.value||2,1,5);salvar();};b4.appendChild(il);g.appendChild(b4);
  c.appendChild(g);
  c.appendChild(el('div',{class:'capacity-rule'},'<b>Regras de exequibilidade ativas</b><span>Faixas extensas serão fracionadas pelo ritmo informado, com no máximo um bloco de lei seca por dia. Revisões automáticas respeitam seu peso percentual e o limite de um bloco diário; revisões manuais continuam independentes.</span>'));

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
  c.appendChild(el('div',{class:'note'},S.perfil==='SP'?'O IX edital não informou quantas questões caberiam a cada matéria. Os pesos entre os quatro grupos são uma estratégia ajustável, não uma distribuição oficial.':'Cada grupo vale 25 das 100 questões (art. 42). Manter 25/25/25/25 espelha o peso oficial da prova.'));
  c.appendChild(pesos('Divisão por tipo de conteúdo',d.pc));
  const somaG=Object.values(d.pg).reduce((a,b)=>a+b,0), somaC=Object.values(d.pc).reduce((a,b)=>a+b,0);
  const ok = somaG===100 && somaC===100 && Object.values(d.minutos).reduce((a,b)=>a+b,0)>=60;
  const rr=el('div',{class:'row'});
  const bg=el('button',{class:'btn',onclick:()=>{ gerarCiclo(); toast('Ciclo gerado. O anterior foi preservado no histórico.'); render(); }},'Gerar novo ciclo');
  if(!ok) bg.disabled=true;
  rr.appendChild(bg);
  if(!ok) rr.appendChild(el('small',null,'Ajuste os pesos para 100% e garanta ao menos 60 minutos por semana.'));
  c.appendChild(rr);
  if(!S.ciclo){m.appendChild(c);m.appendChild(el('div',{class:'card'},'<div class="empty"><b>Nenhum ciclo ativo</b>Gere o primeiro ciclo acima. O plano cobre de 7 a 84 dias e pode ser regerado a qualquer momento sem apagar o histórico.</div>'));return;}

  const sems=semanasDoCiclo();
  const cc=el('div',{class:'card schedule-overview'});
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
  const minSem=sem.dias.reduce((a,d2)=>a+minutosAlocados(d2),0), blSem=sem.dias.reduce((a,d2)=>a+d2.blocos.length,0);
  const okSem=sem.dias.reduce((a,d2)=>a+d2.blocos.filter(b=>b.st==='CONCLUIDO').length,0);
  cc.appendChild(el('div',{class:'row schedule-week-meta'},`<span class="pill">${fmtBR(sem.dias[0].data)} → ${fmtBR(sem.dias[sem.dias.length-1].data)}</span><span class="pill">${blSem} blocos</span><span class="pill">${nf(minSem/60)}h alocadas</span><span class="pill">${pct(okSem,blSem)}% concluído</span>`));
  cc.appendChild(el('div',{class:'cycle-legend'},'<span class="cycle-1"><i></i>Ciclo 1 · Teoria</span><span class="cycle-2"><i></i>Ciclo 2 · Lei seca</span><span class="cycle-3"><i></i>Ciclo 3 · Questões</span><span class="cycle-review"><i></i>Revisões e reforços</span>'));
  m.appendChild(cc);

  sem.dias.forEach(d2=>{
    const dd=el('section',{class:'day schedule-day'+(d2.min===0?' zero':'')});
    const dh=el('div',{class:'dh day-head'});
    dh.appendChild(el('b',null,DIAS_L[parseISO(d2.data).getDay()]+', '+fmtBR(d2.data)));
    const dayMeta=el('div',{class:'day-head-meta'});dayMeta.appendChild(el('span',{class:'day-minutes'},d2.min+' min'));
    if(d2.data===hoje())dayMeta.appendChild(el('span',{class:'day-today'},'Hoje'));else dayMeta.appendChild(el('span',{class:'day-priority'},'Principal'));
    dh.appendChild(dayMeta);
    dd.appendChild(dh);
    const body=el('div',{class:'day-body'});
    if(!d2.blocos.length)body.appendChild(el('div',{class:'note'},'Sem carga prevista neste dia.'));
    d2.blocos.slice().sort((a,b)=>cicloVisual(a).n-cicloVisual(b).n).forEach(b=>body.appendChild(blocoCard(b)));
    dd.appendChild(body);
    m.appendChild(dd);
  });

  const settings=el('details',{class:'card schedule-settings'});settings.appendChild(el('summary',null,'Ajustar disponibilidade, pesos e regras do ciclo'));
  const settingsBody=el('div',{class:'schedule-settings-body'});while(c.firstChild)settingsBody.appendChild(c.firstChild);settings.appendChild(settingsBody);m.appendChild(settings);
}

/* ---------------------------------------------------------------- sessões de questões */
function iniciarSessao(tipo,filtro,n){
  let qs=[];
  const sim=simuladoConfig();
  if(tipo==='SIMULADO_COMPLETO'){ ['I','II','III','IV'].forEach(g=>{ qs=qs.concat(selecionarSimuladoGrupo(g,sim.porGrupo)); }); }
  else if(tipo==='SIMULADO_GRUPO'){ qs=selecionarSimuladoGrupo(filtro.grupo,sim.porGrupo); }
  else { qs=selecionar(n,filtro); }
  if(!qs.length){ toast('Não há questões no banco para esse filtro.'); return; }
  if((tipo==='SIMULADO_GRUPO'&&qs.length<sim.porGrupo)||(tipo==='SIMULADO_COMPLETO'&&qs.length<sim.total)){
    if(!confirm(`O banco tem ${qs.length} questões disponíveis para este simulado, menos que o ideal. Abrir mesmo assim?`)) return;
  }
  S.sessaoAtiva={id:uid(),tipo,filtro:filtro||{},perfil:S.perfil,inicio:new Date().toISOString(),fim:null,idx:0,
    questionBankVersion:CONTENT_MANIFEST.questionBankVersion,
    itens:qs.map(q=>({q:q.id,snapshot:snapshotQuestao(q),resp:null,certo:null,conf:null,t0:null,dt:0}))};
  salvar(); go('questoes');
}
function vQuestoes(m){
  if(S.sessaoAtiva){ return sessaoUI(m); }
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Objetiva'));
  c.appendChild(el('h2',null,'Prática dirigida'));
  const banco=bancoQuestoes();
  c.appendChild(el('p',{class:'section-lead'},S.perfil==='SP'?`Use as <b>${banco.length}</b> questões disponíveis para revisar conteúdo. O banco-base ainda não deve ser tratado como amostra estatística da FCC; importe questões FCC licenciadas em Ajustes quando disponíveis.`:`Escolha um recorte entre <b>${banco.length}</b> questões no formato Cebraspe. Após responder, revise a explicação e a fonte indicada.`));
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
    info.textContent=`${pool.length} disponíveis · ${ined} inéditas. A prática começa pelas inéditas e retoma seus erros no momento certo.`;
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
  const sim=simuladoConfig();
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Treino de prova'));
  c.appendChild(el('h2',null,'Simulados no formato oficial'));
  c.appendChild(el('p',{class:'section-lead'},S.perfil==='SP'?`Simulação pré-edital de ${sim.total} questões em ${sim.duracao}. A divisão igual de ${sim.porGrupo} por grupo é uma aproximação metodológica, pois o IX edital não publicou a distribuição por matéria.`:`Treine por grupo ou faça a prova completa: ${sim.total} questões, divididas igualmente entre os quatro grupos, com duração de ${sim.duracao}.`));
  const g=el('div',{class:'grid g2'});
  ['I','II','III','IV'].forEach(gr=>{
    const pool=poolQuestoes({grupo:gr});
    const ds=(DADOS.meta.grupos[gr]||Array.from(new Set(DADOS.programa.filter(t=>t.g===gr).map(t=>t.di)))).join(' · ');
    const b=el('div',{class:'stat'});
    b.appendChild(el('div',{class:'row'},`<span class="tag g-${gr}">Grupo ${gr}</span><span class="tag">${pool.length} questões no banco</span>`));
    b.appendChild(el('div',null,`<small>${esc(ds)}</small>`));
    const bt=el('button',{class:'btn sm',onclick:()=>iniciarSessao('SIMULADO_GRUPO',{grupo:gr},sim.porGrupo)},`Simulado de ${sim.porGrupo} questões`);
    bt.style.marginTop='9px'; if(pool.length<sim.porGrupo) bt.className='btn sm sec';
    b.appendChild(bt);
    g.appendChild(b);
  });
  c.appendChild(g);
  c.appendChild(el('div',{class:'hr'}));
  const total=bancoQuestoes().length;
  const podeCompleto=['I','II','III','IV'].every(gr=>poolQuestoes({grupo:gr}).length>=sim.porGrupo);
  const bc=el('button',{class:'btn',onclick:()=>iniciarSessao('SIMULADO_COMPLETO',{},sim.total)},`Simulado completo — ${sim.total} questões`);
  if(!podeCompleto) bc.disabled=true;
  c.appendChild(bc);
  c.appendChild(el('div',{class:'note'},podeCompleto?`${total} questões disponíveis. A prova completa sorteia ${sim.porGrupo} de cada grupo.`:`É preciso ter ao menos ${sim.porGrupo} questões em cada grupo. Adicione questões em Ajustes.`));
  m.appendChild(c);

  const sims=S.sessoes.filter(s=>s.tipo!=='PRATICA'&&s.fim);
  if(sims.length){
    const c2=el('div',{class:'card'});
    c2.appendChild(el('h2',null,'Evolução nos simulados'));
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Data</th><th>Tipo</th><th>Nota (0–10)</th><th>Acertos</th><th>Referência</th></tr></thead>';
    const tbody=el('tbody');
    sims.slice().reverse().forEach(s=>{
      const nota=notaObjetiva(s), certos=s.itens.filter(i=>i.certo).length;
      const escala=certos/Math.max(s.itens.length,1)*10,corte=(s.perfil||'RN')==='SP'?5:6;
      tbody.appendChild(el('tr',null,`<td>${fmtBR(s.inicio.slice(0,10))}</td><td>${esc(s.tipo.replace(/_/g,' '))}</td><td><b>${nf(s.tipo==='SIMULADO_COMPLETO'?nota:escala)}</b></td><td>${certos}/${s.itens.length}</td><td>${escala>=corte?'<span class="tag ok">acima</span>':'<span class="tag bad">abaixo</span>'}</td>`));
    });
    tb.appendChild(tbody); c2.appendChild(tb);
    c2.appendChild(el('div',{class:'note'},S.perfil==='SP'?'A referência pré-edital é 44/88 (50%) para a lista geral no IX edital. O novo edital poderá alterar cortes e distribuição.':'Em simulados por grupo a nota é reescalonada para a base 0–10 apenas para comparação; a nota oficial do art. 40 pressupõe as 100 questões.'));
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
  const totalOficial=(s.perfil||'RN')==='SP'?88:100;
  inn.appendChild(el('div',{class:'row'},`<span class="pill">${certos}/${resp} acertos</span><span class="pill">${pct(certos,resp)}%</span>${s.tipo!=='PRATICA'?`<span class="pill">nota ${nf(resp===totalOficial?notaObjetiva(s):(certos/Math.max(resp,1)*10))}</span>`:''}<span class="pill">${Math.round(s.itens.reduce((a,i)=>a+(i.dt||0),0)/60)} min</span>`));
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
function guiaDiscursiva(t){
  const box=el('div',{class:'disc-guide'});
  const espelho=Array.isArray((t||{}).espelho)&&t.espelho.length?t.espelho:[
    {criterio:'Conteúdo jurídico',pontos:'40%',esperado:'Apresente a tese central, os fundamentos normativos e os conceitos essenciais.'},
    {criterio:'Estrutura',pontos:'25%',esperado:'Organize introdução, desenvolvimento e conclusão; na peça, observe o formato processual adequado.'},
    {criterio:'Argumentação',pontos:'25%',esperado:'Aplique a legislação e os precedentes aos fatos, com raciocínio claro e coerente.'},
    {criterio:'Linguagem',pontos:'10%',esperado:'Use redação objetiva, técnica e legível.'}
  ];
  const details=el('details',{class:'study-guide'});
  details.appendChild(el('summary',null,'Ver espelho de resposta'));
  details.appendChild(el('p',{class:'section-lead'},'Use estes pontos para revisar sua produção depois de escrever.'));
  const list=el('div',{class:'rubric-list'});
  espelho.forEach(item=>{
    const row=el('div',{class:'rubric-item'});
    const pontos=item.pontos==null?'':String(item.pontos);
    row.appendChild(el('div',{class:'rubric-title'},`<b>${esc(item.criterio||'Critério')}</b>${pontos?`<span class="pill">${esc(pontos)}${/%|ponto/i.test(pontos)?'':' pts'}</span>`:''}`));
    row.appendChild(el('p',null,esc(item.esperado||item.descricao||'')));
    list.appendChild(row);
  });
  details.appendChild(list);
  const ancoras=Array.isArray((t||{}).ancoras)?t.ancoras:[];
  if(ancoras.length){
    details.appendChild(el('h3',null,'Jurisprudência para citar'));
    const refs=el('div',{class:'anchor-list'});
    ancoras.forEach(a=>{
      const card=el('div',{class:'anchor-item'});
      const rotulo=[a.tribunal,a.referencia,a.informativo].filter(Boolean).join(' · ')||'Precedente relacionado';
      card.appendChild(el('b',null,esc(rotulo)));
      if(a.aplicacao)card.appendChild(el('p',null,esc(a.aplicacao)));
      const url=safeUrl(a.url);if(url)card.appendChild(el('a',{href:url,target:'_blank',rel:'noopener'},'Consultar fonte oficial'));
      refs.appendChild(card);
    });
    details.appendChild(refs);
  }else if(t&&t.ref){
    const ref=el('div',{class:'anchor-item'});
    ref.appendChild(el('b',null,'Referência sugerida'));
    ref.appendChild(el('p',null,esc(t.ref)));
    const url=safeUrl(t.url);if(url)ref.appendChild(el('a',{href:url,target:'_blank',rel:'noopener'},'Consultar fonte oficial'));
    details.appendChild(ref);
  }
  box.appendChild(details);
  return box;
}
function vDiscursivas(m){
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Segunda etapa · peso 4'));
  c.appendChild(el('h2',null,'Treino discursivo'));
  c.appendChild(el('p',{class:'section-lead'},'Pratique questões de 30 linhas e peças de 120 linhas. Depois, compare sua resposta com o espelho e os precedentes indicados.'));
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
  function temasFiltrados(){return temas.filter(t=>(t.gd===sg.value||!t.gd)&&(!t.tipo||t.tipo===stp.value));}
  function refT(){ const list=temasFiltrados();
    sT.innerHTML=list.map((t,i)=>`<option value="${i}">${esc(t.tit)}</option>`).join('')+'<option value="livre">— tema livre —</option>'; }
  refT();
  c2.appendChild(gg);
  const enun=el('div',{class:'lei'}); c2.appendChild(enun);
  const guide=el('div'); c2.appendChild(guide);
  function showEnun(){ const list=temasFiltrados(); const v=sT.value; guide.innerHTML='';
    if(v==='livre'){ enun.innerHTML='<b>Tema livre.</b> Escreva o enunciado que quiser treinar.'; return; }
    const t=list[+v]; if(!t){enun.innerHTML='<b>Nenhum tema disponível para este recorte.</b>';return;}
    enun.innerHTML=`<b>Enunciado:</b> ${esc(t.en)}`;guide.appendChild(guiaDiscursiva(t)); }
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
  ta.oninput=updL; stp.onchange=()=>{updL(); refT(); showEnun();}; sg.onchange=()=>{refT();showEnun();}; updL();
  c2.appendChild(ta); c2.appendChild(cont);
  const gN=el('div',{class:'grid g3'});
  const bF=el('div'); bF.appendChild(el('label',{class:'f'},'Pontos fortes')); const iF=el('input'); bF.appendChild(iF); gN.appendChild(bF);
  const bM=el('div'); bM.appendChild(el('label',{class:'f'},'A melhorar')); const iM=el('input'); bM.appendChild(iM); gN.appendChild(bM);
  const bN=el('div'); bN.appendChild(el('label',{class:'f'},'Autoavaliação (0–10)')); const iN=el('input',{type:'number',min:0,max:10,step:'0.25'}); bN.appendChild(iN); gN.appendChild(bN);
  c2.appendChild(gN);
  c2.appendChild(el('div',{class:'note'},'A nota é uma autoavaliação. Use o espelho do tema para identificar o que foi atendido e o que precisa ser retomado.'));
  c2.appendChild(el('button',{class:'btn',onclick:()=>{
    if(!ta.value.trim()){ toast('Escreva algo antes de salvar.'); return; }
    const list=temasFiltrados(); const t=sT.value==='livre'?{id:'',tit:'Tema livre',en:''}:list[+sT.value];
    S.disc.tentativas.push({id:uid(),data:new Date().toISOString(),tipo:stp.value,gd:sg.value,temaId:t.id||'',tema:t.tit,
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
        const temaAtual=temas.find(item=>(t.temaId&&item.id===t.temaId)||item.tit===t.tema);
        if(temaAtual)inn.appendChild(guiaDiscursiva(temaAtual));
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
  const manuais=(S.revisoesManuais||[]).slice().sort((a,b)=>a.data.localeCompare(b.data));
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Memória de longo prazo'));
  c.appendChild(el('h2',null,'Revisões automáticas e manuais'));
  c.appendChild(el('p',{class:'section-lead'},'As revisões automáticas preservam a repetição espaçada. Em paralelo, você pode reforçar qualquer assunto em uma data adicional, sem alterar a fila automática.'));
  c.appendChild(el('div',{class:'row'},`<span class="pill">${dev.length} automática(s) vencida(s)</span><span class="pill">${fut.length} automática(s) futura(s)</span><span class="pill">${manuais.filter(item=>item.st!=='CONCLUIDO').length} manual(is) pendente(s)</span>`));
  m.appendChild(c);

  const manual=el('div',{class:'card review-manual'});
  manual.appendChild(el('h3',null,'Adicionar revisão manual'));
  manual.appendChild(el('p',{class:'section-lead'},'Escolha o assunto, a data e o tempo de reforço. Se o ciclo atual estiver cheio, o registro fica preservado e entra na próxima geração com capacidade disponível.'));
  const form=el('div',{class:'grid review-form'});
  const topicBox=el('div');topicBox.appendChild(el('label',{class:'f'},'Assunto'));
  const topic=el('select');topic.appendChild(el('option',{value:''},'Selecione um tópico'));
  DADOS.programa.slice().sort((a,b)=>a.di.localeCompare(b.di,'pt-BR')||String(a.it).localeCompare(String(b.it),'pt-BR')).forEach(t=>topic.appendChild(el('option',{value:t.id},`${t.di} · ${t.it} — ${t.to.slice(0,90)}`)));
  topicBox.appendChild(topic);form.appendChild(topicBox);
  const dateBox=el('div');dateBox.appendChild(el('label',{class:'f'},'Data desejada'));const date=el('input',{type:'date',value:h,min:h});dateBox.appendChild(date);form.appendChild(dateBox);
  const minBox=el('div');minBox.appendChild(el('label',{class:'f'},'Duração'));const minutes=el('select');[20,30,40,50,60,90].forEach(value=>minutes.appendChild(el('option',{value,selected:value===30?'selected':null},value+' min')));minBox.appendChild(minutes);form.appendChild(minBox);
  const noteBox=el('div');noteBox.appendChild(el('label',{class:'f'},'Objetivo específico (opcional)'));const note=el('input',{placeholder:'Ex.: reforçar tutela coletiva e precedentes'});noteBox.appendChild(note);form.appendChild(noteBox);
  manual.appendChild(form);
  manual.appendChild(el('button',{class:'btn',onclick:()=>{
    if(!topic.value){toast('Escolha o assunto da revisão.');return;}if(!date.value){toast('Informe a data da revisão.');return;}
    const item={id:'rev-manual-'+uid(),tid:topic.value,data:date.value,min:Number(minutes.value),nota:note.value.trim(),st:'PENDENTE',criada:new Date().toISOString()};
    S.revisoesManuais.push(item);
    const bloco=blocoRevisao(item.tid,item.data,item.min,{manualId:item.id,manualReview:true,why:item.nota?`Revisão manual: ${item.nota}`:'Revisão manual adicionada pelo estudante.'});
    item.agendada=inserirBlocoNoCiclo(bloco,item.data);
    salvar();toast(item.agendada?`Revisão inserida em ${fmtBR(item.agendada)}.`:'Revisão salva; será encaixada na próxima geração do ciclo.');render();
  }},'Adicionar revisão'));
  if(manuais.length){
    manual.appendChild(el('div',{class:'hr'}));manual.appendChild(el('h3',null,'Reforços cadastrados'));
    manuais.forEach(item=>{
      const t=DADOS.programa.find(x=>x.id===item.tid);if(!t)return;
      const card=el('div',{class:'manual-review'+(item.st==='CONCLUIDO'?' done':'')});
      card.appendChild(el('div',null,`<b>${esc(t.di)}</b><small>${esc(t.to.slice(0,150))}</small>`));
      const meta=el('div',{class:'row'},`<span class="tag ${item.st==='CONCLUIDO'?'ok':'pur'}">${item.st==='CONCLUIDO'?'concluída':'manual'}</span><span class="tag">${fmtBR(item.data)}</span><span class="tag">${item.min} min</span>${item.nota?`<span class="tag">${esc(item.nota)}</span>`:''}`);
      card.appendChild(meta);const actions=el('div',{class:'row'});
      if(item.st!=='CONCLUIDO')actions.appendChild(el('button',{class:'btn sm',onclick:()=>{item.st='CONCLUIDO';if(S.ciclo)S.ciclo.dias.forEach(dia=>dia.blocos.filter(bloco=>bloco.manualId===item.id).forEach(bloco=>bloco.st='CONCLUIDO'));salvar();render();}},'Marcar concluída'));
      actions.appendChild(el('button',{class:'btn gho sm',onclick:()=>{if(!confirm('Excluir esta revisão manual?'))return;S.revisoesManuais=S.revisoesManuais.filter(x=>x.id!==item.id);if(S.ciclo)S.ciclo.dias.forEach(dia=>{dia.blocos=dia.blocos.filter(bloco=>bloco.manualId!==item.id);});salvar();render();}},'Excluir'));
      card.appendChild(actions);manual.appendChild(card);
    });
  }
  m.appendChild(manual);
  if(!itens.length){ m.appendChild(el('div',{class:'card'},'<div class="empty"><b>Fila automática vazia</b>Marque tópicos como iniciados no Programa, ou conclua blocos do cronograma, para alimentar a repetição espaçada.</div>')); return; }
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
function numeroInformativo(p){
  const direto=String(p.issue_number||p.informativo||'').match(/\d{1,4}/);if(direto)return direto[0];
  if(/informativo/i.test(String(p.record_type||p.ref||''))){const extra=String(p.ref||'').match(/(?:n[º°.]?\s*)?(\d{2,4})/i);if(extra)return extra[1];}
  return '';
}
function anoInformativo(p){return String(p.published_at||p.data_publicacao||'').slice(0,4);}
const TERMOS_DPE=[
  ['defensoria',24],['assistencia juridica',18],['gratuidade',16],['vulneravel',14],['hipossuficiente',14],['tutela coletiva',14],
  ['direitos humanos',13],['crianca',12],['adolescente',12],['consumidor',11],['execucao penal',11],['prisao',9],['processo penal',9],
  ['moradia',9],['saude',9],['familia',8],['violencia domestica',10],['pessoa com deficiencia',12],['indigena',10],['quilombola',10]
];
function prioridadeDPE(p){
  const ano=anoInformativo(p),texto=jurisSearchText([p.tema,p.tese,p.ramo,p.materia,p.legislacao,p.ref].filter(Boolean).join(' '));
  let score=ano==='2026'?18:ano==='2025'?13:0;if(['I','II','III','IV'].includes(p.g))score+=22;
  TERMOS_DPE.forEach(([termo,pontos])=>{if(texto.includes(termo))score+=pontos;});
  return score;
}
function nivelPrioridadeDPE(p){const score=prioridadeDPE(p);return score>=40?'Muito alta':score>=24?'Alta':'Regular';}
function trilhaInformativos(){
  const mapa=new Map();
  DADOS.precedentes.filter(p=>['STF','STJ'].includes(p.trib)&&['2025','2026'].includes(anoInformativo(p))&&numeroInformativo(p)&&(/informativo/i.test(String(p.record_type||''))||p.source_id==='stj-informativo')).forEach(p=>{
    const numero=numeroInformativo(p),ano=anoInformativo(p),key=`${p.trib}|${ano}|${numero}`;
    if(!mapa.has(key))mapa.set(key,{key,trib:p.trib,ano,numero,itens:[],score:0,grupos:new Set()});
    const grupo=mapa.get(key);grupo.itens.push(p);grupo.score=Math.max(grupo.score,prioridadeDPE(p));if(p.g)grupo.grupos.add(p.g);
  });
  const filas={STF:[],STJ:[]};mapa.forEach(grupo=>filas[grupo.trib].push(grupo));Object.values(filas).forEach(fila=>fila.sort((a,b)=>b.score-a.score||b.ano.localeCompare(a.ano)||Number(b.numero)-Number(a.numero)));
  const misturados=[];let tribunal=(filas.STF[0]||{}).score>(filas.STJ[0]||{}).score?'STF':'STJ';
  while(filas.STF.length||filas.STJ.length){const fila=filas[tribunal];if(fila.length)misturados.push(fila.shift());tribunal=tribunal==='STF'?'STJ':'STF';if(!filas[tribunal].length)tribunal=tribunal==='STF'?'STJ':'STF';}
  return misturados;
}
function jurisLinkLabel(name){
  const value=String(name||'');
  if(/informativos? stf/i.test(value))return 'Abrir informativos do STF';
  if(/informativos? stj/i.test(value))return 'Abrir informativos do STJ';
  if(/teses/i.test(value))return 'Abrir Jurisprudência em Teses';
  if(/súmulas do stf/i.test(value))return 'Abrir súmulas do STF';
  if(/corte idh/i.test(value))return 'Abrir decisões da Corte IDH';
  if(/ix edital dpe\/sp/i.test(value))return 'Abrir IX Edital da DPE/SP';
  if(/regras atuais dpe\/sp/i.test(value))return 'Abrir regras atuais da DPE/SP';
  if(/concursos dpe\/sp/i.test(value))return 'Abrir portal de concursos da DPE/SP';
  if(/resolução/i.test(value))return 'Abrir resolução da DPE/RN';
  return 'Abrir '+value;
}
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
  }},(registro||{}).lido?'Revisado':'Marcar como revisado');
  actions.appendChild(progress);
  const source=safeUrl(p.url);if(source)actions.appendChild(el('a',{class:'btn sec sm',href:source,target:'_blank',rel:'noopener'},'Abrir fonte oficial'));
  box.appendChild(actions);modal.appendChild(box);modal.addEventListener('click',event=>{if(event.target===modal)modal.remove();});document.body.appendChild(modal);
}
let jurisAgenda=null;
function vJuris(m){
  const agendaAtiva=jurisAgenda;jurisAgenda=null;
  const c=el('div',{class:'card'});
  c.appendChild(el('span',{class:'eyebrow'},'Pesquisa e revisão'));
  c.appendChild(el('h2',null,'Jurisprudência'));
  c.appendChild(el('p',{class:'section-lead'},'Pesquise julgados e informativos, marque o que já revisou e consulte a fonte oficial em cada item.'));
  const statusBom=JURIS_META.status==='ATUALIZADO';
  const banner=el('div',{class:'status-banner'});
  banner.appendChild(el('span',{class:'status-lamp'+(statusBom?'':' warn')}));
  const status=el('div');
  status.appendChild(el('b',null,statusBom?'Base atualizada':'Base disponível'));
  status.appendChild(el('div',null,`<small>${nf(DADOS.precedentes.length)} registros para estudo.${statusBom?'':' A atualização mais recente ficou incompleta, mas o conteúdo anterior continua disponível.'}</small>`));
  banner.appendChild(status); c.appendChild(banner);
  const official=el('div',{class:'official-sources'});
  official.appendChild(el('h3',null,'Atalhos oficiais'));
  const r=el('div',{class:'resource-grid'});
  const links=DADOS.juris_links.slice();
  if(S.perfil==='SP'){
    const fontes=configPerfil().sources||{};
    links.unshift(
      {nome:'IX Edital DPE/SP',url:fontes.last_notice},
      {nome:'Regras atuais DPE/SP',url:fontes.current_rules},
      {nome:'Concursos DPE/SP',url:fontes.contest_page}
    );
  }
  links.forEach(l=>{ const url=safeUrl(l.url); if(url){const label=jurisLinkLabel(l.nome);r.appendChild(el('a',{class:'resource-link',href:url,target:'_blank',rel:'noopener','aria-label':label+' (abre em nova aba)'},`${esc(label)}<span aria-hidden="true">↗</span>`));} });
  official.appendChild(r);c.appendChild(official);
  m.appendChild(c);

  const trilha=trilhaInformativos();
  const study=el('div',{class:'card informativos-study'});
  study.appendChild(el('span',{class:'eyebrow'},'STF + STJ · 2026 e 2025'));
  study.appendChild(el('h2',null,'Trilha de informativos por número'));
  study.appendChild(el('p',{class:'section-lead'},'A ordem intercala os tribunais e usa afinidade temática com provas de Defensoria. A data ajuda no recorte, mas não determina sozinha a prioridade.'));
  const trailGrid=el('div',{class:'informativo-grid'});
  trilha.slice(0,24).forEach(grupoInfo=>{
    const progresso=S.informativos[grupoInfo.key]||{};
    const card=el('article',{class:'informativo-card'+(progresso.lido?' done':'')});
    card.appendChild(el('div',{class:'informativo-number'},`<span>${grupoInfo.trib}</span><b>nº ${grupoInfo.numero}</b><small>${grupoInfo.ano}</small>`));
    card.appendChild(el('div',{class:'informativo-copy'},`<span class="tag ${grupoInfo.score>=40?'bad':grupoInfo.score>=24?'warn':''}">${grupoInfo.score>=40?'prioridade muito alta':grupoInfo.score>=24?'prioridade alta':'prioridade regular'}</span><p>${grupoInfo.itens.length} julgamento(s)${grupoInfo.grupos.size?' · grupos '+Array.from(grupoInfo.grupos).join(', '):''}</p>`));
    const actions=el('div',{class:'row'});
    actions.appendChild(el('button',{class:'btn sec sm',onclick:()=>{court.value=grupoInfo.trib;year.value=grupoInfo.ano;issue.value=grupoInfo.numero;page=1;apply();c1.scrollIntoView({behavior:'smooth'});}},'Ver julgamentos'));
    actions.appendChild(el('button',{class:'btn '+(progresso.lido?'':'gho')+' sm',onclick:()=>{S.informativos[grupoInfo.key]={lido:!progresso.lido,at:new Date().toISOString()};salvar();render();}},progresso.lido?'✓ Estudado':'Marcar estudado'));
    card.appendChild(actions);trailGrid.appendChild(card);
  });
  if(!trilha.length)trailGrid.appendChild(el('div',{class:'empty'},'<b>Sem informativos numerados de 2025/2026</b>Atualize a base oficial para montar esta trilha.'));
  study.appendChild(trailGrid);m.appendChild(study);

  const c1=el('div',{class:'card pad0'});
  const hd=el('div',{class:'juris-head'});
  if(agendaAtiva){
    const grupo=trilha.find(item=>item.trib===agendaAtiva.trib&&item.ano===agendaAtiva.ano&&item.numero===agendaAtiva.numero);
    const foco=el('div',{class:'informativo-focus','data-informativo-key':agendaAtiva.key||`${agendaAtiva.trib}|${agendaAtiva.ano}|${agendaAtiva.numero}`,'data-tribunal':agendaAtiva.trib,'data-ano':agendaAtiva.ano,'data-numero':agendaAtiva.numero});
    foco.appendChild(el('div',null,`<span class="eyebrow">Informativo selecionado no cronograma</span><h2>${esc(agendaAtiva.trib)} · Informativo nº ${esc(agendaAtiva.numero)} · ${esc(agendaAtiva.ano)}</h2><p>Exibindo somente os ${grupo?nf(grupo.itens.length):''} julgamento(s) vinculados a esta edição.</p>`));
    foco.appendChild(el('button',{class:'btn gho sm',onclick:()=>{court.value='';year.value='';issue.value='';page=1;apply();foco.remove();}},'Voltar à pesquisa geral'));
    hd.appendChild(foco);
  }
  hd.appendChild(el('h3',null,'Pesquisar julgados e informativos'));
  const filters=el('div',{class:'grid g3 juris-filters'});
  const queryBox=el('div');queryBox.appendChild(el('label',{class:'f'},'Busca livre'));const query=el('input',{type:'search',placeholder:'processo, assunto, tese, legislação…'});queryBox.appendChild(query);filters.appendChild(queryBox);
  function filterSelect(label,values){const box=el('div');box.appendChild(el('label',{class:'f'},label));const select=el('select');select.appendChild(el('option',{value:''},'Todos'));values.forEach(value=>select.appendChild(el('option',{value},esc(value))));box.appendChild(select);filters.appendChild(box);return select;}
  const types=[...new Set(DADOS.precedentes.map(item=>item.record_type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const courts=[...new Set(DADOS.precedentes.map(item=>item.trib).filter(Boolean))].sort();
  const branches=[...new Set(DADOS.precedentes.flatMap(item=>String(item.ramo||'').split(';').map(value=>value.trim()).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const years=[...new Set(DADOS.precedentes.map(item=>String(item.published_at||'').slice(0,4)).filter(value=>/^\d{4}$/.test(value)))].sort().reverse();
  const issues=[...new Set(DADOS.precedentes.map(numeroInformativo).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
  const type=filterSelect('Tipo de registro',types),court=filterSelect('Tribunal',courts),branch=filterSelect('Ramo do Direito',branches),year=filterSelect('Ano do informativo/julgamento',years),issue=filterSelect('Número do informativo',issues),priority=filterSelect('Prioridade DPE',['Muito alta','Alta','Regular']),group=filterSelect('Grupo de estudo',['I','II','III','IV']);
  hd.appendChild(filters);
  const summary=el('div',{class:'row juris-results'});const resultText=el('small');summary.appendChild(resultText);summary.appendChild(el('button',{class:'btn gho sm',onclick:()=>{query.value='';[type,court,branch,year,issue,priority,group].forEach(select=>select.value='');page=1;apply();}},'Limpar filtros'));hd.appendChild(summary);c1.appendChild(hd);
  const wrap=el('div',{class:'juris-table-wrap'});
  const tb=el('table');tb.innerHTML='<thead><tr><th>Origem</th><th>Referência</th><th>Síntese</th><th>Grupo</th><th></th></tr></thead>';const tbody=el('tbody');tb.appendChild(tbody);wrap.appendChild(tb);c1.appendChild(wrap);
  const pager=el('div',{class:'row juris-pager'});const previous=el('button',{class:'btn gho sm'},'Anterior'),pageText=el('small'),next=el('button',{class:'btn gho sm'},'Próxima');pager.appendChild(previous);pager.appendChild(pageText);pager.appendChild(next);c1.appendChild(pager);
  const pageSize=30;let page=1,matches=[];
  function renderRows(){
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));page=clamp(page,1,pages);tbody.innerHTML='';
    matches.slice((page-1)*pageSize,page*pageSize).forEach(p=>{
      const key=jurisKey(p),registro=S.juris.find(item=>item.id===key||(!item.id&&item.ref===p.ref)),lido=(registro||{}).lido,grupo=['I','II','III','IV'].includes(p.g)?p.g:'';
      const tr=el('tr');
      const numero=numeroInformativo(p),prioridade=nivelPrioridadeDPE(p);
      tr.innerHTML=`<td><span class="tag">${esc(p.trib)}</span>${numero?` <span class="tag warn">Inf. ${esc(numero)}</span>`:''}<br><small>${esc(p.record_type||'')}</small></td><td><b>${esc(p.ref)}</b><br><small>${esc([p.ramo,p.materia,jurisDate(p.published_at)].filter(Boolean).join(' · '))}</small></td><td><small>${esc(String(p.tese||'').slice(0,520))}${String(p.tese||'').length>520?'…':''}</small><br><span class="priority-label">Prioridade DPE: ${esc(prioridade.toLowerCase())}</span></td><td>${grupo?`<span class="tag g-${grupo}">${grupo}</span>`:'—'}</td>`;
      const actions=el('td');actions.appendChild(el('button',{class:'btn sec sm',onclick:()=>openJurisDetail(p,renderRows)},'Ver resumo'));actions.appendChild(el('button',{class:'btn '+(lido?'':'gho')+' sm',onclick:()=>{let item=S.juris.find(entry=>entry.id===key||(!entry.id&&entry.ref===p.ref));if(!item){item={id:key,ref:p.ref,lido:false};S.juris.push(item);}item.id=key;item.lido=!item.lido;salvar();renderRows();}},lido?'Revisado':'Marcar como revisado'));tr.appendChild(actions);tbody.appendChild(tr);
    });
    if(!matches.length)tbody.appendChild(el('tr',null,'<td colspan="5"><div class="empty"><b>Nenhum registro encontrado</b>Revise os filtros ou tente outros termos.</div></td>'));
    resultText.textContent=`${nf(matches.length)} resultados · página ${page} de ${pages}`;pageText.textContent=`Página ${page} de ${pages}`;previous.disabled=page<=1;next.disabled=page>=pages;
  }
  function apply(){
    const terms=jurisSearchText(query.value).split(/\s+/).filter(Boolean);
    matches=DADOS.precedentes.filter(p=>{
      if(type.value&&p.record_type!==type.value)return false;if(court.value&&p.trib!==court.value)return false;if(branch.value&&!String(p.ramo||'').split(';').map(value=>value.trim()).includes(branch.value))return false;if(year.value&&anoInformativo(p)!==year.value)return false;if(issue.value&&numeroInformativo(p)!==issue.value)return false;if(priority.value&&nivelPrioridadeDPE(p)!==priority.value)return false;if(group.value&&p.g!==group.value)return false;
      if(!terms.length)return true;const hay=jurisSearchText([p.ref,p.tema,p.tese,p.processo,p.ramo,p.materia,p.relator,p.legislacao,p.ods].filter(Boolean).join(' '));return terms.every(term=>hay.includes(term));
    });matches.sort((a,b)=>prioridadeDPE(b)-prioridadeDPE(a)||String(b.published_at||'').localeCompare(String(a.published_at||'')));renderRows();
  }
  let queryTimer=null;query.addEventListener('input',()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>{page=1;apply();},120);});[type,court,branch,year,issue,priority,group].forEach(select=>select.addEventListener('change',()=>{page=1;apply();}));previous.onclick=()=>{page--;renderRows();};next.onclick=()=>{page++;renderRows();};
  if(agendaAtiva){court.value=agendaAtiva.trib;year.value=agendaAtiva.ano;issue.value=agendaAtiva.numero;}
  apply();m.appendChild(c1);
  if(agendaAtiva)requestAnimationFrame(()=>c1.scrollIntoView({behavior:'smooth',block:'start'}));

  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Adicionar anotação jurídica'));
  c2.appendChild(el('p',{class:'section-lead'},'Inclua um julgado ou informativo que queira acompanhar junto da base principal.'));
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
  }},'Adicionar à lista'));
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
  c0.appendChild(el('span',{class:'eyebrow'},'Planejamento'));
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
  c0.appendChild(el('div',{class:'note'},S.perfil==='SP'?'Não há data oficial para o próximo concurso da DPE/SP. O perfil usa o IX edital e a regra vigente apenas como referência pré-edital; se desejar, informe uma data pessoal de planejamento.':'A banca está definida, mas a data ainda não foi publicada no edital. Até lá, use uma estimativa para organizar o ciclo.'));
  m.appendChild(c0);

  // backup
  const c=el('div',{class:'card'});
  c.appendChild(el('h2',null,'Proteja seu progresso'));
  c.appendChild(el('p',{class:'section-lead'},'Seu histórico fica neste navegador. Baixe uma cópia de segurança e guarde-a em local seguro.'));
  const r=el('div',{class:'row'});
  r.appendChild(el('button',{class:'btn',onclick:exportar},'Baixar cópia de segurança'));
  const fi=el('input',{type:'file',accept:'.json'}); fi.style.display='none';
  fi.onchange=async()=>{ const f=fi.files[0]; if(!f)return;
    try{
      if(f.size>20*1024*1024) throw new Error('o arquivo excede o limite de 20 MB');
      const candidato=await validarBackup(JSON.parse(await f.text()));
      if(!confirm('Restaurar substituirá o progresso atual deste navegador. Uma cópia do estado atual será baixada antes. Continuar?')) return;
      await exportar('pre-restauracao');
      S=candidato; configurarPerfil(S.perfil); DADOS.programa.forEach(t=>{ if(!S.topicos[t.id]) S.topicos[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''}; });
      await gravar(); toast('Backup restaurado e verificado.'); render();
    }catch(e){ alert('Não foi possível restaurar o arquivo: '+e.message); }
    finally{fi.value='';}
  };
  r.appendChild(el('button',{class:'btn sec',onclick:()=>fi.click()},'Restaurar uma cópia'));
  r.appendChild(fi);
  c.appendChild(r);
  c.appendChild(el('div',{class:'hr'}));
  const snapBox=el('div'); snapBox.innerHTML='<small>Carregando cópias automáticas…</small>';
  idbAll(SNAPS).then(sn=>{
    sn.sort((a,b)=>b.ts-a.ts); snapBox.innerHTML='';
    snapBox.appendChild(el('h3',null,`Cópias automáticas (${sn.length})`));
    if(!sn.length){ snapBox.appendChild(el('div',{class:'note'},'A primeira cópia será criada automaticamente após algumas horas de uso.')); return; }
    const tb=el('table'); tb.innerHTML='<thead><tr><th>Data</th><th></th></tr></thead>'; const tbody=el('tbody');
    sn.forEach(s=>{ const tr=el('tr',null,`<td>${new Date(s.ts).toLocaleString('pt-BR')}</td>`);
      const td=el('td'); td.appendChild(el('button',{class:'btn gho sm',onclick:async()=>{ if(!confirm('Restaurar esta cópia? O progresso atual será baixado antes.'))return;
        try{const candidato=await validarBackup(JSON.parse(s.data)); await exportar('pre-snapshot'); S=candidato; await gravar(); toast('Cópia restaurada.'); render();}
        catch(error){alert('Não foi possível restaurar a cópia: '+error.message);}
      }},'Restaurar'));
      tr.appendChild(td); tbody.appendChild(tr); });
    tb.appendChild(tbody); snapBox.appendChild(tb);
  });
  c.appendChild(snapBox);
  m.appendChild(c);

  // importador de questões
  const c2=el('div',{class:'card'});
  c2.appendChild(el('h2',null,'Importar questões'));
  c2.appendChild(el('p',{class:'section-lead'},'Cole uma lista em CSV ou cadastre uma questão. O novo conteúdo entra nas práticas e nos simulados deste navegador.'));
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

  // resumo do conteúdo
  const c3=el('div',{class:'card'});
  c3.appendChild(el('h2',null,'Conteúdo disponível'));
  const k=metricas();
  const resumo=el('div',{class:'grid g4'});
  const resumoStat=(rotulo,valor)=>{const item=el('div',{class:'mini-stat'});item.appendChild(el('b',null,nf(valor)));item.appendChild(el('span',null,rotulo));return item;};
  resumo.appendChild(resumoStat('tópicos',DADOS.programa.length));
  resumo.appendChild(resumoStat('questões',DADOS.questoes.length+imp.length));
  resumo.appendChild(resumoStat('julgados e informativos',DADOS.precedentes.length));
  resumo.appendChild(resumoStat('tópicos iniciados',k.ini));
  c3.appendChild(resumo);
  c3.appendChild(el('div',{class:'note'},'O material orienta seus estudos. Para prova e atuação profissional, confirme sempre o edital, a legislação e os julgados nas fontes oficiais indicadas.'));
  c3.appendChild(el('h3',{class:'danger-title'},'Recomeçar'));
  const rz=el('div',{class:'row'});
  rz.appendChild(el('button',{class:'btn gho sm',onclick:async()=>{
    if(!confirm('Apagar TODO o progresso deste navegador e recomeçar? Uma cópia será baixada antes.')) return;
    try{await exportar('antes-de-zerar'); S=novoEstado(); await gravar(); toast('Estado reiniciado.'); go('painel');}
    catch(error){alert('O progresso não foi apagado: '+error.message);}
  }},'Apagar meu progresso'));
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
  const a=el('a',{href:URL.createObjectURL(blob),download:`centro-estudos-${S.perfil.toLowerCase()}-backup-${hoje()}${sufixo?'-'+sufixo:''}.json`});
  document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},400);
  return true;
}
async function validarBackup(obj){
  if(!obj||typeof obj!=='object') throw new Error('estrutura JSON inválida');
  if(obj.format===BACKUP_FORMAT){
    if(obj.formatVersion!==1) throw new Error(`formato de backup ${obj.formatVersion} não suportado`);
    if(!obj.state||!obj.stateSha256) throw new Error('backup incompleto');
    const atual=await sha256Text(JSON.stringify(obj.state));
    if(atual!==obj.stateSha256) throw new Error('o arquivo está incompleto ou foi alterado');
    return validarEstadoRestaurado(obj.state);
  }
  // Compatibilidade explícita com backups 0.7 e snapshots locais anteriores.
  if(obj.schema&&obj.topicos) return validarEstadoRestaurado(obj);
  throw new Error('o arquivo não é um backup reconhecido deste aplicativo');
}
function validarEstadoRestaurado(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('estado ausente ou inválido');
  if(!Number.isInteger(Number(raw.schema))||Number(raw.schema)<1) throw new Error('formato de dados inválido');
  if(!raw.topicos||typeof raw.topicos!=='object'||Array.isArray(raw.topicos)) throw new Error('progresso por tópicos inválido');
  if(raw.prova&&raw.prova.data&&!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.prova.data))) throw new Error('data da prova inválida');
  const arrayLimit=(name,limit)=>{ if(raw[name]!=null&&!Array.isArray(raw[name]))throw new Error(`${name} deve ser uma lista`); if((raw[name]||[]).length>limit)throw new Error(`${name} excede o limite de ${limit} registros`); };
  arrayLimit('questoesImportadas',5000); arrayLimit('sessoes',5000); arrayLimit('juris',10000); arrayLimit('ciclosAnteriores',200); arrayLimit('revisoesManuais',2000);
  const grupos=new Set(['I','II','III','IV']);
  const disciplinas=new Set(DADOS_BASE.programa.map(t=>t.dc));
  Object.values(DADOS.perfis||{}).forEach(perfil=>(perfil.supplement_topics||[]).forEach(t=>disciplinas.add(t.dc)));
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
    if(!idb) throw new Error('Não foi possível guardar seus dados neste navegador. Verifique as permissões do site.');
    await carregar();
    configurarPerfil(S.perfil);
    DADOS.programa.forEach(t=>{if(!S.topicos[t.id])S.topicos[t.id]={st:'NAO_INICIADO',pr:'MEDIA',dm:0,fz:0,ac:0,nt:''};});
    await gravar();
    tema();
    $('#btnTheme').onclick=()=>{ S.ui.tema = S.ui.tema==='light'?'dark':'light'; tema(); salvar(); };
    $('#profileSelect').onchange=event=>trocarPerfil(event.target.value);
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
    card.appendChild(el('div',{class:'note'},'Recarregue a página. Se o problema continuar, verifique se o navegador permite salvar dados para este site.'));
    main.appendChild(card);
  }
}
init();
})();
