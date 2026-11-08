import { booleanIntersects } from '@turf/boolean-intersects';
import { feature, point } from '@turf/helpers';
import { geometryValid } from '../buildings.js';
export function geographicExposure(graph,scenario){
  scenario={...scenario,assumptions:scenario.sourceType==='hypothetical'?['Hypothetical flood polygon only; no observed inundation, depth-based damage calculation or operational screening is used in exposure mode.']:[]};
  if(!geometryValid(scenario.footprint))throw new Error('A valid Polygon or MultiPolygon hazard footprint is required');
  const hazard=feature(scenario.footprint);
  const exposure=graph.nodes.map(n=>{
    const polygon=geometryValid(n.geometry)?feature(n.geometry):null;
    const coordinates=n.coordinates,located=Array.isArray(coordinates)&&coordinates.length===2&&coordinates.every(Number.isFinite)&&Math.abs(coordinates[0])<=180&&Math.abs(coordinates[1])<=90;
    const geometry=polygon??(located?point(coordinates):null);
    return {nodeId:n.id,exposureStatus:geometry?(booleanIntersects(geometry,hazard)?'exposed':'unexposed'):'unknown',method:geometry?(polygon?'polygon_intersection':'source_point_intersection'):'missing_geometry'};
  });
  const ids=new Set(exposure.filter(e=>e.exposureStatus==='exposed').map(e=>e.nodeId));
  const buildings=graph.nodes.filter(n=>n.type==='building'&&geometryValid(n.geometry)),facilities=graph.nodes.filter(n=>n.type==='business');
  const exposedFacilities=facilities.filter(n=>ids.has(n.id)).map(n=>({businessId:n.id,name:n.name,operationalStatus:null,estimatedRevenueAtRiskUSD:null,estimatedDowntimeHours:null,source:n.sources}));
  return {scenarioId:scenario.id,locationId:graph.locationId,scenario,predictionModeUsed:'exposure',generatedAt:new Date().toISOString(),simulated:scenario.sourceType!=='historical_observed',graphCounts:{buildings:buildings.length,facilities:facilities.length},exposure,exposedAssetIds:[...ids],exposedBuildingFootprints:buildings.filter(n=>ids.has(n.id)).map(n=>({buildingId:n.id,exposureMethod:'polygon_intersection'})),failures:[],hybridRiskAssessments:[],mlInferenceStatus:'not_applicable_exposure_only',cascadingImpacts:{impacts:[],reason:'Spatial associations are inspectable; operating dependencies and historical failures are unverified.'},businessImpact:{exposedFacilities,exposedFacilityCount:exposedFacilities.length,affectedBusinesses:[],totalAffectedBusinesses:null,totalEstimatedRevenueAtRiskUSD:null,totalLostOperatingHours:null},directCommunityImpact:{totalPopulationExposed:null,estimatedDisplacedResidents:null,estimatedShelterSeekers:null,dataSource:'unavailable_in_exposure_mode'},shelterNeeds:{availableCapacity:null,unmetShelterDemand:null,shelterDemand:null,shelters:[],reason:'Verified capacity and demand unavailable'},serviceGaps:{gaps:null,reason:'Service capacities and coverage unavailable'},assumptions:scenario.assumptions??[],limitations:[...(scenario.limitations??[]),'Geometry intersection establishes mapped exposure only; operational condition and damage are unknown.'],timeline:[]};
}
