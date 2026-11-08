import { normalizeText, normalizeAddress } from './ingest.js';

const legacy = { site_12: 'RCH-BLDG-012', site_21: 'RCH-BLDG-021', site_31: 'RCH-BLDG-031', richardson_12: 'RCH-BLDG-012', northside_market: 'RCH-BLDG-021', learning_annex: 'RCH-BLDG-031' };
export function matchRecords(properties, maintenance, businesses) {
  const matches = []; const propertyById = new Map(properties.map(x => [x.property_id, x]));
  const candidates = (record, kind) => {
    const ref = kind === 'maintenance' ? record.site_ref : record.facility_ref;
    const mapped = legacy[normalizeText(ref).replace(/ /g, '_')];
    if (mapped && propertyById.has(mapped)) return { property: propertyById.get(mapped), score: 1, method: 'explicit legacy-ID mapping', accepted: true };
    const norm = normalizeText(ref);
    const found = properties.filter(p => normalizeText(p.property_name) === norm || normalizeText(p.property_name).includes(norm) || norm.includes(normalizeText(p.property_name)));
    if (found.length === 1) return { property: found[0], score: .85, method: 'normalized facility name', accepted: true };
    const address = record.street_address && normalizeAddress(record.street_address);
    const addressFound = address && properties.filter(p => normalizeAddress(p.street_address) === address);
    if (addressFound?.length === 1) return { property: addressFound[0], score: .8, method: 'normalized address', accepted: true };
    return { property: null, score: 0, method: 'no deterministic match', accepted: false };
  };
  for (const r of maintenance) { const m = candidates(r, 'maintenance'); matches.push({ recordType: 'maintenance', recordId: r.work_order_id, ...m, propertyId: m.property?.property_id, original: r }); }
  for (const r of businesses) { const m = candidates(r, 'business'); matches.push({ recordType: 'business', recordId: r.business_id, ...m, propertyId: m.property?.property_id, original: r }); }
  return matches;
}
