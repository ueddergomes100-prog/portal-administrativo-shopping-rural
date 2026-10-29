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
    queue.filter(i => i.stage === 'approved').forEach(i => {
      const pending = (i.channels || []).filter(c => i.listings?.[c.id]?.status !== 'done').map(c => c.name);
      const failed = Object.values(i.listings || {}).some(l => l.status === 'failed');
      push('queue', i.id, `Publicar: ${i.productSnapshot.name}`, failed ? 'Última tentativa falhou' : `Falta: ${pending.join(', ')}`, `fila/${i.id}`);
    });
  }
  if (user.role === 'marketing') {
    arts.filter(a => ['requested', 'in_progress', 'changes'].includes(a.status)).forEach(a => push('arts', a.id, `Criar arte: ${a.title}`, `Prazo ${br(a.deadline)}`, `artes/${a.id}`));
    arts.filter(a => a.status === 'approved').forEach(a => push('arts', a.id, `Registrar publicação: ${a.title}`, 'Arte aprovada', `artes/${a.id}`));
  }
  if (user.role === 'owner') {
    queue.filter(i => i.stage === 'approved' && Object.values(i.listings || {}).some(l => l.status === 'failed')).forEach(i => {
      const failed = Object.entries(i.listings).find(([, l]) => l.status === 'failed');
      push('queue', i.id, `Falha na publicação: ${i.productSnapshot.name}`, failed[1].lastError, `fila/${i.id}`);
    });
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
