import { intersect } from '@turf/intersect';
import { area } from '@turf/area';
import { booleanIntersects } from '@turf/boolean-intersects';
import { feature, featureCollection } from '@turf/helpers';
import { readFile } from 'node:fs/promises';
import { NetworkService } from './service.js';
import { predictBuildingDamageBatch } from './ml.js';
import { loadCensusSnapshot } from './census.js';
import { VISUALIZATION_REGION_ID, region } from './regions.js';

export function polygonOverlap(a,b){return booleanIntersects(feature(a),feature(b));}
export async function productionScenario(){const s=JSON.parse(await readFile(new URL('../data/simulations/richardson-flood.json',import.meta.url),'utf8'));return {...s,locationId:VISUALIZATION_REGION_ID,floodDepthFeet:4.5,assumptions:['Hypothetical flood polygon and uniform interior water depth relative to the lowest floor; no hydrodynamic forecast or observed inundation.', 'Physical damage uses the NFIP claims model with observed floor count where available. Missing numeric covariates use -1 and missing Boolean indicators use false, matching training preprocessing.', 'Availability is a scenario screening classification; actual operating condition and recovery duration are unknown.', 'Census population is weighted by intersected polygon area assuming uniform population distribution; displacement, capacities and revenue are unknown.']};}
export function populationExposure(tracts,flood){
  let total=0,known=0;const neighborhoods=[];
  for(const t of tracts){if(t.population==null)continue;known++;const clipped=intersect(featureCollection([feature(t.geometry),feature(flood)]));if(!clipped)continue;const fraction=Math.min(1,area(clipped)/area(feature(t.geometry)));const exposed=t.population*fraction;total+=exposed;neighborhoods.push({nodeId:t.geoid,population:t.population,exposedPopulation:Math.round(exposed),areaFraction:fraction,source:t.source});}
  return {neighborhoods,totalPopulationExposed:known?Math.round(total):null,estimatedDisplacedResidents:null,estimatedShelterSeekers:null,tractCount:tracts.length,populationTractCount:known,dataSource:known?'census_polygon_area_weighted':'unavailable',assumptions:['Population is distributed uniformly within each tract for this scenario estimate. Displacement and shelter-seeking rates are unavailable.']};
}
export function combineAssessment(rule,prediction,override){
  if(!rule.exposed)return {...rule,riskLevel:'low',predictedStatus:'not_exposed',estimatedDowntimeHours:null,reasonCodes:['OUTSIDE_SCENARIO']};
  if(!prediction||prediction.predictionMethod!=='trained_model')throw new Error('Hybrid assessment unavailable: Python/XGBoost inference failed. Check /api/ml/health and Python dependencies.');
  const severity=prediction.estimatedDamageFraction;
  const riskLevel=severity>=.45?'high':severity>=.18?'elevated':'low';
  return {...rule,riskLevel,predictedStatus:override??(riskLevel==='low'?'exposed_status_unknown':'potentially_unavailable'),estimatedDowntimeHours:null,estimatedDamageFraction:severity,reasonCodes:['FLOOD_POLYGON_INTERSECTION',`PHYSICAL_DAMAGE_${riskLevel.toUpperCase()}`],assumptions:['Damage fraction estimates physical loss conditional on historical insurance claims; it is not a closure probability. Availability is a conservative scenario screening rule, not an observed closure.']};
}
export async function runProductionSimulation({scenario,overrides={}}={}){
  const service=new NetworkService();await service.build();const graph=service.network();
  const configured=await productionScenario();scenario={...configured,...scenario,assumptions:configured.assumptions,locationId:VISUALIZATION_REGION_ID};
  scenario={...scenario,durationHours:overrides.durationHours??scenario.durationHours};
  if(scenario.disasterType!=='flood'||scenario.footprint?.type!=='Polygon')throw new Error('A hypothetical flood Polygon is required');
  for(const [id,status] of Object.entries(overrides.facilityStatus??{})){if(!graph.nodes.some(n=>n.id===id&&n.type==='building'))throw new Error(`Unknown building in counterfactual: ${id}`);if(!['operational','potentially_unavailable'].includes(status))throw new Error('Counterfactual status must be operational or potentially_unavailable');}
  const floodDepthFeet=overrides.floodDepthFeet??(overrides.severity?overrides.severity*1.5:scenario.floodDepthFeet??scenario.severity*1.5);
  if(!Number.isFinite(floodDepthFeet)||floodDepthFeet<0||floodDepthFeet>30)throw new Error('Assumed floodDepthFeet must be between 0 and 30');
  const {booleanPointInPolygon}=await import('@turf/boolean-point-in-polygon');
  const exposure=graph.nodes.map(n=>({nodeId:n.id,exposureStatus:(n.geometry?polygonOverlap(n.geometry,scenario.footprint):booleanPointInPolygon(n.coordinates,feature(scenario.footprint)))?'exposed':'unexposed',method:n.geometry?'polygon_intersection':'observed_point_in_polygon'}));
  const exposedIds=new Set(exposure.filter(e=>e.exposureStatus==='exposed').map(e=>e.nodeId));
  const buildings=graph.nodes.filter(n=>n.type==='building');
  const requests=buildings.filter(n=>exposedIds.has(n.id)).map(n=>({nodeId:n.id,buildingAttributes:{waterDepth:floodDepthFeet,numberOfFloorsInTheInsuredBuilding:n.properties.floors??null,occupancyType:null,foundationType:null,elevatedBuildingIndicator:null,postFIRMConstructionIndicator:null,yearOfLoss:null}}));
  const predictions=requests.length?await predictBuildingDamageBatch(requests):[];
  const byId=new Map(predictions.map(p=>[p.nodeId,p]));
  const failures=buildings.map(n=>combineAssessment({nodeId:n.id,exposed:exposedIds.has(n.id)},byId.get(n.id),overrides.facilityStatus?.[n.id]));
  const disrupted=new Set(failures.filter(f=>f.predictedStatus==='potentially_unavailable').map(f=>f.nodeId));
  const impacts=failures.filter(f=>disrupted.has(f.nodeId)).map(f=>({...f,direct:true,path:[f.nodeId],impactType:'direct_facility_unavailability'}));
  for(const edge of graph.edges){if(disrupted.has(edge.sourceId))impacts.push({nodeId:edge.targetId,predictedStatus:'potentially_interrupted',estimatedDowntimeHours:null,path:[edge.sourceId,edge.targetId],evidence:edge.evidenceLevel,impactType:'business_interruption',assumptions:[edge.explanation]});}
  const affected=graph.nodes.filter(n=>n.type==='business'&&(exposedIds.has(n.id)||impacts.some(i=>i.nodeId===n.id))).map(n=>({businessId:n.id,name:n.name,operationalStatus:'potentially_interrupted',estimatedRevenueAtRiskUSD:null,estimatedDowntimeHours:null,source:n.sources}));
  let census=[],censusError;try{census=(await loadCensusSnapshot()).features;}catch(error){censusError=error.message;}
  const [w,s,e,n]=region(VISUALIZATION_REGION_ID).bbox;
  const studyBoundary={type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};
  const boundedFlood=intersect(featureCollection([feature(scenario.footprint),feature(studyBoundary)]));
  const community=boundedFlood?populationExposure(census,boundedFlood.geometry):{...populationExposure(census,studyBoundary),neighborhoods:[],totalPopulationExposed:census.length?0:null};
  const assumptions=[...(scenario.assumptions??[]),`Uniform hypothetical interior flood depth ${floodDepthFeet} feet relative to the lowest floor is assumed across the flood polygon.`, 'Spatially inferred occupancy paths may propagate scenario disruptions; private utility dependencies are unknown.'];
  return {id:`result:${scenario.id}`,scenarioId:scenario.id,locationId:VISUALIZATION_REGION_ID,region:region(VISUALIZATION_REGION_ID),graphCounts:{buildings:buildings.length,facilities:graph.nodes.filter(n=>n.type==='business').length},scenario,predictionModeUsed:'hybrid',mlInferenceStatus:requests.length?'available':'not_required_no_exposure',mlModelVersion:predictions[0]?.modelVersion,generatedAt:new Date().toISOString(),simulated:true,exposure,exposedAssetIds:[...exposedIds],failures,hybridRiskAssessments:failures.filter(f=>f.exposed).map(f=>({nodeId:f.nodeId,mlAssessment:byId.get(f.nodeId),combinedAssessment:f})),exposedBuildingFootprints:buildings.filter(n=>exposedIds.has(n.id)).map(n=>({buildingId:n.id,exposureMethod:'polygon_intersection'})),cascadingImpacts:{impacts},businessImpact:{affectedBusinesses:affected,totalAffectedBusinesses:affected.length,totalEstimatedRevenueAtRiskUSD:null,totalLostOperatingHours:null},directCommunityImpact:community,shelterNeeds:{availableCapacity:null,unmetShelterDemand:null,shelterDemand:null,shelters:[],reason:'Verified capacities and demand assumptions unavailable'},serviceGaps:{gaps:[],reason:'Service capacities and coverage unknown'},assumptions,limitations:['Hypothetical scenario screening; no actual facility status or forecast. Revenue, downtime, displacement and capacity calculations are unavailable without sourced inputs.',...(censusError?[censusError]:[]),...graph.warnings],timeline:[]};
}
