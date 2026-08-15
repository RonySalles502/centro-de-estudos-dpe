# Centro de Estudos DPE/RN - contexto, premissas e decisões do projeto

> Documento de referência funcional, jurídica e técnica.
>
> Estado documentado: **15 de agosto de 2026**
> Versão da aplicação: **0.7.0**
> Versão do esquema de dados: **6**

## 1. Finalidade deste documento

Este arquivo consolida o contexto que deu origem ao produto, as decisões já tomadas, as premissas que devem orientar a evolução, o estado real da implementação e as pendências que não podem ser tratadas como concluídas.

Ele deve ser atualizado quando ocorrer qualquer uma destas situações:

- publicação do edital do novo concurso;
- alteração do programa, das etapas ou do modelo de prova;
- mudança relevante na arquitetura ou na forma de distribuição;
- inclusão de nova fonte de jurisprudência ou questões;
- promoção de material pendente para juridicamente validado;
- modificação das regras de cronograma, revisão ou desempenho.

Este documento não substitui o `README.md`, que permanece como guia operacional de instalação e uso.

## 2. Fato gerador confirmado

O projeto foi iniciado no contexto da preparação para o novo concurso da Defensoria Pública do Estado do Rio Grande do Norte para o cargo de **Defensor(a) Público(a) Substituto(a)**.

Em 15 de agosto de 2026, o Diário Oficial do Estado do Rio Grande do Norte publicou o **Termo de Dispensa de Licitação nº 03/2026 - DPE/RN**, datado de 14 de agosto de 2026, relativo ao Processo Administrativo nº `000110000191.000001/2025-64`, UASG `925772`.

O documento registra:

- contratante: Defensoria Pública do Estado do Rio Grande do Norte;
- instituição selecionada: Centro Brasileiro de Pesquisa em Avaliação e Seleção e de Promoção de Eventos - **CEBRASPE**;
- objeto: organização e realização de concurso público de provas e títulos para provimento de cargos da carreira de Defensor(a) Público(a) Substituto(a) da DPE/RN;
- valor global estimado: R$ 1.687.380,52;
- fundamento da contratação direta: art. 75, XV, da Lei nº 14.133/2021;
- código de verificação no DOE/RN: `GX4LR7LSV6-F8IF0Q3ET0-P2TH9ZW2VI`.

### 2.1 Limite da informação confirmada

O Termo de Dispensa confirma a escolha do CEBRASPE para a organização do certame, mas **não equivale ao edital do concurso**. Portanto, ainda não estão oficialmente definidos, apenas com base nesse documento:

- data da prova;
- número de vagas;
- cronograma das etapas;
- formato definitivo da prova objetiva;
- quantidade de questões;
- regras de pontuação e penalização;
- estrutura das provas discursivas e oral;
- programa definitivo;
- critérios de títulos, reservas de vagas e recursos.

Qualquer configuração do sistema sobre esses pontos deve permanecer identificada como estimativa ou hipótese até a publicação do edital.

## 3. Visão do produto

O Centro de Estudos DPE/RN deve funcionar como um **ambiente completo de controle do estudo pré-edital**, reunindo em uma única aplicação:

- programa verticalizado;
- diagnóstico da disponibilidade e do perfil de estudo;
- cronograma adaptativo;
- legislação aplicável a cada bloco;
- banco de questões;
- práticas dirigidas e simulados;
- acompanhamento de desempenho;
- jurisprudência e informativos;
- revisão espaçada;
- treino de discursivas;
- registro de erros e dúvidas;
- backup e restauração do progresso.

O objetivo não é apenas armazenar conteúdo. O produto deve apoiar as decisões diárias do candidato: **o que estudar, por quanto tempo, com qual fonte, quando revisar e onde estão suas lacunas**.

### 3.1 Premissa de experiência: estudo primeiro

O candidato não pode funcionar como curador cotidiano do próprio material. A interface principal deve:

- mostrar apenas conteúdo liberado para estudo;
- converter disponibilidade e preferências em uma agenda diária acionável;
- manter estados editoriais, itens experimentais e tarefas de validação na camada técnica;
- permitir sinalização opcional de problema sem transformar conferência jurídica em obrigação;
- redistribuir automaticamente o tempo destinado a módulos ainda sem conteúdo suficiente;
- explicar o ajuste sem criar blocos inexequíveis;
- preservar rastreabilidade e prudência editorial fora do fluxo cognitivo principal.

Essa separação não transforma material incerto em validado. Ela impede que a dívida editorial seja transferida ao candidato.

## 4. Origem e adaptação do conceito

O projeto reaproveita a ideia e parte da experiência funcional do **Centro de Estudos TJCE**, anteriormente produzido pelo mesmo usuário.

