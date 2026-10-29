// Regras de negócio compartilhadas entre o servidor (Node) e o navegador.
// Este arquivo é a fonte única de papéis, etapas e transições. Ao mudar um fluxo,
// mude aqui primeiro: o servidor valida com estas tabelas e a interface desenha com elas.

export const ROLES = {
  owner: { label: 'Dono', description: 'Visão completa, define preços e aprova publicações, promoções, campanhas e artes.' },
  manager: { label: 'Gerente', description: 'Cria campanhas e promoções, solicita artes e aprova quando autorizado.' },
  marketing: { label: 'Marketing', description: 'Produz e entrega artes, acompanha campanhas e indicadores de mídia.' },
  site: { label: 'Site', description: 'Prepara conteúdo dos produtos e publica na Nuvemshop o que foi aprovado.' }
};
export const ROLE_KEYS = Object.keys(ROLES);

// Gerente só aprova quando o dono marcar "pode aprovar" no cadastro dele.
export function canApprove(user) {
  return !!user && (user.role === 'owner' || (user.role === 'manager' && user.canApprove === true));
}

// ---------------------------------------------------------------------------
// Fila de publicação de produtos
// disponível no UniPlus -> selecionado -> em preparação -> pronto p/ aprovação -> aprovado -> publicado
// ---------------------------------------------------------------------------
export const QUEUE_STAGES = {
  selected: { label: 'Selecionado', hint: 'O dono escolheu o produto para o site.', tone: 'neutral' },
  preparing: { label: 'Em preparação', hint: 'O site está preparando foto, descrição e SEO.', tone: 'info' },
  review: { label: 'Pronto para aprovação', hint: 'Conteúdo pronto aguardando o dono ou gerente.', tone: 'warn' },
  approved: { label: 'Aprovado', hint: 'Liberado para o site publicar na Nuvemshop.', tone: 'ok' },
  published: { label: 'Publicado na Nuvemshop', hint: 'A Nuvemshop confirmou o cadastro do produto.', tone: 'done' },
  blocked: { label: 'Bloqueado', hint: 'Pausado por decisão do dono ou gerente.', tone: 'danger' },
  archived: { label: 'Arquivado', hint: 'Fora da operação, mantido no histórico.', tone: 'muted' }
};
export const QUEUE_FLOW = ['selected', 'preparing', 'review', 'approved', 'published'];

// Quem pode mover de qual etapa para qual. `approver` = canApprove(user).
// A ida para `published` NÃO está aqui: só acontece pela ação de publicar,
// depois que a Nuvemshop responde com sucesso.
export const QUEUE_TRANSITIONS = [
  { from: 'selected', to: 'preparing', who: ['site', 'owner', 'manager'], label: 'Começar preparação' },
  { from: 'preparing', to: 'review', who: ['site'], label: 'Enviar para aprovação', requires: 'content' },
  { from: 'review', to: 'approved', who: ['approver'], label: 'Aprovar publicação' },
  { from: 'review', to: 'preparing', who: ['approver'], label: 'Pedir ajustes', requires: 'note' },
  { from: 'approved', to: 'preparing', who: ['approver'], label: 'Voltar para preparação', requires: 'note' },
  { from: ['selected', 'preparing', 'review', 'approved'], to: 'blocked', who: ['owner', 'manager'], label: 'Bloquear', requires: 'note' },
  { from: 'blocked', to: 'selected', who: ['owner', 'manager'], label: 'Desbloquear' },
  { from: ['selected', 'preparing', 'review', 'approved', 'blocked', 'published'], to: 'archived', who: ['owner'], label: 'Arquivar' },
  { from: 'archived', to: 'selected', who: ['owner'], label: 'Reativar' }
];

export const PUBLISH_STATUS = {
  idle: 'Aguardando publicação',
  publishing: 'Enviando à Nuvemshop',
  failed: 'Falhou — tente novamente',
  done: 'Publicado'
};

