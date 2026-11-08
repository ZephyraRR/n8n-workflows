import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.mjs';

const triage = (b) => run('ticket-triage', b);

test('empty ticket is rejected', () => {
  assert.equal(triage({}).error, 'subject or body is required');
  assert.equal(triage({ subject: '  ', body: '' }).error, 'subject or body is required');
});

test('security incident is urgent and goes to security', () => {
  const r = triage({ id: 7, subject: 'My account was hacked', body: 'Someone made an unauthorized login and changed my email' });
  assert.deepEqual([r.category, r.priority, r.queue, r.sla_minutes], ['security', 'urgent', 'security', 15]);
  assert.equal(r.id, 7);
});

test('outage for a paying customer is urgent, for a free one high', () => {
  assert.equal(triage({ subject: 'API is down', body: 'we get 503 errors', customer_tier: 'pro' }).priority, 'urgent');
  assert.equal(triage({ subject: 'Site not loading', body: 'timeouts since this morning', customer_tier: 'free' }).priority, 'high');
  assert.equal(triage({ subject: 'Site not loading', body: 'all users see timeouts', customer_tier: 'free' }).priority, 'urgent');
});

test('refund is a normal billing ticket, a chargeback threat is high', () => {
  const a = triage({ subject: 'Refund please', body: 'I bought the wrong plan' });
  assert.deepEqual([a.category, a.priority, a.queue], ['billing', 'normal', 'billing']);
  assert.equal(triage({ subject: 'Charged twice', body: 'I will file a chargeback' }).priority, 'high');
});

test('enterprise tier bumps the priority one step but never past urgent', () => {
  assert.equal(triage({ subject: 'How do I reset my password', body: '', customer_tier: 'enterprise' }).priority, 'high');
  assert.equal(triage({ subject: 'Feature request', body: 'please add dark mode', customer_tier: 'enterprise' }).priority, 'normal');
  assert.equal(triage({ subject: 'We were hacked', body: '', customer_tier: 'enterprise' }).priority, 'urgent');
});

test('feature requests are low priority with a one day SLA', () => {
  const r = triage({ subject: 'Feature request', body: 'It would be great if exports were scheduled' });
  assert.deepEqual([r.category, r.priority, r.sla_minutes], ['feature', 'low', 1440]);
});

test('the category with the most keyword hits wins; ties go to the earlier rule', () => {
  const r = triage({ subject: 'Invoice problem', body: 'The invoice shows the wrong VAT, the receipt too, and I cannot log in to see it' });
  assert.equal(r.category, 'billing');
  assert.equal(triage({ subject: 'login and invoice', body: '' }).category, 'billing');
});

test('nothing recognisable falls back to other/support/normal', () => {
  const r = triage({ subject: 'Hello', body: 'Just wanted to say thanks for the great service' });
  assert.deepEqual([r.category, r.queue, r.priority, r.reasons], ['other', 'support', 'normal', []]);
});

test('unknown tier is treated as free; matching is case-insensitive and word-bounded', () => {
  assert.equal(triage({ subject: 'REFUND', body: '', customer_tier: 'platinum' }).customer_tier, 'free');
  assert.equal(triage({ subject: 'Prefunded wallet', body: 'works fine' }).category, 'other');
  assert.equal(triage({ subject: 'Enterprise', body: 'x', customer_tier: 'ENTERPRISE' }).customer_tier, 'enterprise');
});

test('reasons list the matched keywords, at most five', () => {
  const r = triage({ subject: 'refund invoice billing receipt vat overcharged subscription cancellation', body: '' });
  assert.ok(r.reasons.length <= 5 && r.reasons.includes('refund'));
});

test('huge bodies and odd types do not crash', () => {
  assert.equal(triage({ subject: 'x', body: 'refund '.repeat(100000) }).category, 'billing');
  assert.equal(triage({ subject: 123, body: null }).category, 'other');
  assert.equal(triage({ subject: 'refund', id: 0 }).id, 0);
});
