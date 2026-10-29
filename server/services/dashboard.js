// Visão geral: o que precisa da atenção de cada papel agora.
import { getStore, C } from '../store/index.js';
import { listIntegrations } from './integrations.js';
import { listAudit } from '../audit.js';
import { canApprove, promotionPhase, todayInSaoPaulo, QUEUE_STAGES } from '../../public/shared/domain.js';

// AAAA-MM-DD -> DD/MM/AAAA para textos prontos da lista "Sua vez".
const br = iso => (iso ? iso.split('-').reverse().join('/') : '—');

export async function dashboard(user) {
  const store = getStore();
  const [queue, campaigns, promotions, arts, leads, integrations, productCount] = await Promise.all([
    store.list(C.queue), store.list(C.campaigns), store.list(C.promotions), store.list(C.arts), store.list(C.leads),
    listIntegrations(), store.count(C.products)
  ]);
  const today = todayInSaoPaulo();
  const approver = canApprove(user);

  const pipeline = Object.keys(QUEUE_STAGES).map(stage => ({ stage, count: queue.filter(i => i.stage === stage).length }));
  const todo = [];
  const push = (kind, id, title, detail, route) => todo.push({ kind, id, title, detail, route });

  if (approver) {
    queue.filter(i => i.stage === 'review').forEach(i => push('queue', i.id, `Aprovar publicação: ${i.productSnapshot.name}`, 'Conteúdo pronto pelo site', `fila/${i.id}`));
    arts.filter(a => a.status === 'awaiting_approval').forEach(a => push('arts', a.id, `Aprovar arte: ${a.title}`, `Prazo ${br(a.deadline)}`, `artes/${a.id}`));
    campaigns.filter(c => c.status === 'awaiting_approval').forEach(c => push('campaigns', c.id, `Aprovar campanha: ${c.name}`, `${br(c.start)} a ${br(c.end)}`, `campanhas/${c.id}`));
    promotions.filter(p => p.status === 'awaiting_approval').forEach(p => push('promotions', p.id, `Aprovar promoção: ${p.name}`, `${p.items.length} produto(s)`, `promocoes/${p.id}`));
  }
  if (user.role === 'site') {
    queue.filter(i => ['selected', 'preparing'].includes(i.stage)).forEach(i => push('queue', i.id, `Preparar: ${i.productSnapshot.name}`, QUEUE_STAGES[i.stage].label, `fila/${i.id}`));
    queue.filter(i => i.stage === 'approved').forEach(i => push('queue', i.id, `Publicar: ${i.productSnapshot.name}`, i.publish?.lastError ? 'Última tentativa falhou' : 'Aprovado', `fila/${i.id}`));
  }
  if (user.role === 'marketing') {
    arts.filter(a => ['requested', 'in_progress', 'changes'].includes(a.status)).forEach(a => push('arts', a.id, `Criar arte: ${a.title}`, `Prazo ${br(a.deadline)}`, `artes/${a.id}`));
    arts.filter(a => a.status === 'approved').forEach(a => push('arts', a.id, `Registrar publicação: ${a.title}`, 'Arte aprovada', `artes/${a.id}`));
  }
  if (user.role === 'owner') {
    queue.filter(i => i.stage === 'approved' && i.publish?.status === 'failed').forEach(i => push('queue', i.id, `Falha na publicação: ${i.productSnapshot.name}`, i.publish.lastError, `fila/${i.id}`));
  }

  const lateArts = arts.filter(a => !['approved', 'published'].includes(a.status) && a.deadline && a.deadline < today);
  return {
    today,
    pipeline,
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
