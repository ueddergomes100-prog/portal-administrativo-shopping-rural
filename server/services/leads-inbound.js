// Entrada automática de leads:
// 1) Webhook genérico POST /api/leads/inbound — para formulário do site (via servidor), robô de WhatsApp,
//    Zapier/Make etc. Autenticado por LEADS_WEBHOOK_TOKEN.
// 2) Importação dos formulários do Meta Lead Ads.
// Se o contato já existe (mesmo telefone ou e-mail, ainda em aberto), vira comentário no lead existente.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { clean, badRequest } from '../http.js';
import { setIntegrationState } from './integrations.js';
import { fetchMetaLeads } from '../integrations/analytics.js';
import { LEAD_SOURCES } from '../../public/shared/domain.js';

const SYSTEM = { id: 'inbound', name: 'Entrada automática', role: 'system' };
const now = () => new Date().toISOString();
const digits = value => String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

async function findOpenLead({ email, phone }) {
  const open = (await getStore().list(C.leads)).filter(l => !['won', 'lost'].includes(l.status));
  return open.find(l => (phone && digits(l.phone) === digits(phone)) || (email && l.email && l.email === email)) || null;
}

async function campaignIdFrom(value) {
  if (!value) return '';
  const campaigns = await getStore().list(C.campaigns);
  const text = String(value).trim().toLowerCase();
  return campaigns.find(c => c.id === value || c.name.trim().toLowerCase() === text)?.id || '';
}

export async function receiveLead(input, { source: defaultSource = 'Site', externalId = '' } = {}) {
  const store = getStore();
  const name = clean.text(input.name || input.nome, { max: 120, label: 'Nome' }) || 'Contato sem nome';
  const email = clean.email(input.email);
  const phone = clean.text(input.phone || input.telefone || input.whatsapp, { max: 40, label: 'Telefone' });
  if (!email && !phone) throw badRequest('Envie ao menos telefone ou e-mail do contato.');
  const source = LEAD_SOURCES.includes(input.source) ? input.source : defaultSource;
  const message = clean.text(input.message || input.mensagem || input.interest, { max: 3000, label: 'Mensagem' });
  const utm = ['utm_source', 'utm_medium', 'utm_campaign'].map(k => input[k] ? `${k}=${String(input[k]).slice(0, 80)}` : '').filter(Boolean).join(' · ');

  if (externalId && (await store.get(C.leads, externalId))) return { duplicate: true, id: externalId };

  const existing = await findOpenLead({ email, phone });
  if (existing) {
    const note = { text: `Novo contato (${source})${message ? `: ${message}` : ''}${utm ? ` [${utm}]` : ''}`, at: now(), by: SYSTEM.name };
    await store.update(C.leads, existing.id, { notes: [...(existing.notes || []), note].slice(-200), updatedAt: now() });
    return { merged: true, id: existing.id };
  }

  const lead = {
    name, email, phone, source,
    campaignId: await campaignIdFrom(input.campaignId || input.campaign || input.utm_campaign),
    assigneeId: '', value: null, status: 'new',
    interest: [message, utm].filter(Boolean).join('\n'),
    createdBy: { id: SYSTEM.id, name: SYSTEM.name },
    createdAt: input.createdAt || now(), updatedAt: now(), updatedBy: SYSTEM.id, notes: []
  };
  const saved = externalId ? await store.set(C.leads, externalId, lead) : await store.create(C.leads, lead);
  await audit(SYSTEM, { action: 'leads.inbound', entity: 'leads', entityId: saved.id, summary: `Lead recebido (${source}): ${name}` });
  await setIntegrationState('leads', { status: 'connected', lastSyncAt: now(), lastError: '' });
  return { created: true, id: saved.id };
}

export async function importMetaLeads(actor) {
  const state = await getStore().get(C.integrations, 'metaleads');
  const leads = await fetchMetaLeads({ since: state?.lastSyncAt });
  let created = 0;
  for (const lead of leads) {
    const result = await receiveLead({ ...lead, campaign: lead.campaignName, message: lead.adName ? `Anúncio: ${lead.adName}` : '' }, { source: 'Meta Ads', externalId: `meta-${lead.externalId}` });
    if (result.created) created++;
  }
  await setIntegrationState('metaleads', { lastSyncAt: now() });
  if (actor) await audit(actor, { action: 'leads.import_meta', entity: 'leads', summary: `Importou ${created} lead(s) do Meta` });
  return { received: leads.length, created };
}
