// n8n Code node, mode "Run Once for All Items".
// Input: webhook body = { email, name?, company? }
// Output: { email, valid, domain, is_free_mail, is_disposable, is_role_address, company_guess, score, route, reasons[] } or { error }
const item = $input.first().json;
const b = (item && item.body) || {};
const email = String(b.email || '').trim().toLowerCase();
if (!email) {
  return [{ json: { error: 'email is required' } }];
}
const FREE = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'aol.com', 'mail.com', 'yandex.com', 'zoho.com', 'web.de', 't-online.de', 'orange.fr', 'free.fr', 'mts.rs', 'eunet.rs', 'sbb.rs']);
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'throwawaymail.com']);
const ROLE = new Set(['info', 'sales', 'support', 'admin', 'contact', 'hello', 'office', 'team', 'billing', 'noreply', 'no-reply', 'postmaster', 'webmaster', 'hr', 'jobs']);
// one @, no spaces, a dot in the domain, no leading/trailing dot or hyphen in a label
const SYNTAX = /^[a-z0-9._%+-]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const valid = SYNTAX.test(email) && !email.includes('..') && email.length <= 254;
if (!valid) {
  return [{ json: { email, valid: false, domain: null, is_free_mail: false, is_disposable: false, is_role_address: false, company_guess: null, score: 0, route: 'reject', reasons: ['invalid e-mail address'] } }];
}
const [local, domain] = email.split('@');
const isFree = FREE.has(domain);
const isDisposable = DISPOSABLE.has(domain);
const isRole = ROLE.has(local.split('+')[0]);
const sld = domain.split('.').slice(-2, -1)[0];
const SECOND = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
const labels = domain.split('.');
const brand = labels.length >= 3 && SECOND.has(labels[labels.length - 2]) ? labels[labels.length - 3] : sld;
const companyGuess = isFree || isDisposable ? null : (b.company ? String(b.company).trim() : brand.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
const reasons = [];
let score = 50;
if (isDisposable) { score = 0; reasons.push('disposable e-mail provider'); }
else {
  if (isFree) { score -= 25; reasons.push('free e-mail provider'); } else { score += 25; reasons.push('business domain'); }
  if (isRole) { score -= 15; reasons.push('role address (' + local + '@)'); }
  if (b.name && String(b.name).trim().split(/\s+/).length >= 2) { score += 10; reasons.push('full name given'); }
  if (b.company) { score += 10; reasons.push('company given'); }
}
score = Math.max(0, Math.min(100, score));
const route = isDisposable ? 'reject' : score >= 60 ? 'sales' : 'nurture';
return [{ json: { email, valid: true, domain, is_free_mail: isFree, is_disposable: isDisposable, is_role_address: isRole, company_guess: companyGuess, score, route, reasons } }];
