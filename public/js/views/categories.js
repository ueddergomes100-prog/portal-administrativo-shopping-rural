// Categorias do site: criar, renomear, mudar a ordem, escolher o ícone e esconder do site.
// Apagar só quando nenhum produto usa; se algum usa, a pessoa escolhe para onde mover os produtos.
import { get, api } from '../api.js';
import { esc, icon, num, pageHead, button, toast, notice } from '../ui.js';
import { CATEGORY_ICONS } from '../../shared/domain.js';

const usageText = u => (u?.total ? `${num(u.total)} produto${u.total === 1 ? '' : 's'}${u.onSite ? ` · ${num(u.onSite)} no site agora` : ''}` : 'Nenhum produto ainda');

function row(c, usage, k) {
  const id = `cat-${k}`;
  const u = usage[c.id];
  return `<li class="cat-row" data-cat data-id="${esc(c.id || '')}" data-used="${u?.total || 0}">
    <div class="cat-order">
      <button type="button" class="btn-icon" data-action="cat-up" aria-label="Subir ${esc(c.name || 'categoria')}" title="Subir">${icon('arrow')}</button>
      <button type="button" class="btn-icon" data-action="cat-down" aria-label="Descer ${esc(c.name || 'categoria')}" title="Descer">${icon('arrow')}</button>
    </div>
    <div class="cat-fields">
      <div class="field"><label for="${id}-name">Nome</label><input id="${id}-name" data-k="name" value="${esc(c.name || '')}" maxlength="40" placeholder="Ex.: Ração para bovinos"></div>
      <div class="field"><label for="${id}-short">Nome curto (menu)</label><input id="${id}-short" data-k="short" value="${esc(c.short || '')}" maxlength="20" placeholder="Ex.: Bovinos"></div>
      <div class="field"><label for="${id}-icon">Ícone no site</label><select id="${id}-icon" data-k="icon">${Object.entries(CATEGORY_ICONS).map(([k, l]) => `<option value="${k}"${k === (c.icon || 'tag') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <label class="check cat-active"><input type="checkbox" data-k="active"${c.active !== false ? ' checked' : ''}><span>Mostrar no site</span></label>
    </div>
    <p class="cat-usage">${esc(usageText(u))}</p>
    <div class="cat-remove" data-remove-slot>${button('Apagar', { action: 'cat-remove', icon: 'trash', variant: 'ghost small danger-text' })}</div>
  </li>`;
}

function readList() {
  const items = [];
  const moves = {};
  for (const li of document.querySelectorAll('[data-cat]')) {
    const val = k => li.querySelector(`[data-k=${k}]`);
    if (li.classList.contains('is-removing')) {
      moves[li.dataset.id] = li.querySelector('[data-move]')?.value || '';
      continue;
    }
    items.push({ id: li.dataset.id || undefined, name: val('name').value.trim(), short: val('short').value.trim(), icon: val('icon').value, active: val('active').checked });
  }
  return { items, moves };
}

export default {
  id: 'categorias',
  title: 'Categorias do site',
  icon: 'tag',
  roles: ['owner', 'manager'],

  load: () => get('/settings/categories'),

  render({ data }) {
    return `${pageHead({
      title: 'Categorias do site',
      lead: 'As categorias que aparecem no menu e na vitrine do site, na ordem desta lista.',
      actions: button('Salvar categorias', { action: 'save', icon: 'check', variant: 'primary' })
    })}
    <section class="panel">
      <ul class="cat-list" id="catList">${data.items.map((c, k) => row(c, data.usage, k)).join('')}</ul>
      ${button('Adicionar categoria', { action: 'cat-add', icon: 'plus', variant: 'ghost' })}
    </section>
    ${notice('Desmarcar “Mostrar no site” esconde a categoria <strong>e os produtos dela</strong> do site, sem apagar nada. Para apagar uma categoria que tem produtos, escolha antes para qual categoria eles vão.', 'info')}
    ${notice('Ícone novo (ave, cavalo, gado, peixe, planta, semente, ferramenta, saco, outros): o site precisa estar preparado para desenhar. Enquanto não estiver, aparece um ícone genérico.', 'info')}`;
  },

  actions: {
    'cat-add'(ctx) {
      const list = document.getElementById('catList');
      list.insertAdjacentHTML('beforeend', row({ active: true, icon: 'tag' }, {}, Date.now()));
      list.lastElementChild.querySelector('[data-k=name]').focus();
    },
    'cat-up'(ctx, el) {
      const li = el.closest('[data-cat]');
      if (li.previousElementSibling) li.parentElement.insertBefore(li, li.previousElementSibling);
      el.focus();
    },
    'cat-down'(ctx, el) {
      const li = el.closest('[data-cat]');
      if (li.nextElementSibling) li.parentElement.insertBefore(li.nextElementSibling, li);
      el.focus();
    },
    'cat-remove'(ctx, el) {
      const li = el.closest('[data-cat]');
      // Categoria nova ou sem produtos: sai da lista na hora (só vale ao salvar).
      if (!li.dataset.id || !Number(li.dataset.used)) { li.remove(); return; }
      const others = [...document.querySelectorAll('[data-cat]')].filter(o => o !== li && !o.classList.contains('is-removing'))
        .map(o => [o.dataset.id, o.querySelector('[data-k=name]').value.trim()]).filter(([id, name]) => id && name);
      li.classList.add('is-removing');
      li.querySelector('[data-remove-slot]').innerHTML = `<div class="field"><label for="move-${esc(li.dataset.id)}">Mover os ${num(li.dataset.used)} produtos para</label>
        <select id="move-${esc(li.dataset.id)}" data-move><option value="">Escolha…</option>${others.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select></div>
        ${button('Não apagar', { action: 'cat-keep', variant: 'ghost small' })}`;
      li.querySelector('[data-move]').focus();
    },
    'cat-keep'(ctx, el) {
      const li = el.closest('[data-cat]');
      li.classList.remove('is-removing');
      li.querySelector('[data-remove-slot]').innerHTML = button('Apagar', { action: 'cat-remove', icon: 'trash', variant: 'ghost small danger-text' });
    },
    async save(ctx) {
      const body = readList();
      const missing = Object.entries(body.moves).filter(([, to]) => !to);
      if (missing.length) return toast('Escolha para qual categoria vão os produtos da categoria que você quer apagar.', 'warn');
      const result = await api('/settings/categories', { method: 'PUT', body });
      ctx.invalidate('categories');
      toast(`Categorias salvas (${num(result.items.length)}).${result.moved ? ` ${num(result.moved)} produto(s) mudaram de categoria.` : ''} O site atualiza em até 1 minuto.`);
      await ctx.refresh();
    }
  }
};
