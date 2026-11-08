/**
 * fetch-census.js
 *
 * Downloads Census tract boundaries (TIGER/Line) and ACS 5-year population
 * estimates for Collin County, TX (FIPS 48085 — includes Richardson, TX).
 *
 * Usage: node scripts/fetch-census.js
 *        npm run data:census:fetch
 *
 * On TIGER failure: preserves existing cache, exits code 1.
 * On ACS failure: saves geometry-only snapshot (populationAvailable: false)
 *   rather than exiting — the Census tract map layer still renders.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUALIZATION_REGION_ID } from '../src/regions.js';
import {
  CENSUS_SCHEMA_VERSION,
  RICHARDSON_VICINITY_BBOX,
  normalizeTract,
  writeCensusSnapshot,
  censusCachePath
} from '../src/census.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── API key support ───────────────────────────────────────────────────────────

const API_KEY = process.env.CENSUS_API_KEY ?? '';
const KEY_SUFFIX = API_KEY ? `&key=${encodeURIComponent(API_KEY)}` : '';

// ── Endpoints ─────────────────────────────────────────────────────────────────

const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query' +
  "?where=STATE%3D'48'+AND+COUNTY+IN+('085','113')" +
  '&outFields=GEOID,NAME' +
  '&f=geojson' +
  '&outSR=4326';

// ACS year candidates — tried in order; first success wins
const ACS_YEAR_CANDIDATES = [2022, 2021, 2023];

function acsUrl(year) {
  return (
    `https://api.census.gov/data/${year}/acs/acs5` +
    '?get=B01003_001E,B25001_001E,NAME' +
    '&for=tract:*' +
    `&in=state:48%20county:*${KEY_SUFFIX}`
  );
}

// ── Output paths ──────────────────────────────────────────────────────────────

const RAW_DIR = path.join(root, 'data', 'census', 'raw');
const GEO_RAW_PATH = path.join(RAW_DIR, 'collin-county-tracts-geo.json');
const ACS_RAW_PATH = path.join(RAW_DIR, 'collin-county-acs.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return parsed JSON.
 * Before parsing, checks the Content-Type to guard against HTML error pages
 * (the Census ACS API sometimes returns a 200 HTML page during maintenance).
 */
