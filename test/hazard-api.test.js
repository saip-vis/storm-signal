import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
test('native HTTP hazard, normal-mode provenance and Dragonfly configuration contracts',async t=>{
  const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',ALLOW_DEMO_DATA:'',NVIDIA_API_KEY:'',DRAGONFLY_URL:'/dragonfly'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Test API startup timed out')),8000);child.on('error',reject);child.stderr.on('data',b=>{clearTimeout(timer);reject(new Error(b.toString()));});child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/localhost:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
  const call=async(path,body)=>{const response=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:response.status,data:await response.json()};};
  const config=await call('/api/frontend-config');assert.equal(config.status,200);assert.equal(config.data.dragonflyUrl,'/dragonfly');assert.equal(config.data.regions.length,1);
  const scenarios=await call('/api/hazards');assert.equal(scenarios.data.scenarios.length,2);assert.equal(scenarios.data.availability.currentWarnings.available,false);
  assert.equal((await call('/api/simulations/scenarios/noaa-dat%3A874975')).status,200);
  const tornado=await call('/api/simulations/run',{scenarioId:'noaa-dat:874975'});assert.equal(tornado.status,200);assert.equal(tornado.data.exposedBuildingFootprints.length,215);assert.equal(tornado.data.businessImpact.totalAffectedBusinesses,null);assert.equal(tornado.data.predictionModeUsed,'exposure');
  const flood=await call('/api/simulations/run',{});assert.equal(flood.status,200);assert.equal(flood.data.exposedBuildingFootprints.length,2293);assert.equal(flood.data.directCommunityImpact.totalPopulationExposed,null);
  assert.equal((await call('/api/simulations/run',{scenarioId:'noaa-dat:874975',predictionMode:'hybrid'})).status,400);
  assert.equal((await call('/api/simulations/run',{scenarioId:'unavailable-event'})).status,400);
  assert.equal((await call('/api/network/build',{options:{mode:'demo'}})).status,400);
  assert.equal((await call('/api/simulations/compare',{scenarioId:'noaa-dat:874975',predictionMode:'hybrid',modification:{}})).status,400);
  const legacy=await call('/api/simulations/results/richardson-flood-demo');assert.equal(legacy.data.predictionModeUsed,'exposure');assert.equal(legacy.data.businessImpact.totalEstimatedRevenueAtRiskUSD,null);
});
