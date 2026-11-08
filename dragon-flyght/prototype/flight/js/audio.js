'use strict';
// =====================================================================
// audio.js: Web Audio. Everything is synthesized in code, and real recordings can be dropped in (see audio/README.txt).
// Mix: four buses (ambience, effects, music, radio) -> compressor. Radio speech ducks ambience and music.
// Each scene has its own sound: tornado (freight-train roar, howl, warning siren), hurricane (howling gusts, heavy rain, surf),
// flood (rushing and lapping water, rain), wildfire (fire roar, crackle, pops), earthquake (deep rumble, debris, car alarms),
// normal day (soft wind, city hum, birds). Loops: wind, wing buzz, truck engine + siren. One-shots: see sfx().
// N toggles sound. The context starts on the Start click (browsers require a user gesture).
// =====================================================================
const AU={ctx:null,on:store.get('df.sound','on')==='on',master:null,bus:{},loops:{},noise:null,music:null,samples:{},tmr:{},chord:0,chordT:0,duck:0,duckT:0,scene:'',radioSrc:null};
const LEVEL={amb:.6,sfx:.85,music:.5,radio:1};   // bus gains (the balance knobs)
function audioInit(){if(AU.ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const c=AU.ctx=new AC();
  const comp=c.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=5;comp.connect(c.destination);AU.master=c.createGain();AU.master.gain.value=AU.on?.9:0;AU.master.connect(comp);
  for(const k in LEVEL){const g=c.createGain();g.gain.value=LEVEL[k];g.connect(AU.master);AU.bus[k]=g}
  const nb=c.createBuffer(1,c.sampleRate*3,c.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;AU.noise=nb;
  const nl=(type,freq,q)=>{const s=c.createBufferSource();s.buffer=nb;s.loop=true;s.loopStart=Math.random()*2;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q||.7;const g=c.createGain();g.gain.value=0;s.connect(f);f.connect(g);g.connect(AU.bus.amb);s.start(0,Math.random()*2);return{f,g}};
  const L=AU.loops;
  L.wind=nl('bandpass',500,.6);L.rain=nl('highpass',2600,.5);L.train=nl('lowpass',140,1.1);L.howl=nl('bandpass',700,9);L.surf=nl('lowpass',320,.8);L.rush=nl('bandpass',900,.45);L.splash=nl('highpass',3500,.4);
  L.fire=nl('lowpass',280,.9);L.quake=nl('lowpass',55,1.2);L.rumble=nl('lowpass',110,1);L.city=nl('lowpass',230,.9);
  // wing buzz: square wave through a lowpass, amplitude-modulated at the flap rate
  {const o=c.createOscillator();o.type='square';o.frequency.value=120;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=900;const am=c.createGain();am.gain.value=.5;
   const lfo=c.createOscillator();lfo.frequency.value=20;const lg=c.createGain();lg.gain.value=.5;lfo.connect(lg);lg.connect(am.gain);const g=c.createGain();g.gain.value=0;
   o.connect(f);f.connect(am);am.connect(g);g.connect(AU.bus.amb);o.start();lfo.start();L.wing={o,lfo,g}}
  // truck engine: two detuned saws through a lowpass
  {const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=500;const g=c.createGain();g.gain.value=0;f.connect(g);g.connect(AU.bus.amb);const a=c.createOscillator(),b=c.createOscillator();a.type=b.type='sawtooth';a.connect(f);b.connect(f);a.start();b.start();L.engine={a,b,f,g}}
  const osc=(type,freq,lp)=>{const o=c.createOscillator();o.type=type;o.frequency.value=freq;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=lp||4000;const g=c.createGain();g.gain.value=0;o.connect(f);f.connect(g);g.connect(AU.bus.amb);o.start();return{o,g}};
  L.siren=osc('triangle',700);L.warnsiren=osc('sawtooth',420,1400);   // truck hi-lo / outdoor tornado warning siren (slow wail)
  // score
  {const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=600;f.Q.value=.8;const g=c.createGain();g.gain.value=0;f.connect(g);g.connect(AU.bus.music);
   const os=[0,1,2,3].map(i=>{const o=c.createOscillator();o.type='sawtooth';o.detune.value=(i-1.5)*7;o.connect(f);o.start();return o});AU.music={f,g,os}}
  // radio voice chain: band-limit -> soft clip -> small speaker -> radio bus (see audioRadio)
  const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=480;hp.Q.value=.9;const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2900;lp.Q.value=.9;
  const pk=c.createBiquadFilter();pk.type='peaking';pk.frequency.value=1700;pk.gain.value=6;pk.Q.value=1.1;const ws=c.createWaveShaper();const cv=new Float32Array(1024);for(let i=0;i<1024;i++){const x=i/512-1;cv[i]=Math.tanh(x*3.2)}ws.curve=cv;
  const og=c.createGain();og.gain.value=.9;hp.connect(lp);lp.connect(pk);pk.connect(ws);ws.connect(og);og.connect(AU.bus.radio);AU.radioIn=hp;
  loadSamples()}
// optional real recordings: put files in audio/ named tornado, hurricane, flood, wildfire, earthquake, city (mp3, ogg or wav). Missing ones are skipped.
async function loadSamples(){const c=AU.ctx;let files=null;try{files=(await (await fetch('api/audio')).json()).files}catch(e){}if(!files)return;  // needs serve.py; without it only the synthesized sounds play
  for(const n of ['tornado','hurricane','flood','wildfire','earthquake','city']){const f=files.find(x=>x.toLowerCase().startsWith(n+'.'));if(!f)continue;
    try{const r=await fetch('audio/'+f);if(!r.ok)continue;const buf=await c.decodeAudioData(await r.arrayBuffer());const s=c.createBufferSource();s.buffer=buf;s.loop=true;const g=c.createGain();g.gain.value=0;s.connect(g);g.connect(AU.bus.amb);s.start();AU.samples[n]={g}}catch(e){}}}
function audioToggle(){AU.on=!AU.on;store.set('df.sound',AU.on?'on':'off');if(AU.master)AU.master.gain.setTargetAtTime(AU.on?.9:0,AU.ctx.currentTime,.05);say(AU.on?'sound on':'sound off')}
const tgt=(p,v,tc=.15)=>{if(p)p.setTargetAtTime(v,AU.ctx.currentTime,tc)};
const CH_MINOR=[[146.8,174.6,220],[116.5,146.8,174.6],[174.6,220,261.6],[130.8,164.8,196]];   // Dm Bb F C
const CH_CALM=[[261.6,329.6,392],[220,261.6,329.6],[174.6,220,261.6],[196,246.9,293.7]];       // C Am F G
const CH_DARK=[[110,130.8,164.8],[103.8,123.5,155.6],[98,116.5,146.8],[103.8,123.5,155.6]];     // slow low drone, quake / fire
function audioTick(dt){if(!AU.ctx||AU.ctx.state!=='running')return;const L=AU.loops,U=unitPos(),air=mode=='air',d=disaster;
  const w=windAt(U.x,U.z).length(),s=air?spd:Math.abs(TR.spd),live_=go&&!paused,gust=.5+.5*Math.sin(t*.45)*Math.sin(t*.23+1.3);
  const smp=AU.samples[d]||null,bedMul=smp?.3:1,none=d=='none';
  // radio ducking: ambience and music dip while the dispatcher talks
  AU.duck=Math.max(0,AU.duck-dt);const dk=AU.duck>0?.35:1;tgt(AU.bus.amb.gain,LEVEL.amb*dk,.12);tgt(AU.bus.music.gain,LEVEL.music*dk,.12);
  // wind: scales with speed and storm wind; hurricane and tornado add gusts and a high howl
  const stormW=d=='hurricane'?1.5:d=='tornado'?1.1:none?.45:.8;
  tgt(L.wind.g.gain,live_?Math.min(.2,(.022+s/520+w/260)*stormW*(1+.35*gust*(d=='hurricane'||d=='tornado'?1:0)))*(none?1:bedMul):0);tgt(L.wind.f.frequency,280+s*10+w*9+gust*140);
  tgt(L.wing.g.gain,live_&&air?.04+Math.min(.04,s/1800):0);tgt(L.wing.o.frequency,110+s*1.4);tgt(L.wing.lfo.frequency,14+s*.35);
  const ev=live_&&!air;tgt(L.engine.g.gain,ev?.045+Math.min(.06,Math.abs(TR.spd)/560)+(nitroT>0?.045:0):0);const ef=38+Math.abs(TR.spd)*2.1+(nitroT>0?25:0);tgt(L.engine.a.frequency,ef);tgt(L.engine.b.frequency,ef*1.505);tgt(L.engine.f.frequency,400+Math.abs(TR.spd)*25);
  const sirenOn=ev&&(auto||Math.abs(TR.spd)>3)&&!none;tgt(L.siren.g.gain,sirenOn?.018:0,.05);if(sirenOn)L.siren.o.frequency.setTargetAtTime(Math.floor(t*1.6)%2?960:720,AU.ctx.currentTime,.02);
  // ----- tornado: freight-train roar that swells as it nears, a rising howl, a far-off warning siren, rattling debris
  const td=d=='tornado'?Math.hypot(U.x-T.x,U.z-T.z):1e9,tn=live_?clamp(1-td/800,0,1):0;
  tgt(L.train.g.gain,tn*(.32+.1*Math.sin(t*5.5))*bedMul,.3);tgt(L.train.f.frequency,110+tn*160);tgt(L.howl.g.gain,tn*tn*.12*bedMul,.3);tgt(L.howl.f.frequency,500+tn*900+Math.sin(t*.7)*90);
  const ws_=live_&&d=='tornado';tgt(L.warnsiren.g.gain,ws_?.02*(1-tn*.5):0,.8);if(ws_)L.warnsiren.o.frequency.setTargetAtTime(430+Math.sin(t*.55)*130,AU.ctx.currentTime,.3);
  if(ws_&&tn>.25){AU.tmr.deb=(AU.tmr.deb||0)-dt;if(AU.tmr.deb<=0){AU.tmr.deb=.4+Math.random()*1.4*(1.3-tn);sfx('rattle')}}
  // ----- hurricane: heavy rain, surf-like surge swells, long thunder
  const hr=live_&&d=='hurricane';tgt(L.surf.g.gain,hr?(.1+.08*Math.sin(t*.5)+Math.min(.1,waterLevel*.05))*bedMul:0,.6);tgt(L.surf.f.frequency,260+Math.sin(t*.5)*90);
  // ----- flood: rain, rushing water that grows with the level, lapping/wading splash near the water
  const lv=d=='flood'?clamp(waterLevel/CFG.flood.maxLevel,0,1):0,wet=live_?floodDepth(U.x,U.z):0,low=air?clamp(1-(P.y-4)/20,0,1):1,wadeK=wet>.1?Math.min(1,wet*1.5)*low:0;
  tgt(L.rush.g.gain,live_&&d=='flood'?(.03+lv*.1+wadeK*.07)*bedMul:0,.5);tgt(L.rush.f.frequency,700+Math.sin(t*1.7)*220+lv*500);tgt(L.splash.g.gain,live_&&d=='flood'&&wadeK>0?wadeK*Math.min(.08,s/260):0,.2);
  const raining=rain.visible;tgt(L.rain.g.gain,live_&&raining?(d=='hurricane'?.16:d=='flood'?.11:.07)*bedMul:0,.5);
  // ----- wildfire: low roar, crackle bursts and pops that get denser close to the fire front
  const fnear=d=='wildfire'?clamp(1-fireArrival(U.x,U.z)/70,0,1)*.8+(FIRE.burning.length?.2:0):0;tgt(L.fire.g.gain,live_&&d=='wildfire'?(.04+fnear*.2+Math.sin(t*3.1)*.015)*bedMul:0,.4);tgt(L.fire.f.frequency,220+fnear*300+Math.sin(t*2.3)*60);
  if(live_&&d=='wildfire'){AU.tmr.crack=(AU.tmr.crack||0)-dt;if(AU.tmr.crack<=0){AU.tmr.crack=.03+Math.random()*(.4-fnear*.33);if(Math.random()<fnear+.1)burst(.03,3000+Math.random()*3000,'highpass',.12*fnear+.03,0,'sfx');if(Math.random()<.04+fnear*.1)sfx('pop')}}
  // ----- earthquake: deep rumble with the shaking, falling debris, far car alarms and creaking
  tgt(L.quake.g.gain,live_&&d=='earthquake'?Math.min(.55,shake*.3)*bedMul:0,.08);
  if(live_&&d=='earthquake'){AU.tmr.q=(AU.tmr.q||0)-dt;if(AU.tmr.q<=0){const busy=shake>.4;AU.tmr.q=busy?.25+Math.random()*.7:5+Math.random()*7;if(busy)sfx('crash');else sfx(Math.random()<.55?'alarm':'creak')}}
  // ----- normal day: city hum and the odd bird
  tgt(L.city.g.gain,live_&&none?.05:0,1.2);if(live_&&none&&(!air||P.y<140)){AU.tmr.bird=(AU.tmr.bird||0)-dt;if(AU.tmr.bird<=0){AU.tmr.bird=2+Math.random()*5;sfx('bird')}}
  // real recordings, when present, fade in for their scene (louder when the hazard is close)
  for(const n in AU.samples){const mine=n==='city'?none:n===d;const k=!mine||!live_?0:n=='tornado'?.3+tn*.5:n=='earthquake'?.25+Math.min(.5,shake*.25):.5+(n=='flood'?lv*.2:0);tgt(AU.samples[n].g.gain,k,1)}
  // score: tone by scene, chord every 8 s, filter opens with danger near you
  const sc=none?'calm':(d=='earthquake'||d=='wildfire')?'dark':'minor',M_=AU.music;
  if(sc!==AU.scene){AU.scene=sc;M_.os.forEach(o=>o.type=sc=='calm'?'triangle':'sawtooth');AU.chordT=0}
  AU.chordT-=dt;if(AU.chordT<=0){AU.chordT=sc=='dark'?11:8;AU.chord=(AU.chord+1)%4;const ch=(sc=='calm'?CH_CALM:sc=='dark'?CH_DARK:CH_MINOR)[AU.chord];M_.os.forEach((o,i)=>o.frequency.setTargetAtTime(i<3?ch[i]:ch[0]/2,AU.ctx.currentTime,.8))}
  const danger=clamp(Math.max(dangerAt(U.x,U.z,3),heatAt(U.x,U.z)),0,1);tgt(M_.g.gain,live_?(none?.035:app==='live'?.03:.045)+danger*.03:.02,1.5);tgt(M_.f.frequency,(none?500:350)+danger*1400+(nitroT>0?600:0),1)}
function burst(dur,freq,type,vol,delay=0,bus='sfx'){const c=AU.ctx;if(!c)return;const s=c.createBufferSource();s.buffer=AU.noise;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;const g=c.createGain(),t0=c.currentTime+delay;
  g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);s.connect(f);f.connect(g);g.connect(AU.bus[bus]);s.start(t0,Math.random()*2);s.stop(t0+dur+.05);return f}
function tone(freq,dur,type='sine',vol=.12,delay=0,slide=0){const c=AU.ctx;if(!c)return;const o=c.createOscillator();o.type=type;o.frequency.value=freq;const g=c.createGain(),t0=c.currentTime+delay;
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,freq*slide),t0+dur);g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(vol,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g);g.connect(AU.bus.sfx);o.start(t0);o.stop(t0+dur+.05)}
function sfx(name){if(!AU.ctx||!AU.on)return;
  switch(name){
    case 'chime':[523.3,659.3,784,1046.5].forEach((f,i)=>tone(f,.35,'triangle',.09,i*.07));break;            // people aboard
    case 'lost':[392,349.2,293.7].forEach((f,i)=>tone(f,.45,'sine',.08,i*.16));break;                         // report expired
    case 'whoosh':{const f=burst(.6,400,'bandpass',.3);if(f)f.frequency.exponentialRampToValueAtTime(3000,AU.ctx.currentTime+.5);tone(180,.4,'sawtooth',.04,0,2.5);break}
    case 'nitro':{const f=burst(1,300,'bandpass',.35);if(f)f.frequency.exponentialRampToValueAtTime(2500,AU.ctx.currentTime+.8);tone(90,.9,'sawtooth',.07,0,3);break}
    case 'thud':tone(70,.35,'sine',.28,0,.5);burst(.15,600,'lowpass',.22);break;
    case 'warn':tone(880,.09,'square',.05);tone(880,.09,'square',.05,.14);break;
    case 'thunder':{const dl=.2+Math.random()*1.5;burst(3.2,160,'lowpass',.5,dl);burst(.25,1200,'lowpass',.28,dl);burst(1.4,260,'lowpass',.25,dl+1.2);break}
    case 'squelch':burst(.1,2500,'highpass',.1);tone(1200,.05,'square',.025,.08);break;
    case 'quake':burst(3.4,60,'lowpass',.8);tone(42,2.6,'sine',.25,0,.7);break;
    case 'swing':tone(300,.25,'triangle',.05,0,2);break;
    case 'rattle':burst(.05+Math.random()*.08,900+Math.random()*2500,'bandpass',.12);burst(.04,1800,'bandpass',.08,.07);break;               // tornado debris
    case 'crash':burst(.5,350+Math.random()*300,'lowpass',.38);burst(.12,1500,'bandpass',.14);tone(60+Math.random()*30,.4,'sine',.2,0,.5);break; // quake debris
    case 'creak':tone(70+Math.random()*30,1.6,'sawtooth',.03,0,.6);break;
    case 'alarm':for(let i=0;i<6;i++)tone(i%2?1250:1600,.12,'square',.012,i*.16);break;                                                         // far car alarm
    case 'pop':tone(160+Math.random()*120,.05,'square',.05,0,.4);burst(.05,2500,'highpass',.1);break;                                         // fire pop
    case 'bird':{const f0=2400+Math.random()*1800,n=2+Math.floor(Math.random()*3);for(let i=0;i<n;i++)tone(f0*(1+i*.08),.09,'sine',.018,i*.12,1.4+Math.random()*.4);break}}}

