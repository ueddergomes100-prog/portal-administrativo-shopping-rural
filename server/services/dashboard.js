// Visão geral: o que precisa da atenção de cada papel agora.
import { getStore, C } from '../store/index.js';
import { listIntegrations } from './integrations.js';
import { listAudit } from '../audit.js';
import { canApprove, promotionPhase, todayInSaoPaulo, QUEUE_STAGES, PREPARERS } from '../../public/shared/domain.js';

// AAAA-MM-DD -> DD/MM/AAAA para textos prontos da lista "Sua vez".
const br = iso => (iso ? iso.split('-').reverse().join('/') : '—');

export async function dashboard(user) {
  const store = getStore();
  const [queue, campaigns, promotions, arts, leads, integrations, productCount, orders, users] = await Promise.all([
    store.list(C.queue), store.list(C.campaigns), store.list(C.promotions), store.list(C.arts), store.list(C.leads),
    listIntegrations(), store.count(C.products), store.list(C.orders), store.list(C.users)
  ]);
  const today = todayInSaoPaulo();
  const approver = canApprove(user);

  const pipeline = Object.keys(QUEUE_STAGES).map(stage => ({ stage, count: queue.filter(i => i.stage === stage).length }));
  // Cada pendência é uma frase simples + o nome do botão que resolve (action).
  const todo = [];
  const push = (kind, id, title, detail, route, action) => todo.push({ kind, id, title, detail, route, action });
  const items = n => (n === 1 ? '1 item' : `${n} itens`);

  if (approver) {
    queue.filter(i => i.stage === 'review').forEach(i => push('queue', i.id, `Aprovar o anúncio de ${i.productSnapshot.name}`, 'Fotos e texto estão prontos. Confira antes de ir para a venda.', `fila/${i.id}`, 'Ver e aprovar'));
    arts.filter(a => a.status === 'awaiting_approval').forEach(a => push('arts', a.id, `Aprovar a arte “${a.title}”`, a.deadline ? `Precisa ficar pronta até ${br(a.deadline)}.` : 'A arte está pronta para você ver.', `artes/${a.id}`, 'Ver a arte'));
    campaigns.filter(c => c.status === 'awaiting_approval').forEach(c => push('campaigns', c.id, `Aprovar a campanha ${c.name}`, `De ${br(c.start)} a ${br(c.end)}.`, `campanhas/${c.id}`, 'Ver a campanha'));
    promotions.filter(p => p.status === 'awaiting_approval').forEach(p => push('promotions', p.id, `Aprovar a promoção ${p.name}`, `${p.items.length === 1 ? '1 produto' : `${p.items.length} produtos`} com preço especial, de ${br(p.start)} a ${br(p.end)}.`, `promocoes/${p.id}`, 'Ver a promoção'));
  }
  // Sem ninguém na função "Vendas na internet", quem prepara e coloca à venda é o dono ou o gerente.
  const hasSiteTeam = users.some(u => u.role === 'site' && u.active !== false);
  if (user.role === 'site' || (!hasSiteTeam && PREPARERS.includes(user.role))) {
    queue.filter(i => ['selected', 'preparing'].includes(i.stage)).forEach(i => push('queue', i.id, `Preparar fotos e texto de ${i.productSnapshot.name}`, i.stage === 'selected' ? 'Este produto foi escolhido para vender na internet.' : 'Já começou. Termine e mande para aprovação.', `fila/${i.id}`, 'Preparar'));
    // Aprovados (ou já à venda com marketplace a atualizar) que ainda têm canal pendente.
    queue.filter(i => ['approved', 'published'].includes(i.stage)).forEach(i => {
      const pending = (i.channels || []).filter(c => i.listings?.[c.id]?.status !== 'done' || i.listings[c.id].needsUpdate);
      if (!pending.length) return;
      const outdated = pending.some(c => i.listings?.[c.id]?.needsUpdate);
      push('queue', i.id, `${outdated ? 'Atualizar o anúncio de' : 'Colocar à venda:'} ${i.productSnapshot.name}`, `Falta em: ${pending.map(c => c.name).join(', ')}.`, `fila/${i.id}`, outdated ? 'Atualizar' : 'Colocar à venda');
    });
  }
  // Pedidos do site esperando a equipe da loja.
  if (['owner', 'manager', 'site'].includes(user.role)) {
    orders.filter(o => o.status === 'pago').forEach(o => push('orders', o.id, `Separar o pedido de ${o.customer?.name || 'um cliente'}`, `Pedido ${o.number}, já pago · ${items(o.items?.length || 0)}.`, `pedidos/${o.id}`, 'Ver o pedido'));
    orders.filter(o => o.status === 'separando').forEach(o => {
      const pickup = o.delivery?.method === 'retirada';
      push('orders', o.id, pickup ? `Avisar ${o.customer?.name || 'o cliente'} que pode retirar` : `Enviar o pedido de ${o.customer?.name || 'um cliente'}`, `Pedido ${o.number} · ${pickup ? 'vai buscar na loja' : 'entrega em casa'}.`, `pedidos/${o.id}`, 'Ver o pedido');
    });
  }
  if (user.role === 'marketing') {
    arts.filter(a => ['requested', 'in_progress', 'changes'].includes(a.status)).forEach(a => push('arts', a.id, `${a.status === 'changes' ? 'Corrigir' : 'Fazer'} a arte “${a.title}”`, `Pedida por ${a.createdBy?.name || 'alguém da equipe'}${a.deadline ? ` · prazo ${br(a.deadline)}` : ''}.`, `artes/${a.id}`, 'Ver o pedido'));
    arts.filter(a => a.status === 'approved').forEach(a => push('arts', a.id, `Avisar onde a arte “${a.title}” foi publicada`, 'A arte foi aprovada. Depois de postar, marque onde saiu.', `artes/${a.id}`, 'Marcar'));
  }
  // Próximos 60 dias: campanhas e promoções que começam ou estão rolando.
  const horizon = new Date(Date.parse(today + 'T12:00:00Z') + 60 * 86400_000).toISOString().slice(0, 10);
  const upcoming = [
    ...campaigns.filter(c => !['cancelled', 'done'].includes(c.status) && c.end >= today && c.start <= horizon)
      .map(c => ({ kind: 'campaign', id: c.id, name: c.name, start: c.start, end: c.end, status: c.status, route: `campanhas/${c.id}` })),
    ...promotions.filter(p => p.status !== 'cancelled' && p.end >= today && p.start <= horizon)
      .map(p => ({ kind: 'promotion', id: p.id, name: p.name, start: p.start, end: p.end, status: p.status, route: `promocoes/${p.id}` }))
  ].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 8);

  const lateArts = arts.filter(a => !['approved', 'published'].includes(a.status) && a.deadline && a.deadline < today);
  return {
    today,
    pipeline,
    upcoming,
    todo: todo.slice(0, 30),
    counts: {
      products: productCount,
      queueOpen: queue.filter(i => !['published', 'archived'].includes(i.stage)).length,
      published: queue.filter(i => i.stage === 'published').length,
      campaignsRunning: campaigns.filter(c => c.status === 'running').length,
      promotionsLive: promotions.filter(p => promotionPhase(p, today)?.key === 'active').length,
      artsOpen: arts.filter(a => !['published'].includes(a.status)).length,
      artsLate: lateArts.length,
      leadsOpen: leads.filter(l => !['won', 'lost'].includes(l.status)).length
    },
    integrations: integrations.map(({ id, name, status, lastSyncAt, lastError }) => ({ id, name, status, lastSyncAt, lastError })),
    recent: ['owner', 'manager'].includes(user.role) ? await listAudit({ limit: 8 }) : []
  };
}
