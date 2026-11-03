# Configuração Firebase — Portal Shopping Rural

Projeto: `portalspr-e0490`. Necessário apenas para `DATA_BACKEND=firestore` (portal na Vercel).
No modo local (`DATA_BACKEND=local`) nada disto é preciso.

## Serviços

1. **Cloud Firestore** em modo de produção, na região mais próxima da loja (ex.: `southamerica-east1`).
   A região não pode ser alterada depois.
2. **Authentication** → provedor **E-mail/senha** (somente este, por enquanto).
3. **Não** ative o Firebase Storage. Fotos e artes ficam em `media/` na máquina da loja.
4. Registre um app **Web** chamado "Portal Administrativo Shopping Rural" e copie a configuração
   pública para as variáveis `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID`.
   Essa configuração não é segredo — vai para o navegador.
5. Em Configurações do projeto → Contas de serviço, gere uma chave privada (JSON).
   Ela vai **somente** em `FIREBASE_SERVICE_ACCOUNT_JSON` (Vercel) ou num arquivo fora do Git
   apontado por `GOOGLE_APPLICATION_CREDENTIALS` (máquina da loja). Nunca no navegador nem no GitHub.

## Regras e índices

Arquivos: `firebase/firestore.rules` e `firebase/firestore.indexes.json` (referenciados em `firebase.json`).

```bash
npx firebase-tools deploy --only firestore --project portalspr-e0490
```

As regras bloqueiam toda escrita vinda do navegador: o portal grava pelo Admin SDK no servidor,
onde ficam as regras de papel, aprovação e histórico.

## Primeiro dono

1. Defina `BOOTSTRAP_OWNER_EMAIL` na Vercel.
2. No console do Firebase → Authentication, crie o usuário com esse e-mail e uma senha.
3. Entre no portal: a conta vira **dono** automaticamente (só enquanto não existir outro dono).
4. Cadastre a equipe em **Equipe e acessos** — o portal cria as contas no Firebase Auth.

## Coleções

Ver `docs/DADOS.md`.
