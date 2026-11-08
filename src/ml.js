import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),artifacts=path.join(root,'ml-training/artifacts');
export async function modelMetadata(){try{return JSON.parse(await readFile(path.join(artifacts,'model_metadata.json'),'utf8'));}catch{return null;}}
let healthProbe,healthAt=0;
export async function mlHealth({force=false}={}){
  if(!force&&healthProbe&&Date.now()-healthAt<60000)return healthProbe;
  healthAt=Date.now();healthProbe=(async()=>{const metadata=await modelMetadata(),prediction=await predictBuildingDamageBatch([{nodeId:'health',buildingAttributes:{waterDepth:2}}],{timeoutMs:5000});const available=prediction[0]?.predictionMethod==='trained_model';return {available,model:metadata?.modelVersion??null,reason:available?null:prediction[0]?.limitations?.[0],limitations:prediction[0]?.limitations??metadata?.limitations,locallyValidated:false,checkedAt:new Date().toISOString()};})();return healthProbe;
}
export async function predictBuildingDamageBatch(requests,{signal,timeoutMs=15000,spawnImpl=spawn}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(requests)||requests.length>12000)throw new Error('Expected at most 12000 building inference requests');
  if(!requests.length)return [];
  if(requests.some(r=>!Number.isFinite(r.buildingAttributes?.waterDepth)))return requests.map(r=>fallback(r,'Essential model input waterDepth (feet relative to the lowest floor) is unavailable. Supply an explicit hazard assumption.'));
  const metadata=await modelMetadata();signal?.throwIfAborted();if(!metadata)return requests.map(r=>fallback(r,'Model artifact unavailable. Choose Geometry exposure or restore the model artifacts.'));
  return new Promise((resolve,reject)=>{
    let child,settled=false,stdout='',timer;
    const finish=(value,error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
    const unavailable=reason=>finish(requests.map(r=>fallback(r,reason)));
    const cancel=()=>{child?.kill('SIGKILL');finish(null,signal.reason??new DOMException('Inference cancelled','AbortError'));};
    try{child=spawnImpl('python3',['ml-training/predict.py'],{cwd:root});}catch{unavailable('Python is unavailable. Choose Geometry exposure, or install Python and ml-training/requirements.txt.');return;}
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
    timer=setTimeout(()=>{child.kill('SIGKILL');unavailable('Python inference timed out. Choose Geometry exposure or check Python dependencies at /api/ml/health.');},Math.min(15000,Math.max(1,timeoutMs)));
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>10_000_000){child.kill('SIGKILL');unavailable('Python inference exceeded the output limit. Use a smaller region.');}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>unavailable('Python inference is unavailable. Choose Geometry exposure, or install Python and ml-training/requirements.txt.'));
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(settled)return;
      try{
        if(code)throw new Error();const raw=JSON.parse(stdout);
        if(raw.length!==requests.length||raw.some((x,i)=>x.nodeId!==requests[i].nodeId||!Number.isFinite(x.estimatedDamageFraction)||x.estimatedDamageFraction<0||x.estimatedDamageFraction>1))throw new Error();
        finish(raw.map((x,i)=>({...x,damageCategory:category(x.estimatedDamageFraction),predictionMethod:'trained_model',modelVersion:metadata.modelVersion,inputFeatures:requests[i].buildingAttributes,missingFeatures:Object.entries(requests[i].buildingAttributes).filter(([,v])=>v==null).map(([k])=>k),assumptions:['Flood depth is a hypothetical scenario input; missing covariates use the training defaults.'],limitations:[...metadata.limitations.filter(l=>!l.includes('Richardson model inputs are synthetic')),'Experimental historical claim severity only. No independent Richardson operating-status validation.']})));
      }catch{unavailable('Python inference failed. Choose Geometry exposure, or install ml-training/requirements.txt and check /api/ml/health.');}
    });
    child.stdin.end(JSON.stringify(requests));
  });
}
function category(x){return x>=.45?'high':x>=.18?'moderate':'low';}function fallback(r,reason){return {nodeId:r.nodeId,estimatedDamageFraction:null,damageCategory:'unknown',predictionMethod:'unavailable',inputFeatures:r.buildingAttributes,missingFeatures:Object.keys(r.buildingAttributes??{}),assumptions:[],limitations:[reason]};}
export function hybridAssessments(failures,predictions){const byId=new Map(predictions.map(x=>[x.nodeId,x]));return failures.map(rule=>{const ml=byId.get(rule.nodeId),high=ml?.damageCategory==='high',moderate=ml?.damageCategory==='moderate';const operationalRisk=high?'high':moderate&&rule.riskLevel==='low'?'elevated':rule.riskLevel;return {nodeId:rule.nodeId,mlAssessment:ml?{available:ml.predictionMethod==='trained_model',...ml}:{available:false},ruleAssessment:{riskLevel:rule.riskLevel,reasonCodes:rule.reasonCodes,triggeredRules:rule.reasonCodes},combinedAssessment:{operationalRisk,predictedStatus:rule.predictedStatus,estimatedDowntimeHours:rule.estimatedDowntimeHours,method:ml?.predictionMethod==='trained_model'?'hybrid':'rule_only',reasonCodes:[...rule.reasonCodes,...(high?['HIGH_PHYSICAL_DAMAGE_ESTIMATE']:moderate?['MODERATE_PHYSICAL_DAMAGE_ESTIMATE']:[])],explanation:ml?.predictionMethod==='trained_model'?'Physical damage estimate is considered sequentially with operational rules; it is not averaged with them.':'ML unavailable; retained rule-only operational assessment.'},assumptions:ml?.assumptions??[],sources:['FEMA NFIP claims model metadata','synthetic Richardson scenario attributes']};});}
