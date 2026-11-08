import * as maplibregl from '/vendor/maplibre-gl.mjs';
import { inheritedPoint, networkToPoints, scenarioToFeatureCollection } from '/adapter.js';

const api = window.RESILIENCE_API_URL || window.location.origin;
const $ = selector => document.querySelector(selector);
const esc = value =>
  String(value ?? '—').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));

let graph, result, map, cy, scenario, selectedId, selectedFootprintId, footprints = [], realPois = [], censusTracts = [];
let cascadeAnimationId = null;

// ── HTTP helper ─────────────────────────────────────────────────────────────

async function request(path, options) {
  const response = await fetch(api + path, options);
  if (!response.ok) throw Error(await response.text());
  return response.json();
}

// ── Graph helpers ────────────────────────────────────────────────────────────

const status = id =>
  result?.failures?.find(failure => failure.nodeId === id)?.riskLevel ?? 'unknown';

const nodeFeatures = () =>
  graph ? networkToPoints(graph, status) : [];

// ── Inspector HTML builders ──────────────────────────────────────────────────

function section(title, body) {
  return `<section><h3>${title}</h3>${body}</section>`;
}

function rows(object) {
  return `<dl>${
    Object.entries(object).map(([key, value]) =>
      `<dt>${esc(key)}</dt><dd>${esc(
        Array.isArray(value)
          ? value.join(', ')
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : value
      )}</dd>`
    ).join('')
  }</dl>`;
}

// ── Map setup ────────────────────────────────────────────────────────────────

function setupMap() {
  map = new maplibregl.Map({
    container: 'map',
    center: [-96.729, 32.952],
    zoom: 14,
    pitch: 45,
    bearing: -15,
    style: 'https://tiles.openfreemap.org/styles/dark'
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

  map.on('load', () => {
    for (const name of ['nodes', 'footprints', 'flood', 'selected-footprint', 'real-pois', 'exposed-footprints', 'census-tracts', 'cascade-lines']) {
      map.addSource(name, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    // Census tract boundaries — rendered first (bottom) as a faint background grid
    map.addLayer({
      id: 'census-tract-fill',
      type: 'fill',
      source: 'census-tracts',
      paint: { 'fill-color': '#1a3a5c', 'fill-opacity': 0.25 }
    });
    map.addLayer({
      id: 'census-tract-line',
      type: 'line',
      source: 'census-tracts',
      paint: { 'line-color': '#2d6a9f', 'line-width': 0.8, 'line-dasharray': [3, 2] }
    });

    try {
      map.setFog({ color: '#07111f', 'horizon-blend': 0.1 });
    } catch { /* fog is optional if the style does not support it */ }

    // 3D building extrusions — placed before flood fill and node circles
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'footprints',
      paint: {
        'fill-extrusion-color': [
          'match', ['get', 'buildingClass'],
          'government', '#4a90d9',
          'commercial', '#7eb8c9',
          'residential', '#6ec87a',
          'apartments', '#89d48a',
          'church', '#c084fc',
          'roof', '#94a3b8',
          '#5a9abf'
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'heightMeters'], 4],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82
      }
    });
    map.addLayer({
      id: 'buildings-3d-selected',
      type: 'fill-extrusion',
      source: 'selected-footprint',
      paint: {
        'fill-extrusion-color': '#48e2dc',
        'fill-extrusion-height': ['coalesce', ['get', 'heightMeters'], 4],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95
      }
    });
    map.addLayer({
      id: 'buildings-3d-exposed',
      type: 'fill-extrusion',
      source: 'exposed-footprints',
      paint: {
        'fill-extrusion-color': '#ff625f',
        'fill-extrusion-height': ['coalesce', ['get', 'heightMeters'], 4],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9
      }
    });

    map.addLayer({ id: 'flood-fill', type: 'fill', source: 'flood',
      paint: { 'fill-color': '#278fdb', 'fill-opacity': .22 } });
    map.addLayer({ id: 'flood-line', type: 'line', source: 'flood',
      paint: { 'line-color': '#47c4ff', 'line-width': 2, 'line-dasharray': [2, 2] } });

    map.addLayer({
      id: 'cascade-flow',
      type: 'line',
      source: 'cascade-lines',
      paint: {
        'line-color': [
          'match', ['get', 'impactType'],
          'business_interruption', '#ffbd55',
          'service_capacity_reduction', '#ff9b55',
          'service_access_gap', '#ff625f',
          '#7eb8c9'
        ],
        'line-width': 1.5,
        'line-opacity': 0.7,
        'line-dasharray': [2, 2]
      }
    });

    // Real OSM POI layer — rendered BEFORE synthetic nodes so nodes appear on top
    map.addLayer({
      id: 'real-pois-layer',
      type: 'circle',
      source: 'real-pois',
      paint: {
        'circle-radius': 8,
        'circle-color': '#a855f7',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9
      }
    });

    for (const category of ['building', 'business', 'equipment', 'road', 'other']) {
      map.addLayer({
        id: `node-${category}`,
        type: 'circle',
        source: 'nodes',
        filter: ['==', ['get', 'category'], category],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? ''], 11, 7],
          'circle-color': ['match', ['get', 'risk'],
            'high', '#ff625f',
            'elevated', '#ffbd55',
            'low', '#39dda0',
            '#9aacbd'
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5
        }
      });
    }

    map.on('click', 'buildings-3d', event => {
      const feature = event.features?.[0];
      if (feature?.properties?.id) selectFootprint(feature.properties.id);
    });
    map.on('click', 'buildings-3d-exposed', event => {
      const feature = event.features?.[0];
      if (feature?.properties?.id) selectFootprint(feature.properties.id);
    });

    map.on('click', 'real-pois-layer', event => {
      const feature = event.features?.[0];
      if (feature) selectRealPoi(feature);
    });

    map.on('click', event => {
      const feature = map.queryRenderedFeatures(event.point, {
        layers: ['node-building', 'node-business', 'node-equipment', 'node-road', 'node-other']
      })[0];
      if (feature?.properties?.id) selectNode(feature.properties.id);
    });

    refreshMap();
  });
}

