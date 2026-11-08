import { productionScenario, runProductionSimulation } from '../production-simulation.js';
import { NetworkService } from '../service.js';
import { geographicExposure } from './exposure.js';
import { tornadoAvailability } from './tornado.js';
export async function supportedScenarios(){const tornado=await tornadoAvailability();return {scenarios:[{...await productionScenario(),supportedPredictionModes:['exposure','hybrid'],modelUse:'Experimental NFIP claim severity only; no locally validated operational failure model.'},...tornado.events.map(e=>({...e,supportedPredictionModes:['exposure']}))],availability:{tornado:{available:tornado.available,reason:tornado.reason??null},currentWarnings:{available:false,reason:'Current NWS warning ingestion is not integrated.'}}};}
export async function getScenario(id='richardson-flood-demo'){const {scenarios}=await supportedScenarios();const scenario=scenarios.find(s=>s.id===id);if(!scenario)throw new Error('Unknown or unavailable disaster scenario');return scenario;}
export async function analyzeHazard({scenarioId='richardson-flood-demo',predictionMode='exposure',overrides={}}={}){
  const scenario=await getScenario(scenarioId);
  if(!scenario.supportedPredictionModes.includes(predictionMode))throw new Error('Unsupported prediction mode for this hazard');
  if(predictionMode==='hybrid')return runProductionSimulation({scenario,overrides});
  if(Object.keys(overrides).some(k=>!['floodDepthFeet','durationHours'].includes(k)))throw new Error('Operational overrides require explicit experimental flood hybrid mode');
  const service=new NetworkService();await service.build(scenario.locationId);
  return geographicExposure(service.network(),scenario);
}
