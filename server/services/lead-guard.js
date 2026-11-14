// Filtro de robôs nos contatos que chegam sozinhos (site, newsletter, aviso de reposição, webhook).
//
// Duas camadas:
// 1. Sinais do formulário do site (`antiBot`): campo-armadilha preenchido (pessoa não vê, robô preenche)
//    ou envio rápido demais → é robô com certeza: o portal descarta sem guardar.
// 2. Cara de robô no próprio contato → entra como "Suspeito (robô)", fora da lista principal e das contas
//    do Início; a equipe confere na aba Suspeitos e, se for gente, um clique devolve para "Novo".
//
// Os sinais de "cara de robô" são conservadores: nome/e-mail de gente de verdade quase nunca batem.

// E-mail descartável (caixas temporárias usadas por robôs e para fugir de cadastro).
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net',
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'yopmail.com', 'yopmail.net', 'trashmail.com', 'getnada.com',
  'nada.email', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com',
  'mail.tm', 'tmail.ws', 'tmpmail.org', 'spamgourmet.com', 'mytemp.email', 'moakt.com', 'burnermail.io', 'inboxkitten.com'
]);
const GMAIL = new Set(['gmail.com', 'googlemail.com']);

// "ape.pol.ex.o.35@gmail.com": Gmail ignora os pontos, então robôs picotam o mesmo endereço em pedaços
// de 1 a 3 letras para parecer outro. Gente de verdade usa no máximo 1 ou 2 pontos, com pedaços maiores.
export function dottedGmail(email) {
  const [local = '', domain = ''] = String(email || '').toLowerCase().split('@');
  if (!GMAIL.has(domain)) return false;
  const parts = local.split('.').filter(Boolean);
  if (parts.length < 4) return false;
  const short = parts.filter(p => p.length <= 3).length;
  return short >= 3 && short / parts.length >= 0.6;
}

const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const HAS_URL = /(https?:\/\/|www\.)\S+/i;
const FOREIGN_SCRIPT = /[Ѐ-ӿ֐-׿؀-ۿ฀-๿぀-ヿ一-鿿가-힯]/;

// Motivos (em português) para o contato parecer robô. Vazio = parece gente.
export function botReasons({ name = '', email = '', message = '' } = {}) {
  const reasons = [];
  const domain = String(email).toLowerCase().split('@')[1] || '';
  if (dottedGmail(email)) reasons.push('E-mail do Gmail picotado com pontos (truque comum de robô)');
  if (DISPOSABLE.has(domain)) reasons.push(`E-mail descartável (${domain})`);
  const links = String(message).match(URL_RE) || [];
  if (links.length >= 2) reasons.push(`Mensagem com ${links.length} links`);
  if (HAS_URL.test(name)) reasons.push('Link no lugar do nome');
  if (FOREIGN_SCRIPT.test(`${name} ${message}`)) reasons.push('Texto em alfabeto estrangeiro');
  return reasons;
}

// Sinais do formulário. honeypot: o campo escondido; elapsedMs: tempo entre abrir e enviar o formulário.
export const MIN_FILL_MS = 2500;
export function trapped(antiBot) {
  if (!antiBot || typeof antiBot !== 'object') return '';
  if (String(antiBot.honeypot ?? '').trim()) return 'campo-armadilha preenchido';
  const ms = Number(antiBot.elapsedMs);
  if (Number.isFinite(ms) && ms >= 0 && ms < MIN_FILL_MS) return `enviado em ${Math.round(ms)} ms`;
  return '';
}
