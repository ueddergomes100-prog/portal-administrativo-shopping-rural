# Prompt para o Codex na máquina da loja

Copie o bloco abaixo inteiro e cole no Codex, aberto na máquina da loja (a que tem o UniPlus).

```text
Você vai continuar o projeto "Portal Shopping Rural" NESTA máquina da loja (Windows), onde roda o UniPlus.
Responda e escreva tudo em português do Brasil.

## Contexto

- Repositório: https://github.com/ueddergomes100-prog/portal-administrativo-shopping-rural
- Antes de qualquer coisa, LEIA na raiz do repositório: AGENTS.md (regras, mapa do código e a seção
  "Quem usa"), docs/DEPLOY.md (implantação), docs/SITE.md (contrato com o site),
  docs/INTEGRACOES.md, docs/ROADMAP.md, docs/DESIGN.md e .env.example.
- Arquitetura decidida pelo dono:
  - O portal roda na NUVEM (Vercel + Firestore + Vercel Blob). Endereço final:
    https://portal.shoppingrural.com (o domínio ainda NÃO foi configurado).
  - Hoje o projeto da Vercel "portal-shopping-rural" já existe, mas está em MODO DEMONSTRAÇÃO
    (DATA_BACKEND=demo, dados fictícios) em https://portal-shopping-rural.vercel.app, usado para
    apresentar ao dono. Para valer, ele precisa passar para DATA_BACKEND=firestore.
  - NESTA máquina roda só o CONECTOR (connector/uniplus-sync.js). Ele lê a API local do UniPlus
    e envia ao portal só os produtos que mudaram, a cada 30 s.
  - O site próprio fica em https://shoppingrural.com. É outro projeto ("Site Shopping Rural"):
    NÃO altere esse projeto.
  - A loja não usa mais a Nuvemshop.
  - Shopee e Mercado Livre são anunciados à mão. NÃO crie automação de anúncios.
- Quem usa o portal são pessoas mais velhas, pouco acostumadas com tecnologia. A interface foi
  simplificada (palavras do dia a dia, letra grande, menu curto por função, Início com "Para resolver
  agora", botão "Letra maior"). Se mexer em qualquer tela ou mensagem, siga AGENTS.md → "Quem usa"
  e docs/DESIGN.md → "Simples de usar". Não volte a usar jargão (SKU, SEO, lead, fila, integração).

## Regras

- Nunca versione nem mostre na tela: .env, tokens, senhas, JSON de conta de serviço, data/, media/.
- Não escreva nada no banco do UniPlus sem autorização explícita minha. Nesta etapa, só leitura.
- Não altere DNS, não mude variáveis nem faça deploy na Vercel e não crie contas pagas sem me
  perguntar antes.
- Commits pequenos e em português, terminando com a linha de coautoria que você costuma usar.
  Só faça push quando eu pedir.
- Antes de cada commit, rode `npm run check` e `npm test`. Os dois precisam passar.
- Se algo exigir login meu (Vercel, Firebase, GitHub), pare, explique o comando e espere eu fazer.

## Tarefas, nesta ordem (pare e me mostre o resultado ao fim de cada etapa)

### 1. Ambiente
- Confirme o Node.js 22 LTS ou mais novo (`node -v`). Se não houver, me diga como instalar e pare.
- Clone o repositório numa pasta fixa (sugestão: C:\ShoppingRural\portal).
  Se já existir, faça `git pull`.
- Rode `npm install`, `npm run check` e `npm test` e me mostre o resultado.
- Para ver o portal funcionando sem UniPlus, pode rodar `DATA_BACKEND=demo` localmente
  (no PowerShell: `$env:DATA_BACKEND='demo'; npm start`, depois abrir http://127.0.0.1:4173).

### 2. API local do UniPlus (só leitura)
- O portal espera `GET {UNIPLUS_API_URL}/api/erp/products` (padrão http://127.0.0.1:3001)
  devolvendo `{ data: [{ id_produto, sku, nome_produto, nome_categoria, preco, estoque, preco_custo? }] }`.
- Descubra se essa API está no ar nesta máquina: que programa/serviço a fornece, em que porta,
  e se liga sozinha com o Windows.
- Chame o endpoint e me mostre: quantos produtos vieram, os NOMES dos campos e 2 exemplos
  com valores (sem dados de clientes).
- Se os nomes dos campos forem diferentes, ajuste SÓ `mapProduct()` em
  server/integrations/uniplus.js e acrescente um teste.
- Verifique se vem custo (preco_custo, custo ou custo_medio). Se não vier, me diga onde o custo
  está no UniPlus. O lucro mostrado no portal depende dele.
- Se a API não existir ou estiver fora do ar, investigue como o UniPlus guarda os dados
  (banco, porta, tabelas de produto e estoque) SEM alterar nada, me apresente opções e espere.

### 3. Portal de verdade na nuvem + conector
- O conector só funciona com o portal em DATA_BACKEND=firestore (a demonstração guarda dados
  temporários). Me pergunte se já posso trocar o projeto "portal-shopping-rural" da Vercel para o
  modo real (a demonstração deixa de existir nesse link) ou se prefiro criar outro projeto.
- Depois da minha resposta, me guie pelo docs/DEPLOY.md, seções 1 a 4: Firebase, variáveis da
  Vercel (incluindo CONNECTOR_TOKEN), Blob, domínio e primeiro acesso. Eu faço os passos no
  navegador; você me diz exatamente o que preencher.
- Crie o .env NESTA máquina só com:
  UNIPLUS_API_URL, PORTAL_URL (https://portal.shoppingrural.com quando o domínio estiver pronto;
  até lá, o endereço .vercel.app do projeto), CONNECTOR_TOKEN (o mesmo valor configurado na
  Vercel; eu colo) e UNIPLUS_SYNC_SECONDS=30.
- Teste com `iniciar-conector.cmd` ou `npm run connector -- --once`. A primeira rodada deve dizer
  "conferência completa: N de N produto(s) enviado(s)", e no portal, em Ajustes → Conexões, o
  "Sistema da loja (UniPlus)" deve ficar "Funcionando".
- Mude o estoque de 1 produto de teste no UniPlus (eu faço) e confirme que em até ~1 minuto
  o valor muda no portal (tela Produtos).

### 4. Conector ligado sempre
- Com o PowerShell como Administrador, rode
  `powershell -ExecutionPolicy Bypass -File scripts\instalar-conector.ps1`.
- Confira: a tarefa "Shopping Rural - Conector UniPlus" existe, está rodando e grava em
  data\conector.log.
- Reinicie o computador (com minha autorização) e confirme que o conector voltou sozinho.
- Me oriente a deixar o Windows sem suspensão e a usar nobreak.

### 5. Baixa de estoque (só investigação, sem escrever nada)
- Hoje o portal só LÊ o estoque. Quando houver venda no site, o estoque precisa baixar no UniPlus.
- Descubra se a API local do UniPlus tem rota para registrar venda, pedido ou movimento de estoque,
  ou outro caminho oficial (importação, módulo de e-commerce do UniPlus).
- Escreva as opções em docs/UNIPLUS.md (o que existe, riscos e o que precisaria do suporte
  do UniPlus), faça commit e me mostre. NÃO implemente a baixa sem eu aprovar.

### 6. Relatório final
- Me entregue um resumo: o que está funcionando, o que testou, o que ficou pendente
  e o que depende de mim.
- Liste exatamente os valores que eu ainda preciso configurar (nomes das variáveis, nunca
  os valores secretos).
```

## Antes de usar

- **Portal de verdade:** as etapas 3 e 4 precisam do Firebase e da troca do projeto da Vercel para o
  modo real. O Codex vai perguntar antes de trocar, porque o link da demonstração deixa de mostrar
  os dados de exemplo. Os logins na Vercel e no Firebase são seus.
- **Site:** o servidor do site (pagamento e frete) fica de fora deste prompt de propósito, porque é
  outro projeto. Para essa parte, use um prompt separado na sessão do site.