A adaptação não deve ser uma simples troca de identidade visual ou de conteúdo. Concursos para Defensoria Pública exigem maior peso para:

- direitos humanos;
- princípios institucionais da Defensoria Pública;
- tutela coletiva e grupos vulnerabilizados;
- jurisprudência constitucional e infraconstitucional;
- legislação especial extensa;
- provas discursivas com argumentação jurídica;
- atualização contínua de precedentes e informativos.

### 4.1 Decisão específica sobre o cronograma

O formato preferido é o utilizado no app do TJCE:

- navegação por semanas (`Sem 1`, `Sem 2` etc.);
- uma semana exibida por vez;
- cartões verticais para cada dia;
- blocos de estudo dentro do cartão diário;
- norma e artigos para leitura apresentados no próprio bloco;
- visualização dos dias sem carga prevista;
- manutenção das ações de concluir, pular e reabrir.

Uma grade mensal compacta não foi adotada porque tenderia a ocultar ou comprimir excessivamente as referências legislativas.

## 5. Público, implantação e modelo de uso

### 5.1 Usuários

O sistema não será necessariamente usado por uma única pessoa. A premissa correta é:

- cada candidato recebe ou instala sua própria cópia;
- cada cópia roda de modo independente na máquina do candidato;
- os dados de um candidato não são compartilhados automaticamente com os demais;
- não existe concorrência de usuários dentro da mesma instalação;
- não há servidor central do grupo.

Em termos técnicos, o produto é de **instância individual**, e não de conta individual em uma plataforma multiusuário.

### 5.2 Uso restrito

O uso inicialmente previsto é privado, por um grupo de amigos, sem comercialização.

Essa restrição reduz a exposição do projeto, mas **não elimina direitos autorais, termos de uso, proteção de dados ou a necessidade de conferir a origem do material**. Conteúdo de prova não deve ser copiado automaticamente apenas porque o uso é gratuito ou restrito.

### 5.3 Hospedagem e conectividade

Premissas definidas:

- execução local;
- servidor restrito a `127.0.0.1` ou `localhost`;
- banco SQLite local;
- ausência de autenticação, aceitável apenas porque o serviço não deve ser exposto à rede;
- funcionamento do conteúdo já importado sem internet;
- internet necessária para buscar novos informativos e abrir fontes oficiais;
- interface sem bibliotecas ou CDNs externas;
- possibilidade de instalação como PWA no navegador, sem transformar o front-end em serviço remoto.

O servidor local não deve ser publicado na internet, colocado atrás de proxy público ou configurado para escutar em todas as interfaces sem uma revisão completa de segurança e autenticação.

## 6. Distribuição e dependência do Python

Existem duas modalidades previstas.

### 6.1 Código-fonte

- Windows 10/11, macOS ou Linux;
- Python 3.10 ou superior;
- sem pacotes Python externos para a execução normal;
- inicialização por `iniciar.bat` no Windows ou `iniciar.sh` no macOS/Linux.

### 6.2 Aplicativo Windows autônomo

O projeto contém:

- `CentroEstudosDPERN.spec` para empacotamento com PyInstaller;
- `gerar_executavel_windows.bat` para compilação local;
- workflow do GitHub Actions para gerar `CentroEstudosDPERN.exe` em ambiente Windows.

O objetivo é distribuir uma versão em que o candidato não precise instalar Python nem iniciar o sistema por arquivo `.bat`.

### 6.3 Situação ainda pendente

O pipeline de empacotamento existe, mas o executável Windows ainda precisa ser:

- compilado em ambiente Windows;
- testado em máquina sem Python;
- verificado quanto ao antivírus e falso positivo;
- validado para gravação em `%LOCALAPPDATA%`;
- testado em atualização sobre uma base pessoal existente;
- distribuído com instruções claras de backup e encerramento.

Portanto, a eliminação prática da dependência do Python **ainda não deve ser considerada concluída**.

## 7. Arquitetura atual

### 7.1 Componentes

| Componente | Responsabilidade |
|---|---|
| `app.py` | servidor HTTP local, rotas da API e entrega dos arquivos estáticos |
| `server/database.py` | inicialização, migrações, persistência SQLite e consultas gerais |
| `server/questions.py` | fontes, questões, sessões, correção, antirrepetição e sinalizações |
| `server/jurisprudence.py` | adaptadores, atualização e enriquecimento de informativos |
| `server/study_planning.py` | diagnóstico, cronograma, legislação, revisões e discursivas |
| `server/backup.py` | criação, verificação e restauração de backups |
| `server/schema.sql` | esquema versionado do banco SQLite |
| `data/program.json` | programa verticalizado |
| `data/legislation_reading_map.json` | mapa de normas, artigos, fontes e situação de validação |
| `data/question_catalog.json` | inventário de fontes e questões controladas |
| `web/` | HTML, CSS, JavaScript, manifesto PWA, ícone e cache offline |
| `tests/` | testes de banco, backup, questões, planejamento e jurisprudência |

