// Ajustes › Campanha do site: Black Friday, Natal e Ano Novo. Cada tema tem a sua janela; o site mostra
// só a que vale agora (topo com título e frase, produtos em destaque, aviso de oferta ao abrir e contagem).
// Os preços com desconto vêm das Promoções aprovadas — aqui é só a parte visual.
// Enquanto a pessoa mexe, a tela (DOM) é a fonte da verdade; `readForm` lê tudo na hora de salvar.
import { get, api } from '../api.js';
import { esc, icon, money, pageHead, button, toast, notice, tag } from '../ui.js';

const THEMES = [
  ['black-friday', 'Black Friday', 'Oferta imperdível'],
  ['natal', 'Natal', 'Presente de Natal'],
  ['ano-novo', 'Ano Novo', 'Comece o ano economizando']
];
const MAX_HERO = 6;
const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const local = iso => (iso ? iso.slice(0, 16) : '');
const brDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} às ${iso.slice(11, 16)}` : '');
const ms = value => (value ? Date.parse(value.length === 16 ? `${value}:00-03:00` : value) : null);

let products = [];
const bySku = sku => products.find(p => p.sku === sku);
const bestDeal = () => [...products].filter(p => p.compareAt).sort((a, b) => b.discount - a.discount)[0] || null;
const productLine = p => `${p.name} — ${money(p.price)}${p.discount ? ` (−${p.discount}%)` : ''}`;

function statusOf(c, live) {
  if (live === c.theme) return tag('Aparecendo no site agora', 'ok');
  if (!c.enabled) return tag('Desligada', 'neutral');
  if (c.endsAt && ms(c.endsAt) <= Date.now()) return tag('Já acabou', 'neutral');
  return tag(`Agendada${c.startsAt ? ` para ${brDate(c.startsAt)}` : ''}`, 'warn');
}

function heroChip(sku) {
  const p = bySku(sku);
  return `<li class="ship-chip" data-hero-sku="${esc(sku)}">
    <span>${esc(p ? p.name : `Código ${sku}`)}${p?.discount ? ` <small>−${p.discount}%</small>` : ''}</span>
    <button type="button" class="ship-chip-x" data-action="hero-remove" aria-label="Tirar ${esc(p?.name || sku)} dos destaques" title="Tirar dos destaques">${icon('close')}</button>
  </li>`;
}

function panel(theme, name, popupDefault, c, live) {
  const id = `camp-${theme}`;
  const options = [...products].sort((a, b) => b.discount - a.discount || a.name.localeCompare(b.name, 'pt-BR'));
  return `<details class="panel camp" data-theme="${theme}"${c.enabled || theme === 'black-friday' ? ' open' : ''}>
    <summary><h2>${esc(name)}</h2>${statusOf(c, live)}</summary>
    <div class="camp-body">
      <label class="check big-check"><input type="checkbox" data-k="enabled" data-input="camp-preview"${c.enabled ? ' checked' : ''}><span>Mostrar a campanha de ${esc(name)} no site</span></label>
      <div class="form-grid">
        <div class="field"><label for="${id}-start">Começa</label><input id="${id}-start" type="datetime-local" data-k="startsAt" data-input="camp-preview" value="${esc(local(c.startsAt))}"><small class="hint">Em branco: começa assim que você salvar.</small></div>
        <div class="field"><label for="${id}-end">Termina</label><input id="${id}-end" type="datetime-local" data-k="endsAt" data-input="camp-preview" value="${esc(local(c.endsAt))}"><small class="hint">O site mostra a contagem até aqui.</small></div>
        <div class="field"><label for="${id}-title">Título do topo</label><input id="${id}-title" data-k="title" data-input="camp-preview" maxlength="40" value="${esc(c.title || '')}" placeholder="${esc(name)}"></div>
        <div class="field"><label for="${id}-sub">Frase do topo</label><input id="${id}-sub" data-k="subtitle" data-input="camp-preview" maxlength="120" value="${esc(c.subtitle || '')}" placeholder="Em branco: o site escreve sozinho"></div>
      </div>

      <fieldset class="ship-block">
        <legend>Produtos em destaque no topo (até ${MAX_HERO})</legend>
        <ul class="ship-chips" data-hero>${(c.heroSkus || []).map(heroChip).join('')}</ul>
        <p class="hint" data-hero-empty${c.heroSkus?.length ? ' hidden' : ''}>Nenhum escolhido: o site mostra os de maior desconto.</p>
        <div class="field"><label for="${id}-find">Procurar produto do site</label><input id="${id}-find" data-input="hero-search" autocomplete="off" placeholder="Nome ou código"></div>
        <ul class="camp-results" data-hero-results></ul>
      </fieldset>

      <fieldset class="ship-block">
        <legend>Aviso de oferta ao abrir o site</legend>
        <label class="check big-check"><input type="checkbox" data-k="popupEnabled" data-input="camp-preview"${c.popup?.enabled !== false ? ' checked' : ''}><span>Mostrar o aviso toda vez que alguém abrir a página inicial do site</span></label>
        <div class="form-grid">
          <div class="field full"><label for="${id}-psku">Produto do aviso</label><select id="${id}-psku" data-k="popupSku" data-input="camp-preview">
            <option value="">Automático: o produto com maior desconto</option>
            ${options.map(p => `<option value="${esc(p.sku)}"${p.sku === c.popup?.sku ? ' selected' : ''}>${esc(productLine(p))}</option>`).join('')}
          </select></div>
          <div class="field"><label for="${id}-ptitle">Título do aviso</label><input id="${id}-ptitle" data-k="popupTitle" data-input="camp-preview" maxlength="60" value="${esc(c.popup?.title || '')}" placeholder="${esc(popupDefault)}"></div>
          <div class="field"><label for="${id}-ptext">Texto do aviso</label><textarea id="${id}-ptext" data-k="popupText" data-input="camp-preview" maxlength="200" rows="2" placeholder="Ex.: Só até domingo ou enquanto durar o estoque.">${esc(c.popup?.text || '')}</textarea></div>
        </div>
      </fieldset>

      <div class="camp-preview-wrap">
        <p class="ship-sub">Prévia do aviso</p>
        <div class="camp-preview" data-preview aria-live="polite">${preview(readCampaignFrom(null, c), name, popupDefault)}</div>
      </div>
    </div>
  </details>`;
}

// Prévia simples do aviso, com o mesmo produto que o site vai escolher.
function preview(c, name, popupDefault) {
  if (!c.popupEnabled) return '<p class="muted">O aviso está desligado para este tema.</p>';
  const p = c.popupSku ? bySku(c.popupSku) : bestDeal();
  if (!p) return '<p class="muted">Nenhum produto em promoção no site ainda. Crie a promoção em Promoções para o aviso ter o que mostrar.</p>';
  const end = ms(c.endsAt);
  const left = end ? end - Date.now() : null;
  const countdown = left == null ? '' : left <= 0 ? 'Já acabou' : left > 86_400_000 ? `Termina em ${Math.ceil(left / 86_400_000)} dias` : `Termina em ${Math.max(1, Math.round(left / 3_600_000))} horas`;
  return `<div class="camp-pop">
    <span class="camp-pop-badge">${esc(c.title || name)}</span>
    <strong class="camp-pop-title">${esc(c.popupTitle || popupDefault)}</strong>
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
    <span class="camp-pop-name">${esc(p.name)}</span>
    <span class="camp-pop-price">${p.compareAt ? `<s>${money(p.compareAt)}</s> ` : ''}<b>${money(p.price)}</b>${p.discount ? ` <em>−${p.discount}%</em>` : ''}</span>
    ${c.popupText ? `<span class="camp-pop-text">${esc(c.popupText)}</span>` : ''}
    ${countdown ? `<span class="camp-pop-count">${esc(countdown)}</span>` : ''}
  </div>
  ${p.compareAt ? '' : notice('Este produto não está em promoção agora: no site ele aparece sem desconto.', 'warn')}`;
}

// Lê um painel da tela (ou, sem painel, uma campanha salva) no formato da prévia.
function readCampaignFrom(el, saved) {
  if (!el) {
    return { enabled: saved.enabled, startsAt: saved.startsAt, endsAt: saved.endsAt, title: saved.title, subtitle: saved.subtitle,
      popupEnabled: saved.popup?.enabled !== false, popupSku: saved.popup?.sku || '', popupTitle: saved.popup?.title || '', popupText: saved.popup?.text || '' };
  }
  const k = name => el.querySelector(`[data-k="${name}"]`);
  return {
    enabled: k('enabled').checked, startsAt: k('startsAt').value, endsAt: k('endsAt').value,
    title: k('title').value.trim(), subtitle: k('subtitle').value.trim(),
    popupEnabled: k('popupEnabled').checked, popupSku: k('popupSku').value, popupTitle: k('popupTitle').value.trim(), popupText: k('popupText').value.trim()
  };
}

function readForm() {
  const items = {};
  for (const el of document.querySelectorAll('[data-theme]')) {
    const c = readCampaignFrom(el);
    items[el.dataset.theme] = {
      enabled: c.enabled, startsAt: c.startsAt, endsAt: c.endsAt, title: c.title, subtitle: c.subtitle,
      heroSkus: [...el.querySelectorAll('[data-hero-sku]')].map(li => li.dataset.heroSku),
      popup: { enabled: c.popupEnabled, sku: c.popupSku, title: c.popupTitle, text: c.popupText }
    };
  }
  return { items };
}

const themeOf = el => el.closest('[data-theme]');
const themeInfo = theme => THEMES.find(t => t[0] === theme);
function refreshPreview(el) {
  const [, name, popupDefault] = themeInfo(el.dataset.theme);
  el.querySelector('[data-preview]').innerHTML = preview(readCampaignFrom(el), name, popupDefault);
}

export default {
  id: 'campanha-site',
  title: 'Campanha do site',
  icon: 'campaign',
  roles: ['owner', 'manager', 'marketing'],

  async load() {
    const data = await get('/settings/campaign');
    products = data.products;
    return data;
  },

  render({ data }) {
    const live = THEMES.find(t => t[0] === data.live);
    return `${pageHead({
      title: 'Campanha do site',
      lead: 'Black Friday, Natal e Ano Novo no site: o topo, os produtos em destaque e o aviso de oferta que aparece ao abrir o site.',
      actions: button('Salvar campanha', { action: 'save', icon: 'check', variant: 'primary' })
    })}
    ${notice(live ? `<strong>Agora no site:</strong> ${esc(live[1])}.` : 'Nenhuma campanha aparecendo no site agora.', live ? 'ok' : 'info')}
    ${notice('Os <strong>preços com desconto</strong> vêm das <a href="#/promocoes">Promoções</a> aprovadas. Crie a promoção com as mesmas datas da campanha; aqui você escolhe só o que aparece no site.', 'info')}
    ${!data.saved ? notice('Enquanto nada for salvo aqui, o site liga a Black Friday sozinho quando há produtos em promoção em novembro. Depois de salvar, vale o que estiver nesta tela.', 'warn') : ''}
    <div class="camp-list">${THEMES.map(([theme, name, popupDefault]) => panel(theme, name, popupDefault, data.items[theme], data.live)).join('')}</div>`;
  },

  actions: {
    'hero-add'(ctx, el) {
      const box = themeOf(el);
      const list = box.querySelector('[data-hero]');
      if (list.children.length >= MAX_HERO) return toast(`No máximo ${MAX_HERO} produtos em destaque. Tire um antes.`, 'warn');
      if (list.querySelector(`[data-hero-sku="${CSS.escape(el.dataset.sku)}"]`)) return toast('Este produto já está nos destaques.', 'warn');
      list.insertAdjacentHTML('beforeend', heroChip(el.dataset.sku));
      box.querySelector('[data-hero-empty]').hidden = true;
      el.closest('li').remove();
    },
    'hero-remove'(ctx, el) {
      const box = themeOf(el);
      el.closest('[data-hero-sku]').remove();
      box.querySelector('[data-hero-empty]').hidden = !!box.querySelector('[data-hero-sku]');
    },
    async save(ctx) {
      const result = await api('/settings/campaign', { method: 'PUT', body: readForm() });
      const live = themeInfo(result.live);
      toast(`Campanha salva.${live ? ` ${live[1]} aparece no site em até 1 minuto.` : ''}`);
      await ctx.refresh();
    }
  },

  inputs: {
    'camp-preview'(ctx, el) { refreshPreview(themeOf(el)); },
    'hero-search'(ctx, el) {
      const box = themeOf(el);
      const out = box.querySelector('[data-hero-results]');
      const terms = norm(el.value).split(/\s+/).filter(Boolean);
      if (!terms.length) { out.innerHTML = ''; return; }
      const chosen = new Set([...box.querySelectorAll('[data-hero-sku]')].map(li => li.dataset.heroSku));
      const found = products.filter(p => !chosen.has(p.sku) && terms.every(t => norm(`${p.sku} ${p.name}`).includes(t)))
        .sort((a, b) => b.discount - a.discount || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 8);
      out.innerHTML = found.length
        ? found.map(p => `<li><button type="button" class="camp-result" data-action="hero-add" data-sku="${esc(p.sku)}">${icon('plus')}<span>${esc(productLine(p))}</span></button></li>`).join('')
        : '<li class="muted">Nenhum produto do site com esse nome.</li>';
    }
  }
};
