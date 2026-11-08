import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TORNADO_CACHE,normalizeTornadoCollection,tornadoScenarios } from '../src/hazards/tornado.js';
import { geographicExposure } from '../src/hazards/exposure.js';
import { analyzeHazard } from '../src/hazards/index.js';
import { dragonflyDestination } from '../src/frontend-config.js';
import { executeTool } from '../src/agent/agent.js';
const box=(x,y,w=1)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]]]});
test('NOAA import preserves exact source polygon, identifiers, contour rating and time',async()=>{
  const raw=JSON.parse(await readFile(TORNADO_CACHE,'utf8')),events=normalizeTornadoCollection(raw);
  assert.equal(events.length,1);assert.equal(events[0].id,'noaa-dat:874975');assert.equal(events[0].reportedContourRating,'EF0');assert.equal(events[0].eventMaximumRating,null);assert.equal(events[0].eventDate,'2019-10-21T02:56:00.000Z');assert.deepEqual(events[0].footprint,raw.features[0].geometry);assert.equal(events[0].source.originalProperties.event_id,raw.features[0].properties.event_id);
});
test('NOAA validator rejects missing provenance, malformed geometry, duplicate IDs and truncation',async()=>{
  const raw=JSON.parse(await readFile(TORNADO_CACHE,'utf8'));
  for(const mutate of [r=>delete r.metadata,r=>r.features[0].geometry.coordinates[0].pop(),r=>r.features.push(r.features[0]),r=>r.exceededTransferLimit=true,r=>r.features[0].properties.stormdate=null,r=>r.features[0].geometry=box(0,0)]){const r=structuredClone(raw);mutate(r);assert.throws(()=>normalizeTornadoCollection(r));}
  assert.deepEqual(normalizeTornadoCollection({...raw,features:[]}),[]);
});
test('generic exposure handles multipolygons, holes, missing coordinates and empty graphs without damage inference',()=>{
  const hollow=box(0,0,4);hollow.coordinates.push(box(1,1).coordinates[0]);const graph={locationId:'test',nodes:[{id:'hole',type:'building',geometry:box(1.1,1.1,.2)},{id:'cross',type:'building',geometry:{type:'MultiPolygon',coordinates:[box(3,3).coordinates,box(8,8).coordinates]}},{id:'point',type:'business',coordinates:[3.5,3.5]},{id:'unknown',type:'business'}]};
  const r=geographicExposure(graph,{id:'test',footprint:hollow,sourceType:'historical_observed'});assert.deepEqual(r.exposedAssetIds,['cross','point']);assert.equal(r.exposure[3].exposureStatus,'unknown');assert.equal(r.businessImpact.exposedFacilityCount,1);assert.equal(r.businessImpact.totalAffectedBusinesses,null);assert.equal(r.businessImpact.totalEstimatedRevenueAtRiskUSD,null);assert.equal(r.directCommunityImpact.totalPopulationExposed,null);assert.equal(r.shelterNeeds.availableCapacity,null);assert.equal(r.serviceGaps.gaps,null);assert.deepEqual(r.failures,[]);assert.deepEqual(r.hybridRiskAssessments,[]);assert.equal(geographicExposure({nodes:[]},{footprint:hollow}).exposedBuildingFootprints.length,0);
});
test('real tornado analysis intersects current footprints and never invokes a flood model',async()=>{
  const [event]=await tornadoScenarios(),r=await analyzeHazard({scenarioId:event.id});assert.equal(r.predictionModeUsed,'exposure');assert.equal(r.mlInferenceStatus,'not_applicable_exposure_only');assert.equal(r.exposedBuildingFootprints.length,215);assert.equal(r.businessImpact.exposedFacilityCount,0);assert.equal(r.simulated,false);assert.ok(r.limitations.some(s=>s.includes('may not have existed')));
  await assert.rejects(()=>analyzeHazard({scenarioId:event.id,predictionMode:'hybrid'}),/Unsupported prediction/);
  await assert.rejects(()=>analyzeHazard({scenarioId:event.id,overrides:{facilityStatus:{x:'operational'}}}),/Operational overrides/);
});
test('point-only buildings keep point evidence and invalid coordinates remain unknown',()=>{
  const r=geographicExposure({nodes:[{id:'point-building',type:'building',coordinates:[.5,.5]},{id:'bad',type:'business',coordinates:[300,.5]}]},{footprint:box(0,0)});
  assert.equal(r.exposure[0].method,'source_point_intersection');assert.equal(r.exposedBuildingFootprints.length,0);assert.equal(r.exposure[1].exposureStatus,'unknown');
});
test('normal flood is exposure only and synthetic financial/population inputs never enter it',async()=>{
  const r=await analyzeHazard();assert.equal(r.scenario.sourceType,'hypothetical');assert.equal(r.predictionModeUsed,'exposure');assert.equal(r.exposedBuildingFootprints.length,2293);assert.equal(r.directCommunityImpact.estimatedDisplacedResidents,null);assert.equal(r.businessImpact.totalEstimatedRevenueAtRiskUSD,null);assert.equal(r.directCommunityImpact.totalPopulationExposed,null);assert.deepEqual(r.failures,[]);
});
test('Nemotron tools honor selected tornado and reject a silent flood substitution',async()=>{
  const context={scenarioId:'noaa-dat:874975',predictionMode:'exposure'};
  const r=await executeTool('run_disaster_simulation',{scenarioId:context.scenarioId},context);assert.equal(r.disasterType,'tornado');assert.equal(r.exposedBuildingFootprintCount,215);assert.equal(r.modeledUnavailableBuildingCount,null);
  await assert.rejects(()=>executeTool('run_disaster_simulation',{scenarioId:'richardson-flood-demo'},context),/selected scenario/);
});
test('Dragonfly accepts configured routes and HTTP destinations but blocks unsafe schemes or credentials',()=>{
  assert.equal(dragonflyDestination(''),null);assert.equal(dragonflyDestination('/dragonfly'),'/dragonfly');assert.equal(dragonflyDestination('https://example.org/game'),'https://example.org/game');
  for(const url of ['javascript:alert(1)','//example.org','/\\example.org','https://user:secret@example.org'])assert.equal(dragonflyDestination(url),null);
});
