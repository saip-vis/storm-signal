import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  POI_SCHEMA_VERSION,
  ESSENTIAL_CATEGORIES,
  normalizePoi,
  snapshotValid,
  loadPoiSnapshot,
  writePoiSnapshot,
  poiResponse
} from '../src/pois.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'data', 'businesses', 'fixtures', 'osm-richardson-pois-fixture.json');

// Shared source stub used in multiple tests
const stubSource = {
  provider: 'OpenStreetMap',
  queryBbox: [-96.755, 32.935, -96.705, 32.975],
  acquiredAt: '2026-11-08T10:00:00.000Z',
  overpassEndpoint: 'https://overpass-api.de/api/interpreter'
};

// ── TEST 1: normalizePoi handles node elements correctly ─────────────────────

test('normalizePoi handles node elements correctly', () => {
  const element = {
    type: 'node',
    id: 999001,
    lat: 32.952,
    lon: -96.730,
    tags: {
      amenity: 'pharmacy',
      name: 'Test Pharmacy',
      'addr:street': 'Main St',
      'addr:city': 'Richardson',
      'addr:state': 'TX',
      'addr:postcode': '75080'
    }
  };

  const poi = normalizePoi(element, stubSource);

  assert.equal(poi.id, 'osm:node:999001');
  assert.equal(poi.osmId, 999001);
  assert.equal(poi.osmType, 'node');
  assert.equal(poi.name, 'Test Pharmacy');
  assert.equal(poi.category, 'pharmacy');
  assert.deepEqual(poi.coordinates, [-96.730, 32.952]);
  assert.equal(poi.dataQuality.hasName, true);
  assert.equal(poi.dataQuality.coordinatesSource, 'node');
  assert.deepEqual(poi.source, stubSource);
});

// ── TEST 2: normalizePoi handles way elements with center ────────────────────

test('normalizePoi handles way elements with center', () => {
  const element = {
    type: 'way',
    id: 888001,
    center: { lat: 32.945, lon: -96.738 },
    // No direct lat/lon on way elements — coordinates come from center
    tags: {
      amenity: 'supermarket',
      name: 'Kroger Richardson'
    }
  };

  const poi = normalizePoi(element, stubSource);

  assert.equal(poi.id, 'osm:way:888001');
  assert.equal(poi.osmType, 'way');
  assert.equal(poi.category, 'supermarket');
  assert.deepEqual(poi.coordinates, [-96.738, 32.945]);
  assert.equal(poi.dataQuality.coordinatesSource, 'way_center');
  assert.equal(poi.dataQuality.hasName, true);
});

// ── TEST 3: normalizePoi rejects elements without valid coordinates ───────────

test('normalizePoi rejects elements without valid coordinates', () => {
  const wayWithoutCenter = {
    type: 'way',
    id: 777001,
    // No center field — this is what happens when queried without "out center"
    tags: { amenity: 'hospital', name: 'Mystery Hospital' }
  };

  assert.throws(
    () => normalizePoi(wayWithoutCenter, stubSource),
    /center coordinates/
  );
});

// ── TEST 4: normalizePoi applies fallback name when tags.name is missing ──────

test('normalizePoi applies fallback name when tags.name is missing', () => {
  const element = {
    type: 'node',
    id: 666001,
    lat: 32.950,
    lon: -96.729,
    tags: { amenity: 'clinic' } // no name tag
  };

  const poi = normalizePoi(element, stubSource);

  assert.equal(typeof poi.name, 'string');
  assert.ok(poi.name.length > 0, 'fallback name must be non-empty');
  assert.equal(poi.dataQuality.hasName, false);
  assert.ok(poi.dataQuality.missingFields.includes('name'));
});

// ── TEST 5: normalizePoi maps all ESSENTIAL_CATEGORIES correctly ─────────────

test('normalizePoi maps all ESSENTIAL_CATEGORIES correctly', () => {
  const tagSets = [
    { amenity: 'pharmacy' },
    { amenity: 'hospital' },
    { amenity: 'clinic' },
    { amenity: 'school' },
    { amenity: 'community_centre' },
    { amenity: 'library' },
    { amenity: 'supermarket' },
    { shop: 'grocery' }
  ];

  const expected = ESSENTIAL_CATEGORIES; // ['pharmacy','hospital','clinic','school','community_center','library','supermarket','grocery']

  tagSets.forEach((tags, i) => {
    const element = {
      type: 'node',
      id: 500000 + i,
      lat: 32.950,
      lon: -96.729,
      tags: { ...tags, name: `Test ${expected[i]}` }
    };
    const poi = normalizePoi(element, stubSource);
    assert.equal(
      poi.category,
      expected[i],
      `tags ${JSON.stringify(tags)} should map to category "${expected[i]}"`
    );
  });
});

