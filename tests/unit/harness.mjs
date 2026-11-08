// Runs a Code-node file the way n8n does: as a function body with `$input` available, returning an array of items.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function run(name, body) {
  const code = fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
  const fn = new Function('$input', code);
  const item = { json: { headers: {}, params: {}, query: {}, body } };
  const out = fn({ first: () => item, all: () => [item] });
  if (!Array.isArray(out) || out.length !== 1 || !out[0].json) throw new Error('a Code node must return exactly one item here');
  return out[0].json;
}
