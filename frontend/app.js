import * as maplibregl from '/vendor/maplibre-gl.mjs';
const $=selector=>document.querySelector(selector),esc=value=>String(value??'Unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map,graph,region,scenario,result,selected,buildings=[],metadata,sourceWarnings=[],running=false;
const empty=()=>({type:'FeatureCollection',features:[]});
async function request(url,body){const response=await fetch(url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
function state(message){$('#status').textContent=message;}
function show(view){document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);document.querySelectorAll('[data-view]').forEach(el=>view===el.dataset.view?el.setAttribute('aria-current','page'):el.removeAttribute('aria-current'));$('#navigation').hidden=true;$('#menu').setAttribute('aria-expanded','false');if(view==='map')requestAnimationFrame(()=>map?.resize());}
$('#menu').onclick=()=>{const open=$('#navigation').hidden;$('#navigation').hidden=!open;$('#menu').setAttribute('aria-expanded',String(open));};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>show(button.dataset.view));
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#navigation').hidden=true;$('#menu').setAttribute('aria-expanded','false');}});
function fit(){if(region&&map)map.fitBounds([[region.bbox[0],region.bbox[1]],[region.bbox[2],region.bbox[3]]],{padding:55,pitch:0,bearing:0,duration:500});}
$('#fit').onclick=fit;
function source(name,features){map.getSource(name)?.setData({type:'FeatureCollection',features});}
async function setup(){
  try{
    region=await request('/api/region');
    map=new maplibregl.Map({container:'map',center:[(region.bbox[0]+region.bbox[2])/2,(region.bbox[1]+region.bbox[3])/2],zoom:13,style:'https://tiles.openfreemap.org/styles/dark',attributionControl:true});
    map.addControl(new maplibregl.NavigationControl(),'bottom-left');
    await new Promise((resolve,reject)=>{map.once('load',resolve);map.on('error',event=>{if(!map.isStyleLoaded()){$('#coverage').textContent=`Basemap unavailable: ${event.error.message}`;}});setTimeout(()=>{if(!map.isStyleLoaded())reject(new Error('Basemap did not load. Check internet connectivity.'));},30000);});
    for(const id of ['buildings','facilities','flood','exposure','tracts','selected','dependencies'])map.addSource(id,{type:'geojson',data:empty()});
    map.addLayer({id:'tracts',source:'tracts',type:'line',layout:{visibility:'none'},paint:{'line-color':'#6e879d','line-width':1,'line-dasharray':[3,3]}});
    map.addLayer({id:'flood',source:'flood',type:'fill',paint:{'fill-color':'#258cca','fill-opacity':.18}});
    map.addLayer({id:'flood-outline',source:'flood',type:'line',paint:{'line-color':'#469cd0','line-width':1.5,'line-dasharray':[3,2]}});
    map.addLayer({id:'buildings',source:'buildings',type:'fill',paint:{'fill-color':'#5c8da8','fill-opacity':.65}});
    map.addLayer({id:'building-outlines',source:'buildings',type:'line',paint:{'line-color':'#8cb7cc','line-width':.7}});
    map.addLayer({id:'exposure',source:'exposure',type:'fill',paint:{'fill-color':'#e98373','fill-opacity':.8}});
    map.addLayer({id:'selected',source:'selected',type:'line',paint:{'line-color':'#8af8e3','line-width':3}});
    map.addLayer({id:'dependencies',source:'dependencies',type:'line',paint:{'line-color':'#6ed6cb','line-width':2,'line-dasharray':[3,2]}});
    map.addLayer({id:'facilities',source:'facilities',type:'circle',paint:{'circle-color':'#c59afb','circle-radius':6,'circle-stroke-color':'#14212f','circle-stroke-width':2}});
    map.on('click',event=>{const hit=map.queryRenderedFeatures(event.point,{layers:['facilities','buildings','exposure']})[0];if(hit)select(hit.properties.nodeId||hit.properties.id);});
    for(const name of ['facilities','buildings']){map.on('mouseenter',name,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',name,()=>map.getCanvas().style.cursor='');}
    fit();await loadData();
  }catch(error){state('Unavailable');$('#coverage').textContent=error.message;}
}
async function loadData(){
  state('Loading Richardson…');
  try{
    await request('/api/network/build',{locationId:region.id});
    [graph,scenario]=await Promise.all([request('/api/network'),request('/api/simulations/scenarios/richardson-flood-demo')]);
    if(graph.locationId!==region.id)throw new Error('Network and map region do not match');
    buildings=[];let offset=0;
    do{const page=await request(`/api/data/buildings?format=geojson&locationId=${region.id}&limit=2000&offset=${offset}`);metadata=page.metadata;buildings.push(...page.features);source('buildings',buildings);state(`Loading buildings ${buildings.length.toLocaleString()}…`);if(page.metadata.nextOffset===null)break;if(!page.features.length)throw new Error('Incomplete building pagination');offset=page.metadata.nextOffset;}while(true);
    source('facilities',graph.nodes.filter(n=>n.type==='business').map(n=>({type:'Feature',geometry:{type:'Point',coordinates:n.coordinates},properties:{id:n.id,nodeId:n.id,name:n.name,category:n.properties.category}})));
    source('flood',[{type:'Feature',geometry:scenario.footprint,properties:{}}]);
    try{const census=await request('/api/data/census?format=geojson');source('tracts',census.features);}catch(error){sourceWarnings.push(error.message);}
    $('#coverage').textContent=`${buildings.length.toLocaleString()} cached buildings · ${metadata.coverageComplete===true?'Complete extract':metadata.coverageComplete===false?'Partial geographic coverage':'Coverage completeness unknown'}`;
    sourceWarnings.push(...(graph.warnings??[]));renderSources();$('#run').disabled=false;$('#run-results').disabled=false;state('Richardson ready');
  }catch(error){state('Data unavailable');$('#coverage').textContent=error.message;}
}
function renderSources(){
  $('#source-details').innerHTML=`<p>${esc(region.name)}. ${esc(region.coverageDescription)}</p><dl><dt>Buildings</dt><dd>Overture Maps · cached</dd><dt>Release</dt><dd>${esc(metadata?.source.datasetRelease)}</dd><dt>Acquired</dt><dd>${esc(metadata?.source.acquiredAt)}</dd><dt>Coverage</dt><dd>${metadata?.coverageComplete===true?'Complete bounded extract':'Incomplete or unverified coverage'}</dd><dt>Facilities</dt><dd>OpenStreetMap / Overpass</dd><dt>Population</dt><dd>US Census TIGER/Line + ACS 2022; study-area tract intersections; Dallas and Collin Counties queried</dd></dl><p>Building footprints establish geometry. Spatially matched facilities are inferred associations. Operational condition, utility connections, revenue and shelter capacities remain unknown.</p><p>Flood footprints and depth are hypothetical. Damage fractions are estimated from historical NFIP claims and do not represent calibrated closure probabilities.</p>${sourceWarnings.map(w=>`<p class="error">${esc(w)}</p>`).join('')}${result?`<h3>Scenario assumptions</h3>${result.assumptions.map(a=>`<p>${esc(a)}</p>`).join('')}`:''}`;
}
$('#source-button').onclick=()=>$('#sources').showModal();$('#close-sources').onclick=()=>$('#sources').close();
const human=value=>String(value??'Unknown').replaceAll('_',' ');
function select(id){
  const n=graph.nodes.find(n=>n.id===id);if(!n)return;selected=n;$('#selection').hidden=false;$('#selection-type').textContent=n.type==='building'?'OVERTURE BUILDING':'OPENSTREETMAP FACILITY';$('#selection-name').textContent=n.name;
  const failure=result?.failures.find(f=>f.nodeId===id)??result?.cascadingImpacts.impacts.find(f=>f.nodeId===id),exposure=result?.exposure.find(e=>e.nodeId===id),edges=graph.edges.filter(e=>e.sourceId===id||e.targetId===id);
  $('#selection-body').innerHTML=`<dl><dt>Category</dt><dd>${esc(human(n.properties.category??n.properties.buildingClass))}</dd><dt>Height</dt><dd>${n.properties.heightMeters!=null?esc(n.properties.heightMeters.toFixed(1))+' m':'Unknown'}</dd><dt>Floors</dt><dd>${esc(n.properties.floors)}</dd><dt>Scenario exposure</dt><dd>${exposure?esc(human(exposure.exposureStatus)):'Run scenario'}</dd><dt>Modeled availability</dt><dd>${failure?esc(human(failure.predictedStatus)):'Unknown'}</dd>${failure?.estimatedDamageFraction!=null?`<dt>Damage severity</dt><dd>${Math.round(failure.estimatedDamageFraction*100)}% estimated physical loss</dd>`:''}</dl><h3>Relationships</h3>${edges.length?edges.map(e=>{const other=graph.nodes.find(x=>x.id===(e.sourceId===id?e.targetId:e.sourceId));return `<button class="relationship" data-node="${esc(other.id)}">${esc(other.name)}<small>${e.sourceId===id?'Downstream':'Upstream'} · ${esc(e.relationship)} · ${esc(e.evidenceLevel)}</small></button>`;}).join(''):'<p class="note">No sourced dependencies are currently known.</p>'}<p class="note">${failure?'Modeled under the hypothetical flood. Actual operating status is unknown.':'Source-backed geography. Actual operating status is unknown.'}</p><details><summary>Source details</summary><pre>${esc(JSON.stringify(n.sources,null,2))}</pre></details>`;
  $('#selection-body').querySelectorAll('[data-node]').forEach(button=>button.onclick=()=>select(button.dataset.node));
  source('selected',n.geometry?[{type:'Feature',geometry:n.geometry,properties:{}}]:[]);
  source('dependencies',edges.map(e=>{const a=graph.nodes.find(n=>n.id===e.sourceId),b=graph.nodes.find(n=>n.id===e.targetId);return {type:'Feature',geometry:{type:'LineString',coordinates:[a.coordinates,b.coordinates]},properties:{relationship:e.relationship,evidence:e.evidenceLevel}};}));
  $('#assistant-context').textContent=`Selected: ${n.name} · ${region.name}`;
}
$('#close-selection').onclick=()=>{$('#selection').hidden=true;selected=null;$('#assistant-context').textContent='Richardson study region · hybrid simulation';source('selected',[]);source('dependencies',[]);};
$('#ask-selected').onclick=()=>{show('assistant');$('#question').value=`Explain the flood exposure and known dependencies for ${selected.name}.`;$('#question').focus();};
document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{const names={buildings:['buildings','building-outlines'],facilities:['facilities'],flood:['flood','flood-outline'],exposure:['exposure'],tracts:['tracts'],dependencies:['dependencies']};for(const id of names[input.dataset.layer])if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',input.checked?'visible':'none');});
async function simulate(){
  if(running||!graph)return;running=true;result=null;source('exposure',[]);if(selected)select(selected.id);$('#depth').disabled=true;$('#results').innerHTML='<p class="empty">Intersecting flood geometry and running Python/XGBoost inference…</p>';$('#simulation-error').hidden=true;$('#run').disabled=true;$('#run-results').disabled=true;state('Running hybrid assessment…');
  try{
    result=await request('/api/simulations/run',{scenarioId:scenario.id,overrides:{floodDepthFeet:Number($('#depth').value)}});
    if(result.locationId!==region.id||result.predictionModeUsed!=='hybrid')throw new Error('Simulation returned an incompatible region or assessment');
    const ids=new Set(result.exposedBuildingFootprints.map(b=>b.buildingId));source('exposure',buildings.filter(b=>ids.has(b.id)));
    const population=result.directCommunityImpact.totalPopulationExposed;
    $('#results').innerHTML=`<div class="cards"><div class="card"><span>Buildings exposed</span><strong>${ids.size.toLocaleString()}</strong><small>Actual polygon intersection</small></div><div class="card"><span>Facilities potentially affected</span><strong>${result.businessImpact.totalAffectedBusinesses}</strong><small>Direct exposure or inferred occupancy path</small></div><div class="card"><span>Population exposure estimate</span><strong>${population==null?'Unavailable':population.toLocaleString()}</strong><small>Census polygon area weighting</small></div></div><p class="note">Hypothetical flood. Revenue, downtime, displacement and shelter capacity estimates are unavailable without sourced inputs. Actual closures are unknown. Counts use source records; duplicate OSM representations may occur.</p><h2>Potentially affected facilities</h2>${result.businessImpact.affectedBusinesses.map(b=>`<div class="result-row"><span>${esc(b.name)}</span><button data-result="${esc(b.businessId)}">View on map →</button></div>`).join('')||'<p>No facilities intersect this scenario or its inferred occupancy paths.</p>'}<details><summary>Model assumptions & limitations</summary>${[...result.assumptions,...result.limitations].map(a=>`<p>${esc(a)}</p>`).join('')}</details>`;
    document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{show('map');select(b.dataset.result);map.flyTo({center:selected.coordinates,zoom:16});});
    if(selected)select(selected.id);renderSources();state('Hybrid assessment ready');
  }catch(error){result=null;$('#results').innerHTML='';$('#simulation-error').hidden=false;$('#simulation-error').textContent=error.message;state('Assessment unavailable');}
  finally{running=false;$('#run').disabled=false;$('#run-results').disabled=false;$('#depth').disabled=false;}
}
$('#run').onclick=()=>{show('results');simulate();};$('#run-results').onclick=simulate;
$('#depth').onchange=()=>{if(result){result=null;source('exposure',[]);$('#results').innerHTML='<p class="empty">Depth changed. Run the scenario again to update results.</p>';if(selected)select(selected.id);}};
$('#ask-form').onsubmit=async event=>{
  event.preventDefault();if($('#ask').disabled)return;const message=$('#question').value.trim();if(!message)return;
  const conversation=$('#conversation');conversation.querySelector('.empty')?.remove();conversation.insertAdjacentHTML('beforeend',`<article class="message user"><span class="eyebrow">YOU</span>${esc(message)}</article>`);$('#ask').disabled=true;$('#ask').textContent='Investigating…';
  try{const response=await request('/api/agent/chat',{sessionId:'richardson-production',message,context:{locationId:region.id,scenarioId:scenario.id,selectedNodeId:selected?.id,scenarioOverrides:{floodDepthFeet:Number($('#depth').value)}}});
    conversation.insertAdjacentHTML('beforeend',`<article class="message"><span class="eyebrow">${response.provider==='nvidia'?'NVIDIA NEMOTRON':'OFFLINE TEST'}</span>${esc(response.answer||response.warnings?.join('\n')||'Provider returned no answer.')}<details><summary>Evidence & tool trace · ${esc(response.status)}</summary>${response.toolTrace.map(t=>`<p>${esc(t.toolName)} · ${esc(t.status)} · ${esc(t.summary)}</p>`).join('')}${response.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details></article>`);
  }catch(error){conversation.insertAdjacentHTML('beforeend',`<p class="error">${esc(error.message)}</p>`);}finally{$('#ask').disabled=false;$('#ask').textContent='Investigate →';}
};
setup();
