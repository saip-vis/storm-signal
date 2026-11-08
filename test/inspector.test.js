import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectorPresentation, relationshipDescription } from '../frontend/adapter.js';
const node={id:'asset:one',type:'building',properties:{real:true,buildingClass:'community_center'},sources:[]};
test('inspector identifies real, synthetic, and unknown records without assuming all nodes are OSM',()=>{
  assert.equal(inspectorPresentation(node).category,'community center');
  assert.equal(inspectorPresentation(node).provenance,'Real geographic record');
  assert.equal(inspectorPresentation({...node,properties:{synthetic:true}}).provenance,'Synthetic demo record');
  for(const type of ['road','service','neighborhood','equipment'])assert.equal(inspectorPresentation({id:type,type}).provenance,'Source not established');
});
test('missing simulation data remains unassessed and missing ML is omitted',()=>{
  const view=inspectorPresentation(node);assert.equal(view.status,'Not assessed yet');assert.equal(view.exposure,'Exposure not assessed');assert.equal(view.ml,null);
  const r={failures:[{nodeId:node.id,predictedStatus:'potentially_unavailable',riskLevel:'high',estimatedDamageFraction:.9}]};
  assert.equal(inspectorPresentation(node,r).ml,null);assert.equal(inspectorPresentation(node,r).tone,'high');
});
test('ML damage requires a trained method, asset-specific result and valid model version',()=>{
  const assessment={predictionMethod:'trained_model',modelVersion:'model-v1',estimatedDamageFraction:.27};
  const r=ml=>({hybridRiskAssessments:[{nodeId:node.id,mlAssessment:ml}]});
  assert.equal(inspectorPresentation(node,r(assessment)).ml.estimatedDamageFraction,.27);
  for(const invalid of [{...assessment,modelVersion:null},{...assessment,predictionMethod:'unavailable'},{...assessment,estimatedDamageFraction:NaN},{...assessment,estimatedDamageFraction:1.2},{...assessment,available:false}])assert.equal(inspectorPresentation(node,r(invalid)).ml,null);
  assert.equal(inspectorPresentation({...node,id:'different'},r(assessment)).ml,null);
});
test('risk and status labels are readable and keep hypothetical operations distinct',()=>{
  for(const [predictedStatus,riskLevel,tone] of [['potentially_unavailable','high','high'],['potentially_interrupted','elevated','elevated'],['operational','low','low'],['not_exposed','low','neutral']]){
    const view=inspectorPresentation(node,{failures:[{nodeId:node.id,predictedStatus,riskLevel,reasonCodes:['FLOOD_POLYGON_INTERSECTION']}]});assert.equal(view.tone,tone);assert.ok(!view.status.includes('_'));assert.match(view.conditions[0],/hypothetical flood/);
  }
});
test('asset consequences do not borrow unrelated global metrics',()=>{
  const result={businessImpact:{totalEstimatedRevenueAtRiskUSD:10000,affectedBusinesses:[{businessId:'different',estimatedRevenueAtRiskUSD:10000}]}};
  assert.equal(inspectorPresentation(node,result).localImpact,undefined);
  result.businessImpact.affectedBusinesses.push({businessId:node.id,estimatedRevenueAtRiskUSD:0,estimatedDowntimeHours:null});assert.equal(inspectorPresentation(node,result).hasLocalNumbers,true);
});
test('relationship descriptions use actual direction and retain evidence',()=>{
  const edge={sourceId:'building',targetId:'facility',relationship:'HOSTS',evidenceLevel:'inferred'};
  assert.deepEqual(relationshipDescription(edge,'building'),{label:'Associated facility',evidence:'Spatially inferred'});
  assert.equal(relationshipDescription(edge,'facility').label,'Associated building');
});