### 7.2 Persistência

Ao executar pelo código-fonte, o banco pessoal é criado em:

```text
runtime/centro-dpern.sqlite3
```

No executável Windows, a localização projetada é:

```text
%LOCALAPPDATA%\CentroEstudosDPERN\
```

O catálogo-base e o progresso pessoal são separados. Atualizações do catálogo devem preservar:

- status de estudo;
- domínio;
- desempenho;
- revisões;
- sessões;
- tentativas discursivas;
- sinalizações;
- cronogramas anteriores;
- configurações e backups.

### 7.3 Concorrência interna

Embora não exista concorrência de usuários, o servidor e os agendadores usam threads. O acesso ao SQLite é serializado para impedir conflito entre:

- gravação de progresso;
- atualização de jurisprudência;
- backup automático;
- restauração do banco.

## 8. Programa e conteúdo programático

### 8.1 Fonte vigente de trabalho

O programa pré-edital foi verticalizado a partir da **Resolução nº 344/2025 da DPE/RN, em redação consolidada**, consultada em 15 de agosto de 2026.

Essa resolução é a melhor base pré-edital disponível, mas não há garantia de identidade integral com o futuro edital. O sistema deve permitir substituir ou versionar o programa quando o edital for publicado, sem apagar o progresso anterior.

### 8.2 Estrutura atual

- 296 tópicos;
- 12 disciplinas;
- quatro grupos objetivos;
- identificação por tópico, disciplina, grupo, item e página da fonte;
- fonte e evidência registradas no catálogo.

Distribuição atual:

| Grupo | Tópicos |
|---|---:|
| I | 69 |
| II | 61 |
| III | 90 |
| IV | 76 |
| **Total** | **296** |

Disciplinas cadastradas:

1. Direito Constitucional;
2. Direito Administrativo;
3. Princípios Institucionais da Defensoria Pública;
4. Direito Penal;
5. Direito Processual Penal;
6. Direito da Execução Penal;
7. Direito Civil;
8. Direito Processual Civil;
9. Direito do Consumidor;
10. Direitos Difusos e Coletivos;
11. Direitos Humanos;
12. Direito da Criança e do Adolescente.

### 8.3 Progresso individual

Cada tópico admite:

- situação: `NAO_INICIADO`, `EM_ESTUDO`, `REVISAO` ou `CONSOLIDADO`;
- prioridade: `ALTA`, `MEDIA` ou `BAIXA`;
- domínio de 0 a 5;
- questões realizadas e acertos;
- última e próxima revisão;
- anotações.

## 9. Diagnóstico e geração do cronograma

### 9.1 Dados do diagnóstico

O diagnóstico registra:

- minutos disponíveis em cada dia da semana;
- nível: iniciante, intermediário ou avançado;
- turno preferencial: manhã, tarde, noite ou flexível;
- duração desejada dos blocos;
- horizonte do ciclo;
- divisão percentual entre os quatro grupos;
- divisão percentual entre tipos de conteúdo.

Tipos de conteúdo:

- leitura;
- questões;
- jurisprudência;
- revisão;
- discursiva;
- simulado.

Regras de validação atuais:

- 0 a 720 minutos por dia;
- mínimo de 60 minutos por semana;
- blocos entre 20 e 120 minutos;
- horizonte entre 7 e 84 dias;
- pesos dos grupos totalizando exatamente 100%;
- pesos dos tipos de conteúdo totalizando exatamente 100%.

### 9.2 Valores iniciais

Disponibilidade sugerida:

- segunda a sexta: 120 minutos por dia;
- sábado: 180 minutos;
- domingo: 60 minutos.

Preferência inicial de conteúdo:

- leitura: 25%;
- questões: 25%;
- jurisprudência: 15%;
- revisão: 15%;
- discursiva: 10%;
- simulado: 10%.

Foco inicial entre grupos: 25% para cada grupo.

Os valores são apenas padrões de preenchimento; o cronograma efetivo depende do diagnóstico de cada instalação.

### 9.3 Critérios do motor

O motor distribui a carga tentando respeitar os pesos informados. A priorização dos tópicos considera:

- prioridade atribuída;
- status do tópico;
- domínio informado;
- acurácia registrada;
- ordem programática;
- revisões vencidas dentro do horizonte;
- nível de experiência do candidato;
- disponibilidade real de conteúdo liberado em cada módulo e grupo.

Perfis:

