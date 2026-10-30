# Implantação — portal na nuvem + conector na loja

```
Máquina da loja                              Nuvem (Vercel)                         Clientes
┌────────────────────────┐   a cada 30 s     ┌──────────────────────────────┐       ┌──────────────────┐
│ UniPlus (API local)    │ ──────────────▶  │ portal.shoppingrural.com     │ ◀───▶ │ shoppingrural.com │
│ conector (tarefa do    │  só o que mudou  │ (portal + API + catálogo)     │       │ (site próprio)    │
│ Windows, sem janela)   │                  │ Firestore · Firebase Auth     │       └──────────────────┘
└────────────────────────┘                  │ Vercel Blob (fotos e artes)   │
                                            └──────────────────────────────┘
```

- Se o computador da loja desligar, **o site continua vendendo**; só o estoque fica parado no último
  valor até o conector voltar.
- A equipe usa o portal de qualquer lugar em `https://portal.shoppingrural.com`.
- Fotos e artes são **enviadas pelo portal** e ficam no Vercel Blob (URL pública para o site).

---

## 1. Firebase (dados e login) — projeto `portalspr-e0490`

Siga `FIREBASE_SETUP.md`: Firestore (região `southamerica-east1`), Authentication só com E-mail/senha,
app Web registrado (copiar a configuração pública) e conta de serviço (JSON, guardar fora do Git).

Publicar regras e índices (na sua máquina, uma vez):
```bash
npx firebase-tools deploy --only firestore --project portalspr-e0490
```

## 2. Vercel — projeto do portal

1. **Add New → Project** → importar `portal-administrativo-shopping-rural`. Framework: *Other*.
   O `vercel.json` já define `public/` como site e `api/index.js` como API.
2. **Storage → Create → Blob** → conectar ao projeto. A Vercel cria `BLOB_READ_WRITE_TOKEN` sozinha.
3. **Settings → Environment Variables** (Production):

| Variável | Valor |
|---|---|
| `DATA_BACKEND` | `firestore` |
| `FIREBASE_PROJECT_ID` | `portalspr-e0490` |
| `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID` | da configuração pública do app Web |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON da conta de serviço **em uma linha** |
| `BOOTSTRAP_OWNER_EMAIL` | e-mail do dono (vira dono no primeiro login) |
| `CONNECTOR_TOKEN` | segredo longo (o mesmo vai no `.env` da loja) |
| `STORE_API_TOKEN` | segredo longo (o mesmo vai no servidor do site) |
| `STORE_PUBLIC_URL` | `https://shoppingrural.com` |
| `STORE_ALLOWED_ORIGINS` | `https://shoppingrural.com,https://www.shoppingrural.com` |
| `PORTAL_PUBLIC_URL` | `https://portal.shoppingrural.com` |
| `LEADS_WEBHOOK_TOKEN` | segredo longo (opcional, ferramentas de leads) |
| GA4 / Google Ads / Meta | ver `docs/INTEGRACOES.md` (opcional, pode ser depois) |

Gerar segredo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

4. **Deploy**. Conferir `https://<projeto>.vercel.app/api/health` → `{"ok":true,"backend":"firestore"}`.

> **Plano da Vercel:** o plano gratuito (Hobby) é só para uso não comercial. Para a loja, use o **Pro**
> (o site em `shoppingrural.com` também se enquadra).

## 3. Domínios (DNS na HostGator — feito à mão)

1. Na Vercel, projeto do portal → **Settings → Domains** → adicionar `portal.shoppingrural.com`.
   No projeto do site → adicionar `shoppingrural.com` e `www.shoppingrural.com`.
2. A Vercel mostra os registros exatos. Normalmente:
   - `portal` → **CNAME** → `cname.vercel-dns.com`
   - `www` → **CNAME** → `cname.vercel-dns.com`
   - `@` (raiz) → **A** → `76.76.21.21`
3. Criar os registros no **cPanel → Zone Editor** da HostGator. Propagação: minutos a algumas horas.
   O portal não mexe em DNS.

## 4. Primeiro acesso