async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ResilienceOS/1.0 (research project; non-commercial)'
    },
    signal: AbortSignal.timeout(20000)
  });

  // Always read body as text first so we can inspect it safely
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  // Guard against HTML error pages returned with a 200 status.
  // Accept any *json* type (application/json, application/geo+json, etc.) or text/plain.
  // Reject text/html which signals an error page or redirect.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Error(
      `Expected JSON but got "${contentType}" — server returned an HTML page (maintenance or error). ` +
      `First 200 chars: ${text.slice(0, 200)}`
    );
  }
  if (!contentType && !text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
    throw new Error(
      `Expected JSON but got empty content-type and non-JSON body. ` +
      `First 200 chars: ${text.slice(0, 200)}`
    );
  }

  return JSON.parse(text);
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
  console.log(`API key: ${API_KEY ? '[set]' : '[not set — 500 req/day limit]'}`);

  // ── Step 1: Fetch TIGER boundaries (required) ──────────────────────────────
  console.log('\n[1/3] Fetching TIGER/Line tract boundaries…');
  let geoData;
  try {
    geoData = await fetchJson(TIGER_URL, 'TIGER/Line');
    if(geoData.error||geoData.exceededTransferLimit||!Array.isArray(geoData.features))throw new Error('Census returned an error or truncated geometry response; cache preserved.');
  } catch (error) {
    console.error(`\nFetch failed (TIGER): ${error.message}`);
    console.error('Existing cache (if any) has NOT been modified.');
    process.exit(1);
  }
  console.log(`     ${geoData.features?.length ?? 0} tract geometries received.`);

  // ── Step 2: Fetch ACS population data (optional — tries multiple years) ────
  console.log('\n[2/3] Fetching ACS 5-year population estimates…');
  let acsData = null;
  let acsYear = null;
  let populationAvailable = false;

  for (const year of ACS_YEAR_CANDIDATES) {
    try {
      const url = acsUrl(year);
      acsData = await fetchJson(url, `ACS ${year}`);
      acsYear = year;
      populationAvailable = true;
      console.log(`     ACS ${year} data received (${acsData.length - 1} rows).`);
      break;
    } catch (error) {
      console.warn(`     ACS ${year} failed: ${error.message}`);
      // Continue to next year — do not exit
    }
  }

  if (!populationAvailable) {
    console.warn('\n  ⚠  ACS population data unavailable for all years tried.');
    console.warn('     Tract boundaries will be saved without population estimates.');
    console.warn('     The Census tract map layer will still render.');
  }

  // ── Build GEOID → ACS row lookup ───────────────────────────────────────────
  const acsMap = new Map();
  if (acsData) {
    // acsData[0] = header row; acsData[1..] = data rows
    // Columns: [B01003_001E, B25001_001E, NAME, state, county, tract]
    const headers = acsData[0];
    const popIdx = headers.indexOf('B01003_001E');
    const housingIdx = headers.indexOf('B25001_001E');
    const stateIdx = headers.indexOf('state');
    const countyIdx = headers.indexOf('county');
    const tractIdx = headers.indexOf('tract');

    for (const row of acsData.slice(1)) {
      const geoid = row[stateIdx] + row[countyIdx] + row[tractIdx];
      acsMap.set(geoid, [row[popIdx], row[housingIdx]]);
    }
  }

  // ── Step 3: Save raw data and build snapshot ───────────────────────────────
  console.log('\n[3/3] Saving raw data and building snapshot…');
  const acquiredAt = new Date().toISOString();
  await mkdir(RAW_DIR, { recursive: true });

  await writeFile(GEO_RAW_PATH, JSON.stringify(geoData, null, 2));
  console.log(`     Raw geometry  → ${path.relative(root, GEO_RAW_PATH)}`);

  if (acsData) {
    await writeFile(ACS_RAW_PATH, JSON.stringify(acsData, null, 2));
    console.log(`     Raw ACS       → ${path.relative(root, ACS_RAW_PATH)}`);
  }

  // ── Normalize + filter ────────────────────────────────────────────────────
  const features = [];
  const skipped = [];

  for (const feature of geoData.features ?? []) {
    if (!feature.geometry) {
      skipped.push({ reason: 'no geometry', geoid: feature.properties?.GEOID });
      continue;
    }
    if (!geometryBboxOverlaps(feature.geometry, RICHARDSON_VICINITY_BBOX)) continue;
    const geoid = feature.properties?.GEOID ?? feature.properties?.geoid ?? null;
    const acsRow = geoid ? (acsMap.get(geoid) ?? null) : null;
    features.push(normalizeTract(feature, acsRow, acquiredAt, acsYear??2022));
  }

  // ── Warn if GEOID join coverage is low ───────────────────────────────────
  if (populationAvailable && features.length > 0) {
    const matched = features.filter(t => t.population !== null).length;
    const matchRate = matched / features.length;
    if (matchRate < 0.5) {
      console.warn(
        `\n  ⚠  Warning: only ${matched}/${features.length} tracts matched ACS data ` +
        `(${Math.round(matchRate * 100)}%) — GEOIDs may not align between TIGER and ACS response.`
      );
    }
  }

  // ── Build and write snapshot ──────────────────────────────────────────────
  const snapshot = {
    schemaVersion: CENSUS_SCHEMA_VERSION,
    county: 'Dallas and Collin Counties, TX (study-region intersections)',
    fips: '48113,48085',
    locationId: VISUALIZATION_REGION_ID,
    bbox: RICHARDSON_VICINITY_BBOX,
    tractCount: features.length,
    acquiredAt,
    populationAvailable,
    dataYear: acsYear ?? null,
    source: {
      provider: 'US Census Bureau',
      geometrySource: 'TIGER/Line',
      populationSource: populationAvailable
        ? `ACS 5-Year Estimates ${acsYear}`
        : 'unavailable — geometry only'
    },
    features
  };

  const cachePath = censusCachePath();
  await writeCensusSnapshot(snapshot, cachePath);
  console.log(`     Cache snapshot → ${path.relative(root, cachePath)}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────');
  console.log(`TIGER tracts total      : ${geoData.features?.length ?? 0}`);
  console.log(`In Richardson vicinity  : ${features.length}`);
  console.log(`ACS year used           : ${acsYear ?? 'none (geometry only)'}`);
  console.log(`ACS rows matched        : ${features.filter(t => t.population !== null).length}`);
  console.log(`Total population        : ${features.reduce((s, t) => s + (t.population ?? 0), 0).toLocaleString()}`);
  console.log(`Total housing units     : ${features.reduce((s, t) => s + (t.housingUnits ?? 0), 0).toLocaleString()}`);
  console.log(`Population available    : ${populationAvailable}`);
  if (skipped.length) console.log(`Skipped (no geometry)   : ${skipped.length}`);
  console.log('─────────────────────────────────────────────────');
  console.log('Done.');
}

main();