// ── TEST 6: snapshotValid and writePoiSnapshot round-trip ────────────────────

test('snapshotValid and writePoiSnapshot round-trip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pois-'));
  const cachePath = path.join(dir, 'test-pois.json');

  const pois = [
    normalizePoi({ type: 'node', id: 1, lat: 32.952, lon: -96.730, tags: { amenity: 'pharmacy', name: 'P1' } }, stubSource),
    normalizePoi({ type: 'node', id: 2, lat: 32.953, lon: -96.731, tags: { amenity: 'hospital', name: 'H1' } }, stubSource),
    normalizePoi({ type: 'node', id: 3, lat: 32.954, lon: -96.732, tags: { shop: 'grocery', name: 'G1' } }, stubSource)
  ];

  const snapshot = {
    schemaVersion: POI_SCHEMA_VERSION,
    source: stubSource,
    locationId: 'richardson-central-test',
    rawElementCount: 3,
    acceptedCount: 3,
    rejectedCount: 0,
    rejected: [],
    features: pois
  };

  assert.ok(snapshotValid(snapshot), 'snapshot should be valid before writing');

  await writePoiSnapshot(snapshot, cachePath);
  const loaded = await loadPoiSnapshot(cachePath);

  assert.equal(loaded.features.length, 3);
  assert.equal(loaded.schemaVersion, POI_SCHEMA_VERSION);
  assert.equal(loaded.source.provider, stubSource.provider);
  assert.equal(loaded.source.acquiredAt, stubSource.acquiredAt);
  assert.equal(loaded.locationId, 'richardson-central-test');
});

// ── TEST 7: poiResponse returns correct GeoJSON FeatureCollection ─────────────

test('poiResponse returns correct GeoJSON FeatureCollection', async () => {
  const fixtureRaw = JSON.parse(await readFile(fixturePath, 'utf8'));
  const elements = fixtureRaw.elements;

  const pois = elements.map(el => normalizePoi(el, stubSource));

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pois-geo-'));
  const cachePath = path.join(dir, 'geo-pois.json');

  const snapshot = {
    schemaVersion: POI_SCHEMA_VERSION,
    source: stubSource,
    locationId: 'richardson-central-test',
    rawElementCount: elements.length,
    acceptedCount: pois.length,
    rejectedCount: 0,
    rejected: [],
    features: pois
  };

  await writePoiSnapshot(snapshot, cachePath);

  const result = await poiResponse({ geojson: true, cachePath, limit: 50 });

  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 8);
  assert.equal(result.metadata.totalCount, 8);

  for (const feature of result.features) {
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Point');
    assert.ok(Array.isArray(feature.geometry.coordinates));
    assert.equal(feature.geometry.coordinates.length, 2);
    assert.ok(typeof feature.properties.name === 'string');
    assert.ok(typeof feature.properties.category === 'string');
  }
});

// ── TEST 8: poiResponse filters by category correctly ────────────────────────

test('poiResponse filters by category correctly', async () => {
  const fixtureRaw = JSON.parse(await readFile(fixturePath, 'utf8'));
  const pois = fixtureRaw.elements.map(el => normalizePoi(el, stubSource));

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pois-filter-'));
  const cachePath = path.join(dir, 'filter-pois.json');

  const snapshot = {
    schemaVersion: POI_SCHEMA_VERSION,
    source: stubSource,
    locationId: 'richardson-central-test',
    rawElementCount: pois.length,
    acceptedCount: pois.length,
    rejectedCount: 0,
    rejected: [],
    features: pois
  };

  await writePoiSnapshot(snapshot, cachePath);

  // Fixture has 2 pharmacies — the filter should return exactly those
  const result = await poiResponse({ geojson: true, category: 'pharmacy', cachePath });

  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 2, 'fixture has 2 pharmacies');
  assert.equal(result.metadata.totalCount, 2);
  assert.equal(result.metadata.categoryFilter, 'pharmacy');

  for (const feature of result.features) {
    assert.equal(feature.properties.category, 'pharmacy');
  }
});
