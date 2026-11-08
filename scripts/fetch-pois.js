/**
 * fetch-pois.js
 *
 * Downloads OSM POI data for the Richardson, TX north-central study area from
 * the Overpass API, normalizes the results, and writes a validated cache file.
 *
 * Usage: node scripts/fetch-pois.js
 *        npm run data:pois:fetch
 *
 * On network failure: tries all configured endpoints, prints each error clearly,
 * leaves any existing cache untouched, and exits with code 1.
 * Never silently swaps in fake data.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizePoi,
  writePoiSnapshot,
  poiCachePath,
  POI_SCHEMA_VERSION
} from '../src/pois.js';
import { VISUALIZATION_REGION_ID as DEFAULT_REGION_ID, region } from '../src/regions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Try primary then backup mirror before giving up
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// Richardson north-central study area bbox: [west, south, east, north]
const BBOX = region(DEFAULT_REGION_ID).bbox;
const [west, south, east, north] = BBOX;

// Exact Overpass query — [timeout:50] gives the server 50s to execute.
const QUERY = `[out:json][timeout:50];
(
  node[amenity~"pharmacy|hospital|clinic|doctors|school|community_centre|library|supermarket"](${south},${west},${north},${east});
  way[amenity~"pharmacy|hospital|clinic|doctors|school|community_centre|library|supermarket"](${south},${west},${north},${east});
  node[shop~"grocery|supermarket|convenience"](${south},${west},${north},${east});
  way[shop~"grocery|supermarket|convenience"](${south},${west},${north},${east});
);
out center tags;`;

const RAW_PATH = path.join(root, 'data', 'businesses', 'raw', 'osm-richardson-pois.json');
const METADATA_PATH = path.join(root, 'data', 'businesses', 'raw', 'osm-richardson-pois.metadata.json');

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  ResilienceOS — OSM POI Fetch (Richardson TX)');
  console.log('══════════════════════════════════════════════');
  console.log(`Bbox     : [${BBOX.join(', ')}]`);
  console.log(`Endpoints: ${ENDPOINTS.length} configured (primary + mirror)`);
  console.log('Querying Overpass API…\n');

  // ── Fetch with endpoint fallback ───────────────────────────────────────────
  let rawData;
  let successEndpoint;

  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`Trying ${endpoint}…`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ResilienceOS/1.0 (research project; non-commercial)'
        },
        body: `data=${encodeURIComponent(QUERY)}`,
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      rawData = await response.json();
      if(rawData.remark||!Array.isArray(rawData.elements))throw new Error(`Incomplete Overpass response: ${rawData.remark??'missing elements'}`);
      successEndpoint = endpoint;
      console.log(`Success via ${endpoint}`);
      break;
    } catch (error) {
      console.warn(`  Failed (${error.message}) — trying next endpoint…`);
      if (endpoint === ENDPOINTS.at(-1)) {
        console.error('\nAll Overpass endpoints failed. Cache unchanged.');
        process.exit(1);
      }
    }
  }

  const acquiredAt = new Date().toISOString();
  const rawElements = rawData.elements ?? [];
  console.log(`\nReceived ${rawElements.length} raw elements from Overpass.`);

  // ── Save raw response ──────────────────────────────────────────────────────
  await mkdir(path.dirname(RAW_PATH), { recursive: true });
  await writeFile(RAW_PATH, JSON.stringify(rawData, null, 2));
  console.log(`Raw response  → ${path.relative(root, RAW_PATH)}`);

  // ── Save metadata ──────────────────────────────────────────────────────────
  const metadata = {
    provider: 'OpenStreetMap',
    queryBbox: BBOX,
    overpassEndpoint: successEndpoint,
    acquiredAt,
    rawElementCount: rawElements.length
  };
  await writeFile(METADATA_PATH, JSON.stringify(metadata, null, 2));
  console.log(`Metadata      → ${path.relative(root, METADATA_PATH)}`);

  // ── Normalize ──────────────────────────────────────────────────────────────
  const source = {
    provider: 'OpenStreetMap',
    queryBbox: BBOX,
    acquiredAt,
    overpassEndpoint: successEndpoint
  };

  const features = [];
  const rejected = [];

  for (const element of rawElements) {
    try {
      features.push(normalizePoi(element, source));
    } catch (error) {
      rejected.push({
        osmId: element.id,
        osmType: element.type,
        reason: error.message
      });
    }
  }

  // ── Write cache snapshot ───────────────────────────────────────────────────
  const cachePath = poiCachePath(DEFAULT_REGION_ID);
  const snapshot = {
    schemaVersion: POI_SCHEMA_VERSION,
    source,
    locationId: DEFAULT_REGION_ID,
    rawElementCount: rawElements.length,
    acceptedCount: features.length,
    rejectedCount: rejected.length,
    rejected,
    features
  };

  await writePoiSnapshot(snapshot, cachePath);
  console.log(`Cache snapshot → ${path.relative(root, cachePath)}\n`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('── Summary ─────────────────────────');
  console.log(`Raw elements : ${rawElements.length}`);
  console.log(`Accepted     : ${features.length}`);
  console.log(`Rejected     : ${rejected.length}`);

  if (rejected.length > 0) {
    console.log('\nRejected elements:');
    rejected.forEach(r => console.log(`  ${r.osmType ?? '?'}:${r.osmId} — ${r.reason}`));
  }

  // Category breakdown
  const byCategory = {};
  for (const poi of features) {
    byCategory[poi.category] = (byCategory[poi.category] ?? 0) + 1;
  }
  console.log('\nBy category:');
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log(`  ${cat.padEnd(18)} ${count}`));

  console.log('────────────────────────────────────');
  console.log('Done.');
}

main();
