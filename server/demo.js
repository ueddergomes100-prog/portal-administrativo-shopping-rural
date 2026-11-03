// Dados de DEMONSTRAÇÃO (DATA_BACKEND=demo). Tudo aqui é fictício e serve só para apresentar o portal.
// Criados sozinhos quando o banco temporário está vazio — na Vercel, a cada nova instância.
// Nunca use este modo com dados reais da loja.
import crypto from 'node:crypto';
import { getStore, C } from './store/index.js';
import { rebuildCatalog } from './services/catalog.js';
import { DEFAULT_CHANNELS, channelFees, marginOf, todayInSaoPaulo } from '../public/shared/domain.js';

let seeding = null;

export function ensureDemoData() {
  seeding ??= (async () => {
    const store = getStore();
    if (await store.get(C.users, 'demo-owner')) return;
    await seed(store);
  })().catch(error => { seeding = null; throw error; });
  return seeding;
}

const now = () => new Date().toISOString();
const day = offset => todayInSaoPaulo(new Date(Date.now() + offset * 86400_000));
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();

const PEOPLE = [
  ['owner', 'Carlos Mendes', true],
  ['manager', 'Juliana Prado', true],
  ['marketing', 'Marina Alves', false],
  ['site', 'Rafael Souza', false]
];

// [id, sku, nome, categoria, preço, custo, estoque]
const PRODUCTS = [
  ['2001', '8596', 'Ração Premium Cães Adultos Raças Médias 15 kg', 'Pet', 189.9, 121.4, 24],
  ['2002', '8611', 'Ração Gatos Castrados Salmão 10 kg', 'Pet', 159.5, 99.8, 17],
  ['2003', '7302', 'Coleira Antipulgas e Carrapatos Cães Médios', 'Pet', 74.9, 41.2, 31],
  ['2004', '7410', 'Areia Higiênica Grãos Finos 4 kg', 'Pet', 22.9, 13.1, 58],
  ['2005', '7455', 'Petisco Bifinho de Carne 500 g', 'Pet', 29.9, 16.5, 40],
  ['2006', '7520', 'Cama Pet Retangular Tamanho M', 'Pet', 119.0, 68.0, 9],
  ['2007', '7533', 'Brinquedo Mordedor de Corda', 'Pet', 19.9, 8.7, 63],
  ['2008', '5110', 'Mangueira Trançada 30 m com Esguicho', 'Jardinagem', 119.0, 72.3, 13],
  ['2009', '5122', 'Fertilizante NPK 10-10-10 1 kg', 'Jardinagem', 18.5, 9.9, 67],
  ['2010', '5135', 'Terra Vegetal Adubada 20 kg', 'Jardinagem', 24.9, 12.6, 0],
  ['2011', '3301', 'Enxada Larga com Cabo 1,5 m', 'Ferramentas', 89.9, 52.0, 26],
  ['2012', '3315', 'Pulverizador Costal 20 L', 'Ferramentas', 279.0, 181.0, 7],
  ['2013', '1102', 'Sal Mineral Bovinos 25 kg', 'Agropecuária', 129.0, 88.5, 35],
  ['2014', '1120', 'Arame Farpado 500 m', 'Agropecuária', 389.0, 262.0, 0],
  ['2015', '1133', 'Bebedouro Automático Aves', 'Agropecuária', 34.9, 19.4, 78],
  ['2016', '9050', 'Botina de Couro Bico PVC', 'Vestuário', 139.9, 86.7, 50],
  ['2017', '9061', 'Chapéu de Palha Aba Larga', 'Vestuário', 39.9, 21.0, 22],
  ['2018', '6200', 'Semente Capim Mombaça 1 kg', 'Sementes', 59.9, 34.8, 44]
];

function channelRows(product, prices, promo = {}) {
  return prices.map(([id, price]) => {
    const channel = DEFAULT_CHANNELS.find(c => c.id === id);
    const fees = channelFees(price, channel);
    const promoPrice = promo[id] ?? null;
    const promoFees = promoPrice ? channelFees(promoPrice, channel) : null;
    return {
      id, name: channel.name, integration: channel.integration, price, promoPrice,
      feeRule: { percent: channel.percent, fixed: channel.fixed, fixedBelow: channel.fixedBelow },
      fee: fees.fee, net: fees.net, promoFee: promoFees?.fee ?? null, promoNet: promoFees?.net ?? null,
      margin: marginOf(fees, product.cost), promoMargin: promoFees ? marginOf(promoFees, product.cost) : null
    };
  });
}

