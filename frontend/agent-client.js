export async function withAbort(promise,signal){if(!signal)return promise;signal.throwIfAborted();let listener;try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(signal.reason);signal.addEventListener('abort',listener,{once:true});})]);}finally{signal.removeEventListener('abort',listener);}}
export async function agentHealthRequest({signal,fetchImpl=fetch}={}){
  const response=await fetchImpl('/api/agent/health',{signal});if(!response.ok)throw new Error(`Health check HTTP ${response.status}. Restart the backend and retry.`);return response.json();
}
export async function investigate(input,{signal,onProgress=()=>{},fetchImpl=fetch}={}){
  const response=await fetchImpl('/api/agent/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify(input),signal});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error??`Investigation HTTP ${response.status}. Restart the backend or retry.`);}
  if(!response.body)throw new Error('No investigation stream received. Check the backend and retry.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result;
  const parse=line=>{if(!line.trim())return;const packet=JSON.parse(line);if(packet.type==='progress')onProgress(packet);else if(packet.type==='result')result=packet.result;else if(packet.type==='error')throw new Error(packet.message);};
  try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});if(pending.length>200000)throw new Error('Investigation response exceeded the client limit. Ask a focused question.');let index;while((index=pending.indexOf('\n'))>=0){parse(pending.slice(0,index));pending=pending.slice(index+1);}}pending+=decoder.decode();parse(pending);}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(!result)throw new Error('The investigation ended without a final result. Retry a focused question.');return result;
}