- iniciante: preserva mais fortemente a progressão programática;
- intermediário: equilibra sequência, status, domínio e acurácia;
- avançado: dá mais peso a lacunas de desempenho já aferidas.

Antes de distribuir os blocos, o motor verifica a disponibilidade. Questões, simulados, jurisprudência, revisão ou discursiva sem conteúdo suficiente têm o tempo redistribuído para métodos executáveis. O plano registra os ajustes e não exige validação do candidato.

### 9.4 Formato de exibição

O cronograma atual usa calendário semanal inspirado no app do TJCE:

- abas por semana;
- período, quantidade de blocos, minutos e conclusão semanal;
- cartões por dia;
- dias com disponibilidade zero permanecem visíveis;
- cada bloco mostra método, duração, grupo, disciplina, justificativa e situação;
- legislação aparece dentro do bloco diário;
- semanas parciais no início e no fim do ciclo são preservadas.

### 9.5 Limites atuais do cronograma

- o turno preferencial é armazenado e exibido, mas o motor ainda não atribui hora específica aos blocos;
- o cronograma não integra compromissos de calendário externo;
- feriados e indisponibilidades excepcionais ainda não são tratados;
- a redistribuição automática de blocos pulados não está implementada;
- a qualidade do cronograma depende da qualidade dos dados de progresso;
- a quantidade e o formato de simulados são provisórios até o edital.

## 10. Legislação aplicável aos blocos

### 10.1 Regra de produto

O cronograma não deve apresentar apenas o nome do conteúdo. Sempre que houver faixa normativa pertinente, o cartão deve informar:

- nome da norma;
- artigos ou intervalo para leitura;
- eventual indicação de leitura integral;
- link para texto oficial;
- rótulo de estudo do roteiro normativo.

### 10.2 Estado do mapa

- versão: `2026.08-inicial-1`;
- método: `IA_ASSISTIDA`;
- 51 fontes normativas oficiais cadastradas;
- 224 tópicos com faixa legislativa inicial;
- 69 tópicos classificados como predominantemente doutrinários, jurisprudenciais ou internacionais, sem faixa autônoma específica;
- três tópicos ainda pendentes de delimitação.

Tópicos pendentes:

1. `G2-DPP-26` - Resoluções CNJ nº 425/2021 e nº 287/2019;
2. `G2-DPP-27` - Política Antimanicomial no Poder Judiciário, Resolução CNJ nº 487/2023;
3. `G2-DPP-28` - Regras Mínimas para o Tratamento do Preso no Brasil, Resolução CNPCP nº 14/1994.

### 10.3 Estados editoriais

- `MAPEADO_PENDENTE_VALIDACAO`: faixa inicial disponível, mas ainda não conferida integralmente;
- `VALIDADO`: conferência humana concluída na fonte oficial;
- `SEM_DISPOSITIVO_ESPECIFICO`: não se deve inventar artigos para tema predominantemente não legislativo;
- `PENDENTE_MAPEAMENTO`: a faixa ainda não foi definida.

### 10.4 Snapshot do cronograma

Ao gerar o cronograma, o sistema grava uma fotografia da orientação legislativa. Alterações futuras no mapa não reescrevem silenciosamente ciclos antigos.

### 10.5 Risco jurídico-editorial

Os 224 mapeamentos foram produzidos com assistência de IA e continuam pendentes de validação humana. Eles servem como orientação operacional, não como garantia jurídica. A promoção para `VALIDADO` exige conferência no texto oficial consolidado.

Essa conferência pertence à manutenção do pacote. Para o candidato, a faixa aparece como **Roteiro pré-edital**, acompanhada do link oficial, sem chamada para validar o conteúdo durante a rotina.

## 11. Banco de questões e simulados

### 11.1 Objetivo

O banco deve ser amplo o suficiente para que o candidato aprenda o tema, e não memorize uma sequência reduzida de enunciados.

Robustez significa combinar:

- diversidade de concursos e anos;
- cobertura por disciplina, tópico e grupo;
- controle de duplicidade;
- histórico de exposição;
- priorização de questões inéditas;
- intervalo mínimo antes da repetição;
- reexposição dirigida a erros e baixa confiança;
- equilíbrio de dificuldade;
- rastreabilidade de fonte, gabarito e versão.

### 11.2 Fontes inventariadas

O catálogo registra oito referências do CEBRASPE:

- DPE/RN 2015 - edital de abertura;
- DPE/RN 2015 - padrão definitivo de resposta discursiva;
- DPE/PA 2021;
- DPE/SE 2021;
- DPE/PI 2021;
- DPE/TO 2021;
- DPE/RO 2022;
- DPE/RS 2021.

Também existem três fontes normativas primárias para os pilotos autorais:

