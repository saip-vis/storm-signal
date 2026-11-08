import { investigate,agentHealthRequest,withAbort } from '/agent-client.js';
import * as maplibregl from '/vendor/maplibre-gl.mjs';
import { selectionNeighborhood, inspectorPresentation, relationshipDescription, analysisMetrics, interventionPayload } from '/adapter.js';
const $=selector=>document.querySelector(selector),esc=value=>String(value??'Unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map,graph,region,scenario,result,selected,buildings=[],metadata,sourceWarnings=[],running=false,debugGraph,inspectorCloseTimer,activePanel='map',comparison=null,comparing=false,analysisBaseline=null,catalog=[],appConfig=null,agentController=null,agentHealthState=null,agentHealthAt=0,agentHealthPending=null;
const assistantSessionId=`storm-signal:${crypto.randomUUID()}`;
const displayName=document.body.dataset.displayName||'Storm Signal';$('#brand-name').textContent=displayName;document.title=`${displayName} · Infrastructure Intelligence`;
const empty=()=>({type:'FeatureCollection',features:[]});
async function request(url,body){const response=await fetch(url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
function state(message){$('#status').textContent=message;}
function show(view){activePanel=view;document.body.dataset.panel=view;document.querySelectorAll('.control-panel').forEach(el=>el.hidden=el.id!==`view-${view}`);document.querySelectorAll('[data-view]').forEach(el=>{el.setAttribute('aria-pressed',String(view===el.dataset.view));view===el.dataset.view?el.setAttribute('aria-current','page'):el.removeAttribute('aria-current');});$('#navigation').hidden=true;$('#menu').setAttribute('aria-expanded','false');$('#selection').hidden=view!=='map'||!selected;document.body.classList.toggle('has-selection',view==='map'&&Boolean(selected));if(view==='compare')updateIntervention();if(view==='assistant')checkAgentHealth().catch(()=>{});requestAnimationFrame(()=>map?.resize());}
document.querySelectorAll('[data-close-panel]').forEach(button=>button.onclick=()=>show('map'));
$('#brand-home').onclick=event=>{event.preventDefault();show('map');};
$('#menu').onclick=()=>{const open=$('#navigation').hidden;$('#navigation').hidden=!open;$('#menu').setAttribute('aria-expanded',String(open));};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>show(button.dataset.view));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#sources').open){$('#navigation').hidden=true;$('#menu').setAttribute('aria-expanded','false');show('map');}});
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function fit(){if(region&&map)map.fitBounds([[region.bbox[0],region.bbox[1]],[region.bbox[2],region.bbox[3]]],{padding:65,pitch:25,bearing:-12,duration:reducedMotion?0:800});}
$('#fit').onclick=fit;
$('#hazard-extent').onclick=()=>{if(!scenario?.footprint)return;const points=scenario.footprint.coordinates.flat(scenario.footprint.type==='Polygon'?1:2);map.fitBounds([[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]],{padding:65,pitch:0,bearing:0,duration:reducedMotion?0:700});};
$('#overview').onclick=()=>map?.flyTo({center:[-30,24],zoom:1.5,pitch:0,bearing:0,duration:reducedMotion?0:1600});
$('#city-view').onclick=()=>map?.flyTo({center:selected?.coordinates??[-96.73,32.955],zoom:15.5,pitch:55,bearing:-20,duration:reducedMotion?0:1100});
function source(name,features){map.getSource(name)?.setData({type:'FeatureCollection',features});}
function monochromeBasemap(){
  // Pattern the actual vector basemap: opaque water masks keep dots off oceans.
  const dots=new Uint8Array(8*8*4),blank=new Uint8Array(8*8*4);
  for(let y=3;y<5;y++)for(let x=3;x<5;x++){const i=(y*8+x)*4;dots.set([215,218,224,145],i);}
  map.addImage('geographic-dots',{width:8,height:8,data:dots});map.addImage('no-pattern',{width:8,height:8,data:blank});
  for(const layer of map.getStyle().layers){
    if(layer.type==='background'){map.setPaintProperty(layer.id,'background-color','#090a0c');map.setPaintProperty(layer.id,'background-pattern',['step',['zoom'],'geographic-dots',7,'no-pattern']);}
    if(layer.type==='fill'){
      map.setPaintProperty(layer.id,'fill-pattern',null);
      if((layer['source-layer']??'').includes('water')){map.setPaintProperty(layer.id,'fill-color','#08090b');map.setPaintProperty(layer.id,'fill-opacity',1);}
      else{map.setPaintProperty(layer.id,'fill-color','#17181c');map.setPaintProperty(layer.id,'fill-opacity',['interpolate',['linear'],['zoom'],6,0,12,.35]);}
    }
    if(layer.type==='line')map.setPaintProperty(layer.id,'line-color',/water/.test(layer.id)?'#22242a':'#26272e');
    if(layer.type==='symbol'&&layer.layout?.['text-field']){map.setPaintProperty(layer.id,'text-color','#85858f');map.setPaintProperty(layer.id,'text-halo-color','#0a0a0e');map.setPaintProperty(layer.id,'text-opacity',['interpolate',['linear'],['zoom'],3,0,7,.7,13,.9]);}
    if(layer.type==='fill-extrusion')map.setLayoutProperty(layer.id,'visibility','none');
  }
}
async function setup(){
  try{
    region=await request('/api/region');
    map=new maplibregl.Map({container:'map',center:[(region.bbox[0]+region.bbox[2])/2,(region.bbox[1]+region.bbox[3])/2],zoom:13,style:'https://tiles.openfreemap.org/styles/dark',attributionControl:true});
    map.addControl(new maplibregl.NavigationControl(),'bottom-left');
    await new Promise((resolve,reject)=>{map.once('load',resolve);map.on('error',event=>{if(!map.isStyleLoaded()){$('#coverage').textContent=`Basemap unavailable: ${event.error.message}`;}});setTimeout(()=>{if(!map.isStyleLoaded())reject(new Error('Basemap did not load. Check internet connectivity.'));},30000);});
    monochromeBasemap();
    for(const id of ['buildings','flood','exposure','tracts','selected','dependencies','focus-nodes'])map.addSource(id,{type:'geojson',data:empty()});
    map.addSource('facilities',{type:'geojson',data:empty(),cluster:true,clusterMaxZoom:11,clusterRadius:42});
    map.addLayer({id:'tracts',source:'tracts',type:'line',layout:{visibility:'none'},paint:{'line-color':'#6e879d','line-width':1,'line-dasharray':[3,3]}});
    map.addLayer({id:'flood',source:'flood',type:'fill',paint:{'fill-color':'#5f718c','fill-opacity':.10}});
    map.addLayer({id:'flood-outline',source:'flood',type:'line',paint:{'line-color':'#8f99ab','line-width':1,'line-dasharray':[3,3]}});
    map.addLayer({id:'buildings',source:'buildings',type:'fill',minzoom:11,paint:{'fill-color':'#81828d','fill-opacity':['interpolate',['linear'],['zoom'],11,.25,15,.65]}});
    map.addLayer({id:'building-outlines',source:'buildings',type:'line',minzoom:11,paint:{'line-color':'#b0afba','line-width':.55,'line-opacity':.65}});
    map.addLayer({id:'building-depth',source:'buildings',type:'fill-extrusion',minzoom:14,filter:['all',['has','heightMeters'],['>', ['get','heightMeters'],0]],paint:{'fill-extrusion-color':'#6b6b79','fill-extrusion-height':['get','heightMeters'],'fill-extrusion-opacity':.72,'fill-extrusion-vertical-gradient':true}});
    map.addLayer({id:'exposure',source:'exposure',type:'fill',minzoom:11,paint:{'fill-color':['case',['==',['get','modeledStatus'],'operational'],'#56b88a',['match',['get','risk'],'low','#56b88a','elevated','#e4b665','high','#d87075','#8bc9e8']],'fill-opacity':.7}});
    map.addLayer({id:'selected',source:'selected',type:'line',paint:{'line-color':'#8bc9e8','line-width':2}});
    map.addLayer({id:'selected-depth',source:'selected',type:'fill-extrusion',minzoom:14,filter:['all',['has','heightMeters'],['>', ['get','heightMeters'],0]],paint:{'fill-extrusion-color':'#8bc9e8','fill-extrusion-height':['get','heightMeters'],'fill-extrusion-opacity':.85}});
    map.addLayer({id:'dependencies',source:'dependencies',type:'line',paint:{'line-color':'#8bc9e8','line-width':1.5,'line-dasharray':[3,2]}});
    map.addLayer({id:'dependency-labels',source:'dependencies',type:'symbol',minzoom:15,layout:{'symbol-placement':'line','text-field':['concat',['get','relationship'],' · ',['get','evidence']],'text-size':10,'text-font':['Noto Sans Regular']},paint:{'text-color':'#dce7ed','text-halo-color':'#16111f','text-halo-width':2}});
    map.addLayer({id:'facilities',source:'facilities',type:'circle',filter:['!', ['has','point_count']],paint:{'circle-color':'#d9e0e5','circle-radius':4,'circle-stroke-color':'#191c1f','circle-stroke-width':1.5}});
    map.addLayer({id:'clusters',source:'facilities',type:'circle',filter:['has','point_count'],paint:{'circle-color':'#191c1f','circle-radius':17,'circle-stroke-color':'#8bc9e8','circle-stroke-width':1}});
    map.addLayer({id:'cluster-counts',source:'facilities',type:'symbol',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':11,'text-font':['Noto Sans Regular']},paint:{'text-color':'#edf0f2'}});
    map.addLayer({id:'focus-points',source:'focus-nodes',type:'circle',paint:{'circle-color':'#8bc9e8','circle-radius':5,'circle-stroke-color':'#8bc9e8','circle-stroke-width':2}});
    map.on('click','clusters',async event=>{const cluster=event.features?.[0];if(!cluster)return;const zoom=await map.getSource('facilities').getClusterExpansionZoom(cluster.properties.cluster_id);map.easeTo({center:cluster.geometry.coordinates,zoom,duration:reducedMotion?0:650});});
    map.on('click',event=>{const hit=map.queryRenderedFeatures(event.point,{layers:['facilities','buildings','exposure','building-depth','focus-points']})[0];if(hit)select(hit.properties.nodeId||hit.properties.id);});
    for(const name of ['facilities','buildings']){map.on('mouseenter',name,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',name,()=>map.getCanvas().style.cursor='');}
    fit();await loadData();
  }catch(error){state('Unavailable');$('#coverage').textContent=error.message;}
}
async function loadData(){
  state('Loading Richardson…');
  try{
    await request('/api/network/build',{locationId:region.id});
    const loaded=await Promise.all([request('/api/network'),request('/api/hazards'),request('/api/frontend-config')]);graph=loaded[0];catalog=loaded[1].scenarios;appConfig=loaded[2];scenario=catalog.find(s=>s.disasterType==='flood');if(!scenario)throw new Error('Flood scenario unavailable');
    $('#analysis-region').innerHTML=appConfig.regions.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');$('#region-scope').textContent=appConfig.coverage;const tornadoOption=$('#hazard-select').querySelector('[value=tornado]');tornadoOption.disabled=!catalog.some(s=>s.disasterType==='tornado');tornadoOption.textContent=tornadoOption.disabled?'Tornado · official data unavailable':'Tornado · historical NOAA survey';if(tornadoOption.disabled){sourceWarnings.push(loaded[1].availability.tornado.reason??'NOAA survey unavailable');tornadoOption.remove();}$('#dragonfly').querySelector('small').textContent=appConfig.dragonflyUrl?'Route Intelligence · configured':'Route Intelligence · unavailable';$('#dragonfly').setAttribute('aria-label',appConfig.dragonflyUrl?'Open Dragonfly':'Dragonfly · unavailable');updateHazardControls();
    $('#analysis-location').textContent=region.name;$('#analysis-scenario').textContent=scenario.name;$('#analysis-duration').value=scenario.durationHours??24;
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
  $('#source-details').innerHTML=`<p>${esc(region.name)}. ${esc(region.coverageDescription)}</p><dl><dt>Buildings</dt><dd>Overture Maps · cached</dd><dt>Release</dt><dd>${esc(metadata?.source.datasetRelease)}</dd><dt>Acquired</dt><dd>${esc(metadata?.source.acquiredAt)}</dd><dt>Coverage</dt><dd>${metadata?.coverageComplete===true?'Complete bounded extract':'Incomplete or unverified coverage'}</dd><dt>Facilities</dt><dd>OpenStreetMap / Overpass</dd><dt>Population</dt><dd>US Census TIGER/Line + ACS 2022; study-area tract intersections; Dallas and Collin Counties queried</dd></dl><p>Building footprints establish geometry. Spatially matched facilities are inferred associations. Operational condition, utility connections, revenue and shelter capacities remain unknown.</p><p>Flood footprints and depth are hypothetical. The explicitly selected experimental flood model estimates historical NFIP claim severity; it is not a locally validated closure model.</p>${sourceWarnings.map(w=>`<p class="error">${esc(w)}</p>`).join('')}${scenario?.sourceType==='historical_observed'?`<p>Historical NOAA survey contour · ${esc(scenario.eventDate)} · ${esc(scenario.reportedContourRating)} contour. Event-wide maximum rating is unknown. Not a current warning.</p>`:''}${result?`<h3>Scenario assumptions & limitations</h3>${[...result.assumptions,...result.limitations].map(a=>`<p>${esc(a)}</p>`).join('')}`:''}`;
}
$('#source-button').onclick=()=>$('#sources').showModal();$('#close-sources').onclick=()=>$('#sources').close();
const human=value=>String(value??'Unknown').replaceAll('_',' ');
function select(id,{focusMap=true}={}){
  const n=graph.nodes.find(n=>n.id===id);if(!n)return;selected=n;if(focusMap)show('map');document.body.classList.toggle('has-selection',activePanel==='map');clearTimeout(inspectorCloseTimer);$('#selection').classList.remove('is-closing');$('#selection').hidden=activePanel!=='map';$('#selection').scrollTop=0;
  const view=inspectorPresentation(n,result);
  $('#selection-type').textContent=view.category;$('#selection-name').textContent=n.name;
  const failure=result?.failures.find(f=>f.nodeId===id)??result?.cascadingImpacts.impacts.find(f=>f.nodeId===id),exposure=result?.exposure.find(e=>e.nodeId===id),neighborhood=selectionNeighborhood(graph,id),edges=neighborhood.edges;
  const downstream=result?.cascadingImpacts?.impacts?.filter(item=>item.nodeId!==id&&item.path?.includes(id))??[];
  const knownRisk=['low','elevated','high'].includes(failure?.riskLevel)?failure.riskLevel:null;
  $('#selection-body').innerHTML=`
    <div class="inspector-status" data-tone="${view.status==='Operating condition unknown'?'neutral':view.tone}"><span class="status-light"></span>${esc(view.status)}${failure?'<small>MODELED</small>':''}</div>
    <div class="intelligence-grid">
      <section class="intelligence-section"><h3>Observed source record</h3><p class="intelligence-value">${esc(view.location)}</p>${n.type==='building'?`<div class="building-facts"><span><b>${Number.isFinite(n.properties?.heightMeters)?`${n.properties.heightMeters.toFixed(1)} m`:'Not supplied'}</b>Height</span><span><b>${Number.isFinite(n.properties?.floors)?n.properties.floors:'Not supplied'}</b>Floors</span></div>`:''}</section>
      <section class="intelligence-section"><h3>Derived exposure</h3><p class="exposure-label">${esc(view.exposure)}</p><p>Intersection is calculated from the selected hazard and current source geometry.</p></section><section class="intelligence-section"><h3>${failure?'Experimental screening':'Operating condition · unknown'}</h3>${knownRisk?`<p class="risk-label" data-tone="${knownRisk}">${esc(human(knownRisk))} modeled risk</p>`:''}<p>${!result?'Run a source-backed geometry exposure analysis.':!failure?'No asset-specific operational assessment is available.':'Scenario screening only; actual operating status is unknown.'}</p>${view.conditions.length?`<ul class="condition-list">${view.conditions.map(condition=>`<li>${esc(condition)}</li>`).join('')}</ul>`:''}</section>
    </div>
    ${view.ml?`<section class="intelligence-section damage-section"><h3>Experimental claim severity</h3><div class="damage-value">${Math.round(view.ml.estimatedDamageFraction*100)}<small>%</small><span>estimated physical loss</span></div><p>Historical NFIP claim severity model. This is not a closure probability.</p></section>`:''}
    <section class="intelligence-section relationships-section"><h3>Linked assets <span>${neighborhood.total}</span></h3>${edges.length?edges.map(edge=>{const other=graph.nodes.find(item=>item.id===(edge.sourceId===id?edge.targetId:edge.sourceId)),description=relationshipDescription(edge,id);return `<button class="relationship" data-node="${esc(other.id)}"><span>${esc(other.name)}</span><small>${esc(description.label)} · ${esc(description.evidence)}</small></button>`;}).join(''):'<p>No sourced relationships are currently known.</p>'}${neighborhood.total>edges.length?`<p>Showing ${edges.length} of ${neighborhood.total} direct relationships.</p>`:''}</section>
    ${downstream.length||view.hasLocalNumbers?`<section class="intelligence-section"><h3>Modeled consequences</h3>${downstream.length?`<p>${downstream.length} linked ${downstream.length===1?'record has':'records have'} a modeled downstream impact through this asset.</p>`:''}${Number.isFinite(view.localImpact?.estimatedDowntimeHours)?`<p>Scenario interruption: ${view.localImpact.estimatedDowntimeHours} hours.</p>`:''}${Number.isFinite(view.localImpact?.estimatedRevenueAtRiskUSD)?`<p>Modeled revenue exposure: $${view.localImpact.estimatedRevenueAtRiskUSD.toLocaleString()}.</p>`:''}</section>`:''}
    <div class="inspector-provenance"><span class="provenance-symbol">◇</span><p>${esc(view.provenance)}<small>${view.synthetic?'Fixture values are illustrative.':'Geometry and source records do not establish operating condition.'}</small></p></div>`;
  $('#selection-body').querySelectorAll('[data-node]').forEach(button=>button.onclick=()=>select(button.dataset.node));
  source('selected',n.geometry?[{type:'Feature',geometry:n.geometry,properties:{...(n.properties.heightMeters!=null?{heightMeters:n.properties.heightMeters}:{}),id:n.id}}]:[]);
  source('dependencies',neighborhood.lines);
  source('focus-nodes',neighborhood.nodes.filter(node=>Array.isArray(node.coordinates)).map(node=>({type:'Feature',geometry:{type:'Point',coordinates:node.coordinates},properties:{id:node.id}})));
  const focusIds=neighborhood.nodes.map(node=>node.id);
  map.setPaintProperty('facilities','circle-opacity',['case',['in',['get','id'],['literal',focusIds]],1,.28]);
  map.setPaintProperty('buildings','fill-opacity',['case',['in',['get','id'],['literal',focusIds]],.8,.25]);
  debugGraph?.destroy();
  const details=document.createElement('details');details.className='developer-details';details.innerHTML=`<summary>Developer Details</summary><div id="debug-graph" aria-label="Selected node dependency graph"></div><pre>${esc(JSON.stringify({node:n,edges,relationshipsShown:edges.length,totalRelationships:neighborhood.total,modeledAssessment:failure??null,mlAssessment:view.ml??null},null,2))}</pre>`;
  $('#selection-body').append(details);
  details.ontoggle=()=>{if(!details.open){debugGraph?.destroy();debugGraph=null;return;}if(typeof cytoscape==='undefined')return;debugGraph?.destroy();debugGraph=cytoscape({container:$('#debug-graph'),elements:[...neighborhood.nodes.map(node=>({data:{id:node.id,label:node.name}})),...edges.map(edge=>({data:{id:edge.id,source:edge.sourceId,target:edge.targetId,label:`${edge.relationship}\n${edge.evidenceLevel}`}}))],style:[{selector:'node',style:{label:'data(label)','background-color':'#8bc9e8',color:'#edf0f2','font-size':9,'text-wrap':'wrap','text-max-width':80,'text-valign':'bottom'}},{selector:'edge',style:{label:'data(label)','curve-style':'bezier','target-arrow-shape':'triangle','line-color':'#8bc9e8','target-arrow-color':'#8bc9e8',color:'#a1aab2','font-size':8}}],layout:{name:'breadthfirst',directed:true,padding:35}});debugGraph.on('tap','node',event=>select(event.target.id()));};
  $('#assistant-context').textContent=`Selected: ${n.name} · ${scenario?.name??region.name}`;
}
$('#close-selection').onclick=()=>{$('#selection').classList.add('is-closing');clearTimeout(inspectorCloseTimer);inspectorCloseTimer=setTimeout(()=>{$('#selection').hidden=true;$('#selection').classList.remove('is-closing');},reducedMotion?0:160);selected=null;document.body.classList.remove('has-selection');debugGraph?.destroy();$('#assistant-context').textContent=`${scenario.name} · ${$('#prediction-mode').value}`;source('selected',[]);source('dependencies',[]);source('focus-nodes',[]);map.setPaintProperty('facilities','circle-opacity',1);map.setPaintProperty('buildings','fill-opacity',['interpolate',['linear'],['zoom'],11,.25,15,.65]);};
$('#ask-selected').onclick=()=>{show('assistant');$('#question').value=`Explain the ${scenario.disasterType==='tornado'?'historical NOAA contour exposure':'hypothetical flood exposure'} and sourced associations for ${selected.name}.`;$('#question').focus();};
document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{const names={buildings:['buildings','building-outlines','building-depth','selected-depth','selected'],facilities:['facilities','clusters','cluster-counts'],flood:['flood','flood-outline'],exposure:['exposure'],tracts:['tracts'],dependencies:['dependencies','dependency-labels','focus-points']};for(const id of names[input.dataset.layer])if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',input.checked?'visible':'none');});
const number=value=>value==null?'Unavailable':value.toLocaleString();
function parameters(){const depth=Number($('#depth').value),duration=Number($('#analysis-duration').value);if($('#depth').value===''||!Number.isFinite(depth)||depth<0||depth>30)throw new Error('Assumed flood depth must be 0–30 feet.');if(!Number.isInteger(duration)||duration<1||duration>168)throw new Error('Scenario window must be 1–168 hours.');return {floodDepthFeet:depth,durationHours:duration};}
function busy(value){$('#run').disabled=value;$('#run-results').disabled=value;$('#depth').disabled=value;$('#analysis-duration').disabled=value;document.querySelectorAll('[data-depth-step],#hazard-select,#event-select,#prediction-mode,#analysis-region').forEach(button=>button.disabled=value);updateIntervention();}
function applyResult(data,caption){
  caption??=data.scenario.sourceType==='historical_observed'?'HISTORICAL NOAA CONTOUR / EXPOSURE ONLY':data.predictionModeUsed==='hybrid'?'EXPERIMENTAL FLOOD ML / HYPOTHETICAL':'HYPOTHETICAL FLOOD / EXPOSURE ONLY';
  if(data.locationId!==region.id||!['hybrid','exposure'].includes(data.predictionModeUsed)||data.scenarioId!==scenario.id)throw new Error('Simulation returned an incompatible region or assessment');
  result=data;const metrics=analysisMetrics(data),ids=new Set((data.exposedBuildingFootprints??[]).map(b=>b.buildingId)),risk=new Map((data.failures??[]).map(f=>[f.nodeId,f.riskLevel])),statuses=new Map((data.failures??[]).map(f=>[f.nodeId,f.predictedStatus]));
  source('exposure',buildings.filter(b=>ids.has(b.id)).map(b=>({...b,properties:{...b.properties,risk:risk.get(b.id),modeledStatus:statuses.get(b.id)}})));
  const exposureOnly=data.predictionModeUsed==='exposure',fields=[['Building footprints intersecting',metrics.buildings,'Current cached geometry; not confirmed damage'],[exposureOnly?'Facility records intersecting':'Facilities potentially affected',metrics.facilities,exposureOnly?'Source point intersection; operating status unknown':'Experimental screening; inferred occupancy may apply']];
  $('#hud-metrics').innerHTML=fields.map(([label,value])=>`<div><strong>${number(value)}</strong><span>${label}</span></div>`).join('');
  $('#hud-caption').textContent=caption;$('#impact-hud').hidden=false;$('#results-toggle').disabled=false;$('#open-compare-results').disabled=exposureOnly;$('#hud-compare').disabled=exposureOnly;$('#hud-compare').title=exposureOnly?'Preservation is available only in experimental flood hybrid mode':'';
  $('#results').innerHTML=`<div class="result-metrics">${fields.map(([label,value,note])=>`<div><span>${label}<small>${note}</small></span><strong>${number(value)}</strong></div>`).join('')}</div><p class="note">Mapped exposure does not establish damage or operating status. Revenue, downtime, population impact, displacement and shelter capacity are unavailable in normal exposure mode. Duplicate OSM representations may occur.</p><h2>${exposureOnly?'Intersecting facility records':'Potentially affected facilities'}</h2>${(data.businessImpact?.exposedFacilities??data.businessImpact?.affectedBusinesses??[]).map(b=>`<div class="result-row"><span>${esc(b.name)}</span><button data-result="${esc(b.businessId)}">Locate ↗</button></div>`).join('')||'<p>No affected facility records returned.</p>'}<details><summary>Assumptions & limitations</summary>${[...(data.assumptions??[]),...(data.limitations??[])].map(a=>`<p>${esc(a)}</p>`).join('')}</details>`;
  $('#results').querySelectorAll('[data-result]').forEach(button=>button.onclick=()=>{select(button.dataset.result);if(selected?.coordinates)map.flyTo({center:selected.coordinates,zoom:16});});
  $('#timeline-content').innerHTML=data.timeline?.length?`<ol>${data.timeline.map(event=>`<li><pre>${esc(JSON.stringify(event,null,2))}</pre></li>`).join('')}</ol>`:'<p>Timeline unavailable: this backend returns no time-step events. The scenario window is metadata; recovery and playback are not modeled.</p>';
  if(selected)select(selected.id,{focusMap:false});renderSources();state(exposureOnly?'Geometry exposure ready':'Experimental hybrid ready');
}
function updateHazardControls(){
  const events=catalog.filter(s=>s.disasterType===$('#hazard-select').value);
  if(!events.length)return;
  $('#event-select').innerHTML=events.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');scenario=events[0];updateScenario();
}
function updateScenario(){
  scenario=catalog.find(s=>s.id===$('#event-select').value)??scenario;
  const tornado=scenario.disasterType==='tornado';$('#console-intro').textContent=tornado?'Replay an official historical survey contour against current cached building geometry.':'A hypothetical flood over real Richardson geography.';const previousMode=$('#prediction-mode').value;$('#prediction-mode').innerHTML='<option value="exposure">Geometry exposure · no damage prediction</option>'+(tornado?'':'<option value="hybrid">Experimental flood ML + screening</option>');$('#prediction-mode').value=tornado?'exposure':previousMode||'exposure';
  $('#hazard-classification').innerHTML=tornado?'<b>Observed hazard</b> · historical NOAA survey contour; preliminary, not a warning.':'<b>Hypothetical hazard</b> · assumed flood rectangle, not observed inundation.';$('#analysis-scenario').textContent=scenario.name;$('#hazard-layer-label').textContent=tornado?'Historical NOAA tornado contour':'Hypothetical flood';
  $('#hazard-source').innerHTML=tornado?`Historical observation · ${esc(scenario.eventDate)} (UTC)<br>NOAA object ${esc(scenario.source.objectId)} · reported contour ${esc(scenario.reportedContourRating)}<br>Event maximum rating: unavailable.<br><a href="${esc(scenario.source.url)}" target="_blank" rel="noopener noreferrer">Official NOAA source ↗</a><br>${esc(scenario.limitations[0])}`:'Hypothetical flood polygon. No observed flood or current warning is loaded.';
  source('flood',[{type:'Feature',geometry:scenario.footprint,properties:{source:scenario.sourceType}}]);updatePredictionMode();
}
function updatePredictionMode(){
  const hybrid=$('#prediction-mode').value==='hybrid';$('#flood-parameters').hidden=!hybrid;$('#assistant-context').textContent=`${scenario.name} · ${hybrid?'experimental flood ML':'geometry exposure'}`;$('#model-disclosure').textContent=hybrid?'Experimental NFIP historical claim severity + unvalidated operating-status screening. Missing building covariates use training defaults. No independent Richardson validation; not a forecast or calibrated closure probability.':'Exposure is geometry intersection only. Building damage, operating condition, population impact and financial loss are unknown.';invalidateAnalysis();
}
$('#hazard-select').onchange=updateHazardControls;$('#event-select').onchange=updateScenario;$('#prediction-mode').onchange=updatePredictionMode;
$('#analysis-region').onchange=()=>{if($('#analysis-region').value!==region.id)state('Only the loaded Richardson study region is available');};
$('#dragonfly').onclick=()=>{if(appConfig?.dragonflyUrl)window.location.assign(appConfig.dragonflyUrl);else show('dragonfly');};
function invalidateAnalysis(){if(running||comparing)return;if(agentController)agentController.abort(new DOMException('Hazard or mode changed. Start a new investigation for the selected context.','AbortError'));result=analysisBaseline=comparison=null;source('exposure',[]);$('#impact-hud').hidden=true;$('#results-toggle').disabled=true;$('#open-compare-results').disabled=true;$('#comparison-views').hidden=true;$('#comparison-results').innerHTML='';$('#results').innerHTML='<p class="empty">Parameters changed. Run analysis to update results.</p>';$('#timeline-content').textContent='Run analysis for the current parameters.';if(selected)select(selected.id,{focusMap:false});updateIntervention();state('Scenario parameters changed');}
async function simulate(){
  if(running||comparing||!graph)return;let overrides;
  try{overrides=$('#prediction-mode').value==='hybrid'?parameters():{};}catch(error){$('#simulation-error').hidden=false;$('#simulation-error').textContent=error.message;return;}
  invalidateAnalysis();running=true;busy(true);$('#simulation-error').hidden=true;$('#analysis-progress').hidden=false;state('Analyzing source geometry…');
  try{if($('#prediction-mode').value==='hybrid'){const health=await request('/api/ml/health');if(!health.available)throw new Error(health.reason??'Python inference is unavailable. Choose Geometry exposure or check /api/ml/health.');}const data=await request('/api/simulations/run',{scenarioId:scenario.id,predictionMode:$('#prediction-mode').value,overrides});applyResult(data);analysisBaseline=data;show('map');}
  catch(error){$('#simulation-error').hidden=false;$('#simulation-error').textContent=error.message;show('console');state('Assessment unavailable');}
  finally{running=false;busy(false);$('#analysis-progress').hidden=true;}
}
function updateIntervention(){const target=selected?.type==='building'?selected:null;$('#intervention-target').textContent=target?.name??'Select a building footprint on the map.';$('#compare-run').disabled=!target||analysisBaseline?.predictionModeUsed!=='hybrid'||running||comparing;}
$('#run').onclick=()=>show('console');$('#run-results').onclick=simulate;
$('#depth').oninput=invalidateAnalysis;$('#analysis-duration').oninput=invalidateAnalysis;
document.querySelectorAll('[data-depth-step]').forEach(button=>button.onclick=()=>{$('#depth').value=Math.max(0,Math.min(30,Number($('#depth').value)+Number(button.dataset.depthStep)));invalidateAnalysis();});
$('#hud-details').onclick=()=>show('results');$('#hud-compare').onclick=$('#open-compare-results').onclick=()=>show('compare');
$('#assistant-toggle').onclick=$('#hud-assistant').onclick=()=>show('assistant');
$('#choose-intervention').onclick=()=>{show('map');state('Select a building footprint, then Compare Intervention');};
$('#compare-run').onclick=async()=>{
  if(comparing||running||analysisBaseline?.predictionModeUsed!=='hybrid')return;
  let payload;try{const p=parameters();payload=interventionPayload(selected,p.floodDepthFeet,p.durationHours,scenario.id);}catch(error){$('#comparison-feedback').textContent=error.message;return;}
  const baseline=analysisBaseline,target=selected,targetName=target.name;comparing=true;busy(true);$('#comparison-feedback').textContent='Running preservation counterfactual…';
  try{
    const response=await request('/api/simulations/compare',{...payload,predictionMode:'hybrid'});
    // The endpoint's baseline uses scenario defaults; retain the actual user analysis instead.
    applyResult(response.modified,'INTERVENTION PREVIEW / HYPOTHETICAL');comparison={baseline,modified:response.modified,overrides:payload.modification};
    const before=analysisMetrics(baseline),after=analysisMetrics(response.modified);
    $('#comparison-results').innerHTML=`<p>Preserved asset: ${esc(targetName)}</p><table><thead><tr><th>Modeled measure</th><th>Before</th><th>After</th></tr></thead><tbody>${[['Exposed buildings','buildings'],['Affected facility records','facilities']].map(([label,key])=>`<tr><td>${label}</td><td>${number(before[key])}</td><td>${number(after[key])}</td></tr>`).join('')}</tbody></table><p>Selected asset: ${esc(inspectorPresentation(target,baseline).status)} → ${esc(inspectorPresentation(target,response.modified).status)} (modeled)</p><p class="note">Preservation changes operational assumptions, not hazard geometry. Financial benefits and recovery time are unavailable.</p>`;
    $('#comparison-views').hidden=false;$('#show-baseline').setAttribute('aria-pressed','false');$('#show-intervention').setAttribute('aria-pressed','true');$('#comparison-feedback').textContent='Comparison ready · intervention preview on map';
  }catch(error){$('#comparison-feedback').textContent=error.message;}
  finally{comparing=false;busy(false);}
};
for(const [id,key] of [['show-baseline','baseline'],['show-intervention','modified']])$('#'+id).onclick=()=>{if(!comparison)return;applyResult(comparison[key],key==='baseline'?'BASELINE / HYPOTHETICAL':'INTERVENTION PREVIEW / HYPOTHETICAL');$('#comparison-feedback').textContent=key==='baseline'?'Comparison ready · baseline preview on map':'Comparison ready · intervention preview on map';$('#show-baseline').setAttribute('aria-pressed',String(key==='baseline'));$('#show-intervention').setAttribute('aria-pressed',String(key==='modified'));};
async function checkAgentHealth(force=false){
  if(!force&&agentHealthState&&Date.now()-agentHealthAt<10000)return agentHealthState;
  if(agentHealthPending)return agentHealthPending;
  $('#agent-health').textContent='Checking backend configuration and Python availability…';
  agentHealthPending=(async()=>{
    try{
      const health=await agentHealthRequest({signal:AbortSignal.timeout(8000)});agentHealthState=health;agentHealthAt=Date.now();
      $('#agent-health').textContent=`${health.apiKeyConfigured?'NVIDIA configured':'NVIDIA key missing'} · ${health.liveNvidiaVerified?'live smoke passed':'live smoke not verified'}. Python ${health.mlInferenceVerified?'available':'unavailable; use Geometry exposure'}.`;
      $('#agent-health-meta').textContent=`Provider: ${health.provider}. Model: ${health.model}. ${health.liveNvidiaVerified?`Last smoke: ${health.liveVerification.verifiedAt}.`:'No successful live smoke recorded in this server session.'} Budget: ${Math.round(health.limits.totalTimeoutMs/1000)} s total, ${health.limits.maxModelCalls} model calls, ${health.limits.maxToolCalls} tools. ${health.mlInferenceVerified?'':health.ml?.reason??''} ${health.action??''}`;
      return health;
    }catch(error){$('#agent-health').textContent=error.name==='TimeoutError'?'Configuration check timed out. Confirm the backend is running and retry.':error.message;throw error;}
    finally{agentHealthPending=null;}
  })();return agentHealthPending;
}
$('#agent-health-refresh').onclick=()=>checkAgentHealth(true).catch(()=>{});
$('#cancel-investigation').onclick=()=>agentController?.abort(new DOMException('Investigation cancelled. No further model or tool calls will be started.','AbortError'));
$('#ask-form').onsubmit=async event=>{
  event.preventDefault();if(agentController)return;const message=$('#question').value.trim();if(!message)return;
  const controller=agentController=new AbortController(),started=Date.now(),contextName=scenario.name,mode=$('#prediction-mode').value;
  const conversation=$('#conversation');conversation.querySelector('.empty')?.remove();conversation.insertAdjacentHTML('beforeend',`<article class="message user"><span class="eyebrow">YOU</span><span class="message-context">${esc(contextName)} · ${esc(mode)}</span>${esc(message)}</article>`);
  $('#ask').disabled=true;$('#ask').textContent='Investigating…';$('#agent-progress').hidden=false;$('#agent-stage').textContent='Checking configuration before contacting NVIDIA';let phase='Checking configuration';$('#agent-progress').scrollIntoView({block:'nearest'});
  const tick=()=>{$('#agent-elapsed').textContent=`${Math.floor((Date.now()-started)/1000)} s elapsed · bounded investigation · ${phase}`;};tick();const clock=setInterval(tick,1000),timeout=setTimeout(()=>controller.abort(new DOMException('Investigation timed out. Retry a focused question; no automatic paid retries are made.','TimeoutError')),50000);
  try{
    const health=await withAbort(checkAgentHealth(),controller.signal);
    if(!health.apiKeyConfigured||health.provider!=='nvidia')throw new Error(health.action??'NVIDIA is unavailable. Configure the provider and restart the backend.');
    if(!health.realDataLayers.buildings)throw new Error('Building source cache is unavailable. Restore the real Overture cache before investigating.');
    if(mode==='hybrid'&&!health.mlInferenceVerified)throw new Error(health.ml?.reason??'Python inference is unavailable. Choose Geometry exposure or check /api/ml/health.');
    const response=await investigate({sessionId:assistantSessionId,message,context:{locationId:region.id,scenarioId:scenario.id,predictionMode:mode,selectedNodeId:selected?.id,scenarioOverrides:comparison&&result===comparison.modified?comparison.overrides:(mode==='hybrid'?parameters():{})}},{signal:controller.signal,onProgress:progress=>{phase=`${progress.modelCalls} model / ${progress.toolCalls} tool calls · ${Math.ceil(progress.remainingMs/1000)} s budget left`;$('#agent-stage').textContent=progress.detail;tick();}});
    const failed=['failed','timeout','cancelled'].includes(response.status);
    conversation.insertAdjacentHTML('beforeend',`<article class="message"><span class="eyebrow">${response.provider==='nvidia'?'NVIDIA NEMOTRON':'OFFLINE TEST'} · ${esc(response.status)}</span><span class="message-context">${esc(contextName)} · ${esc(mode)}</span>${response.answer?esc(response.answer):''}${failed?`<p class="error" role="alert">${esc(response.warnings.join(' · ')||'Investigation stopped. Check configuration and retry.')}</p>`:''}<details><summary>Tool evidence · ${response.budget.modelCalls} model / ${response.budget.toolCalls} tool calls</summary>${response.toolTrace.map(t=>`<p>${esc(t.toolName)} · ${esc(t.status)} · ${esc(t.summary)}</p>`).join('')}${response.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details></article>`);
  }catch(error){const reason=controller.signal.aborted?controller.signal.reason:error;conversation.insertAdjacentHTML('beforeend',`<p class="error" role="alert">${esc(reason.message??reason)}</p>`);}
  finally{clearInterval(clock);clearTimeout(timeout);agentController=null;$('#ask').disabled=false;$('#ask').textContent='Investigate →';$('#agent-progress').hidden=true;while(conversation.children.length>12)conversation.firstElementChild.remove();conversation.lastElementChild?.scrollIntoView({block:'nearest'});}
};
setup();
