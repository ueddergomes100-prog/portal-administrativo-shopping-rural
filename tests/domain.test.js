// Regras de domínio compartilhadas (public/shared/domain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEUE_TRANSITIONS, ART_TRANSITIONS, availableTransitions, findTransition, canApprove, promotionPhase, todayInSaoPaulo
} from '../public/shared/domain.js';

const owner = { role: 'owner' };
const managerApprover = { role: 'manager', canApprove: true };
const manager = { role: 'manager', canApprove: false };
const site = { role: 'site' };
const marketing = { role: 'marketing' };

test('só dono e gerente autorizado aprovam', () => {
  assert.equal(canApprove(owner), true);
  assert.equal(canApprove(managerApprover), true);
  assert.equal(canApprove(manager), false);
  assert.equal(canApprove(site), false);
});

test('fila: site envia para aprovação, aprovador aprova', () => {
  assert.deepEqual(availableTransitions(QUEUE_TRANSITIONS, 'preparing', site).map(t => t.to), ['review']);
  assert.ok(availableTransitions(QUEUE_TRANSITIONS, 'review', owner).some(t => t.to === 'approved'));
  assert.ok(!availableTransitions(QUEUE_TRANSITIONS, 'review', manager).some(t => t.to === 'approved'));
  assert.ok(!availableTransitions(QUEUE_TRANSITIONS, 'review', site).some(t => t.to === 'approved'));
});

test('fila: "publicado" nunca é uma transição manual', () => {
  for (const stage of ['selected', 'preparing', 'review', 'approved']) {
    assert.equal(findTransition(QUEUE_TRANSITIONS, stage, 'published'), null);
  }
});

test('arte: marketing entrega, aprovador aprova, marketing registra publicação', () => {
  assert.ok(availableTransitions(ART_TRANSITIONS, 'in_progress', marketing).some(t => t.to === 'awaiting_approval'));
  assert.ok(!availableTransitions(ART_TRANSITIONS, 'awaiting_approval', marketing).some(t => t.to === 'approved'));
  assert.equal(findTransition(ART_TRANSITIONS, 'approved', 'published').requires, 'channels');
});

test('fase da promoção aprovada segue as datas', () => {
  const promo = { status: 'approved', start: '2026-11-01', end: '2026-11-10' };
  assert.equal(promotionPhase(promo, '2026-10-31').key, 'scheduled');
  assert.equal(promotionPhase(promo, '2026-11-05').key, 'active');
  assert.equal(promotionPhase(promo, '2026-11-11').key, 'ended');
  assert.equal(promotionPhase({ ...promo, status: 'draft' }, '2026-11-05'), null);
});

test('data de hoje usa o fuso de São Paulo', () => {
  // 02:00 UTC de 1º/jan ainda é 31/dez em São Paulo (UTC-3).
  assert.equal(todayInSaoPaulo(new Date('2026-01-01T02:00:00Z')), '2025-12-31');
});