- Constituição Federal;
- Código Civil;
- Estatuto da Criança e do Adolescente.

Inventariar uma página ou documento não autoriza automaticamente a reprodução de todos os enunciados.

### 11.3 Política de direitos

Premissa registrada no catálogo:

> Armazenar enunciados somente após definição de autoria, licença ou autorização de uso. Metadados e links oficiais não liberam reprodução automática do texto.

O uso privado e não comercial não deve ser tratado como autorização automática.

### 11.4 Banco regular

Uma questão somente pode entrar em práticas e simulados regulares se, entre outros controles:

- tiver formato compatível;
- possuir cinco alternativas A-E;
- tiver gabarito válido;
- estiver `VALIDADO` ou `PUBLICADO`;
- tiver direito de uso `AUTORAL`, `LICENCIADO` ou `USO_AUTORIZADO`;
- não possuir sinalização ativa;
- se produzida por IA, estiver `VALIDADA_FONTE`.

O banco regular está vazio no marco atual. Consequentemente, os simulados regulares permanecem indisponíveis até a primeira curadoria.

### 11.5 Estrutura provisória de simulados

- prática dirigida: de 1 a 100 questões;
- simulado de grupo: 25 questões validadas;
- simulado completo: 25 questões por grupo, totalizando 100.

Esses números são uma regra funcional provisória, e não uma reprodução confirmada do futuro edital.

### 11.6 Limite técnico de formato

O motor atual trabalha com questões de múltipla escolha com alternativas A-E. O formato definitivo do novo certame ainda não foi publicado. Caso o CEBRASPE adote itens de certo/errado, modelo híbrido ou regra específica de penalização, o esquema e a correção precisarão ser ampliados.

### 11.7 Antirrepetição: estado atual

A seleção regular já prioriza:

1. questões nunca expostas em sessões regulares;
2. menor quantidade histórica de exposições;
3. questão há mais tempo sem uso;
4. aleatoriedade apenas para desempate.

O cronograma também limita lotes de questões e simulados ao volume inédito estimado e converte a carga excedente em leitura. Permanecem como evolução: balanceamento fino por tópico, janela configurável de resfriamento e repetição dirigida por erro, confiança e tempo.

## 12. Questões e conteúdos produzidos por IA

### 12.1 Princípio

Conteúdo gerado por IA pode ampliar cobertura, mas não pode ser apresentado como juridicamente validado sem conferência humana.

### 12.2 Controles obrigatórios da camada técnica

Cada questão de IA deve conter:

- autoria `IA`;
- identificação do modelo;
- versão do prompt;
- fonte oficial;
- referência normativa ou jurisprudencial precisa;
- gabarito identificado como provisório enquanto pendente;
- situação de validação;
- isolamento até a liberação editorial.

### 12.3 Separação do fluxo do candidato

Questões pendentes permanecem no catálogo técnico, fora do banco, da página de questões, do configurador de sessões e do histórico regular. A infraestrutura experimental continua preservada para manutenção e testes, mas não é oferecida como atividade de estudo. Questões liberadas podem ser sinalizadas opcionalmente; a sinalização aberta coloca o item em quarentena local.

### 12.4 Estado atual

Existem quatro questões-piloto, uma em cada área de teste selecionada, todas:

- autorais;
- geradas por IA;
- com fonte oficial indicada;
- em `EM_REVISAO`;
- com validação `PENDENTE_FONTE`.

Elas exercitam a infraestrutura editorial, mas não constituem banco suficiente nem aparecem na rotina do candidato.

## 13. Jurisprudência e informativos

### 13.1 Relevância

Informativos e precedentes são conteúdo central para concursos de Defensoria. O produto deve manter um radar atualizado, pesquisável e integrado ao planejamento.

### 13.2 Fontes atuais

- STJ - Informativo de Jurisprudência, feed oficial, habilitado;
- STF - página oficial da edição mais recente do Informativo STF, habilitada;
- STJ - Jurisprudência em Teses, cadastrada mas desabilitada até validação específica do adaptador.

### 13.3 Atualização

- atualização automática habilitada por padrão;
- intervalo geral configurável, inicialmente 12 horas;
- falha de rede não impede o uso local;
- nova publicação entra como `IMPORTADO`, sem validação editorial automática;
- mudanças de conteúdo são versionadas por hash e podem retornar o item para revisão.
- a interface do candidato usa estado de leitura, não estado editorial.

### 13.4 Sínteses

O feed pode fornecer apenas título e metadados. Nessa hipótese, o atualizador consulta o detalhe oficial e extrai a síntese existente na própria publicação.

No STJ, a prioridade é extrair os campos **Tema** e **Destaque**. Registros antigos com síntese vazia ou genérica são reparados progressivamente.