async function seed(store) {
  const users = Object.fromEntries(PEOPLE.map(([role, name, canApprove]) => [role, {
    id: `demo-${role}`, name, email: `${role}@demo.shoppingrural.local`, role, active: true, canApprove,
    passwordHash: `scrypt:${crypto.randomBytes(8).toString('hex')}:${crypto.randomBytes(16).toString('hex')}`,
    sessionVersion: 1, createdAt: ago(60 * 24 * 30), updatedAt: ago(60), lastLoginAt: ago(90)
  }]));
  await store.bulkSet(C.users, Object.values(users));
  const by = role => ({ id: users[role].id, name: users[role].name });

  const products = PRODUCTS.map(([id, sku, name, category, basePrice, cost, stock]) => ({
    id, sku, name, category, basePrice, cost, stock, unit: 'UN', syncedAt: ago(1), source: 'demo', missingFromUniplus: false
  }));
  await store.bulkSet(C.products, products);
  const product = id => products.find(p => p.id === id);

  // --- Campanhas ---------------------------------------------------------------
  const camp = (id, data) => ({ id, notes: [], createdBy: by('manager'), createdAt: ago(60 * 24 * 10), updatedAt: ago(60 * 5), updatedBy: 'demo-manager', ...data });
  const campaigns = [
    camp('demo-c1', { name: 'Semana do Pet', objective: 'Vendas', description: 'Rações, petiscos e antipulgas com desconto no site e na loja. Divulgação no Instagram e no grupo de WhatsApp.', start: day(-3), end: day(4), channels: ['Site', 'Instagram', 'WhatsApp'], budget: 1200, ownerId: 'demo-marketing', productIds: ['2001', '2002', '2005'], products: ['2001', '2002', '2005'].map(i => ({ id: i, name: product(i).name, sku: product(i).sku, basePrice: product(i).basePrice })), status: 'running', approvedBy: { ...by('owner'), at: ago(60 * 24 * 7) } }),
    camp('demo-c2', { name: 'Black Friday do Campo', objective: 'Vendas', description: 'Ferramentas, sal mineral e arame com preço especial. Anúncios no Google e Meta.', start: day(21), end: day(28), channels: ['Site', 'Meta Ads', 'Google Ads', 'Loja física'], budget: 3500, ownerId: 'demo-manager', productIds: ['2011', '2012', '2013'], products: ['2011', '2012', '2013'].map(i => ({ id: i, name: product(i).name, sku: product(i).sku, basePrice: product(i).basePrice })), status: 'approved', approvedBy: { ...by('owner'), at: ago(60 * 24) } }),
    camp('demo-c3', { name: 'Jardim de Primavera', objective: 'Divulgação', description: 'Conteúdo sobre jardinagem e kits de fertilizante e terra adubada.', start: day(38), end: day(45), channels: ['Instagram', 'Site'], budget: 600, ownerId: 'demo-marketing', productIds: ['2008', '2009'], products: ['2008', '2009'].map(i => ({ id: i, name: product(i).name, sku: product(i).sku, basePrice: product(i).basePrice })), status: 'draft' })
  ];
  await store.bulkSet(C.campaigns, campaigns);

  // --- Promoções ---------------------------------------------------------------
  const promotions = [
    { id: 'demo-p1', name: 'Rações da Semana do Pet', description: 'Desconto nas rações mais vendidas.', start: day(-3), end: day(4), campaignId: 'demo-c1', channels: ['site', 'shopee'],
      items: [{ productId: '2001', sku: '8596', name: product('2001').name, regularPrice: 189.9, promoPrice: 169.9 }, { productId: '2002', sku: '8611', name: product('2002').name, regularPrice: 159.5, promoPrice: 144.9 }],
      status: 'approved', approvedBy: { ...by('owner'), at: ago(60 * 24 * 4) }, createdBy: by('manager'), createdAt: ago(60 * 24 * 6), updatedAt: ago(60 * 24 * 4), notes: [] },
    { id: 'demo-p2', name: 'Antipulgas para o verão', description: 'Pedido do gerente: coleira com preço de entrada.', start: day(6), end: day(20), campaignId: '', channels: ['site', 'mercadolivre'],
      items: [{ productId: '2003', sku: '7302', name: product('2003').name, regularPrice: 74.9, promoPrice: 64.9 }],
      status: 'awaiting_approval', createdBy: by('manager'), createdAt: ago(60 * 3), updatedAt: ago(60 * 3), notes: [{ text: 'Rascunho → Aguardando aprovação', at: ago(60 * 3), by: users.manager.name }] }
  ];
  await store.bulkSet(C.promotions, promotions);

  // --- Fila de venda -----------------------------------------------------------
  const siteFields = (extra) => ({ siteNotes: '', seoTitle: '', seoDescription: '', ...extra });
  const queue = [
    { id: 'demo-q1', productId: '2001', stage: 'published', slug: 'racao-premium-caes-adultos-15kg', priority: 'Alta', campaignId: 'demo-c1',
      channels: channelRows(product('2001'), [['site', 189.9], ['shopee', 199.9], ['mercadolivre', 194.9]], { site: 169.9, shopee: 179.9 }),
      promoStart: day(-3), promoEnd: day(4),
      content: siteFields({ title: 'Ração Premium Cães Adultos Raças Médias 15 kg', description: 'Ração premium para cães adultos de raças médias, com proteína de alta qualidade, ômega 3 e 6 para a pelagem e prebióticos para a saúde intestinal.', category: 'Pet', imageRefs: [], brand: 'NutriCampo', pet: 'cao', siteCategory: 'racao-caes', measureValue: 15, measureUnit: 'kg', weightKg: null, tag: 'Mais pedido', short: 'Proteína de qualidade, ômega 3 e 6 e prebióticos.', specs: [{ label: 'Porte', value: 'Médio' }, { label: 'Fase', value: 'Adulto' }] }),
      listings: { site: { status: 'done', publishedAt: ago(60 * 24 * 3), by: users.site.name, externalId: 'racao-premium-caes-adultos-15kg', url: '' }, shopee: { status: 'done', manual: true, publishedAt: ago(60 * 24 * 2), by: users.site.name, url: 'https://shopee.com.br/exemplo-demonstracao', externalId: 'SHP-48213' }, mercadolivre: { status: 'done', manual: true, publishedAt: ago(60 * 24 * 2), by: users.site.name, externalId: 'MLB-3311' } } },
    { id: 'demo-q2', productId: '2002', stage: 'approved', slug: 'racao-gatos-castrados-salmao-10kg', priority: 'Normal', campaignId: 'demo-c1',
      channels: channelRows(product('2002'), [['site', 159.5], ['shopee', 169.9]], { site: 144.9 }), promoStart: day(-3), promoEnd: day(4),
      content: siteFields({ title: 'Ração Gatos Castrados Salmão 10 kg', description: 'Ração para gatos castrados com salmão, controle de peso e cuidado urinário. Embalagem econômica de 10 kg.', category: 'Pet', imageRefs: [], brand: 'NutriCampo', pet: 'gato', siteCategory: 'racao-gatos', measureValue: 10, measureUnit: 'kg', weightKg: null, tag: '', short: 'Controle de peso e cuidado urinário.', specs: [{ label: 'Sabor', value: 'Salmão' }] }),
      listings: { site: { status: 'done', publishedAt: ago(60 * 5), by: users.site.name, externalId: 'racao-gatos-castrados-salmao-10kg', url: '' }, shopee: { status: 'idle' } } },
    { id: 'demo-q3', productId: '2003', stage: 'review', priority: 'Normal', campaignId: '',
      channels: channelRows(product('2003'), [['site', 74.9], ['mercadolivre', 79.9]]),
      content: siteFields({ title: 'Coleira Antipulgas e Carrapatos para Cães Médios', description: 'Proteção contra pulgas e carrapatos por até 8 meses, resistente à água, para cães de 8 a 25 kg.', category: 'Pet', imageRefs: [], brand: 'Protege', pet: 'cao', siteCategory: 'antiparasitario', measureValue: 1, measureUnit: 'un', weightKg: 0.1, tag: 'Novo', short: 'Até 8 meses de proteção, resistente à água.', specs: [{ label: 'Peso do cão', value: '8 a 25 kg' }] }),
      listings: { site: { status: 'idle' }, mercadolivre: { status: 'idle' } } },
    { id: 'demo-q4', productId: '2004', stage: 'preparing', priority: 'Baixa', campaignId: '',
      channels: channelRows(product('2004'), [['site', 22.9], ['shopee', 24.9]]),
      content: siteFields({ title: 'Areia Higiênica Grãos Finos 4 kg', description: '', category: 'Pet', imageRefs: [], brand: '', pet: 'gato', siteCategory: 'cama-banheiro', measureValue: 4, measureUnit: 'kg', weightKg: null, tag: '', short: '', specs: [] }),
      listings: { site: { status: 'idle' }, shopee: { status: 'idle' } } },
    { id: 'demo-q5', productId: '2008', stage: 'selected', priority: 'Urgente', campaignId: 'demo-c3', notes: 'Usar a foto com o esguicho montado.',
      channels: channelRows(product('2008'), [['site', 119.0], ['mercadolivre', 124.9]]),
      content: siteFields({ title: 'Mangueira Trançada 30 m com Esguicho', description: '', category: 'Jardinagem', imageRefs: [], brand: '', pet: '', siteCategory: '', measureValue: null, measureUnit: 'un', weightKg: null, tag: '', short: '', specs: [] }),
      listings: { site: { status: 'idle' }, mercadolivre: { status: 'idle' } } }
  ].map((item, i) => {
    const p = product(item.productId);
    return {
      notes: '', ...item,
      productSnapshot: { sku: p.sku, name: p.name, category: p.category, basePrice: p.basePrice, stock: p.stock, cost: p.cost },
      requestedBy: by('owner'), createdAt: ago(60 * 24 * (6 - i)), updatedAt: ago(60 * (i + 1) * 3), updatedBy: 'demo-owner',
      stageHistory: [{ from: 'selected', to: item.stage, at: ago(60 * (i + 2) * 4), by: users.site.name, note: '' }]
    };
  });
  await store.bulkSet(C.queue, queue);

  // --- Artes ---------------------------------------------------------------------
  const art = (id, data) => ({ id, fileRef: '', publications: [], notes: [], priority: 'Normal', format: 'Post', assigneeId: 'demo-marketing', createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 4), ...data });
  await store.bulkSet(C.arts, [
    art('demo-a1', { title: 'Post Semana do Pet — rações', originType: 'campaign', originId: 'demo-c1', originName: 'Semana do Pet', briefing: 'Post com as duas rações em destaque, preço riscado e "só até domingo".', deadline: day(-4), status: 'published', createdBy: by('manager'),
      publications: [{ channel: 'Instagram', at: ago(60 * 24 * 3), by: users.marketing.name, note: 'Feed + destaque' }, { channel: 'WhatsApp', at: ago(60 * 24 * 3), by: users.marketing.name, note: 'Grupo de clientes' }] }),
    art('demo-a2', { title: 'Carrossel Semana do Pet — petiscos', originType: 'campaign', originId: 'demo-c1', originName: 'Semana do Pet', briefing: 'Carrossel com 4 cards: bifinho, mordedor, cama e areia.', format: 'Carrossel', deadline: day(1), status: 'awaiting_approval', createdBy: by('manager'), deliveredAt: ago(50) }),
    art('demo-a3', { title: 'Stories Black Friday do Campo', originType: 'campaign', originId: 'demo-c2', originName: 'Black Friday do Campo', briefing: 'Sequência de 3 stories com contagem regressiva.', format: 'Stories', deadline: day(14), priority: 'Alta', status: 'in_progress', createdBy: by('owner') }),
    art('demo-a4', { title: 'Arte: Antipulgas para o verão', originType: 'promotion', originId: 'demo-p2', originName: 'Antipulgas para o verão', briefing: 'Coleira de R$ 74,90 por R$ 64,90, para site e Mercado Livre.', deadline: day(5), status: 'requested', createdBy: by('manager'), createdAt: ago(60 * 3) })
  ]);

  // --- Leads ---------------------------------------------------------------------
  const lead = (id, data) => ({ id, email: '', campaignId: '', assigneeId: 'demo-manager', notes: [], createdBy: { id: 'inbound', name: 'Entrada automática' }, createdAt: ago(60 * 30), updatedAt: ago(60 * 2), ...data });
  await store.bulkSet(C.leads, [
    lead('demo-l1', { name: 'Fazenda Boa Vista', phone: '(34) 99100-0001', source: 'WhatsApp', value: 2600, status: 'qualified', interest: 'Orçamento de 40 sacos de sal mineral por mês.' }),
    lead('demo-l2', { name: 'Patrícia Gomes', phone: '(34) 99100-0002', source: 'Instagram', campaignId: 'demo-c1', value: 330, status: 'contacted', interest: 'Ração de gato castrado em quantidade.' }),
    lead('demo-l3', { name: 'Haras Primavera', email: 'contato@exemplo.com', source: 'Site', value: 1800, status: 'new', interest: 'Bebedouros e ração equina.' }),
    lead('demo-l4', { name: 'José Ribeiro', phone: '(34) 99100-0004', source: 'Loja física', value: 279, status: 'won', interest: 'Pulverizador costal.' }),
    lead('demo-l5', { name: 'Ana Costa', phone: '(34) 99100-0005', source: 'Meta Ads', campaignId: 'demo-c1', value: 120, status: 'new', interest: 'Cama pet tamanho M.' })
  ]);

  // --- Pedidos do site ------------------------------------------------------------
  const order = (id, status, minutesAgo, items, delivery, extra = {}) => {
    const subtotal = items.reduce((t, i) => t + i.unitPrice * i.qty, 0);
    const timelineSteps = ['aguardando_pagamento', 'pago', 'separando', status === 'pronto_retirada' ? 'pronto_retirada' : 'enviado', 'entregue'];
    const upTo = timelineSteps.indexOf(status);
    return {
      id: `site-${id}`, externalId: id, number: id, channel: 'site', createdAt: ago(minutesAgo), syncedAt: ago(minutesAgo),
      customer: { name: extra.customer || 'Cliente', email: '', phone: '(34) 99200-0000', cpf: '' },
      items, delivery, payment: { method: extra.method || 'pix', status: 'aprovado' },
      totals: { subtotal, couponDiscount: 0, pixDiscount: extra.method === 'pix' ? Math.round(subtotal * 5) / 100 : 0, shipping: delivery.price, total: Math.round((subtotal + delivery.price - (extra.method === 'pix' ? subtotal * 0.05 : 0)) * 100) / 100 },
      status, trackingCode: extra.trackingCode || '',
      timeline: timelineSteps.slice(0, upTo + 1).map((s, k) => ({ status: s, at: ago(minutesAgo - k * 20), ...(k > 1 ? { by: users.site.name } : {}) }))
    };
  };
  const item = (id, qty, unitPrice) => ({ productId: `demo-q${id === '2001' ? 1 : 2}`, sku: product(id).sku, slug: '', name: product(id).name, brand: 'NutriCampo', image: '', measure: '', unitPrice, qty });
  const address = { cep: '38400-000', street: 'Rua das Flores', number: '120', district: 'Centro', city: 'Uberlândia', state: 'MG' };
  await store.bulkSet(C.orders, [
    order('SR-482913', 'pago', 35, [item('2001', 1, 169.9)], { method: 'economica', label: 'Econômica (3 a 6 dias úteis)', price: 18.5, days: [3, 6], address }, { customer: 'Maria Souza', method: 'pix' }),
    order('SR-482877', 'separando', 60 * 5, [item('2002', 2, 144.9)], { method: 'retirada', label: 'Retirada na loja', price: 0, days: null }, { customer: 'Pedro Lima', method: 'cartao' }),
    order('SR-482701', 'enviado', 60 * 26, [item('2001', 2, 169.9)], { method: 'expressa', label: 'Expressa (1 a 2 dias úteis)', price: 32, days: [1, 2], address }, { customer: 'Fernanda Rocha', method: 'pix', trackingCode: 'BR123456789XX' })
  ]);

  // --- Integrações e histórico ----------------------------------------------------
  await store.set(C.integrations, 'uniplus', { status: 'connected', lastSyncAt: ago(1), lastError: '', itemCount: products.length, missingCount: 0, updatedAt: now() });
  await store.set(C.integrations, 'site', { status: 'connected', lastSyncAt: ago(35), lastError: '', updatedAt: now() });
  const audit = (minutes, role, action, entity, entityId, summary) => ({ id: crypto.randomUUID(), at: ago(minutes), actorId: users[role].id, actorName: users[role].name, actorRole: role, action, entity, entityId, summary });
  await store.bulkSet(C.audit, [
    audit(35, 'site', 'orders.create', 'orders', 'site-SR-482913', 'Pedido SR-482913: Pago (Maria Souza)'),
    audit(50, 'marketing', 'arts.status', 'arts', 'demo-a2', 'Solicitação de arte "Carrossel Semana do Pet — petiscos": Em criação → Aguardando aprovação'),
    audit(180, 'manager', 'promotions.status', 'promotions', 'demo-p2', 'Promoção "Antipulgas para o verão": Rascunho → Aguardando aprovação'),
    audit(300, 'site', 'queue.publish_site', 'queue', 'demo-q2', 'Publicou Ração Gatos Castrados Salmão 10 kg no site'),
    audit(60 * 26, 'site', 'orders.move', 'orders', 'site-SR-482701', 'Pedido SR-482701: Separando na loja → Enviado (rastreio BR123456789XX)')
  ]);

  await rebuildCatalog();
}
