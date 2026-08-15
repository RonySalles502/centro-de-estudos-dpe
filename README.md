# Centro de Estudos DPE/RN

Produto de estudo **local-first** para o concurso da DPE/RN. A versão principal é uma PWA estática: pode ser publicada gratuitamente no GitHub Pages, funciona offline depois do primeiro acesso e mantém todo o progresso no navegador de cada usuário.

Não há contas, banco de dados remoto nem concorrência entre usuários. O mesmo endereço pode ser compartilhado com poucas pessoas; cada perfil de navegador terá uma instalação e um estado independentes.

## Versão recomendada: PWA

A pasta `pwa/` contém:

- 296 tópicos do programa verticalizado;
- 260 questões autorais referenciadas, com cinco alternativas, distribuídas nos quatro grupos (80/60/60/60) e vinculadas a 218 tópicos;
- práticas, simulados de grupo e simulado completo;
- diagnóstico e cronograma adaptativo, com redistribuição de pesos quando um tipo de conteúdo não está disponível;
- revisão espaçada, discursivas e mapa de leitura legislativa;
- jurisprudência versionada, alimentada automaticamente por páginas e feeds oficiais do STF e do STJ;
- dados pessoais apenas em IndexedDB;
- backups JSON versionados, com SHA-256 e cópia preventiva antes de restaurações ou reinicialização;
- cache offline por service worker e nenhum CDN ou serviço externo em tempo de estudo.

Sessões encerradas armazenam uma fotografia das questões utilizadas. Assim, uma atualização do banco não altera retroativamente enunciado, gabarito ou explicação do histórico.

## Publicação gratuita no GitHub Pages

1. Publique este projeto em um repositório público no GitHub.
2. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**.
3. Envie a branch `main` ou `master`.

O fluxo [deploy-pages.yml](.github/workflows/deploy-pages.yml) valida e gera a PWA, publica `pwa/dist` e, diariamente, tenta atualizar a jurisprudência. Uma coleta só substitui o pacote quando ao menos uma fonte oficial responde validamente; os dados da fonte que falhou permanecem preservados.

O fluxo também pode ser executado manualmente na aba **Actions**. Agendamentos do GitHub podem atrasar, e repositórios públicos inativos podem ter agendamentos desabilitados pelo próprio GitHub; o disparo manual continua disponível.

> Importante: o progresso pertence à origem do site. Antes de trocar domínio, conta ou nome do repositório, cada usuário deve exportar um backup e restaurá-lo no endereço novo.

## Executar localmente

É necessário servir os arquivos por HTTP; abrir `index.html` com `file://` não oferece as garantias exigidas por PWA, Web Crypto e IndexedDB.

```bash
python pwa/build.py
python -m http.server 8765 --directory pwa/dist
```

Abra `http://127.0.0.1:8765`.

O build não baixa dependências. Ele valida quantidades, IDs, vínculos programáticos, gabaritos, cinco alternativas, URLs, mapa legislativo e integridade do pacote de jurisprudência. Os arquivos de conteúdo recebem nomes com hash, e o navegador verifica o SHA-256 antes de carregá-los.

## Atualização da jurisprudência

Para testar manualmente a coleta:

```bash
python pwa/update_jurisprudence.py
python pwa/build.py
```

Fontes configuradas:

- Informativo de Jurisprudência do STJ;
- Informativo STF no portal oficial;
- Jurisprudência em Teses do STJ.

O coletor não inventa teses com IA. Ele usa título, síntese e metadados presentes nas fontes institucionais, registra a saúde de cada origem e conserva a última versão válida em `pwa/content/jurisprudence.json`.

## Banco de questões

O banco importado da versão HTML foi mantido integralmente. Cada item recebe versão, hash canônico, situação editorial, autoria e situação de direitos no build. Questões inseridas pelo usuário ficam separadas e identificadas como conteúdo sob responsabilidade do próprio usuário.

Para expansão editorial, acrescente itens aos arquivos `pwa/src/questoes_g1.json` a `questoes_g4.json`, mantendo o formato existente. O build rejeita IDs duplicados, gabaritos inválidos, quantidade diferente de cinco alternativas e vínculos com tópicos inexistentes. O inventário de fontes e a política de direitos ficam em `pwa/src/question_catalog.json`.

## Persistência e atualização

- Código e conteúdo público: GitHub Pages/service worker.
- Progresso privado: IndexedDB do navegador.
- Recuperação curta: até sete snapshots locais, espaçados em seis horas.
- Recuperação portátil: backup JSON com hash SHA-256.
- Migração: o estado `0.7` em `localStorage` é importado uma única vez para o esquema `8`.

Atualizar o site não apaga o progresso. Limpar os dados do navegador, usar modo privado ou mudar a origem do site pode apagá-lo; por isso, o backup periódico é parte do uso normal do produto.

O hash detecta corrupção acidental, mas não é assinatura digital. Restaure apenas arquivos gerados por uma instalação em que você confia; a importação também aplica limites e validação estrutural antes de substituir o estado.

## Testes

```bash
python -m unittest discover -v
python pwa/build.py
node --check pwa/src/app.js
```

O roteiro de ponta a ponta em `pwa/test.js` cobre as nove áreas, ciclo de 28 dias, prática, simulados, revisão, discursivas, importação, persistência, jurisprudência e validação criptográfica do backup. Ele requer Playwright e um servidor apontando para `pwa/dist`.

## Aplicação Python anterior

A arquitetura Python/SQLite permanece no repositório para compatibilidade e referência (`app.py`, `server/`, `web/`). Ela ainda pode ser iniciada pelos scripts antigos, mas não é a distribuição recomendada: exige processo local, empacotamento por sistema operacional e manutenção duplicada de interface e conteúdo.

A decisão arquitetural e os limites da migração estão registrados em [ADR-001](docs/ADR-001-pwa-local-first.md).

## Limites

- não há sincronização de progresso entre máquinas;
- não há autenticação nem confidencialidade contra alguém com acesso ao mesmo perfil do navegador;
- a classificação temática automática da jurisprudência é auxiliar;
- questões e sínteses devem ser conferidas nas fontes oficiais antes de firmar posição jurídica;
- o aplicativo não substitui edital, legislação, julgados oficiais ou correção humana.