O sistema não gera síntese jurisprudencial por IA. Se a fonte oficial mudar ou bloquear o detalhe, o link permanece disponível, mas a síntese pode continuar pendente.

### 13.5 Estado de estudo e evoluções necessárias

Já funciona a marcação individual `NAO_LIDO`, `REVISAO` e `LIDO`. Concluir um bloco de jurisprudência no cronograma também marca a publicação como lida.

- classificação por disciplina e tópico;
- ligação com caderno de erros;
- suporte validado a outras fontes relevantes;
- tratamento de repetitivos, repercussão geral, súmulas e decisões de cortes internacionais;
- controle editorial de atualização, superação e alteração de entendimento.

## 14. Revisão espaçada

Tópicos iniciados entram automaticamente na fila de revisão.

Avaliações disponíveis:

- `REPETIR`;
- `DIFICIL`;
- `BOM`;
- `FACIL`.

Regras iniciais:

- repetir: retorno em 1 dia;
- difícil: 2 dias na primeira avaliação e crescimento reduzido nas seguintes;
- bom: 3 dias na primeira avaliação e progressão pelo fator de facilidade;
- fácil: 7 dias na primeira avaliação e progressão acelerada.

A avaliação ajusta intervalo, fator de facilidade, repetições, próxima revisão e domínio. Ela é um instrumento de espaçamento, não uma certificação de conhecimento jurídico.

## 15. Discursivas

O módulo permite:

- cadastro de temas próprios;
- seleção por grupo e disciplina;
- enunciado, fonte e referência oficial;
- rascunho persistente;
- cronômetro;
- contagem de palavras;
- registro de pontos fortes e pontos a melhorar;
- autoavaliação;
- conclusão e histórico de tentativas.

Existem quatro temas-piloto produzidos por IA, vinculados a referências oficiais e marcados como `PENDENTE_FONTE`. Eles não devem ser tratados como espelhos oficiais do CEBRASPE.

Evoluções desejáveis:

- espelho estruturado de correção;
- critérios por conteúdo, argumentação, estrutura e linguagem;
- correção comparativa sem ocultar a natureza estimativa da avaliação por IA;
- histórico de teses e repertórios utilizados;
- banco de temas extraídos de fontes oficiais e provas anteriores com controle de uso.

## 16. Desempenho e métricas

Métricas atuais:

- cobertura do programa;
- tópicos iniciados e consolidados;
- questões respondidas;
- acurácia;
- sessões concluídas;
- carga prevista e realizada do cronograma;
- conclusão por semana;
- distribuição real por grupo e tipo de conteúdo;
- revisões vencidas;
- jurisprudência pendente.

Premissas:

- atividades experimentais de IA não entram nas métricas oficiais;
- desempenho deve ser calculado por questão, tópico, disciplina, grupo e período;
- número bruto de questões não substitui cobertura temática;
- acerto repetido na mesma questão não equivale a domínio do tema;
- métricas devem orientar o cronograma, mas não tomar decisões irreversíveis pelo candidato.

## 17. Backup, restauração e nuvem

### 17.1 Backup local

O backup é um ZIP contendo:

- cópia consistente do SQLite;
- manifesto;
- versão da aplicação;
- versão do esquema;
- hash SHA-256 do banco.

O sistema verifica estrutura, hash, tamanho e compatibilidade do banco antes de aceitar a restauração.

### 17.2 Backup automático

- habilitado por padrão;
- criado quando não existe backup recente nas últimas 24 horas;
- agendador verifica periodicamente a necessidade;
- falha do backup não derruba a aplicação.

### 17.3 Restauração

Antes de substituir o banco, o sistema cria uma cópia de recuperação pré-restauração.

### 17.4 Nuvem

Não há integração direta com credenciais de OneDrive, Google Drive ou Dropbox. A estratégia é permitir que o candidato escolha como pasta de backup um diretório já sincronizado pelo sistema operacional.

Isso reduz complexidade e exposição de credenciais, mas não produz sincronização transacional entre máquinas. Abrir e editar a mesma base a partir de dois computadores não é suportado.

## 18. Segurança, privacidade e integridade

Premissas mínimas:

- nenhum dado de estudo deve sair da máquina sem ação ou configuração explícita;
- o servidor deve permanecer em loopback;
- a aplicação não deve solicitar credenciais de nuvem;
- caminhos de backup e arquivos restaurados devem ser validados;
- alterações relevantes devem gerar eventos de auditoria;
- catálogos versionados devem usar hashes para detectar mudanças;
- restauração não pode aceitar banco com esquema futuro incompatível;
- atualização do aplicativo não pode apagar o diretório pessoal.

