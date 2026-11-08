/**
 * fetch-pois.js
 *
 * Downloads OSM POI data for the Richardson, TX north-central study area from
 * the Overpass API, normalizes the results, and writes a validated cache file.
 *
 * Usage: node scripts/fetch-pois.js
 *        npm run data:pois:fetch
 *
 * On network failure: prints error clearly, leaves any existing cache untouched,
 * and exits with code 1. Never silently swaps in fake data.
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
import { DEFAULT_REGION_ID } from '../src/regions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// Richardson north-central study area bbox: [west, south, east, north]
const BBOX = [-96.755, 32.935, -96.705, 32.975];
const [west, south, east, north] = BBOX;

// Exact Overpass query as specified — queries amenity and shop POIs in the bbox.
const QUERY = `[out:json][timeout:25];
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
  console.log(`Endpoint : ${ENDPOINT}`);
  console.log(`Bbox     : [${BBOX.join(', ')}]`);
  console.log('Querying Overpass API…\n');

  // ── Fetch ──────────────────────────────────────────────────────────────────
  let rawData;
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'ResilienceOS/1.0 (research project; non-commercial)'
      },
      body: `data=${encodeURIComponent(QUERY)}`,
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(`Overpass returned HTTP ${response.status}: ${text}`);
    }
    rawData = await response.json();
  } catch (error) {
    console.error(`\nFetch failed: ${error.message}`);
    console.error('Existing cache (if any) has NOT been modified.');
    process.exit(1);
  }

  const acquiredAt = new Date().toISOString();
  const rawElements = rawData.elements ?? [];
  console.log(`Received ${rawElements.length} raw elements from Overpass.`);

  // ── Save raw response ──────────────────────────────────────────────────────
  await mkdir(path.dirname(RAW_PATH), { recursive: true });
  await writeFile(RAW_PATH, JSON.stringify(rawData, null, 2));
  console.log(`Raw response  → ${path.relative(root, RAW_PATH)}`);

  // ── Save metadata ──────────────────────────────────────────────────────────
  const metadata = {
    provider: 'OpenStreetMap',
    queryBbox: BBOX,
    overpassEndpoint: ENDPOINT,
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
    overpassEndpoint: ENDPOINT
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
