# Portal Shopping Rural

Centro operacional da loja: catálogo e estoque do **UniPlus**, fila de publicação de produtos na
**Nuvemshop**, campanhas, promoções, pedidos de arte, leads e indicadores de mídia — com login,
papéis (dono, gerente, marketing, site) e histórico de tudo que acontece.

## Começar

```bash
npm install
copy .env.example .env      # Windows (no Linux/macOS: cp)
npm start                   # http://localhost:4173
```

No primeiro acesso, crie a conta do dono. Sem o UniPlus por perto, use o simulador de
desenvolvimento: `node scripts/mock-uniplus.js` e `UNIPLUS_API_URL=http://127.0.0.1:3999`.

Na máquina da loja, `iniciar-portal.cmd` instala o que falta e liga o portal.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [AGENTS.md](AGENTS.md) | Regras do projeto e mapa do código (leia primeiro) |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Instalação na loja e publicação na Vercel |
| [docs/API.md](docs/API.md) | Todas as rotas da API |
| [docs/DADOS.md](docs/DADOS.md) | Coleções e estados |
| [docs/DESIGN.md](docs/DESIGN.md) | Identidade visual e componentes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | O que falta, em ordem |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Configuração do Firebase |
| [.env.example](.env.example) | Todas as variáveis de ambiente |

## Verificar

```bash
npm run check   # sintaxe + carga do servidor
npm test        # regras de domínio + fluxo completo da API
```
