# Configuração Firebase — Portal Shopping Rural

Projeto: `portalspr-e0490`.

## Serviços

1. Crie o **Cloud Firestore** em modo de produção, na localização mais próxima da operação da empresa. A localização não pode ser alterada depois.
2. Ative **Authentication** com provedores E-mail/senha e Google. O primeiro administrador será cadastrado depois pelo portal.
3. Não ative Firebase Storage neste momento. Fotos de produtos, artes e anexos serão mantidos na pasta local `media/` desta máquina.
4. Registre um aplicativo Web chamado `Portal Administrativo Shopping Rural` e copie apenas a configuração pública do SDK para as variáveis de ambiente da Vercel. Não copie chaves de conta de serviço para o navegador.

## Coleções

- `users`: nome, e-mail, papel, ativo e timestamps.
- `products`: espelho de catálogo/estoque/preço vindo do UniPlus.
- `publicationQueue`: seleção do dono, preço aprovado, conteúdo, responsável e etapa de publicação.
- `campaigns`, `artRequests`, `leads`: operação de marketing.
- `audit`: histórico imutável criado pelo servidor.

## Papéis

- `owner`: visão completa e aprovações.
- `manager`: campanhas, fila e aprovações operacionais.
- `marketing`: campanhas, artes, materiais e indicadores.
- `site`: conteúdo de produto e publicação aprovada.

## Arquivos locais

O diretório `media/` não entra no GitHub. Ele funciona enquanto esta máquina estiver ligada e o portal local estiver disponível. A Vercel e usuários fora desta rede não conseguem acessar esses arquivos diretamente; quando for necessário acesso remoto, podemos publicar apenas as imagens aprovadas no site/Nuvemshop ou migrar os anexos para um storage em nuvem.

## Segurança

O arquivo `firebase/firestore.rules` contém as regras iniciais. O conector UniPlus e as ações de publicação usarão Admin SDK/Cloud Functions: credenciais privadas nunca vão para o navegador nem para o GitHub.
