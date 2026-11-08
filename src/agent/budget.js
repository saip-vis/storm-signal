const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
export function agentLimits(){return {totalTimeoutMs:bounded(process.env.AGENT_TOTAL_TIMEOUT_MS,35000,1000,45000),modelTimeoutMs:bounded(process.env.AGENT_REQUEST_TIMEOUT_MS,15000,1000,15000),maxModelCalls:bounded(process.env.AGENT_MAX_STEPS,3,1,3),maxToolCalls:bounded(process.env.AGENT_MAX_TOOL_CALLS,6,1,6),maxOutputTokens:900,maxToolResultChars:12000};}
export function toolText(value,max=12000){
  const shrink=(v,depth=0)=>{if(v==null||typeof v==='boolean'||typeof v==='number')return v;if(typeof v==='string')return v.length>700?v.slice(0,700)+' [shortened]':v;if(depth>6)return '[details omitted]';if(Array.isArray(v))return v.slice(0,12).map(x=>shrink(x,depth+1));return Object.fromEntries(Object.entries(v).slice(0,32).map(([k,x])=>[k,shrink(x,depth+1)]));};
  const text=JSON.stringify(shrink(value));return text.length<=max?text:JSON.stringify({available:false,reason:'Result exceeds the bounded output budget. Ask for a focused node or category.'});
}
