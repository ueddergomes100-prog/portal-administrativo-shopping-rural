// Melhor Envio: cotação de frete dos Correios e da Jadlog numa chamada só, sem contrato com cada
// transportadora. Doc: https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos
//
// POST /api/v2/me/shipment/calculate com Bearer token e User-Agent "Aplicação (e-mail de contato)".
// A resposta é uma lista de serviços; os indisponíveis para o CEP vêm com `error` e são ignorados.
// Usamos custom_price/custom_delivery_range, que já trazem os ajustes feitos no painel da conta.
import { config } from '../config.js';

export const melhorEnvioReady = () => !!(config.melhorEnvio.token && config.melhorEnvio.contact);

const baseUrl = () => (config.melhorEnvio.sandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br');

const days = (range, time) => {
  const min = Number(range?.min ?? time);
  const max = Number(range?.max ?? time);
  return Number.isFinite(min) && Number.isFinite(max) ? [min, Math.max(min, max)] : null;
};

// products: [{ id, width, height, length (cm, inteiros), weight (kg), insurance_value (R$ por unidade), quantity }]
export async function quoteMelhorEnvio({ from, to, products, services }) {
  if (!melhorEnvioReady()) throw new Error('Melhor Envio não configurado (MELHOR_ENVIO_TOKEN e MELHOR_ENVIO_CONTACT).');
  const response = await fetch(`${baseUrl()}/api/v2/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.melhorEnvio.token}`,
      'User-Agent': `Portal Shopping Rural (${config.melhorEnvio.contact})`
    },
    body: JSON.stringify({
      from: { postal_code: from },
      to: { postal_code: to },
      products,
      options: { receipt: false, own_hand: false },
      ...(services?.length ? { services: services.join(',') } : {})
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Melhor Envio respondeu ${response.status}${text ? `: ${text}` : ''}`);
  }
  const list = await response.json();
  return (Array.isArray(list) ? list : [])
    .filter(s => s && !s.error)
    .map(s => ({
      id: Number(s.id),
      name: String(s.name || ''),
      company: String(s.company?.name || ''),
      price: Number(s.custom_price ?? s.price),
      days: days(s.custom_delivery_range ?? s.delivery_range, s.custom_delivery_time ?? s.delivery_time)
    }))
    .filter(s => Number.isFinite(s.id) && Number.isFinite(s.price) && s.price >= 0);
}
