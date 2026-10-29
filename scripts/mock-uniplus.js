// SOMENTE PARA DESENVOLVIMENTO: imita a API local do UniPlus para testar o portal sem o ERP.
// Os produtos abaixo são fictícios. Nunca aponte UNIPLUS_API_URL para este mock na loja.
//
// Uso:  node scripts/mock-uniplus.js        (porta 3999)
//       UNIPLUS_API_URL=http://127.0.0.1:3999 npm run dev
import http from 'node:http';

const port = Number(process.env.MOCK_UNIPLUS_PORT || 3999);
const names = [
  ['Ração Premium Cães Adultos 15 kg', 'Pet', 189.9], ['Ração Gatos Castrados 10 kg', 'Pet', 159.5], ['Coleira Antipulgas Cães Médios', 'Pet', 74.9],
  ['Areia Higiênica Grãos Finos 4 kg', 'Pet', 22.9], ['Vaso Autoirrigável 30 cm', 'Jardinagem', 49.9], ['Fertilizante NPK 10-10-10 1 kg', 'Jardinagem', 18.5],
  ['Terra Vegetal Adubada 20 kg', 'Jardinagem', 24.9], ['Mangueira Trançada 30 m', 'Jardinagem', 119.0], ['Enxada Larga com Cabo 1,5 m', 'Ferramentas', 89.9],
  ['Cavadeira Articulada', 'Ferramentas', 109.9], ['Arame Farpado 500 m', 'Agropecuária', 389.0], ['Sal Mineral Bovinos 25 kg', 'Agropecuária', 129.0],
  ['Bebedouro Automático Aves', 'Agropecuária', 34.9], ['Semente Milho Híbrido 20 kg', 'Sementes', 649.0], ['Semente Capim Mombaça 1 kg', 'Sementes', 59.9],
  ['Pulverizador Costal 20 L', 'Ferramentas', 279.0], ['Botina de Couro Bico PVC', 'Vestuário', 139.9], ['Chapéu de Palha Aba Larga', 'Vestuário', 39.9]
];
const products = names.map(([name, category, price], i) => ({
  id_produto: 1000 + i, sku: `SR-${String(1000 + i)}`, nome_produto: name, nome_categoria: category,
  preco: price, estoque: i % 7 === 3 ? 0 : (i * 13) % 80 + 2, unidade: 'UN'
}));

http.createServer((req, res) => {
  if (req.url.startsWith('/api/erp/products')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: products }));
  }
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1', () => console.log(`[mock-uniplus] ${products.length} produtos FICTÍCIOS em http://127.0.0.1:${port}/api/erp/products`));