Não há autenticação interna. Essa escolha só é aceitável enquanto a aplicação permanecer local e sem exposição em rede.

## 19. Estados editoriais e rastreabilidade

O produto deve separar claramente:

| Categoria | Significado |
|---|---|
| confirmado em fonte oficial | fato ou conteúdo localizado diretamente na fonte indicada |
| estimado | configuração provisória para permitir o planejamento pré-edital |
| importado | conteúdo recebido da fonte, ainda sem revisão editorial |
| em revisão | conteúdo em processo de conferência |
| pendente de fonte | conteúdo, geralmente de IA, ainda não validado integralmente |
| validado na fonte | conferência humana concluída na referência oficial |
| rejeitado | conteúdo que não deve ser usado |

O sistema não deve converter automaticamente `IMPORTADO`, `PENDENTE_FONTE` ou `PENDENTE_VALIDACAO` em validado.

## 20. Data da prova

A data `13/12/2026` é atualmente carregada apenas como **estimativa editável**.

Ela não foi confirmada pelo Termo de Dispensa e não deve ser apresentada como data oficial. Quando o edital for publicado, o sistema deve:

1. registrar a fonte oficial;
2. alterar a situação da data para confirmada;
3. permitir regenerar o cronograma;
4. preservar o histórico do ciclo anterior;
5. revisar todas as premissas dependentes do tempo restante.

## 21. Estado real dos módulos na versão 0.7.0

| Módulo | Estado | Observação crítica |
|---|---|---|
| Painel | funcional | agenda do dia prioriza pendências, blocos atuais e próxima data |
| Programa | funcional | base pré-edital sujeita ao futuro edital |
| Banco de questões | estrutura funcional | página do candidato exibe apenas itens liberados; banco regular ainda vazio |
| Práticas e simulados | motor funcional | antirrepetição implementada; sessões bloqueadas sem volume suficiente |
| Catálogo experimental IA | infraestrutura técnica | isolado da rotina e das métricas do candidato |
| Jurisprudência | funcional | síntese oficial, atualização e estado individual de leitura |
| Diagnóstico | funcional | turno ainda não gera horários específicos |
| Planejamento | funcional | calendário semanal e redistribuição por disponibilidade; atrasos ainda não recalculam todo o ciclo |
| Legislação no cronograma | funcional | rótulo de estudo separado do estado editorial técnico |
| Revisão espaçada | funcional | algoritmo inicial, ainda sem calibração empírica |
| Discursivas | funcional | sem correção jurídica automatizada confiável |
| Backup e restauração | funcional | nuvem depende de pasta sincronizada externamente |
| Executável Windows | configurado | ainda não compilado e homologado para distribuição |

## 22. Testes e qualidade

Na versão documentada:

- 31 testes automatizados aprovados;
- verificação de sintaxe de Python;
- verificação de sintaxe de JavaScript;
- testes de persistência e migração;
- testes de backup e restauração;
- testes de regras de questões, isolamento experimental e antirrepetição;
- testes de simulados;
- testes de legislação no cronograma;
- testes de revisão e discursivas;
- testes dos parsers de jurisprudência;
- teste de redistribuição automática de conteúdo indisponível;
- teste de leitura de jurisprudência e integração com o cronograma.

Lacunas de qualidade ainda existentes:

- ausência de suíte automatizada completa de navegador ponta a ponta;
- ausência de regressão visual automatizada;
- executável Windows não homologado;
- necessidade de testes com banco grande de questões;
- necessidade de testes de longa duração dos agendadores;
- necessidade de testar atualização do programa após o edital.

## 23. Riscos principais

### 23.1 Risco jurídico-editorial

Questões, gabaritos, artigos e sínteses incorretos podem induzir o candidato a erro. Nenhum conteúdo de IA deve ser promovido sem conferência.

### 23.2 Risco de banco pequeno e repetitivo

A política básica de antirrepetição está implementada, mas não substitui volume. Enquanto o banco regular for pequeno, a aplicação deve bloquear ou redistribuir a carga em vez de repetir excessivamente.

### 23.3 Risco de divergência do edital

Programa, formato de prova, número de questões, pesos e data podem mudar. A aplicação deve versionar, e não sobrescrever silenciosamente, o contexto pré-edital.

### 23.4 Risco de dependência das páginas oficiais

Feeds e HTML de tribunais podem mudar. O sistema deve falhar de forma controlada, preservar os itens existentes e registrar o erro.

### 23.5 Risco de perda local

Cada instalação é isolada. Sem backup externo, perda, formatação ou defeito da máquina pode eliminar o progresso.

### 23.6 Risco de falsa percepção de automação jurídica

