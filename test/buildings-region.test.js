import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  BUILDING_SCHEMA_VERSION,
  normalizeBuilding,
  writeSnapshot,
  loadSnapshot,
  buildingResponse,
  buildingPathsFor
} from '../src/buildings.js';
import { VISUALIZATION_REGION_ID } from '../src/regions.js';

const LARGE_BBOX = [-96.755, 32.935, -96.705, 32.975];

const polygonAt = (lon, lat) => ({
  type: 'Polygon',
  coordinates: [[
    [lon, lat],
    [lon + 0.001, lat],
    [lon + 0.001, lat + 0.001],
    [lon, lat + 0.001],
    [lon, lat]
  ]]
});

const feature = (id, geometry) => ({
  type: 'Feature',
  geometry,
  properties: { id, class: 'commercial', height: 10 }
});

function snapshotOf(features) {
  return {
    schemaVersion: BUILDING_SCHEMA_VERSION,
    locationId: VISUALIZATION_REGION_ID,
    coverage: { locationId: VISUALIZATION_REGION_ID, bbox: LARGE_BBOX },
    source: { provider: 'Overture Maps', datasetRelease: '2026-10-21.0', acquiredAt: '2026-11-08T00:00:00.000Z' },
    rawRecordCount: features.length,
    acceptedRecordCount: features.length,
    rejectedRecordCount: 0,
    featureCount: features.length,
    rejected: [],
    features
  };
}

test('normalizeBuilding with large region bbox accepts a polygon rejected by the tiny pilot bbox', () => {
  // West of the tiny pilot [-96.731, 32.950, -96.727, 32.954], inside north-central study
  const westOfPilot = polygonAt(-96.740, 32.940);
  assert.throws(
    () => normalizeBuilding(feature('west', westOfPilot)),
    /intersect/
  );
  const accepted = normalizeBuilding(feature('west', westOfPilot), { bbox: LARGE_BBOX });
  assert.equal(accepted.id, 'overture:west');
  assert.equal(accepted.providerId, 'west');
  assert.ok(accepted.geometry);
});

test('buildingResponse for north-central study returns that cache, not the tiny one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buildings-large-'));
  const cachePath = path.join(dir, 'richardson-north-central-study-buildings.json');
  const large = normalizeBuilding(feature('large-only', polygonAt(-96.740, 32.940)), { bbox: LARGE_BBOX });
  await writeSnapshot(snapshotOf([large]), cachePath);

  const geo = await buildingResponse({
    locationId: VISUALIZATION_REGION_ID,
    cachePath,
    geojson: true,
    limit: 50
  });
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.metadata.locationId, VISUALIZATION_REGION_ID);
  assert.equal(geo.features.length, 1);
  assert.equal(geo.features[0].properties.providerId, 'large-only');
  assert.equal(geo.features.some(f => f.properties.providerId === 'one'), false);
});

test('missing large cache does not destroy or replace the tiny cache', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buildings-tiny-safe-'));
  const tinyCache = path.join(dir, 'richardson-tx-buildings.json');
  const missingLarge = path.join(dir, 'richardson-north-central-study-buildings.json');
  const tinyFeature = normalizeBuilding(feature('tiny', polygonAt(-96.730, 32.951)));
  await writeSnapshot({
    ...snapshotOf([tinyFeature]),
    locationId: 'richardson-tx'
  }, tinyCache);

  const productionTiny = buildingPathsFor('richardson-central-test').cache;
  const productionLarge = buildingPathsFor(VISUALIZATION_REGION_ID).cache;
  assert.notEqual(productionTiny, productionLarge);
  const productionBefore = await readFile(productionTiny, 'utf8');
  const productionSnapshot = JSON.parse(productionBefore);
  assert.equal(productionSnapshot.acceptedRecordCount, 28);
  assert.equal(productionSnapshot.features.length, 28);

  await assert.rejects(() => loadSnapshot(missingLarge), /No valid Overture building cache/);
  await assert.rejects(
    () => buildingResponse({ locationId: VISUALIZATION_REGION_ID, cachePath: missingLarge }),
    /No valid Overture building cache/
  );
  await access(tinyCache);
  const stillThere = JSON.parse(await readFile(tinyCache, 'utf8'));
  assert.equal(stillThere.features.length, 1);
  assert.equal(stillThere.features[0].providerId, 'tiny');
  const reloaded = await loadSnapshot(tinyCache);
  assert.equal(reloaded.features.length, 1);

  const productionAfter = await readFile(productionTiny, 'utf8');
  assert.equal(productionAfter, productionBefore);
});
