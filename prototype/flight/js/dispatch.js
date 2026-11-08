'use strict';
// =====================================================================
// dispatch.js: AI radio dispatcher (NVIDIA Nemotron through serve.py, Live/local only).
// The planner decides the route; Nemotron only narrates it in plain words. Callouts are spoken with the
// browser's built-in speech voice after a radio squelch. V toggles the voice. Rate-limited to save tokens.
// =====================================================================
const DSP={on:false,busy:false,last:-99,pending:null,voice:store.get('df.voice','on')==='on',count:0};
function dispatchAvailable(){return live.server&&live.nvidia}
// compact facts for the model: no free text from the page except the alert headline
function situation(event){const U=unitPos(),tm=houstonTime(),spdNow=Math.round(mode=='air'?spd:Math.abs(TR.spd));
  const next=route.slice(0,3).map(r=>{const d=mode=='air'?Math.hypot(r.x-U.x,r.z-U.z):(guide.on&&r===route[0]?guide.dist:Math.hypot(r.b.stop.x-U.x,r.b.stop.z-U.z));
    const dl=isFinite(r.deadlineAbs)?Math.round(r.deadlineAbs-simT):null;return{people_est:r.people,building:r.b.n||r.b.t,distance_m:Math.round(d),eta_s:Math.round(d/Math.max(10,mode=='air'?cruiseAir():CFG.truck.avg)),hazard_reaches_in_s:dl,minutes_waiting:+(r.age/60).toFixed(1)}});
  return{event,houston_time:tm.label,mode_of_play:app==='live'?'Live Houston':'scenario',hazard:{tornado:'tornado',hurricane:H.derecho?'derecho wind storm':'hurricane',flood:'flash flood',wildfire:'wildfire',earthquake:'earthquake',none:'none'}[disaster],
    live_alert:app==='live'?live.note:null,unit:mode=='air'?'dragonfly drone':'fire truck',autopilot:auto,speed_mps:spdNow,battery_pct:Math.round(mode=='air'?bat:tbat),
    wind_mps:Math.round(lastWind.length()),next_stops:next,unreachable_by_road:est.unreach,plan_lives_est:Math.round(est.a),nearest_first_lives_est:Math.round(est.b),
    reached_so_far:stats.saved,missed_so_far:stats.missed,routing_rule:ROUTING_NOTE[disaster]}}
// ask for a callout on an event; at most one every 14 s (important events can jump the queue after 6 s)
function radio(event,important){if(!dispatchAvailable()||!go||disaster=='none')return;const gap=simT-DSP.last;
  if(DSP.busy||gap<(important?6:14)){DSP.pending=event;return}send(event)}
async function send(event){DSP.busy=true;DSP.last=simT;DSP.pending=null;
  try{const r=await fetch('/api/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(situation(event))});const j=await r.json();
    if(j.text){DSP.count++;showRadio(j.text);speak(j.text)}else if(j.error&&DSP.count==0)showRadio('(dispatcher offline: '+j.error+')',true)}catch(e){}
  DSP.busy=false}
function dispatchTick(){if(DSP.pending&&!DSP.busy&&simT-DSP.last>14)send(DSP.pending);
  if(go&&!paused&&dispatchAvailable()&&disaster!='none'&&simT-DSP.last>45&&route.length)radio('periodic status update')}
let radioHide=0;
function showRadio(text,dim){const el=$('radio');el.innerHTML='<b>DISPATCH</b> <span class="k">NVIDIA Nemotron, narrating the planner</span><br>'+text.replace(/</g,'&lt;');el.style.opacity=dim?.6:1;el.style.display='block';clearTimeout(radioHide);radioHide=setTimeout(()=>el.style.opacity=0,11000)}
function speak(text){sfx('squelch');if(!DSP.voice||!AU.on||!window.speechSynthesis)return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=1.08;u.pitch=.9;u.volume=.9;
  const vs=speechSynthesis.getVoices(),v=vs.find(v=>/en-US/.test(v.lang)&&/Samantha|Alex|Daniel|Google US/.test(v.name))||vs.find(v=>/^en/.test(v.lang));if(v)u.voice=v;setTimeout(()=>speechSynthesis.speak(u),180)}catch(e){}}
