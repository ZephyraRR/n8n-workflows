import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.mjs';

const lead = (b) => run('lead-enrich', b);

test('missing e-mail is an error', () => {
  assert.equal(lead({}).error, 'email is required');
  assert.equal(lead({ email: '   ' }).error, 'email is required');
});

test('invalid syntax is rejected with score 0', () => {
  for (const e of ['plain', 'a@b', 'a@@b.com', 'a b@c.com', '@c.com', 'a@c..com', 'a@-c.com', 'a@c.com.', 'a@c.c', 'x'.repeat(65) + '@c.com']) {
    const r = lead({ email: e });
    assert.equal(r.valid, false, e);
    assert.equal(r.route, 'reject', e);
  }
});

test('business address with a full name and company routes to sales', () => {
  const r = lead({ email: 'Ana.Petrovic@Acme-Tools.com', name: 'Ana Petrovic', company: 'Acme Tools d.o.o.' });
  assert.deepEqual([r.valid, r.email, r.domain, r.is_free_mail, r.route, r.company_guess], [true, 'ana.petrovic@acme-tools.com', 'acme-tools.com', false, 'sales', 'Acme Tools d.o.o.']);
  assert.equal(r.score, 95);
});

test('company is guessed from the domain, including co.uk style domains', () => {
  assert.equal(lead({ email: 'x@acme-tools.com' }).company_guess, 'Acme Tools');
  assert.equal(lead({ email: 'x@widgets.co.uk' }).company_guess, 'Widgets');
});

test('free mail goes to nurture and has no company guess', () => {
  const r = lead({ email: 'someone@gmail.com' });
  assert.deepEqual([r.is_free_mail, r.route, r.company_guess], [true, 'nurture', null]);
});

test('disposable providers are rejected even though the syntax is fine', () => {
  const r = lead({ email: 'x@mailinator.com' });
  assert.deepEqual([r.valid, r.is_disposable, r.route, r.score], [true, true, 'reject', 0]);
});

test('role addresses score lower, plus-tags do not hide them', () => {
  assert.equal(lead({ email: 'info@acme-tools.com' }).is_role_address, true);
  assert.equal(lead({ email: 'sales+web@acme-tools.com' }).is_role_address, true);
  assert.equal(lead({ email: 'info@acme-tools.com' }).route, 'sales');
  assert.equal(lead({ email: 'info@gmail.com' }).route, 'nurture');
});

test('score is always within 0..100', () => {
  for (const b of [{ email: 'a@gmail.com' }, { email: 'info@gmail.com' }, { email: 'a.b@big-corp.io', name: 'A B', company: 'X' }]) {
    const s = lead(b).score;
    assert.ok(s >= 0 && s <= 100);
  }
});

test('non-string values do not crash', () => {
  assert.equal(lead({ email: 12345 }).valid, false);
  assert.equal(lead({ email: 'a@acme-tools.com', name: 42, company: {} }).valid, true);
});