// ---------- radio voice: speech through a handheld-radio chain, with key-up squelch, static and a click at the end ----------
// buf: decoded AudioBuffer of the spoken line (from serve.py /api/tts, which uses the Mac's built-in voice). Returns seconds of speech.
function audioRadio(buf,rate=1.06){const c=AU.ctx;if(!c||!AU.on)return 0;const t0=c.currentTime+.12,dur=buf.duration/rate;
  // key-up: short noise puff + two-tone beep
  burst(.09,2200,'bandpass',.22,0,'radio');tone(1500,.06,'square',.03,.07);
  const s=c.createBufferSource();s.buffer=buf;s.playbackRate.value=rate;const g=c.createGain();g.gain.value=1.4;s.connect(g);g.connect(AU.radioIn);s.start(t0);AU.radioSrc=s;
  // static bed: band-limited noise, a bit louder in the gaps, with a slow crackle; fades out with the voice
  const n=c.createBufferSource();n.buffer=AU.noise;n.loop=true;const nf=c.createBiquadFilter();nf.type='bandpass';nf.frequency.value=2100;nf.Q.value=.6;const ng=c.createGain();
  ng.gain.setValueAtTime(.0001,t0-.05);ng.gain.linearRampToValueAtTime(.05,t0+.05);ng.gain.setValueAtTime(.05,t0+dur);ng.gain.exponentialRampToValueAtTime(.0001,t0+dur+.25);
  n.connect(nf);nf.connect(ng);ng.connect(AU.bus.radio);n.start(t0-.05,Math.random()*2);n.stop(t0+dur+.3);
  // tail: unkey click + short squelch burst
  burst(.12,1800,'highpass',.16,dur+.12,'radio');tone(900,.05,'square',.03,dur+.1);
  AU.duck=dur+.7;return dur}