// ── Map refresh ──────────────────────────────────────────────────────────────

function refreshMap() {
  if (!map?.isStyleLoaded() || !graph) return;

  map.getSource('nodes').setData({ type: 'FeatureCollection', features: nodeFeatures() });
  map.getSource('footprints').setData({ type: 'FeatureCollection', features: withHeight(footprints) });
  map.getSource('flood').setData(scenarioToFeatureCollection(scenario));
  map.getSource('real-pois').setData({ type: 'FeatureCollection', features: realPois });
  // exposed-footprints source is updated by simulate() — no recalculation needed here

  const chosen = withHeight(footprints.filter(feature => feature.properties.id === selectedFootprintId));
  map.getSource('selected-footprint').setData({ type: 'FeatureCollection', features: chosen });

  for (const category of ['building', 'business', 'equipment', 'road', 'other']) {
    map.setLayoutProperty(
      `node-${category}`, 'visibility',
      $(`[data-layer="${category}"]`).checked ? 'visible' : 'none'
    );
  }

  for (const layer of ['buildings-3d', 'buildings-3d-selected']) {
    map.setLayoutProperty(layer, 'visibility', $('#real-buildings').checked ? 'visible' : 'none');
  }

  for (const layer of ['flood-fill', 'flood-line']) {
    map.setLayoutProperty(layer, 'visibility', $('#flood').checked ? 'visible' : 'none');
  }

  // Real OSM POI layer toggle
  map.setLayoutProperty(
    'real-pois-layer', 'visibility',
    $('#real-pois-toggle').checked ? 'visible' : 'none'
  );

  // Census tract boundary toggle
  for (const layer of ['census-tract-fill', 'census-tract-line']) {
    map.setLayoutProperty(layer, 'visibility', $('#census-toggle').checked ? 'visible' : 'none');
  }

  // Flood-exposed 3D buildings + cascade flow lines
  map.setLayoutProperty('buildings-3d-exposed', 'visibility', $('#exposed-toggle').checked ? 'visible' : 'none');
  if (map.getLayer('cascade-flow')) {
    map.setLayoutProperty('cascade-flow', 'visibility', $('#exposed-toggle').checked ? 'visible' : 'none');
  }
}

