# Identidade visual

## Ideia

Um portal de operação para uma loja agro precisa parecer **do campo e de trabalho**, não um
painel genérico de SaaS. A identidade vem de dois objetos do dia a dia rural:

- **Brinco de gado** — a etiqueta amarela com furo que identifica cada animal. No portal, ela
  identifica a etapa de cada coisa: todo status é uma `tag` com furo (`ui.js → tag()`).
- **Porteira / trilha** — o caminho que o produto percorre do UniPlus até estar à venda, desenhado
  como uma trilha tracejada com estações (painel inicial e login). A marca é uma porteira.

O amarelo-brinco é usado **com parcimônia**: foco do teclado, item ativo da navegação, contagem
"Sua vez" e a etapa final. O resto é verde-pasto e cinza galvanizado.

## Tokens (`public/assets/styles.css`, `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--pasto-900` | `#123528` | barra lateral, títulos |
| `--pasto-700` | `#22573f` | botão principal, links |
| `--brinco` | `#f2bf1f` | destaque e anel de foco |
| `--galv` | `#eceeea` | fundo da página |
| `--papel` | `#ffffff` | painéis |
| `--terra` | `#18211c` | texto |
| `--muted` | `#56645a` | texto secundário (contraste ≥ 4,5:1 no fundo) |
| `tone-*` | neutral, info, warn, ok, done, danger, muted | cores de status (fg/bg/bd) |

## Tipografia

- **Archivo** (títulos, largura expandida 105–125%, peso 700–800) — lembra letreiro de saco de ração.
- **Public Sans** (texto) — neutra e muito legível em tabelas.
- **IBM Plex Mono** (SKU, preços, datas, rótulos de dado) — números tabulares.

## Componentes

`pageHead`, `panel`, `tag`/`statusTag`, `btn` (`primary`, `ghost`, `danger`, `small`), `field`,
`openDrawer` (ficha lateral, abre por rota `#/area/id`), `openModal` (formulários), `confirmDialog`
(com observação opcional/obrigatória), `toast`, `empty`, `notice`, `.board` (quadros), `.trail`.

## Calculadora de preço por canal (`views/pricing.js`)

Tabela com uma linha por canal: marcar o canal, preço de venda, taxa (vermelho), **líquido** (destaque)
e lucro/margem (verde; vermelho se prejuízo), e o mesmo para o preço promocional. Recalcula a cada
tecla usando `channelFees`/`marginOf` de `shared/domain.js` — o servidor usa as mesmas funções.

## Regras

- Alvos de toque ≥ 44 px; foco visível sempre (anel amarelo).
- Sem rolagem horizontal da página em 375 px; tabelas rolam dentro de `.table-wrap`.
- Quadros (fila, artes) empilham em telas ≤ 640 px.
- `prefers-reduced-motion` desliga animações.
- Ícones SVG de traço (nunca emoji). Ícone ao lado de texto é decorativo (`aria-hidden`).
- Erros dizem o que fazer ("Informe o preço do site"), sem pedir desculpas.
