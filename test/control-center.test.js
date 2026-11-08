import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisMetrics, interventionPayload } from '../frontend/adapter.js';

test('HUD counts actual unique exposed buildings and preserves unavailable metrics',()=>{
  assert.deepEqual(analysisMetrics({exposedBuildingFootprints:[{buildingId:'a'},{buildingId:'a'},{buildingId:'b'}],businessImpact:{totalAffectedBusinesses:0},directCommunityImpact:{totalPopulationExposed:null}}),{buildings:2,facilities:0,population:null});
  assert.deepEqual(analysisMetrics({}),{buildings:0,facilities:null,population:null});
});
test('counterfactual preserves actual target, scenario and explicit analysis parameters',()=>{
  assert.deepEqual(interventionPayload({id:'building:actual',type:'building'},7.5,48,'scenario:actual'),{scenarioId:'scenario:actual',modification:{floodDepthFeet:7.5,durationHours:48,facilityStatus:{'building:actual':'operational'}}});
});
test('counterfactual rejects unsupported targets and invalid hazard parameters',()=>{
  for(const node of [null,{id:'business:a',type:'business'}])assert.throws(()=>interventionPayload(node,4.5,24,'s'),/building/);
  for(const depth of [NaN,-1,31])assert.throws(()=>interventionPayload({id:'a',type:'building'},depth,24,'s'),/depth/);
  for(const hours of [0,169,2.5])assert.throws(()=>interventionPayload({id:'a',type:'building'},4.5,hours,'s'),/window/);
});