// Ensure extrusion height is always a number (MapLibre fill-extrusion requires it)
function withHeight(features) {
  return features.map(f => ({
    ...f,
    properties: { ...f.properties, heightMeters: f.properties.heightMeters ?? 4 }
  }));
}

function startCascadeAnimation() {
  if (cascadeAnimationId) cancelAnimationFrame(cascadeAnimationId);
  function animate() {
    const t = (Date.now() % 2000) / 2000;
    const opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * Math.PI));
    if (map.getLayer('buildings-3d-exposed')) {
      map.setPaintProperty('buildings-3d-exposed', 'fill-extrusion-opacity', opacity);
    }
    if (map.getLayer('cascade-flow')) {
      map.setPaintProperty('cascade-flow', 'line-opacity', 0.5 + 0.4 * Math.abs(Math.sin(t * Math.PI)));
    }
    cascadeAnimationId = requestAnimationFrame(animate);
  }
  cascadeAnimationId = requestAnimationFrame(animate);
}

function stopCascadeAnimation() {
  if (cascadeAnimationId) {
    cancelAnimationFrame(cascadeAnimationId);
    cascadeAnimationId = null;
  }
  if (map?.getLayer?.('buildings-3d-exposed')) {
    map.setPaintProperty('buildings-3d-exposed', 'fill-extrusion-opacity', 0.9);
  }
}

// ── Bounds helpers ───────────────────────────────────────────────────────────

function coordinateBounds(featureCollection) {
  const bounds = new maplibregl.LngLatBounds();
  let count = 0;
  const add = coordinates =>
    Array.isArray(coordinates?.[0])
      ? coordinates.forEach(add)
      : (bounds.extend(coordinates), count++);
  featureCollection.forEach(feature => add(feature.geometry.coordinates));
  return count ? bounds : null;
}

