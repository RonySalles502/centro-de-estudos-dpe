# Auditoria do banco de questões objetivas

## Escopo e critérios

A auditoria cobre as 260 questões autorais de `pwa/src/questoes_g1.json` a `questoes_g4.json`. Foram verificados: estrutura mínima, cinco alternativas não vazias e distintas, gabarito A–E, vínculos com grupo/disciplina/tópico, URL de fonte, IDs e enunciados duplicados, distribuição do gabarito e a pista de comprimento.

A alternativa mais longa é medida pelo número de caracteres visíveis após normalização de espaços. Em empates, a métrica `entre as mais longas` considera todas as alternativas de comprimento máximo; a métrica `única mais longa` exclui empates.

O rebalanceamento é determinístico por ID e grupo. Ele somente reposiciona as cinco alternativas e atualiza a letra do gabarito. Enunciado, explicação, fonte, vínculo temático, conjunto de alternativas e texto da resposta correta permanecem idênticos.

## Resultado executivo

- Questões auditadas: **260**.
- Acerto ao escolher sempre a letra mais frequente: **85.38% antes** e **20.00% depois**.
- Gabarito entre as alternativas mais longas: **95.00% antes** e **95.00% depois**.
- Gabarito como única alternativa mais longa: **94.23% do banco**.
- Problemas estruturais: **0 erro(s)** e **1 aviso(s)** após o rebalanceamento.
- Duplicidades: **0 ID(s)**, **1 conjunto(s) de enunciados** e **0 conjunto(s) de conteúdo integral**.

A pista de comprimento não muda com a reordenação: reduzir esse indicador requer reescrever ou ampliar distratores após revisão jurídica. Alterá-los automaticamente seria incompatível com a exigência de preservar o conteúdo e a correção semântica.

## Distribuição geral do gabarito

| Momento | A | B | C | D | E |
|---|---:|---:|---:|---:|---:|
| Antes | 28 | 222 | 9 | 0 | 1 |
| Depois | 52 | 52 | 52 | 52 | 52 |

## Distribuição antes e depois, por grupo

| Grupo | Total | A | B | C | D | E |
|---|---:|---:|---:|---:|---:|---:|
| I | 80 | 11 → 16 | 59 → 16 | 9 → 16 | 0 → 16 | 1 → 16 |
| II | 60 | 13 → 12 | 47 → 12 | 0 → 12 | 0 → 12 | 0 → 12 |
| III | 60 | 3 → 12 | 57 → 12 | 0 → 12 | 0 → 12 | 0 → 12 |
| IV | 60 | 1 → 12 | 59 → 12 | 0 → 12 | 0 → 12 | 0 → 12 |

## Distribuição antes e depois, por disciplina

| Disciplina | Total | A | B | C | D | E |
|---|---:|---:|---:|---:|---:|---:|
| ADM | 22 | 4 → 5 | 17 → 4 | 1 → 4 | 0 → 4 | 0 → 5 |
| CDC | 12 | 0 → 2 | 12 → 2 | 0 → 3 | 0 → 3 | 0 → 2 |
| CIV | 26 | 0 → 5 | 26 → 5 | 0 → 5 | 0 → 5 | 0 → 6 |
| CON | 40 | 4 → 8 | 27 → 8 | 8 → 8 | 0 → 8 | 1 → 8 |
| DCA | 20 | 1 → 4 | 19 → 4 | 0 → 4 | 0 → 4 | 0 → 4 |
| DCO | 22 | 0 → 4 | 22 → 4 | 0 → 4 | 0 → 5 | 0 → 5 |
| DEP | 14 | 2 → 3 | 12 → 3 | 0 → 3 | 0 → 2 | 0 → 3 |
| DHU | 18 | 0 → 4 | 18 → 4 | 0 → 4 | 0 → 3 | 0 → 3 |
| DPC | 22 | 3 → 5 | 19 → 5 | 0 → 4 | 0 → 4 | 0 → 4 |
| DPP | 26 | 2 → 5 | 24 → 5 | 0 → 5 | 0 → 6 | 0 → 5 |
| PEN | 20 | 9 → 4 | 11 → 4 | 0 → 4 | 0 → 4 | 0 → 4 |
| PID | 18 | 3 → 3 | 15 → 4 | 0 → 4 | 0 → 4 | 0 → 3 |

## Qualidade estrutural

- Comprimento médio da alternativa correta: 189.52 caracteres.
- Comprimento médio dos distratores: 67.47 caracteres.
- Questões com uma única alternativa mais longa: 258.
- Acerto pela única mais longa, quando aplicável: 94.96%.
- Enunciados idênticos candidatos a revisão: A-CON-019 / A-DCO-014.
- O par de enunciados repetidos identificado pertence a tópicos e conteúdos distintos; foi sinalizado para revisão editorial, mas não alterado porque o escopo exige preservar o enunciado.

## Critérios de aceite contínuo

- Cada grupo deve ter diferença zero entre as contagens de A–E quando seu total for múltiplo de cinco.
- Em cada disciplina, a diferença entre a letra mais e menos frequente deve ser no máximo uma questão.
- Nenhum erro estrutural, ID duplicado ou conteúdo integral duplicado; enunciados repetidos devem ser explicitamente revisados ou justificados.
- O algoritmo deve ser idempotente e preservar o texto correto e o multiconjunto de alternativas.
- A pista de comprimento deve ser tratada em uma etapa editorial com validação jurídica; a auditoria deve continuar medindo-a.
