# Prompt para Claude — Portal Administrativo Shopping Rural

Você está trabalhando em um portal administrativo já iniciado em `C:\Users\USER\Desktop\Portal Administrativo Shopping Rural`. Preserve o que já existe, melhore a arquitetura sem apagar funcionalidades prontas e faça alterações pequenas, testáveis e documentadas.

## Objetivo do produto

Criar o centro operacional do Shopping Rural. O sistema deve centralizar catálogo/estoque do UniPlus, publicação de produtos para a Nuvemshop, campanhas, promoções, produção de arte, tráfego pago, leads e pedidos.

O visual poderá ser totalmente redesenhado depois, mas agora a prioridade é funcionamento, clareza operacional, segurança e fluxo entre pessoas.

## Arquitetura definida

```text
UniPlus nesta máquina
  -> conector local
  -> Firestore (Firebase projeto portalspr-e0490)
  -> portal web hospedado na Vercel
  -> usuários remotos

Fotos e artes: pasta local media/ nesta máquina.
```

- Firebase Authentication: somente e-mail e senha por enquanto.
- Cloud Firestore: usuários, papéis, catálogo sincronizado, fila de publicação, campanhas, artes, leads, pedidos, auditoria.
- Firebase Storage: **não usar**. Não criar dependência de Storage nem exigir plano pago.
- Arquivos ficam em `media/`, fora do Git. Usuários remotos veem status/metadados; o responsável pelo site, trabalhando nesta máquina ou por acesso remoto, gerencia o arquivo local e envia a imagem à Nuvemshop ao publicar.
- Vercel hospeda apenas o portal e as funções seguras. A HostGator será usada somente para domínio/DNS.
- Nunca exponha credenciais, tokens, chaves de serviço ou arquivos locais no navegador/GitHub.

## Papéis e permissões

Implemente login e controle por papel, com uma interface administrativa para o dono ativar/desativar usuários e definir papel.

1. `owner` (dono): visão completa; seleciona produtos; define preço; aprova publicação, promoções, campanhas e artes.
2. `manager` (gerente): cria campanhas/promoções, solicita arte, acompanha a operação e pode aprovar quando autorizado.
3. `marketing`: vê campanhas e produtos vinculados; cria/atualiza briefing e artes; anexa/indica arquivo local; marca arte pronta/publicada; lê indicadores de mídia.
4. `site`: vê a fila de publicação; adiciona descrição, SEO, categoria e referência de imagem local; confirma preparação; publica somente item aprovado.

Todos podem ver o que for necessário para sua operação. Alterações importantes precisam de histórico: usuário, data, ação, antes/depois quando aplicável.

## Fluxo obrigatório de produto

O UniPlus é a fonte de catálogo, SKU, estoque e preço-base. Nunca edite estoque diretamente no portal.

Estados:

`disponível no UniPlus -> selecionado pelo dono -> em preparação no site -> pronto para aprovação -> aprovado -> publicado na Nuvemshop`

Também prever `bloqueado` e `arquivado`.

Ao abrir um produto, o dono deve poder:

- selecionar/enviar para a fila de publicação;
- optar por manter preço do UniPlus ou definir preço do site;
- definir preço promocional e período da promoção;
- informar prioridade, observação e campanha associada;
- solicitar arte ligada ao produto.

O responsável do site deve poder:

- visualizar somente itens da fila relevantes ao site;
- indicar caminho/referência da foto local;
- adicionar descrição, título SEO, categoria e observações;
- marcar como pronto para aprovação;
- após aprovação, acionar publicação na Nuvemshop;
- receber mensagens claras se a integração Nuvemshop ainda não estiver configurada.

Não simule publicação como se estivesse integrada: diferencie `pronto para publicar` de `publicado na Nuvemshop` e registre erro/retentativa.

## Campanhas, promoções e artes

- Campanha deve aceitar um ou mais produtos, período, canais, objetivo, orçamento, responsável e status.
- Promoção deve ter preço normal, preço promocional, início/fim e produtos vinculados.
- Solicitação de arte deve nascer de campanha, promoção ou produto; conter briefing, formato, prazo, prioridade, responsável e status.
- Estados de arte: `solicitada`, `em criação`, `aguardando aprovação`, `aprovada`, `publicada` e `ajustes`.
- Marketing deve poder anexar uma referência local da arte e marcar a entrega. A aprovação deve ser feita por dono/gerente.
- Mostrar claramente se a arte foi enviada por WhatsApp/publicada em Instagram, Facebook, site ou outro canal. Isso é registro operacional; não envie mensagens automaticamente sem integração configurada.

## Integrações futuras

Crie estrutura/estado de conexão, telas de configuração e mensagens de pendência para:

- UniPlus: conector local sincroniza preço, estoque e catálogo em intervalos configuráveis.
- Nuvemshop: publicação de produto aprovado, imagem local enviada pelo conector, pedidos e catálogo.
- Google Analytics: visitas, fontes e conversões.
- Google Ads: investimento, cliques, campanhas e conversões.
- Meta Ads: campanhas, alcance, gasto, leads e conversões.
- Leads: origem, campanha, responsável, status, valor e histórico.

Não invente tokens nem dados reais. Use estados `não conectado`, `aguardando autorização`, `conectado`, `erro`, `última sincronização`.

## Dados e Firebase

Use Firestore como fonte compartilhada para toda a operação. Estruture coleções de forma simples e documentada, por exemplo:

- `users`
- `products`
- `publicationQueue`
- `campaigns`
- `artRequests`
- `promotions`
- `leads`
- `orders`
- `integrations`
- `audit`

Preserve e evolua os arquivos `firebase/firestore.rules`, `firebase.json` e `FIREBASE_SETUP.md`. Escritas de catálogo UniPlus e ações críticas de publicação devem passar pelo conector local ou função de servidor; não deixar o cliente editar preço-base/estoque.

## Requisitos de qualidade

- Interface em português do Brasil, responsiva e acessível.
- Use datas no fuso America/Sao_Paulo e moeda BRL.
- Não use dados fictícios em áreas que alegam estar conectadas.
- Mantenha o portal usável mesmo se UniPlus, Firebase ou uma integração estiver indisponível; exiba estado de erro e ação de tentar novamente.
- Evite dependências desnecessárias. Documente variáveis de ambiente em `.env.example`, sem valores secretos.
- Nunca versione `media/`, `portal-workflow.json`, `.env`, tokens, banco local ou chaves de serviço.
- Ao terminar uma etapa, execute verificações, corrija erros encontrados e descreva claramente o que mudou e o que ainda depende de credenciais/contas externas.

## Entregas prioritárias

1. Migrar o fluxo local atual para uma camada Firebase/Firestore bem separada, com modo local de desenvolvimento seguro.
2. Login por e-mail/senha e autorização por papel.
3. Fila visual de publicação de produtos, com o fluxo de aprovação completo.
4. Vínculo entre produtos, promoções, campanhas e pedidos de arte.
5. Painel de integrações com estados reais e base do conector UniPlus.
6. Preparar o projeto para deploy na Vercel, sem publicar nem alterar DNS automaticamente.

Antes de mudanças irreversíveis, preserve dados existentes. Faça commits pequenos e descritivos.