function fit() {
  const bounds = coordinateBounds(footprints.length ? footprints : nodeFeatures());
  if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadFootprints() {
  try {
    const geojson = await request('/api/data/buildings?format=geojson&limit=250');
    footprints = withHeight(geojson.features);
    const source = geojson.metadata.source;
    // FIX 5f: clearer, consistently prefixed data source label
    $('#dataMode').textContent =
      `DATA SOURCE: OVERTURE MAPS · ${geojson.metadata.totalCount} FOOTPRINTS · RELEASE ${source.datasetRelease ?? 'UNKNOWN'}`;
    $('#mapError').textContent = '';
  } catch (error) {
    footprints = [];
    // FIX 5f: clearer fallback label indicating synthetic mode
    $('#dataMode').textContent = 'DATA SOURCE: SYNTHETIC FIXTURE (real footprints unavailable)';
    let detail = error.message;
    try { detail = JSON.parse(error.message).error ?? detail; } catch {}
    $('#mapError').textContent = `Real building footprints unavailable: ${detail}`;
  }
}

// Load real OSM POIs from the cache — non-fatal: failure does not block map load.
async function loadRealPois() {
  try {
    const geojson = await request('/api/data/businesses?format=geojson&limit=200');
    realPois = geojson.features;
    if (map?.isStyleLoaded()) {
      map.getSource('real-pois').setData({ type: 'FeatureCollection', features: realPois });
    }
    const src = geojson.metadata.source;
    const dateStr = src.acquiredAt ? src.acquiredAt.slice(0, 10) : 'unknown date';
    $('#poisMode').textContent = `OSM FACILITIES · ${geojson.metadata.totalCount} REAL · ${dateStr}`;
  } catch (error) {
    realPois = [];
    console.warn('Real OSM POIs unavailable (non-fatal):', error.message);
    $('#poisMode').textContent = `OSM FACILITIES: unavailable (${error.message})`;
  }
}

// Load Census tract boundaries from cache — non-fatal.
async function loadCensusTracts() {
  try {
    const geojson = await request('/api/data/census?format=geojson');
    censusTracts = geojson.features;
    if (map?.isStyleLoaded()) {
      map.getSource('census-tracts').setData({ type: 'FeatureCollection', features: censusTracts });
    }
    $('#censusMode').textContent =
      `CENSUS TRACTS · ${geojson.metadata.tractCount} · ACS 2022`;
  } catch (error) {
    censusTracts = [];
    console.warn('Census tract data unavailable (non-fatal):', error.message);
    $('#censusMode').textContent = `CENSUS: unavailable`;
  }
}

async function load() {
  // FIX 5a: show loading state before data arrives; loadFootprints() clears it on success
  $('#mapError').textContent = 'Loading Richardson infrastructure…';

  try {
    await request('/api/network/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locationId: 'richardson-tx' })
    });

    [graph, scenario] = await Promise.all([
      request('/api/network'),
      request('/api/simulations/scenarios/richardson-flood-demo')
    ]);

    await loadFootprints();
    await loadRealPois();
    await loadCensusTracts();

    $('#status').textContent = `NETWORK READY · ${graph.locationId}`;

    // FIX 2: removed "synthetic" and "real" — context already distinguishes the two layers
    $('#layerStats').textContent =
      `${graph.nodes.length} graph nodes · ${graph.edges.length} edges · ` +
      `${nodeFeatures().length} mappable points · ${footprints.length} footprint polygons · ` +
      `${realPois.length} real OSM facilities`;

    search();
    await simulate();
  } catch (error) {
    $('#status').textContent = 'API ERROR';
    $('#mapError').textContent = error.message;
  }
}

// ── Simulation ───────────────────────────────────────────────────────────────

async function simulate() {
  $('#run').textContent = 'Running…';
  stopCascadeAnimation();
  try {
    result = await request('/api/simulations/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: 'richardson-flood-demo',
        predictionMode: $('#mode').value,
        overrides: { durationHours: Number($('#duration').value) }
      })
    });
    renderMetrics();

    // Highlight flood-exposed Overture building polygons as 3D extrusions
    if (result.exposedBuildingFootprints?.length > 0) {
      const exposedIds = new Set(result.exposedBuildingFootprints.map(e => e.providerId));
      const exposedFeatures = withHeight(footprints.filter(f => exposedIds.has(f.properties.providerId)));
      map.getSource('exposed-footprints')?.setData({ type: 'FeatureCollection', features: exposedFeatures });
    }

    // Cascade connection lines from upstream causes (cascading impacts, not direct failures)
    const cascadeItems = result.cascadingImpacts?.impacts ?? result.failures ?? [];
    const lines = cascadeItems
      .filter(f => f.upstreamCause)
      .map(f => {
        const src = graph.nodes.find(n => n.id === f.upstreamCause);
        const tgt = graph.nodes.find(n => n.id === f.nodeId);
        if (!src?.coordinates || !tgt?.coordinates) return null;
        return {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [src.coordinates, tgt.coordinates] },
          properties: { impactType: f.impactType }
        };
      })
      .filter(Boolean);
    map.getSource('cascade-lines')?.setData({ type: 'FeatureCollection', features: lines });

    refreshMap();
    if (selectedId) selectNode(selectedId);
    if (result.exposedBuildingFootprints?.length > 0 && $('#cascade-anim-toggle').checked) {
      startCascadeAnimation();
    }
  } catch (error) {
    $('#mapError').textContent = error.message;
  } finally {
    $('#run').textContent = 'Run simulation';
  }
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function renderMetrics() {
  const business = result.businessImpact;
  const community = result.directCommunityImpact;
  const shelter = result.shelterNeeds;

  // Each metric card includes a data-source label; displaced residents shows Census vs Synthetic
  const isCensusBacked = community.dataSource === 'census_acs_2022_area_weighted';
  const displacedLabel = isCensusBacked
    ? '<small class="census-label">Census-backed</small>'
    : '<small class="synthetic-label">Synthetic</small>';

  $('#metrics').innerHTML = `
    <div>Businesses
      <b>${business.totalAffectedBusinesses}</b>
      <small>modeled</small>
    </div>
    <div>Revenue exposure
      <b>$${business.totalEstimatedRevenueAtRiskUSD.toLocaleString()}</b>
      <small>modeled</small>
    </div>
    <div>Displaced residents
      <b>${Math.round(community.estimatedDisplacedResidents)}</b>
      ${displacedLabel}
    </div>
    <div>Shelter shortfall
      <b>${Math.round(shelter.unmetShelterDemand)}</b>
      <small>modeled</small>
    </div>
  `;
}

