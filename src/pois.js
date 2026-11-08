import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUALIZATION_REGION_ID as DEFAULT_REGION_ID, region as configuredRegion } from './regions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const POI_SCHEMA_VERSION = 1;

// Categories treated as essential infrastructure for resilience modeling.
export const ESSENTIAL_CATEGORIES = [
  'pharmacy',
  'hospital',
  'clinic',
  'school',
  'community_center',
  'library',
  'supermarket',
  'grocery'
];

// ── Path helpers ─────────────────────────────────────────────────────────────

// Returns the cache file path for a given region ID.
// e.g. poiCachePath('richardson-central-test')
//      → data/businesses/cache/richardson-central-test-pois.json
export function poiCachePath(regionId = DEFAULT_REGION_ID) {
  return path.join(root, 'data', 'businesses', 'cache', `${regionId}-pois.json`);
}

// ── Category mapping ─────────────────────────────────────────────────────────

// Map raw OSM tags to a canonical category string.
function categoryFromTags(tags = {}) {
  if (tags.amenity === 'pharmacy') return 'pharmacy';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.amenity === 'clinic' || tags.amenity === 'doctors') return 'clinic';
  if (tags.amenity === 'school') return 'school';
  if (tags.amenity === 'community_centre') return 'community_center';
  if (tags.amenity === 'library') return 'library';
  if (tags.amenity === 'supermarket' || tags.shop === 'supermarket') return 'supermarket';
  if (tags.shop === 'grocery') return 'grocery';
  if (tags.shop === 'convenience') return 'convenience';
  return 'facility';
}

// ── Normalization ─────────────────────────────────────────────────────────────

// Normalize a raw Overpass element into the POI schema.
// Throws if the element has no valid coordinates — never silently produces
// a POI with null/undefined coordinates.
export function normalizePoi(element, source = {}) {
  const tags = element.tags ?? {};
  let lon, lat, coordinatesSource;

  if (element.type === 'node') {
    if (typeof element.lon !== 'number' || typeof element.lat !== 'number') {
      throw new Error(`OSM node ${element.id} has no valid coordinates`);
    }
    lon = element.lon;
    lat = element.lat;
    coordinatesSource = 'node';
  } else if (element.type === 'way') {
    // Way elements only have coordinates via the "center" field when queried
    // with "out center". If center is absent, the record is rejected.
    if (
      !element.center ||
      typeof element.center.lon !== 'number' ||
      typeof element.center.lat !== 'number'
    ) {
      throw new Error(`OSM way ${element.id} has no center coordinates (query with "out center")`);
    }
    lon = element.center.lon;
    lat = element.center.lat;
    coordinatesSource = 'way_center';
  } else {
    throw new Error(`Unsupported OSM element type: ${element.type ?? 'unknown'}`);
  }

  const category = categoryFromTags(tags);
  const hasName = Boolean(tags.name);
  const name = tags.name || `${category} (unnamed)`;

  const address = {
    street: tags['addr:street'] ?? null,
    city: tags['addr:city'] ?? null,
    state: tags['addr:state'] ?? null,
    postcode: tags['addr:postcode'] ?? null
  };

  const missingFields = [];
  if (!hasName) missingFields.push('name');
  if (!address.street) missingFields.push('address.street');
  if (!address.city) missingFields.push('address.city');

  return {
    id: `osm:${element.type}:${element.id}`,
    osmId: element.id,
    osmType: element.type,
    name,
    category,
    coordinates: [lon, lat],
    address,
    tags,
    source,
    dataQuality: {
      hasName,
      coordinatesSource,
      missingFields
    }
  };
}

// ── Snapshot validation ───────────────────────────────────────────────────────

export function snapshotValid(snapshot) {
  return (
    snapshot?.schemaVersion === POI_SCHEMA_VERSION &&
    Array.isArray(snapshot.features) &&
    snapshot.features.every(
      feature =>
        typeof feature?.id === 'string' &&
        Array.isArray(feature.coordinates) &&
        feature.coordinates.length === 2 &&
        typeof feature.coordinates[0] === 'number' &&
        typeof feature.coordinates[1] === 'number'
    )
  );
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function loadPoiSnapshot(cachePath) {
  try {
    await access(cachePath);
    const snapshot = JSON.parse(await readFile(cachePath, 'utf8'));
    if (!snapshotValid(snapshot)) throw new Error('Invalid or corrupted POI cache');
    return { ...snapshot, source: { ...snapshot.source, cacheStatus: 'cached' } };
  } catch (error) {
    throw new Error(
      `No valid OSM POI cache is available (${error.code ?? error.message}). ` +
      `Run npm run data:pois:fetch to download real POI data.`
    );
  }
}

export async function writePoiSnapshot(snapshot, cachePath) {
  if (!snapshotValid(snapshot)) throw new Error('Refusing to write an invalid POI snapshot');
  await mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot));
  await rename(temporary, cachePath);
  return snapshot;
}

// ── Region resolution ─────────────────────────────────────────────────────────

// "richardson-tx" is accepted as a legacy alias for the default region.
// All canonical region IDs are defined in regions.js.
function resolvePoiRegion(locationId = 'richardson-tx') {
  const id = locationId === 'richardson-tx' ? DEFAULT_REGION_ID : locationId;
  try {
    return configuredRegion(id);
  } catch {
    throw new Error(`Unsupported location ID for POI data: ${locationId}`);
  }
}

// ── API response builder ──────────────────────────────────────────────────────

// Returns either a raw list or a GeoJSON FeatureCollection of POIs.
// cachePath may be overridden for tests — defaults to poiCachePath(region.id).
export async function poiResponse({
  locationId = 'richardson-tx',
  category,
  limit = 100,
  offset = 0,
  geojson = false,
  cachePath
} = {}) {
  const region = resolvePoiRegion(locationId);
  const resolvedCachePath = cachePath ?? poiCachePath(region.id);
  const snapshot = await loadPoiSnapshot(resolvedCachePath);

  offset = Math.max(0, Number(offset) || 0);
  limit = Math.min(Math.max(1, Number(limit) || 100), 500);

  const available = category
    ? snapshot.features.filter(poi => poi.category === category)
    : snapshot.features;

  const selected = available.slice(offset, offset + limit);

  const metadata = {
    locationId: region.id,
    source: snapshot.source,
    schemaVersion: snapshot.schemaVersion,
    totalCount: available.length,
    offset,
    limit,
    categoryFilter: category ?? null,
    cacheStatus: 'valid'
  };

  if (geojson) {
    return {
      type: 'FeatureCollection',
      features: selected.map(poi => ({
        type: 'Feature',
        id: poi.id,
        geometry: {
          type: 'Point',
          coordinates: poi.coordinates
        },
        properties: {
          id: poi.id,
          osmId: poi.osmId,
          osmType: poi.osmType,
          name: poi.name,
          category: poi.category,
          address: poi.address,
          source: poi.source,
          dataQuality: poi.dataQuality,
          tags: poi.tags
        }
      })),
      metadata
    };
  }

  return { ...metadata, features: selected };
}