export const PRIORITIES = ['Baixa', 'Normal', 'Alta', 'Urgente'];

// ---------------------------------------------------------------------------
// Solicitações de arte
// ---------------------------------------------------------------------------
export const ART_STATUS = {
  requested: { label: 'Solicitada', tone: 'neutral' },
  in_progress: { label: 'Em criação', tone: 'info' },
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'warn' },
  changes: { label: 'Ajustes', tone: 'danger' },
  approved: { label: 'Aprovada', tone: 'ok' },
  published: { label: 'Publicada', tone: 'done' }
};
export const ART_FLOW = ['requested', 'in_progress', 'awaiting_approval', 'approved', 'published'];
export const ART_TRANSITIONS = [
  { from: 'requested', to: 'in_progress', who: ['marketing'], label: 'Começar criação' },
  { from: ['in_progress', 'changes'], to: 'awaiting_approval', who: ['marketing'], label: 'Entregar para aprovação', requires: 'file' },
  { from: 'changes', to: 'in_progress', who: ['marketing'], label: 'Retomar criação' },
  { from: 'awaiting_approval', to: 'approved', who: ['approver'], label: 'Aprovar arte' },
  { from: 'awaiting_approval', to: 'changes', who: ['approver'], label: 'Pedir ajustes', requires: 'note' },
  { from: 'approved', to: 'published', who: ['marketing', 'owner', 'manager'], label: 'Registrar publicação', requires: 'channels' }
];
export const ART_FORMATS = ['Post', 'Carrossel', 'Stories', 'Reels / vídeo', 'Banner do site', 'Impresso', 'Outro'];
export const ART_ORIGINS = { campaign: 'Campanha', promotion: 'Promoção', product: 'Produto' };
// Registro operacional: o portal NÃO envia nada sozinho para esses canais.
export const PUBLICATION_CHANNELS = ['WhatsApp', 'Instagram', 'Facebook', 'Site', 'Loja física', 'Outro'];

// ---------------------------------------------------------------------------
// Campanhas e promoções
// ---------------------------------------------------------------------------
export const CAMPAIGN_STATUS = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'warn' },
  approved: { label: 'Aprovada', tone: 'ok' },
  running: { label: 'Em andamento', tone: 'info' },
  done: { label: 'Concluída', tone: 'done' },
  cancelled: { label: 'Cancelada', tone: 'muted' }
};
export const CAMPAIGN_TRANSITIONS = [
  { from: 'draft', to: 'awaiting_approval', who: ['owner', 'manager', 'marketing'], label: 'Enviar para aprovação' },
  { from: 'awaiting_approval', to: 'approved', who: ['approver'], label: 'Aprovar campanha' },
  { from: 'awaiting_approval', to: 'draft', who: ['approver'], label: 'Devolver para ajustes', requires: 'note' },
  { from: 'approved', to: 'running', who: ['owner', 'manager'], label: 'Iniciar campanha' },
  { from: 'running', to: 'done', who: ['owner', 'manager'], label: 'Concluir' },
  { from: ['draft', 'awaiting_approval', 'approved', 'running'], to: 'cancelled', who: ['owner', 'manager'], label: 'Cancelar', requires: 'note' }
];
export const CAMPAIGN_CHANNELS = ['Site', 'Instagram', 'Facebook', 'WhatsApp', 'Google Ads', 'Meta Ads', 'Loja física'];
export const CAMPAIGN_OBJECTIVES = ['Vendas', 'Divulgação', 'Geração de leads', 'Engajamento', 'Evento na loja'];

