# Revisão da tradução pt-BR — DAS · Core v0.289.0

Data da revisão: 20 de novembro de 2026.

## Escopo e resultado

- Catálogo oficial comparado: `module/lang/en.json` contra `module/lang/pt-BR.json` no commit `fb1d58f` (`v0.289.0`).
- Entradas examinadas: 2.756 em inglês e 2.756 em português brasileiro.
- Cobertura: 100%; nenhuma chave ausente ou excedente.
- Novas entradas desde a v0.285.0: 145. A contagem de 102 da solicitação correspondia a uma fotografia anterior do desenvolvimento.
- Entradas corrigidas nesta revisão: 35.
- Código funcional, identificadores, estrutura JSON, HTML, sintaxe do Foundry e placeholders foram preservados.

A revisão combinou uma varredura automática de todo o catálogo com leitura contextual das 145 entradas novas, das duas entradas cujo texto inglês mudou e das famílias terminológicas de regras. Traduções corretas foram mantidas.

## Principais correções

| Tema | Antes | Depois | Motivo |
| --- | --- | --- | --- |
| `Feature` | habilidade | característica | Distingue característica de atributo, perícia e ação. |
| `Saving Throw` | teste de resistência | salvaguarda | Uniformiza três exceções com o restante do módulo e com a terminologia de referência. |
| `Attack Roll` | ataque | jogada de ataque | Evita confundir a jogada com o ataque como ação ou evento. |
| `Damage Roll` | rolagem de dano | jogada de dano | Uniformiza quatro textos de interface e automação. |
| `Dim Light` | Penumbra | Luz Fraca | Adota o termo já estabelecido para o projeto. |
| `Lightly Obscured` | levemente obscurecida | pouco obscurecida | Mantém coerência com os demais textos do catálogo. |
| `Blindsight` | Percepção às Cegas | Visão às Cegas | Corrige dois textos de notas de versão. |
| `Devil's Sight` | Visão do Diabo | Visão Diabólica | Uniformiza três textos com o termo já usado no catálogo. |
| `Warding Bond` | Elo Protetor | Vínculo Protetor | Uniformiza duas notas com a tradução já existente no módulo. |

Também foram corrigidos trechos com perda clara de sentido ou construção artificial, entre eles a avaliação de fórmula por criatura, paredes que permitem enxergar através delas, movimento aleatório, cura mágica, área de efeito, arrasto sob Amedrontado e requisitos de alvo.

## Glossário adotado

| Inglês | Português brasileiro |
| --- | --- |
| Ability | atributo |
| Ability Check | teste de atributo |
| Skill | perícia |
| Skill Check | teste de perícia |
| Feature | característica |
| Saving Throw | salvaguarda / teste de salvaguarda |
| Attack Roll | jogada de ataque |
| Damage Roll | jogada de dano |
| Spell Slot | espaço de magia |
| Action | Ação |
| Bonus Action | Ação Bônus |
| Reaction | Reação |
| Long Rest | Descanso Longo |
| Short Rest | Descanso Curto |
| Bright Light | Luz Plena |
| Dim Light | Luz Fraca |
| Blindsight | Visão às Cegas |
| Devil's Sight | Visão Diabólica |

## Fontes consultadas

1. Wizards of the Coast, [*Glossário de D&D em português brasileiro*](https://media.wizards.com/2022/dnd/downloads/DnD_glossary_printable_PT-BR.pdf) (PDF oficial, 2022): fonte primária para termos como teste de atributo, teste de salvaguarda, espaço de magia, ação, vantagem e desvantagem.
2. [`decito/dnd5e-pt-br/dictionary.md`](https://github.com/decito/dnd5e-pt-br/blob/main/dictionary.md): referência comunitária para cruzamento de termos de regras. As marcações de procedência do arquivo não foram tratadas, por si sós, como publicação oficial.
3. [Glossário do Artifício RPG](https://glossario.artificiorpg.com/dev) e materiais públicos do projeto: referência comunitária complementar. A interface pública consultada informa o acervo, mas não expôs a base completa de termos para verificação direta; por isso, nenhuma decisão dependeu exclusivamente dela.

Em caso de divergência, prevaleceram a fonte oficial aplicável, o contexto do texto, a terminologia já consolidada no DAS e a preservação de traduções corretas.

## Termos mantidos por ambiguidade

- `Tremorsense`: mantido como **Sentido Sísmico**. Materiais comunitários recentes também usam **Sismiconsciência**, mas não foi encontrada confirmação oficial suficiente na fonte primária consultada para justificar uma substituição global.
- `Turn`: mantido como **turno** na interface. **Vez** aparece em prosa de regras, mas uma troca global seria contextual e não uma correção inequívoca.
- `Saving Throw`: o glossário oficial apresenta **Teste de Salvaguarda**; o módulo mantém a forma curta **salvaguarda** onde a construção da frase já deixa claro que se trata de um teste.

## Validações

- JSON válido.
- 2.756 chaves em cada idioma; 0 ausentes e 0 excedentes.
- Placeholders idênticos ao inglês, inclusive quantidade de ocorrências.
- Estrutura de chaves e registro `pt-BR` no manifesto válidos.
- `git diff --check`: sem erros.
- `npm test`: 251 arquivos aprovados; 2.527 testes aprovados; 1 teste ignorado pelo próprio projeto.

