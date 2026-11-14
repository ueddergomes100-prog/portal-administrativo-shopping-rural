// Filtro de robôs nos contatos que chegam sozinhos: cara de robô vai para "Suspeito (robô)";
// campo-armadilha ou envio instantâneo é descartado sem guardar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-bot-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { dottedGmail, botReasons } = await import('../server/services/lead-guard.js');
const { siteNewsletter, siteContact } = await import('../server/services/store.js');
const { recheckLeads } = await import('../server/services/leads-inbound.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner' };
const leads = () => getStore().list(C.leads);

test('cara de robô: Gmail picotado, e-mail descartável, links, alfabeto estrangeiro', () => {
  assert.equal(dottedGmail('ape.pol.ex.o.35@gmail.com'), true);
  assert.equal(dottedGmail('uqu.deho.p.u.f.13@gmail.com'), true);
  // Gente de verdade.
  for (const email of ['joao.silva@gmail.com', 'maria.de.lourdes.santos@gmail.com', 'ana.p.souza@gmail.com', 'z.e.c.a@hotmail.com', 'carlos1985@gmail.com']) {
    assert.equal(dottedGmail(email), false, email);
  }
  assert.match(botReasons({ email: 'x@mailinator.com' }).join(), /descartável/);
  assert.match(botReasons({ email: 'a@b.com', message: 'veja http://a.com e https://b.com' }).join(), /2 links/);
  assert.match(botReasons({ name: 'Иван', email: 'a@b.com' }).join(), /alfabeto estrangeiro/);
  assert.deepEqual(botReasons({ name: 'Maria', email: 'maria@gmail.com', message: 'Tem ração Golden 15 kg? Veja www.loja.com' }), []);
});

test('newsletter e contato do site: robô vai para Suspeitos, gente vai para Novo, armadilha é descartada', async () => {
  const bot = await siteNewsletter({ email: 'ape.pol.ex.o.35@gmail.com' });
  assert.equal(bot.suspect, true);
  const human = await siteNewsletter({ email: 'cliente.real@gmail.com', antiBot: { honeypot: '', elapsedMs: 8000 } });
  assert.ok(human.created && !human.suspect);

  assert.deepEqual(await siteNewsletter({ email: 'outro@gmail.com', antiBot: { honeypot: 'http://spam', elapsedMs: 9000 } }), { ignored: true });
  assert.deepEqual(await siteContact({ name: 'Rapidinho', email: 'rapido@gmail.com', message: 'oi', antiBot: { honeypot: '', elapsedMs: 600 } }), { ignored: true });

  const all = await leads();
  assert.equal(all.length, 2);
  const spam = all.find(l => l.email === 'ape.pol.ex.o.35@gmail.com');
  assert.equal(spam.status, 'spam');
  assert.match(spam.botReasons[0], /picotado/);
  assert.equal(all.find(l => l.email === 'cliente.real@gmail.com').status, 'new');

  // Gente que assina de novo: vira comentário no contato que já existe (não duplica).
  await siteNewsletter({ email: 'cliente.real@gmail.com' });
  assert.equal((await leads()).length, 2);
});

test('"Procurar robôs" separa os novos que chegaram sozinhos; não mexe no que a equipe anotou', async () => {
  const store = getStore();
  const inbound = { id: 'inbound', name: 'Entrada automática' };
  await store.create(C.leads, { name: 'Newsletter', email: 'uqu.deho.p.u.f.13@gmail.com', source: 'Site', status: 'new', interest: 'Assinou a newsletter do site', createdBy: inbound, notes: [] });
  await store.create(C.leads, { name: 'Pessoa da equipe', email: 'a.b.c.d@gmail.com', source: 'WhatsApp', status: 'new', interest: '', createdBy: { id: 'dono', name: 'Dono' }, notes: [] });
  const result = await recheckLeads(owner);
  assert.equal(result.moved, 1);
  const after = await leads();
  assert.equal(after.find(l => l.email === 'uqu.deho.p.u.f.13@gmail.com').status, 'spam');
  assert.equal(after.find(l => l.email === 'a.b.c.d@gmail.com').status, 'new');
  await assert.rejects(() => recheckLeads({ ...owner, role: 'marketing' }), /dono ou o gerente/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
