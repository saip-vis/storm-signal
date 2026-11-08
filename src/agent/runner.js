import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT, toolDefinitions } from './contracts.js';
import { createToolRuntime } from './tools.js';
import { agentLimits, toolText } from './budget.js';
import { VISUALIZATION_REGION_ID } from '../regions.js';
const now=()=>new Date().toISOString();
const modelName=()=>process.env.NVIDIA_MODEL??'nvidia/nemotron-3-ultra-550b-a55b';
const fingerprint=()=>createHash('sha256').update([process.env.NVIDIA_API_KEY??'',modelName(),process.env.NVIDIA_BASE_URL??'https://integrate.api.nvidia.com/v1'].join('|')).digest('hex');
export async function nvidiaOnce(messages,{signal,allowTools=true,maxOutputTokens=900}={}){
  if(!process.env.NVIDIA_API_KEY)throw new Error('NVIDIA_API_KEY is not configured. Add it to .env and restart the server.');
  let url;try{url=new URL((process.env.NVIDIA_BASE_URL??'https://integrate.api.nvidia.com/v1').replace(/\/$/,'')+'/chat/completions');if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();}catch{throw new Error('NVIDIA_BASE_URL is invalid. Use the NVIDIA OpenAI-compatible endpoint and restart.');}
  let response;
  try{response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.NVIDIA_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:modelName(),messages,max_tokens:maxOutputTokens,temperature:0.15,tools:toolDefinitions,tool_choice:allowTools?'auto':'none'}),signal});}
  catch{signal?.throwIfAborted();throw new Error('Cannot reach NVIDIA. Check internet access and NVIDIA_BASE_URL, then retry.');}
  if(!response.ok){await response.body?.cancel();const action=response.status===401||response.status===403?'Check NVIDIA_API_KEY, model access and endpoint, then restart.':response.status===429?'Check NVIDIA quota/credits and retry later.':'The provider is unavailable; retry later.';throw new Error(`NVIDIA HTTP ${response.status}. ${action}`);}
  const data=await response.json();signal?.throwIfAborted();const message=data.choices?.[0]?.message;if(!message)throw new Error('NVIDIA returned no answer. Retry a focused question.');return message;
}
function offlineMock(messages){return messages.some(m=>m.role==='tool')?{content:'Offline test used the real geographic tool result. No live NVIDIA request was made; operating condition remains unknown.'}:{content:null,tool_calls:[{id:'offline-summary',type:'function',function:{name:'get_network_summary',arguments:JSON.stringify({locationId:VISUALIZATION_REGION_ID})}}]};}
export function createAgent({modelRequest=nvidiaOnce,runtimeFactory=createToolRuntime,limitsFactory=agentLimits}={}){
  const sessions=new Map(),active=new Set();let verified=null;
  function getSession(id,context){if(!sessions.has(id)){if(sessions.size>=32){const idle=[...sessions.keys()].find(key=>!active.has(key));if(idle)sessions.delete(idle);}sessions.set(id,{id,createdAt:now(),messages:[],context:{locationId:VISUALIZATION_REGION_ID,scenarioId:'richardson-flood-demo',predictionMode:'exposure',...context},trace:[]});}return sessions.get(id);}
  function verification(){const valid=verified?.fingerprint===fingerprint();return {liveNvidiaVerified:Boolean(valid),liveVerification:valid?{verifiedAt:verified.at,model:verified.model,method:'Live NVIDIA response and real network tool smoke'}:null};}
  async function chat({sessionId='default',message,context={},provider=process.env.AGENT_PROVIDER??'nvidia',smokeTest=false}={}, {signal:externalSignal,onProgress=()=>{}}={}){
    if(typeof message!=='string'||!message.trim()||message.length>4000)throw new Error('Provide a question of 1–4000 characters.');
    if(typeof sessionId!=='string'||sessionId.length>120)throw new Error('Invalid session identifier');
    if(!['nvidia','mock_test'].includes(provider))throw new Error('Unsupported agent provider');
    if(active.has(sessionId)||active.size>=2)throw new Error('An investigation is already running. Cancel it or wait.');
    const limits=limitsFactory(),started=Date.now(),controller=new AbortController();
    const cancel=()=>controller.abort(externalSignal?.reason??new DOMException('Investigation cancelled','AbortError'));
    if(externalSignal?.aborted)cancel();else externalSignal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error('Investigation reached its total time budget. Ask a focused question or retry.')),limits.totalTimeoutMs);
    const signal=controller.signal,s=getSession(sessionId,context),trace=[],warnings=[],evidence=[];let answer='',status='completed',modelCalls=0,toolCalls=0;
    s.context={...s.context,...context};const runtime=runtimeFactory(s.context,{signal});active.add(sessionId);
    const emit=(stage,detail)=>{try{onProgress({stage,detail,elapsedMs:Date.now()-started,remainingMs:Math.max(0,limits.totalTimeoutMs-(Date.now()-started)),modelCalls,toolCalls});}catch{/* A disconnected progress sink must not extend the request. */}};
    const check=()=>signal.throwIfAborted();
    async function bounded(promise,abortSignal=signal){abortSignal.throwIfAborted();let listener;try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(abortSignal.reason);abortSignal.addEventListener('abort',listener,{once:true});})]);}finally{abortSignal.removeEventListener('abort',listener);}}
    try{
      check();emit('checking','Checking provider configuration and the full request budget');
      if(provider==='nvidia'&&!process.env.NVIDIA_API_KEY)throw new Error('NVIDIA_API_KEY is not configured. Add it to .env and restart the server.');
      const messages=[{role:'system',content:`${SYSTEM_PROMPT}\nCurrent authoritative context: ${toolText(s.context)}`},...s.messages.slice(-6),{role:'user',content:message}];
      for(let step=0;step<limits.maxModelCalls;step++){
        check();const allowTools=step<limits.maxModelCalls-1&&toolCalls<limits.maxToolCalls;modelCalls++;emit('model',allowTools?'NVIDIA is selecting focused evidence':'NVIDIA is writing the answer from collected evidence');
        const callSignal=AbortSignal.any([signal,AbortSignal.timeout(limits.modelTimeoutMs)]);let assistant;
        try{assistant=provider==='mock_test'?offlineMock(messages):await bounded(modelRequest(messages,{signal:callSignal,allowTools,maxOutputTokens:limits.maxOutputTokens}),callSignal);}
        catch(error){check();if(callSignal.aborted)throw new Error('NVIDIA response timed out. Retry a shorter question; no automatic paid retry was made.');throw error;}
        if(!assistant)throw new Error('NVIDIA returned no message. Retry a focused question.');
        const calls=assistant.tool_calls??[];
        if(!calls.length){answer=String(assistant.content??'').trim().slice(0,6000);if(!answer)throw new Error('NVIDIA returned an empty answer. Retry a focused question.');break;}
        if(!allowTools){status='partial';warnings.push('Model/tool budget reached. No further tools were executed.');break;}
        const boundedCalls=calls.slice(0,limits.maxToolCalls-toolCalls);
        messages.push({role:'assistant',content:assistant.content??null,tool_calls:boundedCalls});
        const entries=boundedCalls.map(call=>{toolCalls++;return {call,entry:{id:call.id,toolName:call.function?.name??'unknown',arguments:null,status:'error',startedAt:now()}};});
        emit('tools',`Reading evidence: ${entries.map(x=>x.entry.toolName).join(', ')}`);
        const results=await bounded(Promise.all(entries.map(async({call,entry})=>{
          const start=Date.now();let value;
          try{check();const args=JSON.parse(call.function.arguments);entry.arguments=args;value=await runtime.execute(entry.toolName,args);check();entry.status='success';entry.summary=`${entry.toolName} completed`;if(entry.toolName==='get_network_summary')entry.resultSummary={nodeCount:value.nodeCount,edgeCount:value.edgeCount};evidence.push({toolName:entry.toolName,scenarioId:args.scenarioId,nodeIds:args.nodeId?[args.nodeId]:undefined,description:entry.summary});}
          catch(error){check();entry.summary=error.message;warnings.push(`Tool ${entry.toolName}: ${error.message}`);value={available:false,error:error.message};}
          entry.completedAt=now();entry.durationMs=Date.now()-start;trace.push(entry);return {entry,message:{role:'tool',tool_call_id:call.id,content:toolText(value,limits.maxToolResultChars)}};
        })));
        messages.push(...results.map(r=>r.message));
        if(results.some(r=>r.entry.status==='error'&&/Python|inference failed|XGBoost/i.test(r.entry.summary)))throw new Error('Python inference is unavailable. Choose Geometry exposure, or install ml-training/requirements.txt and check /api/ml/health before retrying experimental flood ML.');
        emit('evidence','Evidence loaded; duplicate lookups reuse this request’s data');
      }
      if(!answer){status='partial';answer='Investigation reached its bounded model/tool limit. Review the evidence or ask a narrower question.';}
      const smokeSummary=trace.find(t=>t.toolName==='get_network_summary'&&t.status==='success')?.resultSummary;
      const normalizedAnswer=answer.replaceAll(',','');
      if(smokeTest&&provider==='nvidia'&&status==='completed'&&!warnings.length&&smokeSummary&&[smokeSummary.nodeCount,smokeSummary.edgeCount].every(count=>Number.isInteger(count)&&normalizedAnswer.includes(String(count))))verified={fingerprint:fingerprint(),at:now(),model:modelName()};
      s.messages.push({role:'user',content:message},{role:'assistant',content:answer});s.messages=s.messages.slice(-8);
    }catch(error){status=externalSignal?.aborted?'cancelled':signal.aborted?'timeout':'failed';warnings.push(String(error.message??error));}
    finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',cancel);active.delete(sessionId);s.trace=[...s.trace,...trace].slice(-24);}
    emit(status,status==='completed'?'Investigation complete':warnings.at(-1)??'Investigation stopped');
    return {sessionId:s.id,provider,model:provider==='nvidia'?modelName():'mock_test',answer,status,context:s.context,toolTrace:trace,evidence,warnings,budget:{...limits,elapsedMs:Date.now()-started,modelCalls,toolCalls},runtime:runtime.stats,...verification()};
  }
  return {chat,verification,session:id=>{const s=sessions.get(id);if(!s)throw new Error('Unknown session');return s;},reset:id=>{if(active.has(id))throw new Error('Cancel the active investigation before resetting');sessions.delete(id);return {reset:true,sessionId:id};}};
}
