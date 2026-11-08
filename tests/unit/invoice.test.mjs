import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.mjs';

const inv = (text) => run('invoice-extract', { text });

const EN = `Acme Hosting Ltd
Invoice No: INV-2025-0042
Invoice date: 2025-03-03
Due date: 2025-03-17
Subtotal: $1,000.00
VAT 20%: $200.00
Total due: $1,200.00
VAT ID: GB123456789`;

test('too little text is rejected', () => {
  assert.match(inv('').error, /text is required/);
  assert.match(inv('short').error, /text is required/);
});

test('English invoice with US number format', () => {
  const r = inv(EN);
  assert.deepEqual([r.vendor, r.invoice_number, r.invoice_date, r.due_date, r.currency, r.total, r.tax_id], ['Acme Hosting Ltd', 'INV-2025-0042', '2025-03-03', '2025-03-17', 'USD', 1200, 'GB123456789']);
  assert.deepEqual([r.missing, r.confidence], [[], 100]);
});

test('subtotal never beats the total, whatever the order', () => {
  const r = inv('Shop d.o.o.\nInvoice #: 77-A\nDate: 04.03.2025\nTotal: 1.234,56 EUR\nSubtotal: 1.000,00 EUR');
  assert.equal(r.total, 1234.56);
  assert.equal(r.currency, 'EUR');
});

test('European decimal comma, thousands dot, and a space as thousands separator', () => {
  assert.equal(inv('Firma\nRechnung Nr. R-100\nDatum: 15.03.2025\nGesamtbetrag: 1.234,50 EUR').total, 1234.5);
  assert.equal(inv('Firma\nRačun br. 55/2025\nDatum: 15.03.2025\nUkupno za uplatu: 12 345,00 RSD').total, 12345);
  assert.equal(inv('Firma\nInvoice no 9000\nDate 2025-03-15\nTotal 12,5 EUR').total, 12.5);
  assert.equal(inv('Firma\nInvoice no 9000\nDate 2025-03-15\nTotal 1,234 EUR').total, 1234);
});

test('Serbian invoice', () => {
  const r = inv('Zephyra Studio\nRačun br. 12-2025\nDatum izdavanja: 15.03.2025\nRok plaćanja: 30.03.2025\nUkupno za uplatu: 54.000,00 RSD\nPIB: 115123456');
  assert.deepEqual([r.invoice_number, r.invoice_date, r.due_date, r.currency, r.total, r.tax_id], ['12-2025', '2025-03-15', '2025-03-30', 'RSD', 54000, '115123456']);
});

test('written-out dates in both orders', () => {
  assert.equal(inv('Vendor Inc\nInvoice number: A1B2C3\nIssued: March 3, 2025\nTotal: $10.00').invoice_date, '2025-03-03');
  assert.equal(inv('Vendor Inc\nInvoice number: A1B2C3\nIssued: 3 March 2025\nTotal: $10.00').invoice_date, '2025-03-03');
});

test('ambiguous day/month is flagged and impossible dates are not invented', () => {
  const r = inv('Vendor Inc\nInvoice number: A1B2C3\nDate: 03/04/2025\nTotal: $10.00');
  assert.equal(r.invoice_date, '2025-04-03');
  assert.ok(r.warnings.some((w) => /ambiguous/.test(w)));
  assert.equal(inv('Vendor Inc\nInvoice number: A1B2C3\nDate: 31.02.2025\nTotal: $10.00').invoice_date, null);
});

test('missing fields are listed and lower the confidence', () => {
  const r = inv('Just some text that is not really an invoice at all');
  assert.deepEqual(r.missing, ['invoice_number', 'invoice_date', 'total', 'currency']);
  assert.equal(r.confidence, 0);
});

test('due date before invoice date is a warning', () => {
  const r = inv('Vendor Inc\nInvoice no: X-1001\nInvoice date: 2025-03-10\nDue date: 2025-03-01\nTotal: €50.00');
  assert.ok(r.warnings.some((w) => /due date is before/.test(w)));
  assert.equal(r.currency, 'EUR');
});

test('the word invoice in prose is not mistaken for a number', () => {
  const r = inv('Vendor Inc\nPlease find the invoice attached to this mail.\nTotal: $5.00');
  assert.equal(r.invoice_number, null);
});

test('windows line endings and long input are handled', () => {
  assert.equal(inv(EN.replace(/\n/g, '\r\n')).total, 1200);
  assert.equal(inv(EN + '\n' + 'x'.repeat(200000)).total, 1200);
});

test('net, excl-VAT and sub-total lines that come after the total never replace it', () => {
  for (const extra of ['Net total: 1,000.00 USD', 'Total excl. VAT: 1,000.00 USD', 'Sub-total: 1,000.00 USD', 'Zwischensumme: 1,000.00 USD', 'Total without VAT: 1,000.00 USD']) {
    assert.equal(inv('Vendor Inc\nInvoice no: X-2001\nDate: 2025-03-15\nTotal due: 1,200.00 USD\n' + extra).total, 1200, extra);
  }
});