Atualização automática e IA não equivalem a curadoria jurídica. O produto deve preservar a situação editorial e a fonte na camada técnica, mas não transferir a conferência cotidiana ao candidato. Na área de estudo, deve exibir apenas o rótulo necessário para uso seguro.

## 24. Prioridades de evolução

### P0 - necessárias antes de considerar o núcleo maduro

1. formar o primeiro banco regular juridicamente curado;
2. definir e documentar a política de uso dos enunciados oficiais;
3. evoluir a antirrepetição para cobertura temática, erros, confiança e tempo;
4. validar humanamente as 224 faixas legislativas iniciais na manutenção do pacote;
5. delimitar as três resoluções pendentes;
6. gerar e homologar o executável Windows;
7. criar procedimento de atualização imediata após a publicação do edital;
8. ampliar testes de navegador e atualização de versão.

### P1 - ganho pedagógico relevante

1. matriz de cobertura de questões por tópico;
2. caderno de erros integrado ao cronograma;
3. repetição dirigida por erro, confiança e tempo;
4. classificação automática assistida, mas revisável, dos informativos;
5. tratamento de temas repetitivos, repercussão geral e súmulas;
6. redistribuição de blocos pulados;
7. indisponibilidades excepcionais e feriados;
8. critérios estruturados de correção discursiva;
9. relatórios de evolução por período.

### P2 - expansão futura

1. importadores adicionais de fontes oficiais;
2. exportação de relatórios de estudo;
3. atualização de conteúdo em pacotes assinados;
4. suporte a formatos de questão definidos pelo novo edital;
5. instalador e atualização assistida do aplicativo.

## 25. Critérios para novas funcionalidades

Uma nova funcionalidade deve ser aceita apenas se:

- preservar o modelo de instância individual;
- não exigir servidor central sem decisão expressa;
- não apagar ou reescrever histórico silenciosamente;
- registrar fonte e situação editorial na camada técnica quando houver conteúdo jurídico;
- manter IA pendente separada do material liberado e da rotina do candidato;
- funcionar sem internet quando não depender de atualização externa;
- ser incluída no backup quando gerar dados pessoais;
- possuir tratamento de erro que não impeça a abertura da aplicação;
- ter teste compatível com o risco da mudança;
- não criar dependência desnecessária de serviço externo.

## 26. Decisões que não devem ser revertidas implicitamente

1. cada candidato possui sua própria instalação;
2. não haverá concorrência de usuários na mesma instância;
3. a aplicação continuará local-first;
4. backup em nuvem será inicialmente indireto, por pasta sincronizada;
5. questões de IA serão identificadas e isoladas até liberação editorial, sem incumbir o candidato de validá-las;
6. o candidato poderá sinalizar possível erro;
7. a legislação e os artigos aparecerão dentro do cartão do dia;
8. o cronograma usará navegação semanal inspirada no app TJCE;
9. o programa pré-edital será versionado quando houver novo edital;
10. material importado não será automaticamente considerado juridicamente validado;
11. o uso privado não será confundido com autorização irrestrita de reprodução;
12. o objetivo de distribuição é um executável Windows que dispense Python para o usuário final.
13. a experiência principal seguirá a premissa **estudo primeiro**: tarefas editoriais não integrarão a agenda do candidato.
14. blocos sem conteúdo suficiente serão redistribuídos e explicados, não simulados por atividades inexequíveis.

## 27. Fontes e arquivos de referência

### Fonte institucional de origem

- Diário Oficial do Estado do Rio Grande do Norte, Ano XCIII, nº 16.216, 15 de agosto de 2026;
- Termo de Dispensa de Licitação nº 03/2026 - DPE/RN;
- Processo Administrativo nº `000110000191.000001/2025-64`;
- código de autenticidade `GX4LR7LSV6-F8IF0Q3ET0-P2TH9ZW2VI`.

### Fontes internas versionadas

- `data/program.json`;
- `data/legislation_reading_map.json`;
- `data/question_catalog.json`;
- `server/schema.sql`;
- `README.md`;
- testes automatizados em `tests/`.

### Fonte programática pré-edital

- Resolução nº 344/2025 da DPE/RN, em redação consolidada, conforme URL e evidência registradas em cada tópico do `data/program.json`.

## 28. Regra de manutenção deste documento

Toda alteração relevante deve atualizar, no mínimo:

- data do estado documentado;
- versão da aplicação;
- estado dos módulos;
- riscos e pendências afetados;
- fontes oficiais novas ou substituídas;
- decisões de produto modificadas;
- números de tópicos, fontes, questões e testes.

Se houver divergência entre este documento e o código, o código descreve o comportamento executável, mas a divergência deve ser tratada como defeito documental ou funcional, e não ignorada.
