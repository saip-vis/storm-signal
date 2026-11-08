/**
 * fetch-census.js
 *
 * Downloads Census tract boundaries (TIGER/Line) and ACS 5-year population
 * estimates for Collin County, TX (FIPS 48085 — includes Richardson, TX).
 *
 * Usage: node scripts/fetch-census.js
 *        npm run data:census:fetch
 *
 * On failure: prints error clearly, leaves any existing cache untouched,
 * exits with code 1. Never silently swaps in fake data.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENSUS_SCHEMA_VERSION,
  RICHARDSON_VICINITY_BBOX,
  normalizeTract,
  writeCensusSnapshot,
  censusCachePath
} from '../src/census.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Endpoints ─────────────────────────────────────────────────────────────────

const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query' +
  "?where=STATE%3D'48'+AND+COUNTY%3D'085'" +
  '&outFields=GEOID,NAME' +
  '&f=geojson' +
  '&outSR=4326';

const ACS_URL =
  'https://api.census.gov/data/2022/acs/acs5' +
  '?get=B01003_001E,B25001_001E,NAME' +
  '&for=tract:*' +
  '&in=state:48%20county:085';

// ── Output paths ──────────────────────────────────────────────────────────────

const RAW_DIR = path.join(root, 'data', 'census', 'raw');
const GEO_RAW_PATH = path.join(RAW_DIR, 'collin-county-tracts-geo.json');
const ACS_RAW_PATH = path.join(RAW_DIR, 'collin-county-acs.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ResilienceOS/1.0 (research project)' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function geometryBboxOverlaps(geometry, [west, south, east, north]) {
  const coords =
    geometry?.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry?.coordinates?.flatMap(poly => poly[0]) ?? [];
  if (!coords.length) return false;
  const minLon = Math.min(...coords.map(c => c[0]));
  const maxLon = Math.max(...coords.map(c => c[0]));
  const minLat = Math.min(...coords.map(c => c[1]));
  const maxLat = Math.max(...coords.map(c => c[1]));
  return minLon < east && maxLon > west && minLat < north && maxLat > south;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  ResilienceOS — Census Fetch (Collin County TX 48085)');
  console.log('══════════════════════════════════════════════════════');

  // ── Step 1: Fetch TIGER boundaries ────────────────────────────────────────
  console.log('\n[1/3] Fetching TIGER/Line tract boundaries…');
  let geoData;
  try {
    geoData = await fetchJson(TIGER_URL, 'TIGER/Line');
  } catch (error) {
    console.error(`\nFetch failed (TIGER): ${error.message}`);
    console.error('Existing cache (if any) has NOT been modified.');
    process.exit(1);
  }
  console.log(`     ${geoData.features?.length ?? 0} tract geometries received.`);

  // ── Step 2: Fetch ACS population data ─────────────────────────────────────
  console.log('\n[2/3] Fetching ACS 5-year population estimates…');
  let acsData;
  try {
    acsData = await fetchJson(ACS_URL, 'ACS Data API');
  } catch (error) {
    console.error(`\nFetch failed (ACS): ${error.message}`);
    console.error('Existing cache (if any) has NOT been modified.');
    process.exit(1);
  }
  // acsData[0] = header row; acsData[1..] = data rows
  // Columns: [B01003_001E, B25001_001E, NAME, state, county, tract]
  const acsHeaders = acsData[0];
  const popIdx = acsHeaders.indexOf('B01003_001E');
  const housingIdx = acsHeaders.indexOf('B25001_001E');
  const stateIdx = acsHeaders.indexOf('state');
  const countyIdx = acsHeaders.indexOf('county');
  const tractIdx = acsHeaders.indexOf('tract');
  console.log(`     ${acsData.length - 1} ACS rows received.`);

  // Build GEOID → [population, housingUnits] lookup
  const acsMap = new Map();
  for (const row of acsData.slice(1)) {
    const geoid = row[stateIdx] + row[countyIdx] + row[tractIdx];
    acsMap.set(geoid, [row[popIdx], row[housingIdx]]);
  }

  // ── Step 3: Save raw data ─────────────────────────────────────────────────
  console.log('\n[3/3] Saving raw data and building snapshot…');
  const acquiredAt = new Date().toISOString();
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(GEO_RAW_PATH, JSON.stringify(geoData, null, 2));
  console.log(`     Raw geometry  → ${path.relative(root, GEO_RAW_PATH)}`);
  await writeFile(ACS_RAW_PATH, JSON.stringify(acsData, null, 2));
  console.log(`     Raw ACS       → ${path.relative(root, ACS_RAW_PATH)}`);

  // ── Normalize + filter ────────────────────────────────────────────────────
  const features = [];
  const skipped = [];

  for (const feature of geoData.features ?? []) {
    if (!feature.geometry) { skipped.push({ reason: 'no geometry', geoid: feature.properties?.GEOID }); continue; }
    if (!geometryBboxOverlaps(feature.geometry, RICHARDSON_VICINITY_BBOX)) continue; // outside study area
    const geoid = feature.properties?.GEOID ?? feature.properties?.geoid ?? null;
    const acsRow = geoid ? acsMap.get(geoid) : null;
    features.push(normalizeTract(feature, acsRow ?? null, acquiredAt));
  }

  const snapshot = {
    schemaVersion: CENSUS_SCHEMA_VERSION,
    county: 'Collin County, TX',
    fips: '48085',
    tractCount: features.length,
    acquiredAt,
    source: {
      provider: 'US Census Bureau',
      geometrySource: 'TIGER/Line',
      populationSource: 'ACS 5-Year Estimates 2022'
    },
    features
  };

  const cachePath = censusCachePath();
  await writeCensusSnapshot(snapshot, cachePath);
  console.log(`     Cache snapshot → ${path.relative(root, cachePath)}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────');
  console.log(`TIGER tracts total   : ${geoData.features?.length ?? 0}`);
  console.log(`In Richardson vicinity: ${features.length}`);
  console.log(`ACS rows matched     : ${features.filter(t => t.population !== null).length}`);
  console.log(`Total population     : ${features.reduce((s, t) => s + (t.population ?? 0), 0).toLocaleString()}`);
  console.log(`Total housing units  : ${features.reduce((s, t) => s + (t.housingUnits ?? 0), 0).toLocaleString()}`);
  if (skipped.length) console.log(`Skipped (no geometry): ${skipped.length}`);
  console.log('─────────────────────────────────────────────────');
  console.log('Done.');
}

main();
