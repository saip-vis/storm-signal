'use strict';
// =====================================================================
// audio.js: every sound is synthesized in code with Web Audio (no audio files, so no licensing).
// Loops: wind (speed + storm), wing buzz, truck engine + siren, rain, tornado rumble, fire crackle, quake rumble, ambient score.
// One-shots: pickup chime, report lost, dash/nitro whoosh, impact thud, hazard warning, thunder, radio squelch.
// N toggles sound. The context starts on the Start click (browsers require a user gesture).
// =====================================================================
const AU={ctx:null,on:store.get('df.sound','on')==='on',master:null,loops:{},noise:null,music:null,crackT:0,chord:0,chordT:0};
function audioInit(){if(AU.ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const c=AU.ctx=new AC();
  const comp=c.createDynamicsCompressor();comp.connect(c.destination);AU.master=c.createGain();AU.master.gain.value=AU.on?.8:0;AU.master.connect(comp);
  const nb=c.createBuffer(1,c.sampleRate*2,c.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;AU.noise=nb;
  const noiseLoop=(type,freq,q)=>{const s=c.createBufferSource();s.buffer=nb;s.loop=true;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q||.7;const g=c.createGain();g.gain.value=0;s.connect(f);f.connect(g);g.connect(AU.master);s.start();return{f,g}};
  const osc=(type,freq)=>{const o=c.createOscillator();o.type=type;o.frequency.value=freq;const g=c.createGain();g.gain.value=0;o.connect(g);g.connect(AU.master);o.start();return{o,g}};
  AU.loops.wind=noiseLoop('bandpass',500,.6);AU.loops.rain=noiseLoop('highpass',2500,.5);AU.loops.rumble=noiseLoop('lowpass',110,1);AU.loops.quake=noiseLoop('lowpass',55,1.2);
  // wing buzz: square wave through a lowpass, amplitude-modulated at the flap rate
  {const o=c.createOscillator();o.type='square';o.frequency.value=120;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=900;const am=c.createGain();am.gain.value=.5;
   const lfo=c.createOscillator();lfo.frequency.value=20;const lg=c.createGain();lg.gain.value=.5;lfo.connect(lg);lg.connect(am.gain);const g=c.createGain();g.gain.value=0;
   o.connect(f);f.connect(am);am.connect(g);g.connect(AU.master);o.start();lfo.start();AU.loops.wing={o,lfo,g}}
  // truck engine: two detuned saws through a lowpass
  {const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=500;const g=c.createGain();g.gain.value=0;f.connect(g);g.connect(AU.master);const a=c.createOscillator(),b=c.createOscillator();a.type=b.type='sawtooth';a.connect(f);b.connect(f);a.start();b.start();AU.loops.engine={a,b,f,g}}
  AU.loops.siren=osc('triangle',700);
  // ambient score: three detuned saws through a lowpass, slow minor chord changes; the filter opens with danger
  {const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=600;f.Q.value=.8;const g=c.createGain();g.gain.value=0;f.connect(g);g.connect(AU.master);
   const os=[0,1,2,3].map(i=>{const o=c.createOscillator();o.type='sawtooth';o.detune.value=(i-1.5)*7;o.connect(f);o.start();return o});AU.music={f,g,os}}}
function audioToggle(){AU.on=!AU.on;store.set('df.sound',AU.on?'on':'off');if(AU.master)AU.master.gain.setTargetAtTime(AU.on?.8:0,AU.ctx.currentTime,.05);say(AU.on?'sound on':'sound off')}
const tgt=(p,v,tc=.15)=>{if(p)p.setTargetAtTime(v,AU.ctx.currentTime,tc)};
// minor progression (Dm - Bb - F - C), root notes in Hz; a fourth voice adds the fifth
const CHORDS=[[146.8,174.6,220],[116.5,146.8,174.6],[174.6,220,261.6],[130.8,164.8,196]];
function audioTick(dt){if(!AU.ctx||AU.ctx.state!=='running')return;const L=AU.loops,U=unitPos(),air=mode=='air';
  const w=windAt(U.x,U.z).length(),s=air?spd:Math.abs(TR.spd),live_=go&&!paused;
  tgt(L.wind.g.gain,live_?Math.min(.32,.03+s/260+w/160):0);tgt(L.wind.f.frequency,300+s*12+w*8);
  tgt(L.wing.g.gain,live_&&air?.045+Math.min(.05,s/1500):0);tgt(L.wing.o.frequency,110+s*1.4);tgt(L.wing.lfo.frequency,14+s*.35);
  const ev=live_&&!air;tgt(L.engine.g.gain,ev?.05+Math.min(.07,Math.abs(TR.spd)/500)+(nitroT>0?.05:0):0);const ef=38+Math.abs(TR.spd)*2.1+(nitroT>0?25:0);tgt(L.engine.a.frequency,ef);tgt(L.engine.b.frequency,ef*1.505);tgt(L.engine.f.frequency,400+Math.abs(TR.spd)*25);
  // siren: two-tone hi-lo while the truck is on a call
  const sirenOn=ev&&(auto||Math.abs(TR.spd)>3)&&disaster!='none';tgt(L.siren.g.gain,sirenOn?.022:0,.05);if(sirenOn)L.siren.o.frequency.setTargetAtTime(Math.floor(t*1.6)%2?960:720,AU.ctx.currentTime,.02);
  const raining=rain.visible;tgt(L.rain.g.gain,live_&&raining?(disaster=='flood'?.16:.12):0,.5);
  const td=disaster=='tornado'?Math.hypot(U.x-T.x,U.z-T.z):1e9;tgt(L.rumble.g.gain,live_?Math.max(0,1-td/650)*.55:0,.3);
  tgt(L.quake.g.gain,live_&&disaster=='earthquake'?Math.min(.7,shake*.35):0,.08);
  // wildfire crackle: random short bursts, denser close to the fire
  if(live_&&disaster=='wildfire'){const near=clamp(1-fireArrival(U.x,U.z)/60,0,1)*.8+(FIRE.burning.length?.1:0);AU.crackT-=dt;if(AU.crackT<=0){AU.crackT=.03+Math.random()*(.4-near*.35);if(Math.random()<near+.1)burst(.03,3000+Math.random()*3000,'highpass',.15*near+.03)}}
  // score: chord every 8 s, filter opens with danger near you
  const M_=AU.music;AU.chordT-=dt;if(AU.chordT<=0){AU.chordT=8;AU.chord=(AU.chord+1)%4;const ch=CHORDS[AU.chord];M_.os.forEach((o,i)=>o.frequency.setTargetAtTime(i<3?ch[i]:ch[0]/2,AU.ctx.currentTime,.8))}
  const danger=clamp(Math.max(dangerAt(U.x,U.z,3),heatAt(U.x,U.z)),0,1);tgt(M_.g.gain,live_?(app==='live'?.018:.028)+danger*.02:.02,1.5);tgt(M_.f.frequency,350+danger*1400+(nitroT>0?600:0),1)}
function burst(dur,freq,type,vol,delay=0){const c=AU.ctx;if(!c)return;const s=c.createBufferSource();s.buffer=AU.noise;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;const g=c.createGain(),t0=c.currentTime+delay;
  g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);s.connect(f);f.connect(g);g.connect(AU.master);s.start(t0,Math.random());s.stop(t0+dur+.05);return f}
function tone(freq,dur,type='sine',vol=.12,delay=0,slide=0){const c=AU.ctx;if(!c)return;const o=c.createOscillator();o.type=type;o.frequency.value=freq;const g=c.createGain(),t0=c.currentTime+delay;
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,freq*slide),t0+dur);g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(vol,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g);g.connect(AU.master);o.start(t0);o.stop(t0+dur+.05)}
function sfx(name){if(!AU.ctx||!AU.on)return;
  switch(name){
    case 'chime':[523.3,659.3,784,1046.5].forEach((f,i)=>tone(f,.35,'triangle',.09,i*.07));break;            // people aboard
    case 'lost':[392,349.2,293.7].forEach((f,i)=>tone(f,.45,'sine',.08,i*.16));break;                         // report expired
    case 'whoosh':{const f=burst(.6,400,'bandpass',.35);if(f)f.frequency.exponentialRampToValueAtTime(3000,AU.ctx.currentTime+.5);tone(180,.4,'sawtooth',.05,0,2.5);break}
    case 'nitro':{const f=burst(1,300,'bandpass',.4);if(f)f.frequency.exponentialRampToValueAtTime(2500,AU.ctx.currentTime+.8);tone(90,.9,'sawtooth',.08,0,3);break}
    case 'thud':tone(70,.35,'sine',.3,0,.5);burst(.15,600,'lowpass',.25);break;
    case 'warn':tone(880,.09,'square',.06);tone(880,.09,'square',.06,.14);break;
    case 'thunder':{const d=.2+Math.random()*1.5;burst(2.8,180,'lowpass',.55,d);burst(.25,1200,'lowpass',.3,d);break}
    case 'squelch':burst(.12,2500,'highpass',.12);tone(1200,.06,'square',.03,.1);break;
    case 'quake':burst(3,60,'lowpass',.8);break;
    case 'swing':tone(300,.25,'triangle',.05,0,2);break;}}
