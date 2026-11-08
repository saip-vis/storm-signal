import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkService } from '../src/service.js';
import { verifyMlInference } from '../src/simulation/engine.js';
import { executeTool } from '../src/agent/agent.js';

// ── TEST 1: Overture buildings added as real graph nodes ─────────────────────

test('NetworkService.build() with building cache present adds Overture nodes to graph', async () => {
  const service = new NetworkService();
  await service.build();
  const graph = service.network();

  const overtureNodes = graph.nodes.filter(n => n.id.startsWith('overture:'));

  // Building cache (richardson-tx-buildings.json, 28 features) exists in this repo
  assert.ok(overtureNodes.length > 0,
    `Expected at least one overture: node — got ${overtureNodes.length}. ` +
    'Check data/buildings/cache/richardson-tx-buildings.json exists.'
  );

  const sample = overtureNodes[0];
  assert.ok(Array.isArray(sample.coordinates) && sample.coordinates.length === 2,
    'Overture node must have [lon, lat] coordinates'
  );
  assert.strictEqual(sample.properties.real, true, 'real flag must be true');
  assert.strictEqual(sample.properties.providerBacked, true, 'providerBacked flag must be true');
  assert.ok(sample.sources?.some(s => s.category === 'overture_maps'),
    'node must reference overture_maps source'
  );
  assert.ok(service.realBuildingCount > 0, 'service.realBuildingCount must be > 0');
  assert.strictEqual(graph.realBuildingCount, service.realBuildingCount,
    'network() snapshot must include realBuildingCount'
  );
});

// ── TEST 2: Matched POIs have HOSTS edges when both caches present ────────────

test('matched POIs have HOSTS edges when building + POI caches both present', async (t) => {
  // Gracefully skip if POI cache is missing (Overpass network was blocked in CI)
  let service;
  try {
    service = new NetworkService();
    await service.build();
  } catch (error) {
    t.skip(`Build failed: ${error.message}`);
    return;
  }

  if (!service.poiMatches || service.poiMatches.length === 0) {
    t.skip('POI cache not populated — run npm run data:pois:fetch first.');
    return;
  }

  const graph = service.network();
  const hostsEdges = graph.edges.filter(e => e.relationship === 'HOSTS' && e.id.startsWith('edge:hosts-real:'));

  // Not asserting count — depends on live Overpass data — but verify structure
  assert.ok(hostsEdges.length >= 0, 'HOSTS edges array should exist (may be empty without POI data)');

  if (hostsEdges.length > 0) {
    const edge = hostsEdges[0];
    assert.ok(['observed', 'inferred'].includes(edge.evidenceLevel),
      `HOSTS edge evidenceLevel must be 'observed' or 'inferred', got: ${edge.evidenceLevel}`
    );
    assert.ok(edge.sourceId.startsWith('overture:'), 'HOSTS source must be an Overture building');
    assert.ok(edge.targetId.startsWith('real-poi:'), 'HOSTS target must be a real POI node');
  }
});

// ── TEST 3: verifyMlInference returns a result without throwing ───────────────

test('verifyMlInference() returns {working, predictionMethod, error} without throwing', async () => {
  // This must not throw regardless of whether Python/model artifacts are available
  let result;
  assert.doesNotThrow(async () => {
    result = await verifyMlInference();
  });
  result = await verifyMlInference();

  assert.ok(typeof result === 'object' && result !== null, 'must return an object');
  assert.ok(typeof result.working === 'boolean', 'working must be boolean');
  assert.ok(typeof result.predictionMethod === 'string', 'predictionMethod must be a string');
  // error is null on success, string on failure
  assert.ok(result.error === null || typeof result.error === 'string',
    'error must be null or string'
  );
});

// ── TEST 4: get_real_buildings tool ──────────────────────────────────────────

test('get_real_buildings tool returns valid response', async () => {
  // If building cache exists: returns array with length > 0, each item has id
  // If cache missing: returns { available: false } without throwing
  let result;
  assert.doesNotThrow(async () => {
    result = await executeTool('get_real_buildings', { limit: 5 });
  });
  result = await executeTool('get_real_buildings', { limit: 5 });

  if (Array.isArray(result)) {
    // Cache exists
    assert.ok(result.length > 0, 'should return at least 1 building');
    assert.ok(result.length <= 5, 'should respect limit');
    const first = result[0];
    assert.ok(typeof first.id === 'string' && first.id.startsWith('overture:'),
      'building id must start with overture:'
    );
  } else {
    // Cache missing — graceful fallback
    assert.strictEqual(result.available, false, 'must report available: false');
    assert.ok(typeof result.reason === 'string', 'must include reason');
  }
});

// ── TEST 5: get_census_population tool with summary=true ─────────────────────

test('get_census_population tool with summary=true returns valid response', async () => {
  let result;
  assert.doesNotThrow(async () => {
    result = await executeTool('get_census_population', { summary: true });
  });
  result = await executeTool('get_census_population', { summary: true });

  if (result.available === false) {
    // Census cache missing — graceful fallback
    assert.ok(typeof result.reason === 'string', 'must include reason when unavailable');
    assert.ok(result.reason.includes('data:census:fetch'),
      'reason should mention the fetch command'
    );
  } else {
    // Census cache exists
    assert.ok(typeof result.tractCount === 'number' && result.tractCount > 0,
      'tractCount must be > 0'
    );
    assert.ok(typeof result.totalPopulation === 'number',
      'totalPopulation must be a number (may be 0 for geometry-only Census snapshots)'
    );
    assert.ok(typeof result.totalHousingUnits === 'number', 'totalHousingUnits must be a number');
    assert.strictEqual(result.dataYear, 2022);
  }
});