// ── Feature selection: footprint ─────────────────────────────────────────────

function selectFootprint(id) {
  const feature = footprints.find(candidate => candidate.properties.id === id);
  if (!feature) return;

  selectedId = undefined;
  selectedFootprintId = id;

  const properties = feature.properties;
  const source = typeof properties.source === 'string' ? JSON.parse(properties.source) : (properties.source ?? {});
  const exposed = result?.exposedBuildingFootprints?.find(e => e.providerId === properties.providerId);

  $('#title').textContent = properties.name || properties.providerId || 'Overture building footprint';

  $('#inspector').innerHTML = `
    <div class="card-badge badge-${properties.buildingClass ?? 'unknown'}">
      ${(properties.buildingClass ?? 'Building').toUpperCase()}
    </div>
    ${properties.name ? `<p class="card-name">${esc(properties.name)}</p>` : ''}
    <div class="card-stats">
      <div><span>Height</span><b>${properties.heightMeters ? Number(properties.heightMeters).toFixed(1) + ' m' : '—'}</b></div>
      <div><span>Source</span><b>Overture Maps</b></div>
      <div><span>Release</span><b>${esc(source.datasetRelease ?? 'unknown')}</b></div>
      <div><span>Flood exposure</span><b style="color:${exposed ? '#ff625f' : '#39dda0'}">
        ${exposed ? '⚠ Exposed (' + esc(exposed.exposureMethod) + ')' : '✓ Not exposed'}</b></div>
    </div>
    <p class="card-note">Provider-backed Overture footprint · Entity matching active when POI cache is populated.</p>
  `;

  $('#raw').textContent = JSON.stringify(feature, null, 2);
  $('#graphTitle').textContent = 'Provider-backed footprint · no graph links asserted';

  // FIX 5c: collapse the graph panel when a footprint (not a node) is selected
  $('.graphpanel').classList.remove('graph-active');

  cy?.destroy();
  cy = undefined;
  refreshMap();

  const bounds = coordinateBounds([feature]);
  if (bounds) map.fitBounds(bounds, { padding: 90, maxZoom: 18 });
}

// ── Feature selection: real OSM POI ─────────────────────────────────────────

function selectRealPoi(feature) {
  const p = feature.properties;
  const address = typeof p.address === 'string' ? JSON.parse(p.address) : (p.address ?? {});
  const dq = typeof p.dataQuality === 'string' ? JSON.parse(p.dataQuality) : (p.dataQuality ?? {});
  const src = typeof p.source === 'string' ? JSON.parse(p.source) : (p.source ?? {});

  // Do not modify synthetic graph state — this is an independent real OSM record
  selectedId = undefined;
  selectedFootprintId = undefined;
  $('.graphpanel').classList.remove('graph-active');
  cy?.destroy();
  cy = undefined;

  $('#title').textContent = p.name || 'Real OSM Facility';

  $('#inspector').innerHTML =
    section('Identity', rows({
      id: p.id,
      category: p.category,
      osmId: p.osmId,
      osmType: p.osmType
    })) +
    section('Location', rows({
      coordinates: feature.geometry.coordinates.join(', ')
    })) +
    section('Address', rows({
      street: address.street,
      city: address.city,
      state: address.state,
      postcode: address.postcode
    })) +
    section('Provenance', rows({
      provider: src.provider ?? 'OpenStreetMap',
      acquiredAt: src.acquiredAt
    })) +
    section('Data quality', rows({
      hasName: dq.hasName,
      coordinatesSource: dq.coordinatesSource,
      missingFields: dq.missingFields
    })) +
    section('Note',
      '<p>This is a real OpenStreetMap record. It is not yet linked to the dependency graph. ' +
      'Entity matching will associate it with a building in a future update.</p>'
    );

  $('#raw').textContent = JSON.stringify(feature, null, 2);
  $('#graphTitle').textContent = `Real OSM: ${p.name ?? p.id} · ${p.category}`;

  if (feature.geometry?.coordinates) {
    map.flyTo({ center: feature.geometry.coordinates, zoom: 17 });
  }
}

