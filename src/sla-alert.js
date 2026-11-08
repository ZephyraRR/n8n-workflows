// n8n Code node, mode "Run Once for All Items".
// Input: webhook body = { now?: ISO time, tickets: [{ id, created, first_response?, resolved?, priority?, status? }], policy?: { urgent: { first_response_minutes, resolution_hours }, default: {...} }, slack_webhook_url?: string }
// Output: one item { checked, breaches[], warnings[], alerts, slack_url, slack_payload, error? }
const item = $input.first().json;
const b = (item && item.body) || {};
if (!Array.isArray(b.tickets)) {
  return [{ json: { error: 'tickets must be an array' } }];
}
const now = b.now ? new Date(b.now) : new Date();
if (Number.isNaN(now.getTime())) {
  return [{ json: { error: 'now is not a valid date' } }];
}
const DEFAULT = { default: { first_response_minutes: 60, resolution_hours: 24 }, urgent: { first_response_minutes: 15, resolution_hours: 4 }, high: { first_response_minutes: 30, resolution_hours: 8 } };
const policy = Object.assign({}, DEFAULT, b.policy || {});
const WARN_AT = 0.8;
const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const breaches = [];
const warnings = [];
const skipped = [];
for (const t of b.tickets) {
  const created = toDate(t && t.created);
  if (!t || t.id === undefined || !created) { skipped.push({ id: t && t.id, reason: 'missing id or invalid created time' }); continue; }
  if (/^(solved|closed|resolved|done)$/i.test(String(t.status || '')) || toDate(t.resolved)) continue;
  const pol = policy[String(t.priority || '').toLowerCase()] || policy.default;
  const waitedMin = (now - created) / 60000;
  const replied = toDate(t.first_response);
  const checks = [];
  if (!replied && pol.first_response_minutes) checks.push(['first response', waitedMin, pol.first_response_minutes]);
  if (pol.resolution_hours) checks.push(['resolution', waitedMin, pol.resolution_hours * 60]);
  for (const [kind, waited, limit] of checks) {
    const row = { id: t.id, kind, priority: t.priority || 'default', waited_minutes: Math.round(waited), limit_minutes: limit };
    if (waited > limit) breaches.push(row);
    else if (waited > limit * WARN_AT) warnings.push(row);
  }
}
const line = (r) => `#${r.id} (${r.priority}) ${r.kind}: ${r.waited_minutes} of ${r.limit_minutes} min`;
const text = [].concat(breaches.length ? ['*SLA breached*'].concat(breaches.map(line)) : [], warnings.length ? ['*SLA at risk*'].concat(warnings.map(line)) : []).join('\n');
const slackUrl = typeof b.slack_webhook_url === 'string' && /^https?:\/\//.test(b.slack_webhook_url) ? b.slack_webhook_url : '';
return [{ json: { checked: b.tickets.length, breaches, warnings, skipped, alerts: breaches.length + warnings.length, slack_url: slackUrl, slack_payload: { text } } }];
