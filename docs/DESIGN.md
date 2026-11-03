# Identidade visual

## Ideia

Um portal de operação para uma loja agro precisa parecer **do campo e de trabalho**, não um
painel genérico de SaaS. A identidade vem de dois objetos do dia a dia rural:

- **Brinco de gado** — a etiqueta amarela com furo que identifica cada animal. No portal, ela
  identifica a etapa de cada coisa: todo status é uma `tag` com furo (`ui.js → tag()`).
- **Porteira / trilha** — o caminho que o produto percorre do UniPlus até estar à venda, desenhado
  como uma trilha tracejada com estações (painel inicial e login). A marca é uma porteira.

O amarelo-brinco é usado **com parcimônia**: foco do teclado, item ativo da navegação, contagem
e borda de "Para resolver agora", o selo "Precisa de você" e a etapa final. O resto é verde-pasto e
cinza galvanizado.

## Simples de usar (nov/2026)

Quem usa são pessoas mais velhas, pouco acostumadas com tecnologia. Toda tela nova segue:

- **Uma pergunta por tela respondida no topo**: o título diz onde a pessoa está; a frase abaixo
  (`lead`) diz o que ela faz ali, em uma ou duas frases curtas.
- **Palavras do dia a dia** (lista em `AGENTS.md` → "Quem usa"). Sem siglas na tela.
- **Botões com verbo e texto** — nunca só ícone para ação importante. O primeiro passo é o botão
  principal (verde); o resto é secundário.
- **Início = tarefas**: "Para resolver agora" com frase + botão; números em frase
  ("1 promoção valendo hoje"); o técnico fica recolhido em "Ver mais detalhes".
- **Etapas empilhadas** (`.board` vira lista vertical); a etapa que espera pela pessoa vem primeiro
  (`.is-yours`, selo "Precisa de você"); etapas vazias ocupam uma linha só. Em Anúncios, um passo a
  passo numerado (`.how`) explica o caminho — numerado porque é uma sequência de verdade.
- **Ajustes** (`views/settings-hub.js`) reúne o que se mexe pouco, em cartões grandes (`.hub`).
- **Letra maior**: botão no menu e em Ajustes; liga `html.big-text` (zoom 1,15) e fica guardado no
  aparelho (`localStorage`, chave `sr-letra-grande`).

## Tokens (`public/assets/styles.css`, `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--pasto-900` | `#123528` | barra lateral, títulos |
| `--pasto-700` | `#22573f` | botão principal, links |
| `--brinco` | `#f2bf1f` | destaque e anel de foco |
| `--galv` | `#eceeea` | fundo da página |
| `--papel` | `#ffffff` | painéis |
| `--terra` | `#18211c` | texto |
| `--muted` | `#47544b` | texto secundário (contraste ≥ 4,5:1 no fundo) |
| `tone-*` | neutral, info, warn, ok, done, danger, muted | cores de status (fg/bg/bd) |

## Tipografia

- **Archivo** (títulos, largura expandida 105–125%, peso 700–800) — lembra letreiro de saco de ração.
- **Public Sans** (texto) — neutra e muito legível em tabelas.
- **IBM Plex Mono** (códigos, preços, datas) — números tabulares. Não usar em rótulos.
- Tamanhos: texto 17 px, secundário 15–16 px, mínimo 13 px. Sem caixa alta em rótulos.

## Componentes

`pageHead`, `panel`, `tag`/`statusTag`, `btn` (`primary`, `ghost`, `danger`, `small`), `field`,
`openDrawer` (ficha lateral, abre por rota `#/area/id`), `openModal` (formulários), `confirmDialog`
(com observação opcional/obrigatória), `toast`, `empty`, `notice`, `.board` (quadros), `.trail`.

## Calculadora de preço por canal (`views/pricing.js`)

Tabela com uma linha por canal: marcar o canal, preço de venda, taxa (vermelho), **líquido** (destaque)
e lucro/margem (verde; vermelho se prejuízo), e o mesmo para o preço promocional. Recalcula a cada
tecla usando `channelFees`/`marginOf` de `shared/domain.js` — o servidor usa as mesmas funções.

## Regras

- Alvos de toque ≥ 48 px (botões), 44 px no mínimo; foco visível sempre (anel amarelo).
- Sem rolagem horizontal da página em 375 px; tabelas rolam dentro de `.table-wrap`.
- Quadros (Anúncios, Artes) empilham em qualquer largura.
- `prefers-reduced-motion` desliga animações.
- Ícones SVG de traço (nunca emoji). Ícone ao lado de texto é decorativo (`aria-hidden`).
- Erros dizem o que fazer ("Informe o preço do site"), sem pedir desculpas.
