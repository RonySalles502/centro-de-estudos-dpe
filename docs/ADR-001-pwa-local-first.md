# ADR-001 — PWA estática local-first como produto principal

- **Situação:** aceita
- **Data:** 2026-08-15
- **Versão:** 0.8.0

## Contexto

O produto será repassado a poucos usuários, sem uso concorrente. Cada pessoa deve manter configuração e progresso próprios. A implantação e as melhorias devem ser simples e, idealmente, gratuitas. O banco de 260 questões da versão HTML precisa ser preservado, e a jurisprudência deve continuar recebendo atualização automática.

O repositório possuía duas arquiteturas:

1. aplicação Python, servidor HTTP local e SQLite;
2. aplicação HTML autocontida, com estado no navegador e banco de questões maior.

## Decisão

Adotar uma **PWA estática modular e local-first** como produto principal:

```text
GitHub Actions ── build + coleta oficial ──> GitHub Pages
                                                │
                           código/conteúdo      │ HTTPS + cache offline
                                                ▼
                                          navegador do usuário
                                                │
                                  progresso ──> IndexedDB + backup JSON
```

O Python deixa de ser requisito de execução e passa a atuar apenas no build e na coleta agendada. O aplicativo Python/SQLite permanece como legado compatível, sem ser removido nesta decisão.

## Motivos

- **Distribuição:** um link substitui instaladores e atualizações manuais.
- **Custo:** o site estático cabe no GitHub Pages gratuito para repositório público.
- **Isolamento:** IndexedDB é separado por navegador/perfil, atendendo ao uso sem concorrência.
- **Offline:** o service worker mantém aplicação e último conteúdo válido após o primeiro acesso.
- **Manutenção:** interface, programa, questões e jurisprudência publicados formam um único artefato versionado.
- **Migração:** o banco HTML de 260 questões é usado diretamente; o estado `0.7` é migrado de `localStorage` para IndexedDB.

## Consequências favoráveis

- nenhum processo local ou Python para o usuário final;
- deploy reprodutível, com conteúdo validado e hashes SHA-256;
- sessões históricas imutáveis por snapshot das questões;
- jurisprudência atualizada fora do navegador e sem CORS;
- falha em uma fonte não destrói a base anterior;
- cada usuário pode exportar e restaurar seu próprio estado.

## Custos e riscos aceitos

- o progresso não sincroniza entre dispositivos;
- a segurança depende do perfil e das permissões do navegador;
- alterar a origem do site exige exportar/restaurar backup;
- GitHub Pages gratuito exige repositório público e não executa Python no servidor;
- GitHub Actions agendado pode atrasar ou ser desabilitado por inatividade;
- `frame-ancestors` e outros cabeçalhos fortes dependem do provedor; `_headers` também permite publicar a mesma pasta no Cloudflare Pages.

## Alternativas rejeitadas

### Manter Python/SQLite como produto principal

Oferece consultas SQL, backups de arquivo e tarefas em segundo plano no próprio computador, mas aumenta suporte, empacotamento e risco de bloqueios locais. Não pode ser hospedado no GitHub Pages e duplicaria o ciclo de atualização para cada instalação.

### HTML monolítico sem build

É simples de copiar, porém mistura código, estilo e conteúdo, dificulta cache seletivo, integridade, atualização de jurisprudência e revisão do banco.

### Backend gratuito compartilhado

Criaria autenticação, privacidade, concorrência, migrações remotas e dependência operacional sem benefício para o requisito atual.

## Guardrails

- não carregar scripts, fontes ou estilos de CDN;
- aceitar links externos somente por HTTP/HTTPS;
- nunca substituir o pacote jurídico quando todas as fontes falharem;
- manter versão e hash de conteúdo e backups;
- preservar snapshots de questões em sessões encerradas;
- validar o banco no build antes do deploy;
- tratar material automático como referência, sempre com link oficial.
