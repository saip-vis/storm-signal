/**
 * census.js — Census tract geometry and population data.
 *
 * Sources:
 *   Boundaries: TIGER/Line via Census ARCGIS REST service
 *   Population: ACS 5-Year Estimates 2022 via Census Data API
 *   Coverage:   Collin County, TX (FIPS 48085) — includes Richardson, TX
 */

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUALIZATION_REGION_ID, region } from './regions.js';
import { validBbox, intersectsBbox } from './buildings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CENSUS_SCHEMA_VERSION = 1;

// Richardson vicinity bounding box used to filter tracts after fetching
export const RICHARDSON_VICINITY_BBOX = region(VISUALIZATION_REGION_ID).bbox;

// ── Path helpers ─────────────────────────────────────────────────────────────

export function censusCachePath() {
  return path.join(root, 'data', 'census', 'cache', 'richardson-study-tracts.json');
}

// ── Bbox helpers ─────────────────────────────────────────────────────────────

// Compute axis-aligned bbox from a GeoJSON geometry's outer ring(s).
function geometryBbox(geometry) {
  const coords =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.coordinates.flatMap(poly => poly[0]);
  return [
    Math.min(...coords.map(c => c[0])),
    Math.min(...coords.map(c => c[1])),
    Math.max(...coords.map(c => c[0])),
    Math.max(...coords.map(c => c[1]))
  ];
}

// Returns true if the geometry's bbox overlaps [west, south, east, north].
function geometryBboxOverlaps(geometry, [west, south, east, north]) {
  const [minLon, minLat, maxLon, maxLat] = geometryBbox(geometry);
  return minLon < east && maxLon > west && minLat < north && maxLat > south;
}

// ── Normalization ─────────────────────────────────────────────────────────────

// Normalize a TIGER GeoJSON feature joined with an ACS data row.
// acsRow may be null if no matching population data was found.
export function normalizeTract(tigerFeature, acsRow, acquiredAt, dataYear=2022) {
  const props = tigerFeature.properties ?? {};
  const geoid = props.GEOID ?? props.geoid ?? null;
  const name = props.NAME ?? props.name ?? (geoid ? `Census Tract ${geoid.slice(5)}` : 'Unknown');
  const numeric=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
  const population = acsRow ? numeric(acsRow[0]) : null;
  const housingUnits = acsRow ? numeric(acsRow[1]) : null;

  const sourceInfo = {
    provider: 'US Census Bureau',
    geometrySource: 'TIGER/Line',
    populationSource: `ACS 5-Year Estimates ${dataYear}`,
    acquiredAt
  };

  return {
    geoid,
    name,
    geometry: tigerFeature.geometry,
    population,
    housingUnits,
    dataYear,
    source: sourceInfo
  };
}

// ── Snapshot validation ───────────────────────────────────────────────────────

function censusSnapshotValid(snapshot) {
  return (
    snapshot?.schemaVersion === CENSUS_SCHEMA_VERSION &&
    typeof snapshot.fips === 'string' &&
    Array.isArray(snapshot.features) &&
    snapshot.features.every(t => t?.geoid && t?.geometry)
  );
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function loadCensusSnapshot(cachePath = censusCachePath()) {
  try {
    await access(cachePath);
    const snapshot = JSON.parse(await readFile(cachePath, 'utf8'));
    if (!censusSnapshotValid(snapshot)) throw new Error('Invalid or corrupted Census snapshot');
    return snapshot;
  } catch (error) {
    throw new Error(
      `No valid Census cache available (${error.code ?? error.message}). ` +
      `Run npm run data:census:fetch to download tract boundaries and population data.`
    );
  }
}

export async function writeCensusSnapshot(snapshot, cachePath = censusCachePath()) {
  if (!censusSnapshotValid(snapshot)) throw new Error('Refusing to write an invalid Census snapshot');
  await mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot, null, 2));
  await rename(temporary, cachePath);
  return snapshot;
}

// ── API response builder ──────────────────────────────────────────────────────

export async function censusResponse({ format, bbox, cachePath } = {}) {
  const snapshot = await loadCensusSnapshot(cachePath);

  let features = snapshot.features;

  // Apply optional spatial bbox filter
  if (bbox) {
    const parsed = Array.isArray(bbox)
      ? bbox.map(Number)
      : String(bbox).split(',').map(Number);
    if(!validBbox(parsed))throw new Error('Invalid Census bbox; expected west,south,east,north');
    features = features.filter(t => intersectsBbox(t.geometry, parsed));
  }

  const summary = {
    locationId: snapshot.locationId??VISUALIZATION_REGION_ID,
    county: snapshot.county,
    fips: snapshot.fips,
    tractCount: features.length,
    dataYear: snapshot.dataYear??2022,
    source: snapshot.source
  };

  if (format === 'geojson') {
    return {
      type: 'FeatureCollection',
      features: features.map(t => ({
        type: 'Feature',
        id: t.geoid,
        geometry: t.geometry,
        properties: {
          geoid: t.geoid,
          name: t.name,
          population: t.population,
          housingUnits: t.housingUnits,
          dataYear: t.dataYear,
          source: t.source
        }
      })),
      metadata: summary
    };
  }

  return { ...summary, features };
}