export const PROMOTION_STATUS = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'warn' },
  approved: { label: 'Aprovada', tone: 'ok' },
  cancelled: { label: 'Cancelada', tone: 'muted' }
};
export const PROMOTION_TRANSITIONS = [
  { from: 'draft', to: 'awaiting_approval', who: ['owner', 'manager'], label: 'Enviar para aprovação' },
  { from: 'awaiting_approval', to: 'approved', who: ['approver'], label: 'Aprovar promoção' },
  { from: 'awaiting_approval', to: 'draft', who: ['approver'], label: 'Devolver para ajustes', requires: 'note' },
  { from: ['draft', 'awaiting_approval', 'approved'], to: 'cancelled', who: ['owner', 'manager'], label: 'Cancelar', requires: 'note' }
];

// Promoção aprovada ganha uma fase calculada pelas datas (fuso de São Paulo).
export function promotionPhase(promo, todayISO) {
  if (promo.status !== 'approved') return null;
  if (todayISO < promo.start) return { key: 'scheduled', label: 'Programada', tone: 'info' };
  if (todayISO > promo.end) return { key: 'ended', label: 'Encerrada', tone: 'muted' };
  return { key: 'active', label: 'No ar', tone: 'ok' };
}

// ---------------------------------------------------------------------------
// Leads e pedidos
// ---------------------------------------------------------------------------
export const LEAD_STATUS = {
  new: { label: 'Novo', tone: 'neutral' },
  contacted: { label: 'Em contato', tone: 'info' },
  qualified: { label: 'Qualificado', tone: 'warn' },
  won: { label: 'Convertido', tone: 'ok' },
  lost: { label: 'Perdido', tone: 'muted' }
};
export const LEAD_SOURCES = ['Site', 'WhatsApp', 'Instagram', 'Facebook', 'Meta Ads', 'Google Ads', 'Loja física', 'Indicação', 'Outro'];

export const ORDER_STATUS = {
  open: { label: 'Aberto', tone: 'info' },
  paid: { label: 'Pago', tone: 'ok' },
  shipped: { label: 'Enviado', tone: 'info' },
  delivered: { label: 'Entregue', tone: 'done' },
  cancelled: { label: 'Cancelado', tone: 'muted' }
};

// ---------------------------------------------------------------------------
// Integrações
// ---------------------------------------------------------------------------
export const INTEGRATION_STATUS = {
  not_connected: { label: 'Não conectado', tone: 'muted' },
  awaiting_auth: { label: 'Aguardando autorização', tone: 'warn' },
  connected: { label: 'Conectado', tone: 'ok' },
  error: { label: 'Erro', tone: 'danger' }
};
export const INTEGRATIONS = {
  uniplus: { name: 'UniPlus ERP', role: 'Catálogo, SKU, estoque e preço-base', env: ['UNIPLUS_API_URL'] },
  nuvemshop: { name: 'Nuvemshop', role: 'Publicação de produtos e pedidos do site', env: ['NUVEMSHOP_STORE_ID', 'NUVEMSHOP_ACCESS_TOKEN'] },
  ga4: { name: 'Google Analytics 4', role: 'Visitas, fontes de tráfego e conversões', env: ['GA4_PROPERTY_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON'] },
  googleads: { name: 'Google Ads', role: 'Investimento, cliques, campanhas e conversões', env: ['GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN'] },
  metaads: { name: 'Meta Ads', role: 'Alcance, gasto, leads e conversões', env: ['META_AD_ACCOUNT_ID', 'META_ACCESS_TOKEN'] }
};

// ---------------------------------------------------------------------------
// Utilitários de transição
// ---------------------------------------------------------------------------
export function roleMatches(user, who) {
  if (!user) return false;
  return who.some(w => (w === 'approver' ? canApprove(user) : w === user.role));
}

export function availableTransitions(table, current, user) {
  return table.filter(t => {
    const from = Array.isArray(t.from) ? t.from : [t.from];
    return from.includes(current) && roleMatches(user, t.who);
  });
}

export function findTransition(table, from, to) {
  return table.find(t => (Array.isArray(t.from) ? t.from : [t.from]).includes(from) && t.to === to) || null;
}

// Data de hoje (AAAA-MM-DD) no fuso da operação.
export function todayInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
