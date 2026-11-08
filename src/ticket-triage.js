// n8n Code node, mode "Run Once for All Items".
// Input: the Webhook item, body = { id, subject, body, customer_tier: "free" | "pro" | "enterprise" }
// Output: one item { id, category, priority, queue, sla_minutes, reasons[] } or { error } (the Respond node turns an error into HTTP 422).
const item = $input.first().json;
const b = (item && item.body) || {};
const subject = String(b.subject || '').trim();
const text = String(b.body || '').trim();
if (!subject && !text) {
  return [{ json: { error: 'subject or body is required' } }];
}
const tier = ['free', 'pro', 'enterprise'].includes(String(b.customer_tier || '').toLowerCase()) ? String(b.customer_tier).toLowerCase() : 'free';
const hay = (subject + ' \n ' + text).toLowerCase().slice(0, 20000);

// Order matters: when two categories score the same, the earlier one wins.
const RULES = [
  { cat: 'security', rx: /\b(hacked|hack(ed|ing)?|breach(ed)?|phishing|data leak|leaked|unauthori[sz]ed (access|login|charge)|stolen|compromised|account takeover|suspicious (login|activity))\b/g },
  { cat: 'outage', rx: /\b(outage|is down|are down|went down|cannot access|can't access|unreachable|502|503|504|500 error|timeouts?|not loading|completely broken|production (is )?(down|broken))\b/g },
  { cat: 'billing', rx: /\b(refund|chargeback|charged twice|double charge|invoice|billing|payment (failed|declined)|card (declined|rejected)|subscription|cancel(l)?ation|overcharged|receipt|vat)\b/g },
  { cat: 'account', rx: /\b(password|log ?in|sign ?in|locked out|2fa|two[- ]factor|verification (email|code)|change (my )?email|reset link)\b/g },
  { cat: 'bug', rx: /\b(bug|crash(es|ed)?|exception|stack ?trace|error message|doesn't work|does not work|not working|broken|fails?|failing|wrong result)\b/g },
  { cat: 'abuse', rx: /\b(spam|harass(ment|ing)?|abusive|scam(mer)?|fake (account|profile)|report (a )?user)\b/g },
  { cat: 'feature', rx: /\b(feature request|would be (great|nice)|suggestion|please add|it would help if|wish (you|it) (had|could)|roadmap)\b/g },
];
const scores = RULES.map((r) => {
  const hits = hay.match(r.rx) || [];
  return { cat: r.cat, n: hits.length, hits: [...new Set(hits.map((h) => (typeof h === 'string' ? h : String(h))))] };
});
let best = scores.reduce((a, s) => (s.n > a.n ? s : a), { cat: 'other', n: 0, hits: [] });
const category = best.n > 0 ? best.cat : 'other';

const ORDER = ['low', 'normal', 'high', 'urgent'];
let priority = 'normal';
if (category === 'security') priority = 'urgent';
else if (category === 'outage') priority = tier !== 'free' || /\b(production|all users|everyone|entire)\b/.test(hay) ? 'urgent' : 'high';
else if (category === 'billing') priority = /\b(chargeback|dispute|double charge|charged twice|fraud)\b/.test(hay) ? 'high' : 'normal';
else if (category === 'feature') priority = 'low';
if (tier === 'enterprise' && priority !== 'urgent') priority = ORDER[Math.min(ORDER.indexOf(priority) + 1, 3)];

const QUEUE = { security: 'security', outage: 'engineering', bug: 'engineering', billing: 'billing', account: 'support', abuse: 'trust-safety', feature: 'product', other: 'support' };
const SLA = { urgent: 15, high: 60, normal: 240, low: 1440 };
return [{ json: { id: b.id === undefined ? null : b.id, category, priority, queue: QUEUE[category], sla_minutes: SLA[priority], customer_tier: tier, reasons: best.hits.slice(0, 5) } }];
