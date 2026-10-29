// Utilitários HTTP compartilhados pelo servidor local (server.js) e pela função da Vercel (api/index.js).

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Entre com seu e-mail e senha para continuar.') => new HttpError(401, message);
export const forbidden = (message = 'Seu papel não permite esta ação.') => new HttpError(403, message);
export const notFound = (message = 'Registro não encontrado.') => new HttpError(404, message);
export const conflict = message => new HttpError(409, message);

export function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req, limit = 1_000_000) {
  // A Vercel já entrega o corpo interpretado em req.body.
  if (req.body !== undefined && typeof req.body === 'object' && req.body !== null) return req.body;
  if (typeof req.body === 'string') return parse(req.body);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new HttpError(413, 'Requisição muito grande.');
  }
  return parse(raw);
}

// Corpo cru (webhooks assinados). Não toca em req.body para a Vercel não consumir o fluxo antes.
export async function readRawBody(req, limit = 1_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new HttpError(413, 'Requisição muito grande.');
  }
  return raw;
}

export function parseJson(raw) {
  return parse(raw);
}

function parse(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw badRequest('O corpo da requisição precisa ser um objeto JSON.');
  }
}

// ---------------------------------------------------------------------------
// Validação simples de entrada. Toda escrita passa por aqui antes do banco.
// ---------------------------------------------------------------------------
export const clean = {
  text(value, { max = 500, required = false, label = 'Campo' } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw badRequest(`${label} é obrigatório.`);
    if (text.length > max) throw badRequest(`${label} pode ter no máximo ${max} caracteres.`);
    return text;
  },
  money(value, { required = false, label = 'Valor', allowZero = false } = {}) {
    if (value === '' || value === null || value === undefined) {
      if (required) throw badRequest(`Informe ${label.toLowerCase()}.`);
      return null;
    }
    const number = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0) || number > 10_000_000) {
      throw badRequest(`${label} precisa ser um valor em reais válido.`);
    }
    return number;
  },
  date(value, { required = false, label = 'Data' } = {}) {
    const text = String(value ?? '').trim();
    if (!text) {
      if (required) throw badRequest(`Informe ${label.toLowerCase()}.`);
      return '';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text + 'T12:00:00Z'))) {
      throw badRequest(`${label} precisa estar no formato AAAA-MM-DD.`);
    }
    return text;
  },
  oneOf(value, options, { label = 'Opção', fallback } = {}) {
    if ((value === undefined || value === '') && fallback !== undefined) return fallback;
    if (!options.includes(value)) throw badRequest(`${label} inválido(a).`);
    return value;
  },
  list(value, options, { label = 'Lista', max = 50 } = {}) {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    if (list.length > max) throw badRequest(`${label}: no máximo ${max} itens.`);
    for (const item of list) if (options && !options.includes(item)) throw badRequest(`${label}: "${item}" não é válido.`);
    return [...new Set(list.map(String))];
  },
  ids(value, { label = 'Itens', max = 200 } = {}) {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    if (list.length > max) throw badRequest(`${label}: no máximo ${max} itens.`);
    return [...new Set(list.map(v => String(v).slice(0, 120)).filter(Boolean))];
  },
  email(value, { required = false } = {}) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text && !required) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || text.length > 200) throw badRequest('Informe um e-mail válido.');
    return text;
  },
  // Caminho relativo dentro de media/. Bloqueia ../ e caminhos absolutos.
  mediaRef(value) {
    const text = String(value ?? '').trim().replaceAll('\\', '/');
    if (!text) return '';
    if (text.length > 300 || text.startsWith('/') || /^[a-z]:/i.test(text) || text.split('/').includes('..')) {
      throw badRequest('Use um caminho relativo dentro da pasta media/, por exemplo: produtos/racao-15kg.jpg');
    }
    return text;
  }
};
