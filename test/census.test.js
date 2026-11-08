import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  CENSUS_SCHEMA_VERSION,
  loadCensusSnapshot,
  writeCensusSnapshot,
  censusResponse
} from '../src/census.js';
import { calculateDirectCommunityImpact } from '../src/simulation/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'data', 'census', 'fixtures', 'richardson-tracts-fixture.json');

// Minimal synthetic attributes used by the fallback path of calculateDirectCommunityImpact
const stubAttributes = {
  communities: {
    'neighborhood:test-area': {
      population: 1000,
      footprintExposureFraction: 0.3,
      displacementFraction: 0.5,
      shelterSeekingFraction: 0.4
    }
  }
};

// Minimal scenario with a small flood polygon inside Richardson vicinity
const stubScenario = {
  id: 'test-flood',
  disasterType: 'flood',
  severity: 3,
  durationHours: 24,
  locationId: 'richardson-tx',
  assumptions: [],
  footprint: {
    type: 'Polygon',
    coordinates: [[
      [-96.737, 32.947],
      [-96.728, 32.947],
      [-96.728, 32.957],
      [-96.737, 32.957],
      [-96.737, 32.947]
    ]]
  }
};

// ── TEST 1: loadCensusSnapshot loads fixture correctly ───────────────────────

test('loadCensusSnapshot loads fixture correctly', async () => {
  const fixtureRaw = JSON.parse(await readFile(fixturePath, 'utf8'));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'census-'));
  const cachePath = path.join(dir, 'tracts.json');
  await writeCensusSnapshot(fixtureRaw, cachePath);

  const snapshot = await loadCensusSnapshot(cachePath);

  assert.equal(snapshot.schemaVersion, CENSUS_SCHEMA_VERSION);
  assert.equal(snapshot.tractCount, 5);
  assert.equal(snapshot.features.length, 5);
  assert.equal(snapshot.fips, '48085');

  for (const tract of snapshot.features) {
    assert.ok(tract.geoid, 'each tract must have a geoid');
    assert.ok(tract.geometry, 'each tract must have a geometry');
    assert.ok(typeof tract.population === 'number', 'population must be a number');
    assert.ok(typeof tract.housingUnits === 'number', 'housingUnits must be a number');
    assert.ok(tract.population >= 2000 && tract.population <= 6000,
      `population ${tract.population} should be in realistic range`);
  }
});

// ── TEST 2: censusResponse returns GeoJSON FeatureCollection ─────────────────

test('censusResponse returns GeoJSON FeatureCollection', async () => {
  const fixtureRaw = JSON.parse(await readFile(fixturePath, 'utf8'));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'census-geo-'));
  const cachePath = path.join(dir, 'tracts.json');
  await writeCensusSnapshot(fixtureRaw, cachePath);

  const result = await censusResponse({ format: 'geojson', cachePath });

  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 5);
  assert.equal(result.metadata.tractCount, 5);
  assert.equal(result.metadata.fips, '48085');

  for (const feature of result.features) {
    assert.equal(feature.type, 'Feature');
    assert.ok(feature.geometry, 'each feature must have geometry');
    assert.ok(feature.properties.geoid, 'each feature must have geoid property');
    assert.ok(typeof feature.properties.population === 'number');
  }
});

// ── TEST 3: censusResponse with bbox filter returns subset ───────────────────

test('censusResponse with bbox filter returns only overlapping tracts', async () => {
  const fixtureRaw = JSON.parse(await readFile(fixturePath, 'utf8'));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'census-bbox-'));
  const cachePath = path.join(dir, 'tracts.json');
  await writeCensusSnapshot(fixtureRaw, cachePath);

  // This bbox only overlaps Census Tract 213 (Central: lon -96.740…-96.725, lat 32.945…32.960)
  // West boundary (-96.738) excludes West tract (maxLon -96.740)
  // East boundary (-96.727) excludes East tract (minLon -96.725)
  // North boundary (32.958) excludes North tract (minLat 32.960)
  // South boundary (32.947) excludes South tract (maxLat 32.945)
  const bbox = [-96.738, 32.947, -96.727, 32.958];

  const result = await censusResponse({ format: 'geojson', bbox, cachePath });

  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 1, 'only 1 tract should match the tight bbox');
  assert.equal(result.features[0].properties.geoid, '48085021300');
});

// ── TEST 4: calculateDirectCommunityImpact with Census tracts ────────────────

test('calculateDirectCommunityImpact uses real Census tracts when provided', () => {
  // Two tracts: Central (213) and North (214)
  // The stubScenario flood polygon overlaps Central but not North
  const tracts = [
    {
      geoid: '48085021300',
      name: 'Census Tract 213',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-96.740, 32.945], [-96.725, 32.945],
          [-96.725, 32.960], [-96.740, 32.960],
          [-96.740, 32.945]
        ]]
      },
      population: 3500,
      housingUnits: 1400,
      dataYear: 2022,
      source: {}
    },
    {
      geoid: '48085021400',
      name: 'Census Tract 214',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-96.740, 32.960], [-96.725, 32.960],
          [-96.725, 32.975], [-96.740, 32.975],
          [-96.740, 32.960]
        ]]
      },
      population: 4200,
      housingUnits: 1800,
      dataYear: 2022,
      source: {}
    }
  ];

  const result = calculateDirectCommunityImpact(stubScenario, stubAttributes, tracts);

  assert.equal(result.dataSource, 'census_acs_2022_area_weighted');
  assert.ok(result.totalPopulationExposed > 0, 'should have exposed population from Census data');
  assert.ok(result.estimatedDisplacedResidents > 0, 'should have displaced residents');
  assert.equal(typeof result.displacementAssumption, 'string');
  assert.ok(result.displacementAssumption.length > 0);
  assert.ok(result.tractCount >= 1, 'at least one tract should contribute exposure');
  // Flood overlaps part of Central tract (3500 pop) — expect > 0 exposed
  assert.ok(result.totalPopulationExposed <= 3500 + 4200, 'cannot exceed total population');
});

// ── TEST 5: calculateDirectCommunityImpact fallback with tracts=[] ───────────

test('calculateDirectCommunityImpact uses synthetic fallback when tracts is empty', () => {
  const result = calculateDirectCommunityImpact(stubScenario, stubAttributes, []);

  assert.equal(result.dataSource, 'synthetic_fixture');
  assert.equal(result.tractCount, 0);

  // Synthetic: population=1000, exposureFraction=0.3, displacementFraction=0.5
  // exposedPop = 1000 × 0.3 = 300
  // displaced = 300 × 0.5 = 150
  assert.equal(result.totalPopulationExposed, 300);
  assert.equal(result.estimatedDisplacedResidents, 150);
  // shelterSeekers = 150 × 0.4 = 60
  assert.equal(result.estimatedShelterSeekers, 60);
  assert.ok(Array.isArray(result.neighborhoods));
  assert.equal(result.neighborhoods.length, 1);
});
