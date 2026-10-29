# Instalação e publicação

Há dois jeitos de rodar. Comece pelo **A** (mais simples, tudo na máquina da loja) e passe para o
**B** quando quiser acesso de fora da loja sem depender da máquina ligada.

## A. Tudo na máquina da loja (modo local)

Requisitos: Windows com **Node.js 22 LTS ou mais novo**, UniPlus rodando na mesma máquina.

1. Copie o projeto (ou `git clone`) para, por exemplo, `C:\Portal Shopping Rural`.
2. Na pasta do projeto: `copy .env.example .env` e edite:
   - `UNIPLUS_API_URL=http://127.0.0.1:3001` (endereço da API local do UniPlus)
   - `HOST=0.0.0.0` se outras máquinas da rede da loja forem acessar
   - `SESSION_SECRET=` um valor aleatório (comando no próprio `.env.example`)
3. Dê dois cliques em `iniciar-portal.cmd` (ou rode `npm start`).
4. Abra `http://localhost:4173`, crie a conta do dono e cadastre a equipe.
5. Coloque as fotos e artes em `media/` (subpastas à vontade, ex.: `media/produtos/`).

Para iniciar junto com o Windows: Agendador de Tarefas → "Ao fazer logon" → executar
`iniciar-portal.cmd`. (Alternativa robusta: instalar como serviço com NSSM.)

Backup: copie a pasta `data/` (contém `portal-db.json` e o segredo de sessão) e `media/`.

## B. Portal na Vercel + Firestore + conector na loja

1. **Firebase** (projeto `portalspr-e0490`) — ver `FIREBASE_SETUP.md`:
   Firestore em modo produção, Authentication com E-mail/senha, app Web registrado,
   conta de serviço gerada (JSON — guardar fora do Git).
2. Publicar regras e índices: `npx firebase-tools deploy --only firestore --project portalspr-e0490`.
3. **Vercel**: importar o repositório. O `vercel.json` já define `public/` como site e `api/index.js`
   como função. Variáveis (Settings → Environment Variables):
   `DATA_BACKEND=firestore`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_AUTH_DOMAIN`,
   `FIREBASE_WEB_APP_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON em uma linha), `BOOTSTRAP_OWNER_EMAIL`,
   `CONNECTOR_TOKEN`, e as do site próprio (`STORE_*`, `PORTAL_PUBLIC_URL`).
4. Criar no Firebase Auth o usuário do dono com o mesmo e-mail de `BOOTSTRAP_OWNER_EMAIL` e entrar.
5. Na máquina da loja, `.env` com `UNIPLUS_API_URL`, `PORTAL_URL=https://…vercel.app` e o mesmo
   `CONNECTOR_TOKEN`; rodar `npm run connector` (deixar rodando como tarefa agendada).
6. Domínio: apontar o DNS na HostGator para a Vercel **manualmente** (CNAME `cname.vercel-dns.com`).
   O projeto não altera DNS.

### Limitação do modo B

Fotos em `media/` só existem na máquina da loja. O catálogo do site serve as fotos a partir do
portal (`/api/store/images/...`): com o portal na Vercel, a máquina da loja não serve as fotos.
Nesse caso, copie as fotos publicadas para um armazenamento público (ver ROADMAP, item 1).

## Checklist antes de colocar no ar

- [ ] `npm run check` e `npm test` passando
- [ ] `.env`/variáveis sem valores de exemplo; `SESSION_SECRET` definido
- [ ] Publicar um produto de teste no site e fazer uma compra de teste (pedido chega como Pago)
- [ ] Conferir que `data/`, `media/`, `.env` e JSON de serviço não estão no Git (`git status`)