// ── Feature selection: graph node ────────────────────────────────────────────

function selectNode(id) {
  const node = graph.nodes.find(candidate => candidate.id === id);
  if (!node) return;

  selectedFootprintId = undefined;
  selectedId = id;

  const loc = inheritedPoint(graph, node);
  const incoming = graph.edges.filter(edge => edge.targetId === id);
  const outgoing = graph.edges.filter(edge => edge.sourceId === id);
  const failure = result?.failures?.find(item => item.nodeId === id);
  const sources = node.sources.map(source => `${source.category}: ${source.reference}`).join(' · ');

  $('#title').textContent = node.name;

  const riskLevel = failure?.riskLevel ?? 'unknown';
  $('#inspector').innerHTML =
    `<div class="card-badge badge-risk-${riskLevel}">${riskLevel.toUpperCase()} RISK</div>` +
    section('Identity', rows({
      id: node.id,
      type: node.type,
      coordinates: loc?.coordinates?.join(', '),
      location: loc?.locationMethod
    })) +
    section('Provenance', `<p>${esc(sources || 'No source records')}</p>`) +
    section('Attributes', rows(node.properties)) +
    section('Data quality', rows({
      geometry: 'synthetic graph point or missing geometry',
      risk: failure?.riskLevel ?? 'not simulated',
      status: failure?.predictedStatus ?? 'not simulated'
    })) +
    section('Dependencies',
      `<p>${
        [...incoming, ...outgoing]
          .map(edge => `${esc(edge.relationship)} <em>${esc(edge.evidenceLevel)}</em>`)
          .join(' · ') || 'No direct edges'
      }</p>`
    );

  $('#raw').textContent = JSON.stringify({ node, incoming, outgoing, failure }, null, 2);
  $('#graphTitle').textContent = `${node.name} · ${incoming.length + outgoing.length} direct relationships`;

  drawGraph([id, ...incoming.map(edge => edge.sourceId), ...outgoing.map(edge => edge.targetId)]);

  // FIX 5c: reveal the graph panel when a node is selected
  $('.graphpanel').classList.add('graph-active');

  refreshMap();

  if (loc?.coordinates) map.flyTo({ center: loc.coordinates, zoom: 16 });
}

// ── Cytoscape graph rendering ────────────────────────────────────────────────

function drawGraph(ids) {
  const keep = new Set(ids);
  const nodes = graph.nodes
    .filter(node => keep.has(node.id))
    .map(node => ({ data: { id: node.id, label: node.name, type: node.type } }));
  const edges = graph.edges
    .filter(edge => keep.has(edge.sourceId) && keep.has(edge.targetId))
    .map(edge => ({
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: `${edge.relationship}\n${edge.evidenceLevel}`,
        evidence: edge.evidenceLevel
      }
    }));

  cy?.destroy();
  cy = cytoscape({
    container: $('#cy'),
    elements: { nodes, edges },
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'font-size': 10,
          'background-color': '#30bfc0',
          'color': '#dce8f4',
          'text-wrap': 'wrap',
          'text-max-width': 100,
          'text-valign': 'bottom',
          'text-margin-y': 8
        }
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'font-size': 8,
          'color': '#dce8f4',
          'line-color': '#5a86a7',
          'target-arrow-color': '#5a86a7',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier'
        }
      },
      {
        selector: 'edge[evidence = "hypothetical"]',
        style: { 'line-style': 'dashed', 'line-color': '#bd8cff' }
      },
      {
        selector: 'edge[evidence = "inferred"]',
        style: { 'line-style': 'dotted', 'line-color': '#ffbd55' }
      }
    ],
    layout: { name: 'cose', animate: false }
  });

  cy.on('tap', 'node', event => selectNode(event.target.id()));
}

