import * as maplibregl from '/vendor/maplibre-gl.mjs';
import { inheritedPoint, networkToPoints, scenarioToFeatureCollection } from '/adapter.js';

const api = window.RESILIENCE_API_URL || window.location.origin;
const $ = selector => document.querySelector(selector);
const esc = value =>
  String(value ?? '—').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));

let graph, result, map, cy, scenario, selectedId, selectedFootprintId, footprints = [], realPois = [];

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
    pitch: 35,
    style: 'https://tiles.openfreemap.org/styles/dark'
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

  map.on('load', () => {
    for (const name of ['nodes', 'footprints', 'flood', 'selected-footprint', 'real-pois']) {
      map.addSource(name, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    map.addLayer({ id: 'footprint-fill', type: 'fill', source: 'footprints',
      paint: { 'fill-color': '#347baf', 'fill-opacity': .35 } });
    map.addLayer({ id: 'footprint-line', type: 'line', source: 'footprints',
      paint: { 'line-color': '#72ddf4', 'line-width': 1.8 } });
    map.addLayer({ id: 'selected-footprint-fill', type: 'fill', source: 'selected-footprint',
      paint: { 'fill-color': '#48e2dc', 'fill-opacity': .34 } });
    map.addLayer({ id: 'selected-footprint-line', type: 'line', source: 'selected-footprint',
      paint: { 'line-color': '#7ffef5', 'line-width': 3 } });
    map.addLayer({ id: 'flood-fill', type: 'fill', source: 'flood',
      paint: { 'fill-color': '#278fdb', 'fill-opacity': .22 } });
    map.addLayer({ id: 'flood-line', type: 'line', source: 'flood',
      paint: { 'line-color': '#47c4ff', 'line-width': 2, 'line-dasharray': [2, 2] } });

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

    map.on('click', 'footprint-fill', event => {
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
  map.getSource('footprints').setData({ type: 'FeatureCollection', features: footprints });
  map.getSource('flood').setData(scenarioToFeatureCollection(scenario));
  map.getSource('real-pois').setData({ type: 'FeatureCollection', features: realPois });

  const chosen = footprints.filter(feature => feature.properties.id === selectedFootprintId);
  map.getSource('selected-footprint').setData({ type: 'FeatureCollection', features: chosen });

  for (const category of ['building', 'business', 'equipment', 'road', 'other']) {
    map.setLayoutProperty(
      `node-${category}`, 'visibility',
      $(`[data-layer="${category}"]`).checked ? 'visible' : 'none'
    );
  }

  for (const layer of ['footprint-fill', 'footprint-line', 'selected-footprint-fill', 'selected-footprint-line']) {
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
    footprints = geojson.features;
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
  try {
    result = await request('/api/simulations/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'richardson-flood-demo', predictionMode: $('#mode').value })
    });
    renderMetrics();
    refreshMap();
    if (selectedId) selectNode(selectedId);
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

  // FIX 5d: each metric card includes a "modeled" caveat label
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
      <small>modeled</small>
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
  const source = properties.source ?? {};

  $('#title').textContent = properties.name || properties.providerId || 'Overture building footprint';

  $('#inspector').innerHTML =
    section('Identity', rows({
      id: properties.id,
      providerId: properties.providerId,
      type: feature.geometry.type,
      representativePoint: properties.representativePoint
    })) +
    section('Provenance', rows({
      provider: source.provider,
      dataset: source.dataset,
      release: source.datasetRelease,
      acquiredAt: source.acquiredAt,
      realProviderBacked: properties.realProviderBacked
    })) +
    section('Attributes', rows({
      class: properties.buildingClass,
      heightMeters: properties.heightMeters,
      floors: properties.floors
    })) +
    section('Data quality', rows({
      geometry: feature.geometry.type,
      geometryValid: properties.dataQuality?.geometryValid,
      missingFields: properties.dataQuality?.missingFields
    })) +
    section('Dependencies',
      '<p>No graph dependencies are currently known. This provider-backed footprint is intentionally separate from the synthetic dependency graph.</p>'
    );

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

  $('#inspector').innerHTML =
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
    chat.textContent = `Agent error: ${error.message}`;
  } finally {
    ask.textContent = 'Investigate with Nemotron';
    ask.disabled = false;
  }
};

// ── Bootstrap ────────────────────────────────────────────────────────────────

setupMap();
load();
