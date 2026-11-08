// n8n Code node, mode "Run Once for All Items".
// Input: webhook body = { text: "<invoice text from OCR or a PDF-to-text step>" }
// Output: { vendor, invoice_number, invoice_date, due_date, currency, total, tax_id, missing[], warnings[], confidence } or { error }
const item = $input.first().json;
const b = (item && item.body) || {};
const raw = typeof b.text === 'string' ? b.text : '';
if (raw.trim().length < 10) {
  return [{ json: { error: 'text is required (at least 10 characters)' } }];
}
const text = raw.replace(/\r/g, '').slice(0, 50000);
const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
const warnings = [];

const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
function parseDate(s) {
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (m) {
    const a = +m[1], c = +m[2], y = +m[3];
    if (a > 12 && valid(y, c, a)) return `${y}-${pad(c)}-${pad(a)}`;
    if (c > 12 && valid(y, a, c)) return `${y}-${pad(a)}-${pad(c)}`;
    if (valid(y, c, a)) { warnings.push('date ' + m[0] + ' is ambiguous, read as day.month.year'); return `${y}-${pad(c)}-${pad(a)}`; }
  }
  m = s.match(/\b([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()] && valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2])) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(+m[2])}`;
  m = s.match(/\b(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})\b/);
  if (m && MONTHS[m[2].toLowerCase()] && valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  return null;
}
function parseAmount(s) {
  const m = s.match(/-?\d[\d.,  ]*\d|\d/);
  if (!m) return null;
  let n = m[0].replace(/[  ]/g, '');
  const lastDot = n.lastIndexOf('.'), lastComma = n.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    n = n.split(dec === '.' ? ',' : '.').join('');
    n = n.replace(dec, '.');
  } else if (lastComma >= 0) {
    n = n.length - lastComma - 1 === 3 && n.split(',').length > 1 && !/^0,/.test(n) ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (lastDot >= 0 && n.length - lastDot - 1 === 3 && n.split('.').length > 2) {
    n = n.replace(/\./g, '');
  }
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}
const CUR = [['EUR', /€|\bEUR\b/i], ['USD', /\$|\bUSD\b/i], ['GBP', /£|\bGBP\b/i], ['RSD', /\bRSD\b|\bdin\b|\bдин/i], ['CHF', /\bCHF\b/i]];

// invoice number
let invoiceNumber = null;
for (const l of lines) {
  const m = l.match(/(?:invoice|rechnung|ra[cč]un|faktura)\s*(?:no\.?|number|nr\.?|num\.?|br\.?|#|:)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i);
  if (m && /\d/.test(m[1])) { invoiceNumber = m[1].replace(/[.,;]$/, ''); break; }
}
// dates
let invoiceDate = null, dueDate = null;
for (const l of lines) {
  if (!dueDate && /\b(due|payable by|pay by|rok pla[cć]anja|f[aä]llig|valuta)\b/i.test(l)) dueDate = parseDate(l);
  else if (!invoiceDate && /\b(invoice date|date of issue|issued|datum|date)\b/i.test(l) && !/\bdue\b/i.test(l)) invoiceDate = parseDate(l);
}
if (!invoiceDate) { for (const l of lines) { const d = parseDate(l); if (d && d !== dueDate) { invoiceDate = d; break; } } }
// total: prefer an explicit total label, take the last one (grand total comes after subtotal)
let total = null, totalLine = null;
const TOTAL = /(total due|amount due|balance due|grand total|total amount|gesamtbetrag|ukupno za uplatu|za uplatu|ukupno|\btotal\b)/i;
for (const l of lines) {
  if (TOTAL.test(l) && !/sub\s*-?total|zwischensumme|without vat|excl|net total/i.test(l)) {
    const v = parseAmount(l.replace(TOTAL, ' '));
    if (v !== null) { total = v; totalLine = l; }
  }
}
let currency = null;
for (const [code, rx] of CUR) { if (rx.test(totalLine || text)) { currency = code; break; } }
const taxMatch = text.match(/\b(?:VAT|PIB|TIN|tax) ?(?:id|no\.?|number|reg\.?|broj)?\s*[:#]?\s*([A-Z]{0,2}\s?\d{8,12})\b/i);
const taxId = taxMatch ? taxMatch[1].replace(/\s/g, '') : null;
const vendor = (lines.find((l) => !/^(invoice|rechnung|ra[cč]un|faktura|bill to|date)/i.test(l) && /[A-Za-z]{3,}/.test(l) && l.length <= 80) || null);

const missing = [];
if (!invoiceNumber) missing.push('invoice_number');
if (!invoiceDate) missing.push('invoice_date');
if (total === null) missing.push('total');
if (!currency) missing.push('currency');
if (total !== null && total <= 0) warnings.push('total is not positive');
if (invoiceDate && dueDate && dueDate < invoiceDate) warnings.push('due date is before the invoice date');
const confidence = Math.max(0, Math.round((1 - missing.length / 4) * 100 - warnings.length * 10));
return [{ json: { vendor, invoice_number: invoiceNumber, invoice_date: invoiceDate, due_date: dueDate, currency, total, tax_id: taxId, missing, warnings, confidence } }];