1. Firebase → Authentication → criar o usuário com o e-mail de `BOOTSTRAP_OWNER_EMAIL`.
2. Entrar em `https://portal.shoppingrural.com` → vira **dono**.
3. Cadastrar a equipe em **Equipe e acessos** (o portal cria as contas no Firebase).
4. Conferir **Canais e taxas** (inclua a taxa do gateway no "Site próprio").

## 5. Máquina da loja (UniPlus) — conector

1. Instalar **Node.js LTS** (nodejs.org).
2. Baixar o projeto: `git clone https://github.com/ueddergomes100-prog/portal-administrativo-shopping-rural.git`
3. Na pasta do projeto, criar o `.env` só com:
   ```
   UNIPLUS_API_URL=http://127.0.0.1:3001
   PORTAL_URL=https://portal.shoppingrural.com
   CONNECTOR_TOKEN=<mesmo valor da Vercel>
   UNIPLUS_SYNC_SECONDS=30
   ```
4. Testar: dois cliques em `iniciar-conector.cmd`. Deve aparecer "conferência completa: N produtos enviados".
   No portal, **Integrações → UniPlus** fica "Conectado" e os produtos aparecem.
5. Deixar ligado sempre: PowerShell **como Administrador**, na pasta do projeto:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\instalar-conector.ps1
   ```
   Liga com o Windows, sem janela, reinicia se cair. Log em `data\conector.log`.
   Remover: o mesmo comando com `-Remover`.

Recomendado: nobreak e configurar o Windows para não dormir. Se a máquina desligar, o site segue com o
último estoque; ao voltar, o conector manda tudo o que mudou.

## 6. Site (`shoppingrural.com`)

Ver `docs/SITE.md`. Resumo: o site lê `https://portal.shoppingrural.com/api/catalog`; o servidor do
site (a construir) envia pedidos e avisos com `STORE_API_TOKEN`.

## Custos e limites (referência — conferir preços atuais)

- **Firestore (plano gratuito):** 50 mil leituras e 20 mil escritas por dia. O portal foi feito para
  caber: o catálogo do site é um documento único com cache de 30 s na CDN, e o conector só grava
  produtos que mudaram (mais uma conferência completa a cada 6 h). Loja com milhares de produtos e
  muita venda no balcão pode passar das escritas — aí ativar o plano Blaze (paga só o excedente).
- **Vercel Blob:** cobra por armazenamento e transferência; fotos de produto são reduzidas para
  WebP de até 1600 px (~100–300 KB cada).
- **Vercel Pro:** por membro da equipe na Vercel (não por usuário do portal).

## Checklist antes de divulgar

- [ ] `npm run check` e `npm test` passando
- [ ] `/api/health` responde `firestore`; login do dono funciona
- [ ] Integrações → UniPlus "Conectado", produtos com estoque certo
- [ ] Produto de teste: colocar à venda → preparar com fotos → aprovar → **Publicar no site** →
      aparece em `https://portal.shoppingrural.com/api/catalog`
- [ ] Mudar o estoque no UniPlus → em até ~30–60 s muda no catálogo
- [ ] Compra de teste no site chega em **Pedidos** e a etapa movida no portal aparece no site
- [ ] `git status` sem `.env`, `data/`, `media/` ou JSON de conta de serviço

---

## Demonstração (para apresentar, sem Firebase)

Projeto da Vercel com `DATA_BACKEND=demo` e `SESSION_SECRET` (segredo longo). Abre com botões
"Entrar como Dono / Gerente / Marketing / Site", faixa "Demonstração" e dados fictícios
(`server/demo.js`) recriados sozinhos — o que alguém cadastrar pode sumir quando a Vercel trocar de
instância. Para valer, trocar para `DATA_BACKEND=firestore` com as variáveis da seção 2.

## Alternativa: tudo na máquina da loja (sem nuvem)

`DATA_BACKEND=local`, `iniciar-portal.cmd` e o portal exposto com Cloudflare Tunnel em
`portal.shoppingrural.com`. Mais simples, mas o site fica fora do ar quando o computador da loja
desliga. Fotos ficam em `media/uploads/` e são servidas por `/api/store/images/...`.