// ── Downstream trace ─────────────────────────────────────────────────────────

async function downstream() {
  if (!selectedId) return;
  const trace = await request(`/api/network/nodes/${encodeURIComponent(selectedId)}/dependencies?maxDepth=4`);
  drawGraph([selectedId, ...trace.affectedNodeIds]);
}

// ── Node search ──────────────────────────────────────────────────────────────

function search() {
  const query = $('#search').value.toLowerCase();
  const found = graph?.nodes
    .filter(node =>
      node.name.toLowerCase().includes(query) ||
      node.id.toLowerCase().includes(query)
    )
    .slice(0, 12) ?? [];

  $('#searchResults').innerHTML = found
    .map(node => `<button data-node="${esc(node.id)}">${esc(node.name)} <small>${esc(node.type)}</small></button>`)
    .join('');

  document.querySelectorAll('[data-node]').forEach(button => {
    button.onclick = () => selectNode(button.dataset.node);
  });
}

// ── Event wiring ─────────────────────────────────────────────────────────────

$('#run').onclick = simulate;
$('#mode').onchange = simulate;
$('#fit').onclick = fit;
$('#direct').onclick = () => selectedId && selectNode(selectedId);
$('#downstream').onclick = downstream;
$('#search').oninput = search;

document.querySelectorAll('[data-layer]').forEach(input => input.onchange = refreshMap);
$('#real-buildings').onchange = refreshMap;
$('#flood').onchange = refreshMap;
$('#real-pois-toggle').onchange = refreshMap;
$('#exposed-toggle').onchange = refreshMap;
$('#census-toggle').onchange = refreshMap;
$('#cascade-anim-toggle').onchange = () => {
  if ($('#cascade-anim-toggle').checked && result?.exposedBuildingFootprints?.length) startCascadeAnimation();
  else stopCascadeAnimation();
};
$('#duration').oninput = () => { $('#durationLabel').textContent = $('#duration').value + 'h'; };
$('#duration').onchange = simulate;

// FIX 5e: disable button during agent call and restore on completion
$('#ask').onclick = async () => {
  const chat = $('#chat');
  const ask = $('#ask');

  chat.textContent = 'Nemotron is investigating…';
  ask.textContent = 'Investigating…';
  ask.disabled = true;

  try {
    const response = await request('/api/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'resilience-ui',
        message: $('#question').value,
        context: {
          locationId: 'richardson-tx',
          scenarioId: 'richardson-flood-demo',
          selectedNodeId: selectedId
        }
      })
    });
    chat.textContent =
      response.answer + '\n\nTools: ' +
      response.toolTrace.map(item => `${item.toolName} (${item.status})`).join(', ');
  } catch (error) {
    const raw = String(error.message ?? '');
    const lower = raw.toLowerCase();
    if (lower.includes('nvidia_api_key') || lower.includes('api key') || lower.includes('api_key')) {
      chat.textContent = 'NVIDIA API key is not configured on the server.';
    } else if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('timed out')) {
      chat.textContent = `Agent request timed out. ${raw}`;
    } else {
      chat.textContent = `Agent error: ${raw}`;
    }
  } finally {
    ask.textContent = 'Investigate with Nemotron';
    ask.disabled = false;
  }
};

// ── Bootstrap ────────────────────────────────────────────────────────────────

setupMap();
load();
