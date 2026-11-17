// Service worker só dos avisos no celular (push). Não guarda páginas nem mexe no carregamento do portal:
// mostra o aviso que chega do servidor (server/services/push.js) e, ao tocar, abre a tela certa.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { data: { title: 'Shopping Rural', body: event.data ? event.data.text() : '' } };
  }
  // O Firebase entrega os campos em `data`; aceita também o formato com `notification`.
  const data = payload.data || payload;
  const extra = payload.notification || {};
  const title = data.title || extra.title || 'Shopping Rural';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || extra.body || '',
    icon: '/assets/icon-512.png',
    badge: '/assets/icon-180.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/#/inicio' }
  }));
});

// Tocou no aviso: usa o portal que já está aberto (só troca a tela) ou abre um novo.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#/inicio', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
