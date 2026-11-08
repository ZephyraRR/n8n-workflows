import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.mjs';

const sla = (b) => run('sla-alert', b);
const NOW = '2025-03-03T12:00:00Z';
const ago = (min) => new Date(new Date(NOW).getTime() - min * 60000).toISOString();

test('tickets must be an array; now must be a date', () => {
  assert.equal(sla({}).error, 'tickets must be an array');
  assert.equal(sla({ tickets: 'x' }).error, 'tickets must be an array');
  assert.equal(sla({ tickets: [], now: 'yesterday-ish' }).error, 'now is not a valid date');
});

test('an unanswered ticket past the first-response limit is a breach', () => {
  const r = sla({ now: NOW, tickets: [{ id: 1, created: ago(90), priority: 'normal' }] });
  assert.equal(r.breaches.length, 1);
  assert.deepEqual([r.breaches[0].kind, r.breaches[0].limit_minutes, r.breaches[0].waited_minutes], ['first response', 60, 90]);
  assert.equal(r.alerts, 1);
  assert.match(r.slack_payload.text, /SLA breached/);
  assert.match(r.slack_payload.text, /#1/);
});

test('80 percent of the limit is a warning, not a breach', () => {
  const r = sla({ now: NOW, tickets: [{ id: 1, created: ago(50) }] });
  assert.equal(r.breaches.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.slack_payload.text, /SLA at risk/);
});

test('exactly at the limit is not a breach; below the warning threshold is silent', () => {
  assert.equal(sla({ now: NOW, tickets: [{ id: 1, created: ago(60) }] }).breaches.length, 0);
  assert.equal(sla({ now: NOW, tickets: [{ id: 1, created: ago(10) }] }).alerts, 0);
});

test('priority picks the limit: urgent is 15 minutes', () => {
  assert.equal(sla({ now: NOW, tickets: [{ id: 1, created: ago(20), priority: 'URGENT' }] }).breaches.length, 1);
  assert.equal(sla({ now: NOW, tickets: [{ id: 1, created: ago(20), priority: 'low' }] }).breaches.length, 0);
});

test('a replied ticket only has the resolution limit', () => {
  const r = sla({ now: NOW, tickets: [{ id: 1, created: ago(120), first_response: ago(100), priority: 'normal' }] });
  assert.equal(r.alerts, 0);
  const late = sla({ now: NOW, tickets: [{ id: 1, created: ago(25 * 60), first_response: ago(24 * 60) }] });
  assert.equal(late.breaches.length, 1);
  assert.equal(late.breaches[0].kind, 'resolution');
});

test('solved and closed tickets are ignored', () => {
  const r = sla({ now: NOW, tickets: [{ id: 1, created: ago(900), status: 'Solved' }, { id: 2, created: ago(900), resolved: ago(10) }, { id: 3, created: ago(900), status: 'closed' }] });
  assert.equal(r.alerts, 0);
});

test('bad rows are reported as skipped, not fatal', () => {
  const r = sla({ now: NOW, tickets: [{ id: 1 }, { created: ago(5) }, null, { id: 4, created: 'garbage' }, { id: 5, created: ago(500) }] });
  assert.equal(r.skipped.length, 4);
  assert.equal(r.breaches.length > 0, true);
});

test('custom policy overrides the defaults', () => {
  const r = sla({ now: NOW, policy: { normal: { first_response_minutes: 5, resolution_hours: 1 } }, tickets: [{ id: 1, created: ago(10), priority: 'normal' }] });
  assert.equal(r.breaches[0].limit_minutes, 5);
});

test('slack url must be http(s); anything else is dropped', () => {
  assert.equal(sla({ now: NOW, tickets: [], slack_webhook_url: 'javascript:alert(1)' }).slack_url, '');
  assert.equal(sla({ now: NOW, tickets: [], slack_webhook_url: 'file:///etc/passwd' }).slack_url, '');
  assert.equal(sla({ now: NOW, tickets: [], slack_webhook_url: 'https://hooks.slack.com/services/x' }).slack_url, 'https://hooks.slack.com/services/x');
});

test('empty list is fine', () => {
  const r = sla({ now: NOW, tickets: [] });
  assert.deepEqual([r.checked, r.alerts, r.slack_payload.text], [0, 0, '']);
});
