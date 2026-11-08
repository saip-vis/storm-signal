import { readFile } from 'node:fs/promises';
import { assert } from './types.js';

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/); const headers = lines.shift().split(',').map(x => x.trim());
  assert(headers.length > 1, 'CSV must have headers');
  return lines.filter(Boolean).map((line, i) => {
    const values = line.split(',').map(x => x.trim());
    assert(values.length === headers.length, `CSV row ${i + 2} has wrong column count`);
    return Object.fromEntries(headers.map((h, n) => [h, values[n]]));
  });
}
export async function loadCsv(path, required) {
  const records = parseCsv(await readFile(path, 'utf8'));
  for (const [index, record] of records.entries()) for (const field of required) assert(record[field], `Missing ${field} in row ${index + 2}`);
  return records;
}
export function normalizeText(value = '') { return value.toLowerCase().replace(/\b(building|bldg|facility|center)\b/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function normalizeAddress(value = '') { return normalizeText(value).replace(/\broad\b/g, 'rd').replace(/\bstreet\b/g, 'st'); }
