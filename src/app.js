const $ = (id)=>document.getElementById(id);
const logEl = $("log");
function log(line){
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent;
}

// ---- Seeded RNG (xorshift32) ----
class RNG {
  constructor(seed){ this.x = (seed>>>0) || 0x12345678; }
  nextU32(){ let x=this.x; x^=x<<13; x^=x>>>17; x^=x<<5; this.x=x>>>0; return this.x; }
  nextFloat(){ return (this.nextU32()>>>8)/(1<<24); }
  pick(arr){ return arr[Math.floor(this.nextFloat()*arr.length)]; }
}
function hashSeed(str){
  let h=2166136261>>>0;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619)>>>0;
  }
  return h>>>0;
}
function randSeedString(){
  const a = new Uint32Array(2);
  (crypto||window.crypto).getRandomValues(a);
  return (a[0].toString(36) + a[1].toString(36)).toUpperCase();
}

// ---- Note helpers ----
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function midiToName(m){
  const o = Math.floor(m/12)-1;
  return NOTE_NAMES[m%12]+o;
}
function midiToHz(m){ return 440*Math.pow(2,(m-69)/12); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// ---- STATE ----
let STATE = {
  preset:"acid_trance_rave",
  style:"acid_trance",

  seedMode:"sequence",
  seedLayers:[
    {id:"A", seedStr:"1337-ACID", offset:0, weight:1.00, mode:"dominant", enabled:true},
    {id:"B", seedStr:"RND-TRANCE", offset:0, weight:0.55, mode:"add", enabled:false},
  ],
  activeLayerId:"A",

  bpm:145,
  swing:0.12,
  humanize:0.08,
  stepsPerBar:16,
  editMode:"off",

  loopBars:2,
  variation:0.22,
  mutator:"acidLift",
  mutIntensity:0.38,
  editBar:0,
  patterns:[],
  renderPatterns:[],
  mutes:{kick:false, snare:false, hat:false, bass:false},

  autoLanes:"off",
  laneStrength:0.55,
  lanesByBar:null,

  autoFills:"off",
  fillPeriod:4,
  fillIntensity:0.45,

  delaySync:"1/16",
  sidechainPump:0.35,

  transpose:0,
  rootMidi:43,
  selectedMidi:43,

  filterModel:"biquad",
  wobbleAmt:0.64,
  wobbleSync:"1/16",
  wobbleHz:6.0,
  lfoWave:"sine",
  lfoFilterHz:20.0,
  lfoTarget:"filter",
  cutoff:650,
  res:0.62,
  drive:0.26,
  chorus:0.35,
  delay:0.24,
  reverb:0.18,
  glideMs:55,
  subMix:0.26,

  vol:{kick:0.88, snare:0.72, hat:0.60, bass:0.78},
  eq:{lowDb:1, midDb:0, highDb:3},

  playing:false,
  globalStep:0,
  nextTime:0,

  _dyn:null
};

// ---- Presets ----
const PRESETS = {
  acid_trance_rave:{
    style:"acid_trance",
    bpm:145, swing:0.12, humanize:0.08, stepsPerBar:16,
    loopBars:2, variation:0.22, mutator:"acidLift", mutIntensity:0.38,
    transpose:0, rootMidi:43,
    bass:{filterModel:"biquad", wobbleAmt:0.64, wobbleSync:"1/16", wobbleHz:6.0, cutoff:650, res:0.62, drive:0.26, chorus:0.35, delay:0.24, reverb:0.18, glideMs:55, subMix:0.26},
    delaySync:"1/16", sidechainPump:0.32,
    vol:{kick:0.88, snare:0.72, hat:0.60, bass:0.78},
    eq:{lowDb:1, midDb:0, highDb:3}
  },
  dark_techno_roll:{
    style:"dark_techno",
    bpm:138, swing:0.18, humanize:0.10, stepsPerBar:16,
    loopBars:4, variation:0.28, mutator:"buildup", mutIntensity:0.35,
    transpose:0, rootMidi:41,
    bass:{filterModel:"cascade24", wobbleAmt:0.78, wobbleSync:"1/8", wobbleHz:4.0, cutoff:360, res:0.78, drive:0.44, chorus:0.18, delay:0.12, reverb:0.08, glideMs:38, subMix:0.34},
    delaySync:"1/16", sidechainPump:0.42,
    vol:{kick:0.92, snare:0.70, hat:0.58, bass:0.80},
    eq:{lowDb:2, midDb:-1, highDb:1}
  }
};

function applyPreset(key){
  const p = PRESETS[key]; if(!p) return;
  STATE.preset=key;
  STATE.style=p.style;

  STATE.bpm=p.bpm; STATE.swing=p.swing; STATE.humanize=p.humanize; STATE.stepsPerBar=p.stepsPerBar;
  STATE.loopBars=p.loopBars; STATE.variation=p.variation; STATE.mutator=p.mutator; STATE.mutIntensity=p.mutIntensity;

  STATE.transpose=p.transpose; STATE.rootMidi=p.rootMidi; STATE.selectedMidi=p.rootMidi;

  STATE.filterModel=p.bass.filterModel;
  STATE.wobbleAmt=p.bass.wobbleAmt; STATE.wobbleSync=p.bass.wobbleSync; STATE.wobbleHz=p.bass.wobbleHz;
  STATE.lfoWave=(p.bass.lfoWave||"sine");
  STATE.lfoFilterHz=(p.bass.lfoFilterHz==null?20:p.bass.lfoFilterHz);
  STATE.lfoTarget=(p.bass.lfoTarget||"filter");
  STATE.cutoff=p.bass.cutoff; STATE.res=p.bass.res; STATE.drive=p.bass.drive;
  STATE.chorus=p.bass.chorus; STATE.delay=p.bass.delay; STATE.reverb=p.bass.reverb;
  STATE.glideMs=p.bass.glideMs; STATE.subMix=p.bass.subMix;

  STATE.delaySync=p.delaySync; STATE.sidechainPump=p.sidechainPump;

  Object.assign(STATE.vol, p.vol);
  Object.assign(STATE.eq, p.eq);

  const A = STATE.seedLayers.find(x=>x.id==="A");
  if (A){ A.seedStr = $("seed").value || A.seedStr; }

  STATE.editBar=0;
  buildBarTabs();
  regenArrangementFromSeedStack();
  syncUIFromState();
  syncMixToGraph(); syncEQToGraph();
  rebuildBassVoiceIfNeeded();
  log(`[T+0ms] INFO PRESET_APPLY { preset:${key}, style:${STATE.style} }`);
}

// ---- Pattern generation (style-aware) ----
function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }
function isTrance(){ return (STATE.style==="acid_trance" || STATE.style==="dark_trance"); }
function isDark(){ return (STATE.style==="dark_trance" || STATE.style==="dark_techno"); }
function isAcid(){ return (STATE.style==="acid" || STATE.style==="acid_trance"); }

function genKick(rng, steps){
  const hit=new Array(steps).fill(0), vel=new Array(steps).fill(0);
  const q=steps/4;
  for (let i=0;i<steps;i+=q){ hit[i]=1; vel[i]=0.92; }

  if (STATE.style==="dark_techno"){
    for (let i=0;i<steps;i++){
      if ((i%q)!==0 && (i%(q/2)===0) && rng.nextFloat()<0.20){ hit[i]=1; vel[i]=0.68; }
    }
  } else {
    for (let i=0;i<steps;i++){
      if ((i%q)!==0 && (i%(q/2)===0) && rng.nextFloat()<0.10){ hit[i]=1; vel[i]=0.60; }
    }
  }
  return {hit,vel};
}
function genSnare(rng, steps){
  const hit=new Array(steps).fill(0), vel=new Array(steps).fill(0);
  const back1=steps/4, back2=(steps/4)*3;

  if (STATE.style==="dark_techno"){
    hit[back1]=1; vel[back1]=0.78;
    hit[back2]=1; vel[back2]=0.78;
    if (rng.nextFloat()<0.18 && back2-1>=0){ hit[back2-1]=1; vel[back2-1]=0.42; }
  } else {
    hit[back1]=1; vel[back1]=0.85;
    hit[back2]=1; vel[back2]=0.85;
    if (isTrance()){
      const g1=back1+1, g2=back2+1;
      if (g1<steps && rng.nextFloat()<0.65){ hit[g1]=1; vel[g1]=0.58; }
      if (g2<steps && rng.nextFloat()<0.65){ hit[g2]=1; vel[g2]=0.58; }
    } else {
      if (rng.nextFloat()<0.35 && back1-1>=0){ hit[back1-1]=1; vel[back1-1]=0.52; }
      if (rng.nextFloat()<0.35 && back2-1>=0){ hit[back2-1]=1; vel[back2-1]=0.52; }
    }
  }
  return {hit,vel};
}
function genHats(rng, steps){
  const hit=new Array(steps).fill(0), vel=new Array(steps).fill(0);
  const spb = steps/4;

  const baseOff = isTrance() ? 0.68 : 0.60;
  const extraP =
    (STATE.style==="dark_techno") ? 0.52 :
    (STATE.style==="acid") ? 0.42 :
    (STATE.style==="acid_trance") ? 0.34 :
    0.38;

  for (let i=0;i<steps;i++){
    const isOff = (i % spb === spb/2);
    const isGrid = (i % (spb/2)===0);

    if (isOff){ hit[i]=1; vel[i]=baseOff; }
    if (isGrid && rng.nextFloat()<extraP){
      hit[i]=1;
      vel[i]=Math.max(vel[i], 0.36 + rng.nextFloat()*0.22);
    }

    if (hit[i] && rng.nextFloat()<0.10){
      vel[i]=Math.min(1.0, vel[i]*(1.15 + rng.nextFloat()*0.15));
    }
    if (isDark() && hit[i]) vel[i]*=0.92;
  }
  return {hit,vel};
}
function genBassline(rng, steps, rootMidi){
  const root = rootMidi;
  const scale =
    (STATE.style==="acid" || STATE.style==="dark_techno") ? [0,3,5,6,7,10] :
    [0,2,3,5,7,10];

  let last = root + rng.pick(scale);
  const notes = new Array(steps).fill(null);
  const spb = steps/4;

  const dens =
    (STATE.style==="acid") ? 0.86 :
    (STATE.style==="acid_trance") ? 0.72 :
    (STATE.style==="dark_trance") ? 0.62 :
    0.66;

  const restP =
    (STATE.style==="acid") ? 0.05 :
    (STATE.style==="acid_trance") ? 0.12 :
    (STATE.style==="dark_trance") ? 0.18 :
    0.14;

  const jumpP =
    (STATE.style==="acid") ? 0.32 :
    (STATE.style==="acid_trance") ? 0.28 :
    (STATE.style==="dark_trance") ? 0.25 :
    0.22;

  const slideP =
    (STATE.style==="acid") ? 0.26 :
    (STATE.style==="acid_trance") ? 0.18 :
    (STATE.style==="dark_trance") ? 0.12 :
    0.10;

  const accentP =
    (STATE.style==="acid") ? 0.28 :
    (STATE.style==="acid_trance") ? 0.18 :
    (STATE.style==="dark_trance") ? 0.12 :
    0.14;

  for (let i=0;i<steps;i++){
    const onGrid = (i % (spb/2)===0);
    if (!onGrid && rng.nextFloat() > dens) continue;

    if (rng.nextFloat() < restP){ notes[i]=null; continue; }

    let n;
    if (STATE.style==="dark_techno" && rng.nextFloat()<0.55){
      n = last;
    } else {
      n = (rng.nextFloat()<jumpP) ? (root + rng.pick(scale)) : last;
    }
    last = n;

    const accent = (i % spb === 0) || (rng.nextFloat() < accentP);
    const slide  = (rng.nextFloat() < slideP);
    notes[i] = {midi:n, accent, slide};
  }

  if (!notes.some(x=>x!==null)) notes[0]={midi:root, accent:true, slide:false};
  return notes;
}

function mutatePattern(pattern, barIndex, amount){
  if (amount<=0) return pattern;
  const steps = pattern.stepsPerBar;
  const rng = new RNG(hashSeed(`${activeSeedSignature()}|mutate|bar:${barIndex}|steps:${steps}|style:${STATE.style}`));
  const out = deepClone(pattern);

  const pFlipKick  = 0.02 + amount*0.08;
  const pFlipSnare = 0.02 + amount*0.06;
  const pFlipHat   = 0.05 + amount*0.14;
  const pBassAlt   = 0.04 + amount*0.14;

  for (let i=0;i<steps;i++){
    const isDown = (i%(steps/4)===0);
    if (!isDown && rng.nextFloat()<pFlipKick){
      out.kick.hit[i] = 1 - out.kick.hit[i];
      out.kick.vel[i] = out.kick.hit[i] ? (0.55 + rng.nextFloat()*0.35) : 0;
    }
    if (rng.nextFloat()<pFlipSnare*0.6 && out.snare.hit[i] && !isDown){
      out.snare.vel[i] = Math.min(1.0, out.snare.vel[i] * (0.75 + rng.nextFloat()*0.45));
    }
    if (rng.nextFloat()<pFlipHat){
      if (out.hat.hit[i]){
        if (rng.nextFloat()<0.45){ out.hat.vel[i] = (out.hat.vel[i]>=0.9)?0.55:0.98; }
        else { out.hat.hit[i]=0; out.hat.vel[i]=0; }
      } else {
        out.hat.hit[i]=1;
        out.hat.vel[i]=0.32 + rng.nextFloat()*0.40;
      }
    }
  }

  const scale = (STATE.style==="acid" || STATE.style==="dark_techno") ? [0,3,5,6,7,10] : [0,2,3,5,7,10];
  const root = STATE.rootMidi;
  function snapToScale(m){
    let best=m, bestd=1e9;
    for (let oct=-1; oct<=1; oct++){
      for (const s of scale){
        const cand = root + s + oct*12;
        const d = Math.abs(cand - m);
        if (d < bestd){ bestd=d; best=cand; }
      }
    }
    return best;
  }
  for (let i=0;i<steps;i++){
    const ev = out.bass[i];
    if (!ev) continue;
    if (rng.nextFloat()<pBassAlt){
      const dir = rng.nextFloat()<0.5 ? -1 : 1;
      ev.midi = snapToScale(ev.midi + dir*(rng.nextFloat()<0.6 ? 1 : 2));
    }
    if (rng.nextFloat()<pBassAlt*0.7) ev.accent = !ev.accent;
    if (rng.nextFloat()<pBassAlt*0.5) ev.slide  = !ev.slide;
  }

  return out;
}

// ---- Seed Stack ----
function activeSeedSignature(){
  return STATE.seedLayers.filter(l=>l.enabled).map(l=>`${l.id}:${l.seedStr}@${l.offset}|${l.mode}|${l.weight.toFixed(2)}`).join(";");
}
function layerSeedU32(layer, barIndex){
  const steps = STATE.stepsPerBar;
  const s = `${layer.seedStr}|off:${layer.offset}|style:${STATE.style}|steps:${steps}|root:${STATE.rootMidi}|bar:${barIndex}`;
  return hashSeed(s);
}
function patternForLayerBar(layer, barIndex){
  const steps = STATE.stepsPerBar;
  const base = layerSeedU32(layer, barIndex);
  const rng = new RNG(base);

  const kick  = genKick (new RNG(rng.nextU32()), steps);
  const snare = genSnare(new RNG(rng.nextU32()), steps);
  const hat   = genHats (new RNG(rng.nextU32()), steps);
  const bass  = genBassline(new RNG(rng.nextU32()), steps, STATE.rootMidi);

  let pat = {stepsPerBar:steps, kick, snare, hat, bass};
  pat = (STATE.variation<=0.0001) ? pat : mutatePattern(pat, barIndex, STATE.variation);
  return pat;
}
function mergePatterns(pats, barIndex){
  const steps = STATE.stepsPerBar;
  const out = deepClone(pats[0].pat);

  function coin(key){
    const h = hashSeed(`${activeSeedSignature()}|${key}|bar:${barIndex}|style:${STATE.style}|steps:${steps}`);
    return new RNG(h).nextFloat();
  }

  for (const track of ["kick","snare","hat"]){
    for (let i=0;i<steps;i++){
      let hit = 0, vel = 0;

      for (const {pat, layer} of pats){
        if(!layer.enabled) continue;
        const w = layer.weight;
        const mode = layer.mode;
        const h = pat[track].hit[i] ? 1 : 0;

        if (mode==="dominant"){
          if (h && (w*pat[track].vel[i]) >= (vel||0)){
            hit = 1; vel = Math.max(vel, pat[track].vel[i]);
          }
        } else if (mode==="add"){
          if (h && coin(`${layer.id}|${track}|${i}`) < w){
            hit = 1;
            vel = Math.max(vel, pat[track].vel[i] * (0.85 + 0.3*w));
          }
        } else if (mode==="xor"){
          if (h && coin(`${layer.id}|${track}|${i}|xor`) < w){
            hit = hit ? 0 : 1;
            vel = hit ? Math.max(vel, pat[track].vel[i]) : 0;
          }
        }
      }

      out[track].hit[i]=hit;
      out[track].vel[i]=hit ? clamp(vel,0.2,1.0) : 0;
    }
  }

  for (let i=0;i<steps;i++){
    let chosen = out.bass[i];
    let bestScore = -1;

    for (const {pat, layer} of pats){
      const ev = pat.bass[i];
      if (!ev) continue;

      const w = layer.weight;
      if (layer.mode==="xor"){
        if (coin(`${layer.id}|bass|${i}|xor`) < w){
          chosen = chosen ? null : deepClone(ev);
        }
        continue;
      }

      const score = w + (ev.accent?0.08:0) + (ev.slide?0.04:0);
      if (score > bestScore){
        bestScore = score;
        chosen = deepClone(ev);
      } else if (layer.mode==="add" && coin(`${layer.id}|bass|${i}|add`) < w*0.35){
        chosen = chosen ?? deepClone(ev);
        if (chosen){
          if (coin(`${layer.id}|bass|${i}|acc`) < 0.35*w) chosen.accent = !chosen.accent;
          if (coin(`${layer.id}|bass|${i}|sld`) < 0.25*w) chosen.slide = !chosen.slide;
        }
      }
    }
    out.bass[i] = chosen;
  }

  if (isTrance()){
    const q = steps/4;
    for (let k=0;k<steps;k+=q){
      out.kick.hit[k]=1;
      out.kick.vel[k]=Math.max(out.kick.vel[k], 0.86);
    }
  }

  return out;
}

function regenArrangementFromSeedStack(){
  const bars = STATE.loopBars;
  const active = STATE.seedLayers.filter(l=>l.enabled);
  if (!active.length){
    alert("Mindestens 1 Seed Layer aktivieren.");
    return;
  }

  const patterns=[];
  for (let b=0;b<bars;b++){
    let barPat;
    if (STATE.seedMode==="sequence"){
      const layer = active[b % active.length];
      barPat = patternForLayerBar(layer, b);
    } else {
      const pats = active.map(layer=>({layer, pat:patternForLayerBar(layer, b)}));
      barPat = mergePatterns(pats, b);
    }
    patterns[b]=barPat;
  }
  STATE.patterns = patterns;
  if (STATE.editBar >= bars) STATE.editBar=0;

  rebuildDerivedPlaybackData();
  buildBarTabs();
  renderGrid();
  updateSelectedNoteBadge();
  log(`[T+0ms] ARR_SEEDSTACK { mode:${STATE.seedMode}, bars:${bars}, layers:${active.map(x=>x.id).join(",")} }`);
}

// ---- Auto-Lanes / Auto-Fills ----
function generateAutoLanes(){
  const bars = STATE.loopBars;
  const steps = STATE.stepsPerBar;
  const strength = STATE.laneStrength;
  const out = {};

  for (let b=0;b<bars;b++){
    const baseSeed = hashSeed(`${activeSeedSignature()}|lanes|bar:${b}|style:${STATE.style}|mode:${STATE.seedMode}`);
    const rng = new RNG(baseSeed);

    const t = bars<=1 ? 0 : b/(bars-1);
    const laneType =
      (isTrance() && t>0.5) ? "rampUp" :
      (isDark() && t>0.6) ? "breakDip" :
      (rng.nextFloat()<0.5 ? "sine" : "randomWalk");

    function mkLane(){
      const arr = new Array(steps).fill(0);
      let x = rng.nextFloat()*0.4 + 0.3;
      for(let i=0;i<steps;i++){
        if (laneType==="rampUp") x = i/(steps-1);
        else if (laneType==="rampDown") x = 1 - i/(steps-1);
        else if (laneType==="sine") x = 0.5 + 0.5*Math.sin((i/(steps-1))*Math.PI*2);
        else if (laneType==="breakDip"){
          const p=i/(steps-1);
          x = 1 - Math.sin(p*Math.PI);
        } else {
          x = clamp(x + (rng.nextFloat()*2-1)*0.12, 0, 1);
        }
        arr[i]=x;
      }
      for(let i=1;i<steps;i++) arr[i] = arr[i-1]*0.75 + arr[i]*0.25;
      return arr.map(v=>clamp(0.5 + (v-0.5)*strength, 0, 1));
    }

    out[b] = {cutoff:mkLane(), res:mkLane(), wobble:mkLane(), reverb:mkLane(), drive:mkLane()};
  }
  return out;
}

function applyAutoFills(patterns){
  const bars = patterns.length;
  const steps = STATE.stepsPerBar;
  const period = STATE.fillPeriod|0;
  const I = STATE.fillIntensity;

  for (let b=0;b<bars;b++){
    if (period<=0 || ((b+1)%period)!==0) continue;

    const p = patterns[b];
    const seed = hashSeed(`${activeSeedSignature()}|fills|bar:${b}|style:${STATE.style}|I:${I.toFixed(2)}`);
    const rng = new RNG(seed);

    const start = Math.floor(steps*0.75);
    const maxAdds = Math.floor(steps*(0.10 + 0.18*I));
    let adds=0;

    const snP = isDark()? (0.18 + 0.40*I) : (0.25 + 0.55*I);
    for (let i=start;i<steps;i++){
      if (adds>=maxAdds) break;
      if (rng.nextFloat() < snP){
        p.snare.hit[i]=1;
        p.snare.vel[i]=clamp(0.42 + 0.48*rng.nextFloat(), 0.30, 0.95);
        adds++;
      }
    }

    const hP = (STATE.style==="dark_techno") ? (0.40 + 0.40*I) : (0.35 + 0.45*I);
    for (let i=start;i<steps;i++){
      if (adds>=maxAdds) break;
      if (rng.nextFloat() < hP){
        p.hat.hit[i]=1;
        p.hat.vel[i]=clamp(0.28 + 0.60*rng.nextFloat(), 0.22, 0.95);
        adds++;
      }
    }

    const bP = isAcid()? (0.22 + 0.40*I) : (0.16 + 0.30*I);
    for (let i=start;i<steps;i++){
      if (adds>=maxAdds) break;
      if (rng.nextFloat() < bP){
        if (!p.bass[i]) p.bass[i]={midi:STATE.rootMidi, accent:false, slide:false};
        p.bass[i].midi = p.bass[i].midi + (rng.nextFloat()<0.5 ? -1 : 1);
        if (rng.nextFloat()<0.45) p.bass[i].slide = true;
        if (rng.nextFloat()<0.35) p.bass[i].accent = true;
        adds++;
      }
    }
  }
  return patterns;
}

function rebuildDerivedPlaybackData(){
  STATE.lanesByBar = (STATE.autoLanes==="on") ? generateAutoLanes() : null;
  STATE.renderPatterns = (STATE.autoFills==="on") ? applyAutoFills(deepClone(STATE.patterns)) : STATE.patterns;
}

// ---- Bar tabs ----
function buildBarTabs(){
  const el = $("barTabs");
  el.innerHTML="";
  for (let i=0;i<STATE.loopBars;i++){
    const b = document.createElement("div");
    b.className = "pill" + (i===STATE.editBar ? " active" : "");
    b.textContent = `Bar ${i+1}`;
    b.onclick=()=>{ STATE.editBar=i; buildBarTabs(); renderGrid(); };
    el.appendChild(b);
  }
}

// ---- Grid editor ----
function activePattern(){ return STATE.patterns[STATE.editBar]; }
function cellClassFor(track, step){
  const p=activePattern();
  if (!p) return "cell off";
  if (track==="bass"){
    const ev = p.bass[step];
    if (!ev) return "cell off";
    if (ev.slide) return "cell slide";
    return ev.accent ? "cell accent" : "cell on";
  } else {
    const hit = p[track].hit[step];
    if (!hit) return "cell off";
    const v = p[track].vel[step];
    return (v>=0.9) ? "cell accent" : "cell on";
  }
}
function renderGrid(){
  const p=activePattern(); if(!p){ $("grid").innerHTML=""; return; }
  const steps=p.stepsPerBar;

  let html = `<table><thead><tr><th class="trackName">Bar ${STATE.editBar+1} / ${STATE.loopBars}</th>`;
  for (let i=0;i<steps;i++){
    const marker = (i%(steps/4)===0) ? "•" : "";
    html += `<th>${marker}${i+1}</th>`;
  }
  html += `</tr></thead><tbody>`;

  function row(trackKey, label, isBass=false){
    html += `<tr><td class="trackName">${label}</td>`;
    for (let i=0;i<steps;i++){
      const cls = cellClassFor(trackKey, i);
      let title="";
      if (isBass){
        const ev=p.bass[i];
        title = ev ? `${midiToName(ev.midi+STATE.transpose)}${ev.slide?" slide":""}${ev.accent?" acc":""}` : "(off)";
      } else {
        const hit=p[trackKey].hit[i];
        title = hit ? `vel ${p[trackKey].vel[i].toFixed(2)}` : "(off)";
      }
      html += `<td><span class="${cls}" data-track="${trackKey}" data-step="${i}" title="${title}"></span></td>`;
    }
    html += `</tr>`;
  }

  row("kick","Kick");
  row("snare","Snare/Clap");
  row("hat","Hat");
  row("bass","Bass", true);

  html += `</tbody></table>`;
  $("grid").innerHTML = html;

  $("grid").querySelectorAll(".cell").forEach(el=>{
    el.addEventListener("click", (e)=>{
      if (STATE.editMode!=="on") return;
      const track = el.dataset.track;
      const step = parseInt(el.dataset.step,10);
      editCell(track, step, e);
      rebuildDerivedPlaybackData();
      renderGrid();
    });
  });
}
function editCell(track, step, e){
  const p=activePattern();
  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey || e.metaKey;

  if (track==="bass"){
    let ev = p.bass[step];
    if (!ev){
      ev = {midi:STATE.selectedMidi, accent:shift, slide:false};
      p.bass[step] = ev;
      return;
    }
    if (alt){ ev.slide = !ev.slide; return; }
    if (ctrl){ ev.midi = Math.min(60, ev.midi+1); return; }
    if (shift){ ev.accent = !ev.accent; return; }
    p.bass[step] = null;
    return;
  }

  const hit = p[track].hit[step];
  if (!hit){
    p[track].hit[step]=1;
    p[track].vel[step]= shift ? 0.98 : 0.72;
  } else {
    if (shift){
      p[track].vel[step] = (p[track].vel[step]>=0.9) ? 0.72 : 0.98;
    } else {
      p[track].hit[step]=0;
      p[track].vel[step]=0;
    }
  }
}

// ---- Keyboard ----
function buildKeyboard(){
  const base = 36; // C2
  const keys = [];
  for(let i=0;i<13;i++) keys.push(base+i);
  const kbd = $("kbd");
  kbd.innerHTML = "";
  keys.forEach(m=>{
    const div=document.createElement("div");
    div.className="key";
    div.textContent = NOTE_NAMES[m%12];
    div.dataset.midi = String(m);
    div.onclick=()=>{
      STATE.selectedMidi = m;
      updateSelectedNoteBadge();
      previewBass(m);
      highlightKeyboard();
    };
    kbd.appendChild(div);
  });
  highlightKeyboard();
}
function highlightKeyboard(){
  document.querySelectorAll(".key").forEach(k=>{
    const m=parseInt(k.dataset.midi,10);
    k.classList.toggle("active", m===STATE.selectedMidi);
  });
}
function updateSelectedNoteBadge(){
  $("selNoteBadge").textContent = midiToName(STATE.selectedMidi + STATE.transpose);
  highlightKeyboard();
}

// ---- Seed Layer UI ----
function renderSeedLayersUI(){
  const box = $("seedLayers");
  box.innerHTML = "";
  const active = STATE.activeLayerId;

  STATE.seedLayers.forEach(layer=>{
    const row = document.createElement("div");
    row.style.border = "1px solid var(--line)";
    row.style.borderRadius = "10px";
    row.style.padding = "8px";
    row.style.margin = "8px 0";
    row.style.background = "rgba(10,15,28,.6)";

    row.innerHTML = `
      <div class="row2">
        <div class="kv">
          <button class="pill ${layer.id===active?'active':''}" data-act="${layer.id}">Active ${layer.id}</button>
          <label class="tiny">enabled <input type="checkbox" data-en="${layer.id}" ${layer.enabled?'checked':''}></label>
        </div>
        <label class="tiny">mode
          <select data-mode="${layer.id}">
            <option value="dominant" ${layer.mode==="dominant"?"selected":""}>dominant</option>
            <option value="add" ${layer.mode==="add"?"selected":""}>add</option>
            <option value="xor" ${layer.mode==="xor"?"selected":""}>xor</option>
          </select>
        </label>
      </div>

      <label>seed <input type="text" data-seed="${layer.id}" value="${layer.seedStr}"></label>
      <div class="kv">
        <label class="tiny">offset <input type="number" data-off="${layer.id}" value="${layer.offset}" style="width:120px"></label>
        <label class="tiny">weight <input type="range" min="0" max="1" step="0.01" data-w="${layer.id}" value="${layer.weight}"></label>
        <span class="badge">${layer.weight.toFixed(2)}</span>
      </div>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      STATE.activeLayerId = b.dataset.act;
      renderSeedLayersUI();
    };
  });
  box.querySelectorAll("[data-en]").forEach(cb=>{
    cb.onchange=()=>{
      const id = cb.dataset.en;
      const L = STATE.seedLayers.find(x=>x.id===id);
      L.enabled = cb.checked;
      if (id==="A") $("seed").value = L.seedStr;
      regenArrangementFromSeedStack();
    };
  });
  box.querySelectorAll("[data-seed]").forEach(inp=>{
    inp.oninput=()=>{
      const id = inp.dataset.seed;
      const L = STATE.seedLayers.find(x=>x.id===id);
      L.seedStr = inp.value;
      if (id==="A") $("seed").value = L.seedStr;
      regenArrangementFromSeedStack();
    };
  });
  box.querySelectorAll("[data-off]").forEach(inp=>{
    inp.oninput=()=>{
      const id = inp.dataset.off;
      const L = STATE.seedLayers.find(x=>x.id===id);
      L.offset = parseInt(inp.value||"0",10);
      regenArrangementFromSeedStack();
    };
  });
  box.querySelectorAll("[data-mode]").forEach(sel=>{
    sel.onchange=()=>{
      const id = sel.dataset.mode;
      const L = STATE.seedLayers.find(x=>x.id===id);
      L.mode = sel.value;
      regenArrangementFromSeedStack();
    };
  });
  box.querySelectorAll("[data-w]").forEach(r=>{
    r.oninput=()=>{
      const id = r.dataset.w;
      const L = STATE.seedLayers.find(x=>x.id===id);
      L.weight = parseFloat(r.value);
      renderSeedLayersUI();
      regenArrangementFromSeedStack();
    };
  });
}

// ---- Humanize / Swing ----
function stepDurationSec(){ return 240/(STATE.bpm * STATE.stepsPerBar); }
function swingOffset(stepIdx){
  const d = stepDurationSec();
  return (stepIdx % 2 === 1) ? (STATE.swing * d * 0.5) : 0;
}
function eventJitterSec(trackKey, bar, step){
  const amt = STATE.humanize;
  if (amt<=0) return 0;
  const seed = hashSeed(`${activeSeedSignature()}|jit|${trackKey}|b${bar}|s${step}|style:${STATE.style}|steps:${STATE.stepsPerBar}`);
  const rng = new RNG(seed);
  const x = (rng.nextFloat()*2-1);
  const maxJ = stepDurationSec() * 0.08 * amt;
  return x * maxJ;
}

// ---- Mutator base (bar-level) ----
function computeBarBassParams(barIndex){
  const bars = Math.max(1, STATE.loopBars);
  const t = (bars<=1) ? 0 : (barIndex/(bars-1));
  const I = STATE.mutIntensity;

  let cutoff = STATE.cutoff;
  let res = STATE.res;
  let drive = STATE.drive;
  let wobbleAmt = STATE.wobbleAmt;
  let reverb = STATE.reverb;

  if (STATE.mutator==="buildup"){
    cutoff = cutoff + (600 + cutoff*0.18) * I * t;
    wobbleAmt = clamp(wobbleAmt + 0.18*I*t, 0, 1);
    reverb = clamp(reverb + 0.06*I*t, 0, 0.55);
  } else if (STATE.mutator==="breakdown"){
    const dip = Math.sin(Math.PI*t);
    cutoff = cutoff * (1 - 0.35*I*dip) - 120*I*dip;
    reverb = clamp(reverb + 0.14*I*dip, 0, 0.55);
    wobbleAmt = clamp(wobbleAmt * (1 - 0.20*I*dip), 0, 1);
  } else if (STATE.mutator==="acidLift"){
    res = clamp(res + 0.18*I*t, 0.1, 0.95);
    drive = clamp(drive + 0.22*I*t, 0, 1);
    cutoff = cutoff + 280*I*t;
  }

  cutoff = clamp(cutoff, 60, 4000);
  return {cutoff, res, drive, wobbleAmt, reverb};
}

// ---- Auto-Lane mapping (step-level) ----
function applyLaneForStep(barIdx, stepIdx, t){
  if (!STATE.lanesByBar) return;

  const L = STATE.lanesByBar[barIdx];
  if (!L) return;

  const lc = L.cutoff[stepIdx], lr=L.res[stepIdx], lw=L.wobble[stepIdx], ld=L.drive[stepIdx], lv=L.reverb[stepIdx];
  const base = computeBarBassParams(barIdx);

  const cut = clamp(base.cutoff * (0.70 + 1.60*lc), 60, 4000);
  const res = clamp(base.res + (lr-0.5)*0.22, 0.1, 0.95);
  const wob = clamp(base.wobbleAmt + (lw-0.5)*0.22, 0, 1);
  const drv = clamp(base.drive + (ld-0.5)*0.25, 0, 1);
  const rev = clamp(base.reverb + (lv-0.5)*0.18, 0, 0.55);

  STATE._dyn = {cutoff:cut, res, wobbleAmt:wob, drive:drv, reverb:rev};
}
function getParam(name){
  return (STATE._dyn && (name in STATE._dyn)) ? STATE._dyn[name] : STATE[name];
}

// ---- Beat-synced Delay ----
function delayTimeFromSync(){
  if (STATE.delaySync==="free") return null;
  const bpm = STATE.bpm;
  const map = {"1/8":0.5, "1/16":0.25, "1/32":0.125};
  const beats = map[STATE.delaySync] ?? 0.25;
  return (60/bpm) * beats;
}

// ---- Audio engine ----
let audioCtx=null;
let master=null;
let NOISE_BUF=null;

function makeWaveshaper(ctx, amount){
  const ws = ctx.createWaveShaper();
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 2 + amount*28;
  for (let i=0;i<n;i++){
    const x = (i/(n-1))*2 - 1;
    curve[i] = Math.tanh(k*x) / Math.tanh(k);
  }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}
function noiseBufferSeeded(ctx, seedU32){
  const rng = new RNG(seedU32>>>0);
  const length = ctx.sampleRate * 1.0;
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0;i<length;i++){
    const r = rng.nextFloat()*2-1;
    data[i] = r * 0.9;
  }
  return buf;
}
function createSimpleReverb(ctx){
  const input = ctx.createGain();
  const wet = ctx.createGain(); wet.gain.value = STATE.reverb;
  const dry = ctx.createGain(); dry.gain.value = 1.0 - STATE.reverb;
  const out = ctx.createGain();

  function comb(delayTime, fbGain){
    const d = ctx.createDelay(0.2);
    d.delayTime.value = delayTime;
    const fb = ctx.createGain();
    fb.gain.value = fbGain;
    const lp = ctx.createBiquadFilter();
    lp.type="lowpass"; lp.frequency.value=5500; lp.Q.value=0.7;

    input.connect(d);
    d.connect(lp);
    lp.connect(fb);
    fb.connect(d);
    lp.connect(wet);
  }
  comb(0.0297, 0.78);
  comb(0.0371, 0.76);
  comb(0.0411, 0.74);
  comb(0.0437, 0.73);

  function allpass(delayTime, g){
    const d = ctx.createDelay(0.05);
    d.delayTime.value = delayTime;
    const fb = ctx.createGain(); fb.gain.value = g;
    const sum = ctx.createGain();
    const inv = ctx.createGain(); inv.gain.value = -g;

    input.connect(sum);
    input.connect(d);
    d.connect(fb);
    fb.connect(d);
    d.connect(inv);
    inv.connect(sum);
    sum.connect(wet);
  }
  allpass(0.005, 0.65);
  allpass(0.0017, 0.60);

  input.connect(dry);
  dry.connect(out);
  wet.connect(out);
  return {input, out, wet, dry};
}
function buildGraph(ctx){
  const kickBus = ctx.createGain();
  const snareBus = ctx.createGain();
  const hatBus = ctx.createGain();
  const bassBus = ctx.createGain();

  kickBus.gain.value = STATE.vol.kick;
  snareBus.gain.value = STATE.vol.snare;
  hatBus.gain.value = STATE.vol.hat;
  bassBus.gain.value = STATE.vol.bass;

  const sum = ctx.createGain();
  kickBus.connect(sum);
  snareBus.connect(sum);
  hatBus.connect(sum);
  bassBus.connect(sum);

  const low = ctx.createBiquadFilter(); low.type="lowshelf"; low.frequency.value=110; low.gain.value = STATE.eq.lowDb;
  const mid = ctx.createBiquadFilter(); mid.type="peaking"; mid.frequency.value=1000; mid.Q.value=0.9; mid.gain.value = STATE.eq.midDb;
  const high = ctx.createBiquadFilter(); high.type="highshelf"; high.frequency.value=6500; high.gain.value = STATE.eq.highDb;

  const hpf = ctx.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=28; hpf.Q.value=0.707;

  const trim = ctx.createGain(); trim.gain.value = 0.9;
  const duck = ctx.createGain(); duck.gain.value = 1.0;
  const limiter = makeWaveshaper(ctx, 0.35);

  const rev = createSimpleReverb(ctx);

  sum.connect(low); low.connect(mid); mid.connect(high); high.connect(hpf);
  hpf.connect(rev.input);
  hpf.connect(trim);
  rev.out.connect(trim);

  trim.connect(duck);
  duck.connect(limiter);
  limiter.connect(ctx.destination);

  return {kickBus, snareBus, hatBus, bassBus, low, mid, high, trim, duck, limiter, rev};
}

// ---- Drums ----
function trigKick(ctx, out, t, vel){
  const osc = ctx.createOscillator(); osc.type="sine";
  const gain = ctx.createGain();

  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(48, t+0.08);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.9*vel), t+0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t+0.26);

  osc.connect(gain);

  const n = ctx.createBufferSource(); n.buffer = NOISE_BUF;
  const click = ctx.createBiquadFilter(); click.type="highpass"; click.frequency.value=1000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.08*vel, t+0.001);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.018);
  n.connect(click); click.connect(ng);

  const sum = ctx.createGain();
  gain.connect(sum); ng.connect(sum);
  sum.connect(out);

  osc.start(t); osc.stop(t+0.5);
  n.start(t); n.stop(t+0.06);
}
function trigSnare(ctx, out, t, vel){
  const n = ctx.createBufferSource(); n.buffer = NOISE_BUF;
  const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=900; hp.Q.value=0.7;
  const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1900; bp.Q.value=0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.55*vel, t+0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.20);
  n.connect(hp); hp.connect(bp); bp.connect(ng);

  const osc = ctx.createOscillator(); osc.type="triangle"; osc.frequency.setValueAtTime(190, t);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.20*vel, t+0.002);
  og.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
  osc.connect(og);

  const sum=ctx.createGain();
  ng.connect(sum); og.connect(sum);
  sum.connect(out);

  n.start(t); n.stop(t+0.35);
  osc.start(t); osc.stop(t+0.25);
}
function trigHat(ctx, out, t, vel){
  const n = ctx.createBufferSource(); n.buffer = NOISE_BUF;
  const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=6500; hp.Q.value=0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.22*vel, t+0.001);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
  n.connect(hp); hp.connect(ng); ng.connect(out);
  n.start(t); n.stop(t+0.08);
}

// ---- Bass ----
function getWobbleRateHz(){
  const bpm = STATE.bpm;
  const sync = STATE.wobbleSync;
  if (sync==="free") return STATE.wobbleHz;
  const map = {"1/2":2, "1/4":1, "1/8":0.5, "1/16":0.25, "1/32":0.125};
  const beatsPerCycle = map[sync] ?? 0.25;
  const period = (60/bpm) * beatsPerCycle;
  return 1/period;
}
function createBassVoice(ctx, dest){
  const osc1 = ctx.createOscillator(); osc1.type="sawtooth";
  const osc2 = ctx.createOscillator(); osc2.type="square";
  const sub  = ctx.createOscillator(); sub.type="sine";

  const g1 = ctx.createGain(); const g2 = ctx.createGain(); const gs = ctx.createGain();
  g1.gain.value = 0.70;
  g2.gain.value = 0.22;
  gs.gain.value = STATE.subMix;

  osc1.connect(g1); osc2.connect(g2); sub.connect(gs);
  const pre = ctx.createGain();
  g1.connect(pre); g2.connect(pre); gs.connect(pre);

  const preDrive = makeWaveshaper(ctx, Math.min(0.85, getParam("drive")*0.85));
  pre.connect(preDrive);

  let lp1=null, lp2=null, lpSingle=null;
  if (STATE.filterModel==="cascade24"){
    lp1 = ctx.createBiquadFilter(); lp1.type="lowpass";
    lp2 = ctx.createBiquadFilter(); lp2.type="lowpass";
    preDrive.connect(lp1); lp1.connect(lp2);
  } else {
    lpSingle = ctx.createBiquadFilter(); lpSingle.type="lowpass";
    preDrive.connect(lpSingle);
  }

  const lfo = ctx.createOscillator();
  lfo.type = (STATE.lfoWave||"sine");
  const lfoLP = ctx.createBiquadFilter(); lfoLP.type="lowpass";
  lfoLP.frequency.value = Math.max(0.5, Math.min(50, (STATE.lfoFilterHz||20)));
  const lfoGainF = ctx.createGain(); lfoGainF.gain.value = 0;
  const lfoGainA = ctx.createGain(); lfoGainA.gain.value = 0;
  const lfoTarget = (STATE.lfoTarget||"filter");
  const wantFilter = (lfoTarget !== "amp");
  const wantAmp    = (lfoTarget !== "filter");
  lfo.connect(lfoLP);
  lfoLP.connect(lfoGainF);
  lfoLP.connect(lfoGainA);
  if (wantFilter){
    if (lpSingle){ lfoGainF.connect(lpSingle.frequency); }
    else { lfoGainF.connect(lp1.frequency); lfoGainF.connect(lp2.frequency); }
  }
const driveWS = makeWaveshaper(ctx, getParam("drive"));
  const driveTrim = ctx.createGain(); driveTrim.gain.value = 0.70 - getParam("drive")*0.22;

  const chorusMix = ctx.createGain(); chorusMix.gain.value = STATE.chorus;
  const dry = ctx.createGain(); dry.gain.value = 1.0 - STATE.chorus;

  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const chDelayL = ctx.createDelay(0.05);
  const chDelayR = ctx.createDelay(0.05);
  chDelayL.delayTime.value = 0.015;
  chDelayR.delayTime.value = 0.019;

  const chLfo = ctx.createOscillator(); chLfo.type="sine"; chLfo.frequency.value = 0.35;
  const chLfoG = ctx.createGain(); chLfoG.gain.value = 0.004;
  const chLfoG2 = ctx.createGain(); chLfoG2.gain.value = -0.004;
  chLfo.connect(chLfoG); chLfo.connect(chLfoG2);
  chLfoG.connect(chDelayL.delayTime);
  chLfoG2.connect(chDelayR.delayTime);

  const delay = ctx.createDelay(1.0);
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const delayMix = ctx.createGain(); delayMix.gain.value = STATE.delay;
  const delayDry = ctx.createGain(); delayDry.gain.value = 1.0 - STATE.delay;
  const delayLP = ctx.createBiquadFilter(); delayLP.type="lowpass"; delayLP.frequency.value=2500; delayLP.Q.value=0.7;

  const amp = ctx.createGain(); amp.gain.value = 0.0001;

  
  if (wantAmp){ lfoGainA.connect(amp.gain); }
const filterOut = ctx.createGain();
  if (lpSingle){ lpSingle.connect(filterOut); } else { lp2.connect(filterOut); }
  filterOut.connect(driveWS);
  driveWS.connect(driveTrim);

  driveTrim.connect(dry);
  driveTrim.connect(split);
  split.connect(chDelayL,0); split.connect(chDelayR,0);
  chDelayL.connect(merge,0,0); chDelayR.connect(merge,0,1);
  merge.connect(chorusMix);

  const post = ctx.createGain();
  dry.connect(post);
  chorusMix.connect(post);
  post.connect(amp);

  amp.connect(delayDry);
  amp.connect(delay);

  delay.connect(delayLP);
  delayLP.connect(fb);
  fb.connect(delay);
  delayLP.connect(delayMix);

  const out = ctx.createGain();
  delayDry.connect(out);
  delayMix.connect(out);
  out.connect(dest);

  const dts = delayTimeFromSync();
  if (dts !== null){
    delay.delayTime.value = clamp(dts, 0.02, 0.95);
  } else {
    delay.delayTime.value = 0.28;
  }

  const start = ctx.currentTime + 0.01;
  osc1.start(start); osc2.start(start); sub.start(start);
  lfo.start(start); chLfo.start(start);

  function setParams(t){
    const tt = t ?? ctx.currentTime;
    const res = getParam("res");
    const cutoff = getParam("cutoff");
    const drive = getParam("drive");
    const q = 0.5 + res*7.5;

    if (lpSingle){
      lpSingle.Q.setValueAtTime(q, tt);
      lpSingle.frequency.setValueAtTime(cutoff, tt);
    } else {
      lp1.Q.setValueAtTime(Math.max(0.6, q*0.55), tt);
      lp2.Q.setValueAtTime(Math.max(0.6, q*0.55), tt);
      lp1.frequency.setValueAtTime(cutoff, tt);
      lp2.frequency.setValueAtTime(cutoff, tt);
    }

    driveWS.curve = makeWaveshaper(ctx, drive).curve;
    driveTrim.gain.setValueAtTime(0.70 - drive*0.22, tt);

    chorusMix.gain.setValueAtTime(STATE.chorus, tt);
    dry.gain.setValueAtTime(1.0-STATE.chorus, tt);
    delayMix.gain.setValueAtTime(STATE.delay, tt);
    delayDry.gain.setValueAtTime(1.0-STATE.delay, tt);
    gs.gain.setValueAtTime(STATE.subMix, tt);

    const dts = delayTimeFromSync();
    if (dts !== null) delay.delayTime.setValueAtTime(clamp(dts,0.02,0.95), tt);
  }

  let prevFreq = null;
  function noteOn(midi, t, accent, slide){
    setParams(t);
    const freq = midiToHz(midi);
    const glide = Math.max(0, STATE.glideMs)/1000;

    if (slide && prevFreq && glide>0){
      osc1.frequency.setValueAtTime(prevFreq, t);
      osc1.frequency.linearRampToValueAtTime(freq, t+glide);
      osc2.frequency.setValueAtTime(prevFreq, t);
      osc2.frequency.linearRampToValueAtTime(freq, t+glide);
      sub.frequency.setValueAtTime(prevFreq/2, t);
      sub.frequency.linearRampToValueAtTime(freq/2, t+glide);
    } else {
      osc1.frequency.setValueAtTime(freq, t);
      osc2.frequency.setValueAtTime(freq, t);
      sub.frequency.setValueAtTime(freq/2, t);
    }
    prevFreq = freq;

    const peak = (accent?1.0:0.82);
    amp.gain.cancelScheduledValues(t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t+0.002);
    amp.gain.exponentialRampToValueAtTime(0.55, t+0.102);

    const wobAmt = getParam("wobbleAmt");
    const base = getParam("cutoff");
    const accentBoost = (STATE.filterModel==="cascade24") ? 320 : 200;

    const envAmt = 260 + wobAmt*960 + (accent?accentBoost:0);
    const cMin = 70 + (1-wobAmt)*120;
    const cMax = 2200 + wobAmt*2800;

    const setFreqAt = (node)=> {
      node.frequency.cancelScheduledValues(t);
      node.frequency.setValueAtTime(Math.min(cMax, Math.max(cMin, base + envAmt)), t);
      node.frequency.exponentialRampToValueAtTime(Math.min(cMax, Math.max(cMin, base)), t+0.12);
    };
    if (lpSingle){ setFreqAt(lpSingle); }
    else { setFreqAt(lp1); setFreqAt(lp2); }

    const lfoDepthF = wobAmt*(base*0.8 + 240);
    const lfoDepthA = wobAmt*0.22;
    lfoGainF.gain.cancelScheduledValues(t);
    lfoGainF.gain.setValueAtTime(wantFilter ? lfoDepthF : 0, t);
    lfoGainA.gain.cancelScheduledValues(t);
    lfoGainA.gain.setValueAtTime(wantAmp ? lfoDepthA : 0, t);
    lfoLP.frequency.setValueAtTime(Math.max(0.5, Math.min(50, (STATE.lfoFilterHz||20))), t);
    lfo.frequency.setValueAtTime(getWobbleRateHz(), t);
  }

  function noteOff(t){
    amp.gain.cancelScheduledValues(t);
    amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t+0.08);
  }

  function stop(t){
    const tt = t ?? (ctx.currentTime+0.1);
    osc1.stop(tt); osc2.stop(tt); sub.stop(tt);
    lfo.stop(tt); chLfo.stop(tt);
  }

  return {noteOn, noteOff, stop,
    _setLfoFilter:(hz)=>{ try{ lfoLP.frequency.setTargetAtTime(Math.max(0.5, Math.min(50, hz||20)), ctx.currentTime, 0.03); }catch(e){} }
  };
}

// ---- Transport scheduling ----
let SCHED = {timer:null, lookaheadMs:25, aheadSec:0.15, bassVoice:null};

function ensureAudio(){
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({latencyHint:"interactive"});
  const noiseSeed = hashSeed(activeSeedSignature()+"|noise");
  NOISE_BUF = noiseBufferSeeded(audioCtx, noiseSeed);
  master = buildGraph(audioCtx);
  master.rev.wet.gain.value = STATE.reverb;
  master.rev.dry.gain.value = 1.0 - STATE.reverb;
  SCHED.bassVoice = createBassVoice(audioCtx, master.bassBus);
  log(`[T+0ms] AUDIO INIT { sampleRate:${audioCtx.sampleRate} }`);
}

function unlockAudioOnGesture(){
  // Some browsers require a one-time gesture to unlock audio.
  if (!audioCtx) return;
  if (audioCtx.state === "suspended"){
    audioCtx.resume().catch(()=>{});
  }
  window.removeEventListener("pointerdown", unlockAudioOnGesture, true);
  window.removeEventListener("touchstart", unlockAudioOnGesture, true);
  window.removeEventListener("mousedown", unlockAudioOnGesture, true);
}
window.addEventListener("pointerdown", unlockAudioOnGesture, true);
window.addEventListener("touchstart", unlockAudioOnGesture, true);
window.addEventListener("mousedown", unlockAudioOnGesture, true);

function rebuildBassVoiceIfNeeded(){
  if(!audioCtx || !master) return;
  try{ SCHED.bassVoice.stop(audioCtx.currentTime+0.02); }catch(e){}
  SCHED.bassVoice = createBassVoice(audioCtx, master.bassBus);
  log(`[T+0ms] BASS_REBUILD { filterModel:${STATE.filterModel} }`);
}
function totalStepsInLoop(){ return STATE.loopBars * STATE.stepsPerBar; }

function scheduleSidechain(t){
  const pump = STATE.sidechainPump;
  if (!master || !master.duck || pump<=0) return;
  master.duck.gain.cancelScheduledValues(t);
  master.duck.gain.setValueAtTime(1.0, t);
  master.duck.gain.linearRampToValueAtTime(1.0 - 0.65*pump, t + 0.012);
  master.duck.gain.exponentialRampToValueAtTime(1.0, t + (0.18 + 0.18*pump));
}

function scheduleGlobalStep(ctx, t, globalStep){
  const steps = STATE.stepsPerBar;
  const bars = STATE.loopBars;
  const barIdx = Math.floor(globalStep / steps) % bars;
  const stepIdx = globalStep % steps;

  if (stepIdx===0) STATE._dyn = computeBarBassParams(barIdx);
  applyLaneForStep(barIdx, stepIdx, t);

  const dynRev = getParam("reverb");
  if (master && dynRev!=null){
    master.rev.wet.gain.setValueAtTime(dynRev, t);
    master.rev.dry.gain.setValueAtTime(1.0 - dynRev, t);
  }

  const p = STATE.renderPatterns[barIdx] || STATE.patterns[barIdx];
  if (!p) return;

  const s = t + swingOffset(stepIdx);

  const jK = eventJitterSec("kick", barIdx, stepIdx);
  const jS = eventJitterSec("snare", barIdx, stepIdx);
  const jH = eventJitterSec("hat", barIdx, stepIdx);
  const jB = eventJitterSec("bass", barIdx, stepIdx);

  if (!STATE.mutes.kick && p.kick.hit[stepIdx]){
    trigKick(ctx, master.kickBus, s + jK, p.kick.vel[stepIdx]);
    scheduleSidechain(s + jK);
  }
  if (!STATE.mutes.snare && p.snare.hit[stepIdx]) trigSnare(ctx, master.snareBus, s + jS, p.snare.vel[stepIdx]);
  if (!STATE.mutes.hat && p.hat.hit[stepIdx]) trigHat(ctx, master.hatBus, s + jH, p.hat.vel[stepIdx]);

  const ev = p.bass[stepIdx];
  const gate = stepDurationSec() * 0.92;
  if (!STATE.mutes.bass && ev){
    const midi = ev.midi + STATE.transpose;
    SCHED.bassVoice.noteOn(midi, s + jB, ev.accent, ev.slide);
    SCHED.bassVoice.noteOff(s + jB + gate);
  }

  $("pos").textContent = `bar ${barIdx+1}/${bars} • step ${stepIdx+1}`;
}

function schedulerTick(){
  if (!STATE.playing || !audioCtx) return;
  const now = audioCtx.currentTime;
  while (STATE.nextTime < now + SCHED.aheadSec){
    scheduleGlobalStep(audioCtx, STATE.nextTime, STATE.globalStep);
    STATE.nextTime += stepDurationSec();
    STATE.globalStep = (STATE.globalStep + 1) % totalStepsInLoop();
  }
}
async function play(){
  ensureAudio();
  // Ensure audio actually runs (browser may start AudioContext in "suspended")
  if (audioCtx && audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (e) { console.warn("AudioContext resume failed", e); }
  }
  if (!STATE.patterns.length) regenArrangementFromSeedStack();
  STATE.playing = true;
  STATE.globalStep = 0;
  STATE.nextTime = audioCtx.currentTime + 0.06;
  $("status").textContent = "playing";
  if (SCHED.timer) clearInterval(SCHED.timer);
  SCHED.timer = setInterval(schedulerTick, SCHED.lookaheadMs);
  log(`[T+0ms] PLAY { bpm:${STATE.bpm}, bars:${STATE.loopBars}, steps:${STATE.stepsPerBar}, style:${STATE.style} }`);
}
function stop(){
  STATE.playing = false;
  $("status").textContent = "stopped";
  if (SCHED.timer){ clearInterval(SCHED.timer); SCHED.timer=null; }
  $("pos").textContent = `bar ${STATE.editBar+1}/${STATE.loopBars} • step 1`;
  try{ if (SCHED.bassVoice && audioCtx) SCHED.bassVoice.noteOff(audioCtx.currentTime); }catch(e){}
  log(`[T+0ms] STOP`);
}

// ---- Preview ----
async function previewBass(midi){
  ensureAudio();
  if (audioCtx && audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (e) { console.warn("AudioContext resume failed", e); }
  }
  const t = audioCtx.currentTime + 0.01;
  STATE._dyn = computeBarBassParams(0);
  const m = midi + STATE.transpose;
  SCHED.bassVoice.noteOn(m, t, true, false);
  SCHED.bassVoice.noteOff(t + 0.18);
}

// ---- UI Sync / Bindings stubs (real ones are in PART 2) ----
function setText(id, v){ $(id).textContent = v; }
function syncUIFromState(){ /* defined in PART 2 */ }
function updateMuteButtons(){ /* defined in PART 2 */ }
function syncMixToGraph(){ /* defined in PART 2 */ }
function syncEQToGraph(){ /* defined in PART 2 */ }
function bindUI(){ /* defined in PART 2 */ }

// ---- WAV export via OfflineAudioContext ----
// (continues in PART 2/2)
<!-- =========================
PART 2/2 — ab hier direkt an PART 1 anhängen
WICHTIG: Falls du in PART 1 zweimal
  let audioCtx=null; let master=null; let NOISE_BUF=null;
und/oder ähnliche Doppel-`let`-Deklarationen siehst:
➡️ LASS NUR DIE ERSTE VERSION STEHEN, die zweite löschen,
sonst gibt’s einen SyntaxError (redeclaration).
========================= -->

<script>
// ---- WAV export via OfflineAudioContext ----

function encodeWav16Stereo(audioBuffer){
  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;

  const left = audioBuffer.getChannelData(0);
  const right = (numCh>1) ? audioBuffer.getChannelData(1) : left;

  // 44-byte header + 16-bit interleaved samples
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = len * blockAlign;

  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  function writeStr(off, s){
    for (let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i));
  }
  function writeU32(off, v){ view.setUint32(off, v, true); }
  function writeU16(off, v){ view.setUint16(off, v, true); }

  writeStr(0,"RIFF");
  writeU32(4, 36 + dataSize);
  writeStr(8,"WAVE");
  writeStr(12,"fmt ");
  writeU32(16, 16);
  writeU16(20, 1); // PCM
  writeU16(22, numCh);
  writeU32(24, sr);
  writeU32(28, byteRate);
  writeU16(32, blockAlign);
  writeU16(34, 16);
  writeStr(36,"data");
  writeU32(40, dataSize);

  let o = 44;
  for (let i=0;i<len;i++){
    const l = clamp(left[i], -1, 1);
    const r = clamp(right[i], -1, 1);
    view.setInt16(o, (l<0 ? l*32768 : l*32767)|0, true); o+=2;
    if (numCh>1){
      view.setInt16(o, (r<0 ? r*32768 : r*32767)|0, true); o+=2;
    }
  }
  return new Blob([buf], {type:"audio/wav"});
}

function downloadBlob(blob, filename){
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 8000);
}

function makeOfflineCtx(durationSec, sampleRate=44100){
  const len = Math.ceil(durationSec * sampleRate);
  return new OfflineAudioContext({numberOfChannels:2, length:len, sampleRate});
}

function offlineBuildNoiseBuf(ctx){
  const noiseSeed = hashSeed(activeSeedSignature()+"|noise");
  return noiseBufferSeeded(ctx, noiseSeed);
}

function buildGraphOffline(ctx){
  // clone of buildGraph(ctx) but safe in offline
  const kickBus = ctx.createGain();
  const snareBus = ctx.createGain();
  const hatBus = ctx.createGain();
  const bassBus = ctx.createGain();

  kickBus.gain.value = STATE.vol.kick;
  snareBus.gain.value = STATE.vol.snare;
  hatBus.gain.value = STATE.vol.hat;
  bassBus.gain.value = STATE.vol.bass;

  const sum = ctx.createGain();
  kickBus.connect(sum);
  snareBus.connect(sum);
  hatBus.connect(sum);
  bassBus.connect(sum);

  const low = ctx.createBiquadFilter(); low.type="lowshelf"; low.frequency.value=110; low.gain.value = STATE.eq.lowDb;
  const mid = ctx.createBiquadFilter(); mid.type="peaking"; mid.frequency.value=1000; mid.Q.value=0.9; mid.gain.value = STATE.eq.midDb;
  const high = ctx.createBiquadFilter(); high.type="highshelf"; high.frequency.value=6500; high.gain.value = STATE.eq.highDb;

  const hpf = ctx.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=28; hpf.Q.value=0.707;

  const trim = ctx.createGain(); trim.gain.value = 0.9;
  const duck = ctx.createGain(); duck.gain.value = 1.0;
  const limiter = makeWaveshaper(ctx, 0.35);

  const rev = createSimpleReverb(ctx);
  rev.wet.gain.value = getParam("reverb");
  rev.dry.gain.value = 1.0 - getParam("reverb");

  sum.connect(low); low.connect(mid); mid.connect(high); high.connect(hpf);

  hpf.connect(rev.input);
  hpf.connect(trim);
  rev.out.connect(trim);

  trim.connect(duck);
  duck.connect(limiter);
  limiter.connect(ctx.destination);

  return {kickBus, snareBus, hatBus, bassBus, low, mid, high, trim, duck, limiter, rev};
}

function offlineScheduleSidechain(master, t){
  const pump = STATE.sidechainPump;
  if (!master || !master.duck || pump<=0) return;
  master.duck.gain.cancelScheduledValues(t);
  master.duck.gain.setValueAtTime(1.0, t);
  master.duck.gain.linearRampToValueAtTime(1.0 - 0.65*pump, t + 0.012);
  master.duck.gain.exponentialRampToValueAtTime(1.0, t + (0.18 + 0.18*pump));
}

function offlineRender({bars=8, sampleRate=44100, stem=null}){
  // stem: null=full mix, or "kick"|"snare"|"hat"|"bass" (solo)
  // NOTE: uses STATE.renderPatterns already derived (auto-fills/lanes)
  const steps = STATE.stepsPerBar;
  const dur = bars * steps * stepDurationSec();
  const tail = 2.0; // reverb/delay tail
  const ctx = makeOfflineCtx(dur + tail, sampleRate);
  const master = buildGraphOffline(ctx);
  const NOISE = offlineBuildNoiseBuf(ctx);

  // apply solo stem via mutes
  const solo = (stem!==null);
  const muteKick  = solo ? (stem!=="kick") : STATE.mutes.kick;
  const muteSnare = solo ? (stem!=="snare") : STATE.mutes.snare;
  const muteHat   = solo ? (stem!=="hat") : STATE.mutes.hat;
  const muteBass  = solo ? (stem!=="bass") : STATE.mutes.bass;

  // create bass voice in offline ctx
  // we need getParam() to work per-step; it uses STATE._dyn and lanes; OK.
  const bassVoice = createBassVoice(ctx, master.bassBus);

  // helper scheduling like live
  function scheduleStep(t, globalStep){
    const barsLoop = STATE.loopBars;
    const barIdx = Math.floor(globalStep / steps) % barsLoop;
    const stepIdx = globalStep % steps;

    if (stepIdx===0) STATE._dyn = computeBarBassParams(barIdx);
    applyLaneForStep(barIdx, stepIdx, t);

    const dynRev = getParam("reverb");
    master.rev.wet.gain.setValueAtTime(dynRev, t);
    master.rev.dry.gain.setValueAtTime(1.0 - dynRev, t);

    const pat = STATE.renderPatterns[barIdx] || STATE.patterns[barIdx];
    if (!pat) return;

    const s = t + swingOffset(stepIdx);

    const jK = eventJitterSec("kick", barIdx, stepIdx);
    const jS = eventJitterSec("snare", barIdx, stepIdx);
    const jH = eventJitterSec("hat", barIdx, stepIdx);
    const jB = eventJitterSec("bass", barIdx, stepIdx);

    // local noise usage: patch trig functions to use NOISE
    function trigKickO(t0, vel){
      const osc = ctx.createOscillator(); osc.type="sine";
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(130, t0);
      osc.frequency.exponentialRampToValueAtTime(48, t0+0.08);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.9*vel), t0+0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0+0.26);
      osc.connect(gain);

      const n = ctx.createBufferSource(); n.buffer = NOISE;
      const click = ctx.createBiquadFilter(); click.type="highpass"; click.frequency.value=1000;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.08*vel, t0+0.001);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0+0.018);
      n.connect(click); click.connect(ng);

      const sum = ctx.createGain();
      gain.connect(sum); ng.connect(sum);
      sum.connect(master.kickBus);

      osc.start(t0); osc.stop(t0+0.5);
      n.start(t0); n.stop(t0+0.06);
    }
    function trigSnareO(t0, vel){
      const n = ctx.createBufferSource(); n.buffer = NOISE;
      const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=900; hp.Q.value=0.7;
      const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1900; bp.Q.value=0.7;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.55*vel, t0+0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0+0.20);
      n.connect(hp); hp.connect(bp); bp.connect(ng);

      const osc = ctx.createOscillator(); osc.type="triangle"; osc.frequency.setValueAtTime(190, t0);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.20*vel, t0+0.002);
      og.gain.exponentialRampToValueAtTime(0.0001, t0+0.12);
      osc.connect(og);

      const sum=ctx.createGain();
      ng.connect(sum); og.connect(sum);
      sum.connect(master.snareBus);

      n.start(t0); n.stop(t0+0.35);
      osc.start(t0); osc.stop(t0+0.25);
    }
    function trigHatO(t0, vel){
      const n = ctx.createBufferSource(); n.buffer = NOISE;
      const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=6500; hp.Q.value=0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.22*vel, t0+0.001);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0+0.06);
      n.connect(hp); hp.connect(ng); ng.connect(master.hatBus);
      n.start(t0); n.stop(t0+0.08);
    }

    if (!muteKick && pat.kick.hit[stepIdx]){
      trigKickO(s + jK, pat.kick.vel[stepIdx]);
      offlineScheduleSidechain(master, s + jK);
    }
    if (!muteSnare && pat.snare.hit[stepIdx]) trigSnareO(s + jS, pat.snare.vel[stepIdx]);
    if (!muteHat && pat.hat.hit[stepIdx]) trigHatO(s + jH, pat.hat.vel[stepIdx]);

    const ev = pat.bass[stepIdx];
    const gate = stepDurationSec() * 0.92;
    if (!muteBass && ev){
      const midi = ev.midi + STATE.transpose;
      bassVoice.noteOn(midi, s + jB, ev.accent, ev.slide);
      bassVoice.noteOff(s + jB + gate);
    }
  }

  // schedule over render bars (play the loop repeated)
  const totalSteps = bars * steps;
  let t0 = 0.06;
  for (let gs=0; gs<totalSteps; gs++){
    scheduleStep(t0, gs);
    t0 += stepDurationSec();
  }
  // stop bass osc after tail
  try{ bassVoice.stop(dur + 0.6); }catch(e){}

  return ctx.startRendering();
}

function baseExportName(){
  const s = (STATE.style||"style").toUpperCase();
  const m = STATE.seedMode.toUpperCase();
  const seedSig = activeSeedSignature().replaceAll("|","_").replaceAll(";","_").replaceAll(":","").replaceAll("@","_");
  return `WobbleBox_${s}_${m}_${seedSig}`.slice(0, 160);
}

async function exportWavMix(){
  try{
    stop();
    ensureAudio();
    rebuildDerivedPlaybackData();

    const bars = parseInt($("exportBars").value,10);
    log(`[T+0ms] EXPORT_WAV_MIX { bars:${bars} }`);
    const buf = await offlineRender({bars, sampleRate:44100, stem:null});
    const wav = encodeWav16Stereo(buf);
    downloadBlob(wav, `${baseExportName()}_${bars}bars_mix.wav`);
    log(`[T+0ms] EXPORT_OK { mix }`);
  } catch(e){
    console.error(e);
    alert("Export Mix fehlgeschlagen. Sieh Console.");
  }
}

async function exportWavStems(){
  try{
    stop();
    ensureAudio();
    rebuildDerivedPlaybackData();

    const bars = parseInt($("exportBars").value,10);
    const stems = ["kick","snare","hat","bass"];
    log(`[T+0ms] EXPORT_WAV_STEMS { bars:${bars} }`);

    for (const s of stems){
      const buf = await offlineRender({bars, sampleRate:44100, stem:s});
      const wav = encodeWav16Stereo(buf);
      downloadBlob(wav, `${baseExportName()}_${bars}bars_${s}.wav`);
    }
    log(`[T+0ms] EXPORT_OK { stems }`);
  } catch(e){
    console.error(e);
    alert("Export Stems fehlgeschlagen. Sieh Console.");
  }
}

// ---- MIDI export (Type-0) ----
function writeVarLen(v){
  // variable-length quantity
  let bytes = [];
  let buffer = v & 0x7F;
  while ((v >>= 7) > 0){
    buffer <<= 8;
    buffer |= ((v & 0x7F) | 0x80);
  }
  while (true){
    bytes.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>= 8; else break;
  }
  return bytes;
}
function strBytes(s){ return Array.from(s).map(c=>c.charCodeAt(0)); }
function u16be(v){ return [(v>>8)&255, v&255]; }
function u32be(v){ return [(v>>24)&255, (v>>16)&255, (v>>8)&255, v&255]; }

function midiBuild(){
  rebuildDerivedPlaybackData();

  const ppq = 480;
  const steps = STATE.stepsPerBar;
  const bars = parseInt($("exportBars").value,10);
  const ticksPerBeat = ppq;
  const beatsPerBar = 4;
  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const stepTicks = Math.floor(ticksPerBar / steps);

  const tempo = Math.floor(60000000 / STATE.bpm);

  // track events (delta time, bytes)
  let evs = [];
  function push(delta, bytes){ evs.push({delta, bytes}); }

  // meta: tempo
  push(0, [0xFF,0x51,0x03, (tempo>>16)&255, (tempo>>8)&255, tempo&255]);

  // program for bass channel 0 (optional)
  push(0, [0xC0, 0x27]); // program 39-ish (synth bass) – ok for GM

  // iterate steps
  const totalSteps = bars * steps;
  let tick=0;
  let lastTick=0;

  // drum mapping (GM-ish)
  const DR_CH = 9; // ch10 (0-based 9)
  const BA_CH = 0;

  const KICK=36, SNARE=38, HAT=42;

  // Bass note tracking for slide handling
  let bassOn = null; // {note, offTick}
  function bassNoteOff(atTick){
    if (!bassOn) return;
    const dt = atTick - lastTick;
    push(dt, [0x80 | BA_CH, bassOn.note & 127, 0]);
    lastTick = atTick;
    bassOn = null;
  }
  function bassNoteOn(note, vel, atTick){
    const dt = atTick - lastTick;
    push(dt, [0x90 | BA_CH, note & 127, vel & 127]);
    lastTick = atTick;
    bassOn = {note};
  }

  for (let gs=0; gs<totalSteps; gs++){
    const barIdx = Math.floor(gs / steps) % STATE.loopBars;
    const stepIdx = gs % steps;
    const pat = STATE.renderPatterns[barIdx] || STATE.patterns[barIdx];
    const atTick = gs * stepTicks;

    // drums
    const doDrum = (note, vel)=>{
      const dt = atTick - lastTick;
      push(dt, [0x99, note, vel]); // note on ch10
      lastTick = atTick;
      // immediate off a bit later (use same tick+1)
      push(1, [0x89, note, 0]); // note off
      lastTick = atTick + 1;
    };

    if (pat && !STATE.mutes.kick && pat.kick.hit[stepIdx]){
      const v = Math.floor(clamp(pat.kick.vel[stepIdx],0,1)*110)+10;
      doDrum(KICK, v);
    }
    if (pat && !STATE.mutes.snare && pat.snare.hit[stepIdx]){
      const v = Math.floor(clamp(pat.snare.vel[stepIdx],0,1)*105)+10;
      doDrum(SNARE, v);
    }
    if (pat && !STATE.mutes.hat && pat.hat.hit[stepIdx]){
      const v = Math.floor(clamp(pat.hat.vel[stepIdx],0,1)*95)+10;
      doDrum(HAT, v);
    }

    // bass
    if (pat && !STATE.mutes.bass){
      const ev = pat.bass[stepIdx];
      if (ev){
        const note = clamp(ev.midi + STATE.transpose, 0, 127);
        const vel = ev.accent ? 110 : 88;

        // slide: keep previous note playing (no off on boundary)
        if (!ev.slide) bassNoteOff(atTick);
        bassNoteOn(note, vel, atTick);

        // default off at next step unless slide continues; we handle off at next boundary when slide false.
      } else {
        bassNoteOff(atTick);
      }
    }
    tick = atTick;
  }
  // close remaining bass at end
  bassNoteOff(totalSteps*stepTicks);

  // end of track
  const endTick = totalSteps*stepTicks + 10;
  const dtEnd = endTick - lastTick;
  push(dtEnd, [0xFF,0x2F,0x00]);

  // encode track bytes
  let trackBytes = [];
  for (const e of evs){
    trackBytes.push(...writeVarLen(e.delta));
    trackBytes.push(...e.bytes);
  }

  // header
  const header = [
    ...strBytes("MThd"),
    ...u32be(6),
    ...u16be(0), // format 0
    ...u16be(1), // 1 track
    ...u16be(ppq)
  ];
  const track = [
    ...strBytes("MTrk"),
    ...u32be(trackBytes.length),
    ...trackBytes
  ];

  return new Uint8Array([...header, ...track]);
}

function exportMIDI(){
  try{
    stop();
    const bytes = midiBuild();
    const blob = new Blob([bytes], {type:"audio/midi"});
    const bars = parseInt($("exportBars").value,10);
    downloadBlob(blob, `${baseExportName()}_${bars}bars.mid`);
    log(`[T+0ms] EXPORT_OK { midi }`);
  } catch(e){
    console.error(e);
    alert("MIDI Export fehlgeschlagen. Sieh Console.");
  }
}

// ---- Project JSON export/import ----
function exportProject(){
  stop();
  rebuildDerivedPlaybackData();

  const project = {
    version: "wobblebox.v4",
    savedAt: new Date().toISOString(),
    state: {
      preset: STATE.preset,
      style: STATE.style,

      seedMode: STATE.seedMode,
      seedLayers: STATE.seedLayers,
      activeLayerId: STATE.activeLayerId,

      bpm: STATE.bpm,
      swing: STATE.swing,
      humanize: STATE.humanize,
      stepsPerBar: STATE.stepsPerBar,
      editMode: STATE.editMode,

      loopBars: STATE.loopBars,
      variation: STATE.variation,
      mutator: STATE.mutator,
      mutIntensity: STATE.mutIntensity,

      mutes: STATE.mutes,

      autoLanes: STATE.autoLanes,
      laneStrength: STATE.laneStrength,

      autoFills: STATE.autoFills,
      fillPeriod: STATE.fillPeriod,
      fillIntensity: STATE.fillIntensity,

      delaySync: STATE.delaySync,
      sidechainPump: STATE.sidechainPump,

      transpose: STATE.transpose,
      rootMidi: STATE.rootMidi,
      selectedMidi: STATE.selectedMidi,

      filterModel: STATE.filterModel,
      wobbleAmt: STATE.wobbleAmt,
      wobbleSync: STATE.wobbleSync,
      wobbleHz: STATE.wobbleHz,
      cutoff: STATE.cutoff,
      res: STATE.res,
      drive: STATE.drive,
      chorus: STATE.chorus,
      delay: STATE.delay,
      reverb: STATE.reverb,
      glideMs: STATE.glideMs,
      subMix: STATE.subMix,

      vol: STATE.vol,
      eq: STATE.eq,

      // store patterns as "authored" (not renderPatterns)
      patterns: STATE.patterns
    }
  };

  const blob = new Blob([JSON.stringify(project, null, 2)], {type:"application/json"});
  downloadBlob(blob, `${baseExportName()}_project.json`);
  log(`[T+0ms] EXPORT_OK { project }`);
}

function importProjectObject(obj){
  if (!obj || !obj.state) throw new Error("Invalid project JSON (missing state).");
  const s = obj.state;

  // minimal validation / safe assign
  function pick(key, fallback){ return (key in s) ? s[key] : fallback; }

  STATE.preset = pick("preset", STATE.preset);
  STATE.style = pick("style", STATE.style);

  STATE.seedMode = pick("seedMode", STATE.seedMode);
  STATE.seedLayers = pick("seedLayers", STATE.seedLayers);
  STATE.activeLayerId = pick("activeLayerId", STATE.activeLayerId);

  STATE.bpm = pick("bpm", STATE.bpm);
  STATE.swing = pick("swing", STATE.swing);
  STATE.humanize = pick("humanize", STATE.humanize);
  STATE.stepsPerBar = pick("stepsPerBar", STATE.stepsPerBar);
  STATE.editMode = pick("editMode", STATE.editMode);

  STATE.loopBars = pick("loopBars", STATE.loopBars);
  STATE.variation = pick("variation", STATE.variation);
  STATE.mutator = pick("mutator", STATE.mutator);
  STATE.mutIntensity = pick("mutIntensity", STATE.mutIntensity);

  STATE.mutes = pick("mutes", STATE.mutes);

  STATE.autoLanes = pick("autoLanes", STATE.autoLanes);
  STATE.laneStrength = pick("laneStrength", STATE.laneStrength);

  STATE.autoFills = pick("autoFills", STATE.autoFills);
  STATE.fillPeriod = pick("fillPeriod", STATE.fillPeriod);
  STATE.fillIntensity = pick("fillIntensity", STATE.fillIntensity);

  STATE.delaySync = pick("delaySync", STATE.delaySync);
  STATE.sidechainPump = pick("sidechainPump", STATE.sidechainPump);

  STATE.transpose = pick("transpose", STATE.transpose);
  STATE.rootMidi = pick("rootMidi", STATE.rootMidi);
  STATE.selectedMidi = pick("selectedMidi", STATE.selectedMidi);

  STATE.filterModel = pick("filterModel", STATE.filterModel);
  STATE.wobbleAmt = pick("wobbleAmt", STATE.wobbleAmt);
  STATE.wobbleSync = pick("wobbleSync", STATE.wobbleSync);
  STATE.wobbleHz = pick("wobbleHz", STATE.wobbleHz);
  STATE.cutoff = pick("cutoff", STATE.cutoff);
  STATE.res = pick("res", STATE.res);
  STATE.drive = pick("drive", STATE.drive);
  STATE.chorus = pick("chorus", STATE.chorus);
  STATE.delay = pick("delay", STATE.delay);
  STATE.reverb = pick("reverb", STATE.reverb);
  STATE.glideMs = pick("glideMs", STATE.glideMs);
  STATE.subMix = pick("subMix", STATE.subMix);

  STATE.vol = pick("vol", STATE.vol);
  STATE.eq = pick("eq", STATE.eq);

  STATE.patterns = pick("patterns", STATE.patterns);

  // clamp / fixups
  if (!Array.isArray(STATE.seedLayers) || !STATE.seedLayers.length){
    STATE.seedLayers = [{id:"A", seedStr:"1337-ACID", offset:0, weight:1, mode:"dominant", enabled:true}];
    STATE.activeLayerId="A";
  }
  STATE.loopBars = clamp(parseInt(STATE.loopBars,10)||2, 1, 8);
  STATE.stepsPerBar = (parseInt(STATE.stepsPerBar,10)===32) ? 32 : 16;

  STATE.editBar = 0;
  rebuildDerivedPlaybackData();

  syncUIFromState();
  renderSeedLayersUI();
  buildBarTabs();
  renderGrid();
  updateMuteButtons();

  ensureAudio();
  syncMixToGraph();
  syncEQToGraph();
  rebuildBassVoiceIfNeeded();

  log(`[T+0ms] IMPORT_OK { version:${obj.version||"?"} }`);
}

function importProjectFromFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const obj = JSON.parse(String(reader.result||"{}"));
      importProjectObject(obj);
    } catch(e){
      console.error(e);
      alert("Import fehlgeschlagen (invalid JSON).");
    }
  };
  reader.readAsText(file);
}

// ---- UI Sync / Bindings ----
function setText(id, v){ $(id).textContent = v; }
function syncUIFromState(){
  $("preset").value = STATE.preset;
  $("style").value = STATE.style;

  $("seedMode").value = STATE.seedMode;
  $("seed").value = (STATE.seedLayers.find(x=>x.id==="A")?.seedStr) || $("seed").value;

  $("bpm").value = STATE.bpm; setText("bpmVal", STATE.bpm);
  $("swing").value = STATE.swing; setText("swingVal", STATE.swing.toFixed(2));
  $("humanize").value = STATE.humanize; setText("humanVal", STATE.humanize.toFixed(2));
  $("stepsPerBar").value = String(STATE.stepsPerBar);
  $("editMode").value = STATE.editMode;

  $("loopBars").value = String(STATE.loopBars);
  $("variation").value = STATE.variation; setText("varVal", STATE.variation.toFixed(2));
  $("mutator").value = STATE.mutator;
  $("mutIntensity").value = STATE.mutIntensity; setText("mutVal", STATE.mutIntensity.toFixed(2));

  $("autoLanes").value = STATE.autoLanes;
  $("laneStrength").value = STATE.laneStrength; setText("laneStrVal", STATE.laneStrength.toFixed(2));

  $("autoFills").value = STATE.autoFills;
  $("fillPeriod").value = String(STATE.fillPeriod);
  $("fillIntensity").value = STATE.fillIntensity; setText("fillIntVal", STATE.fillIntensity.toFixed(2));

  $("delaySync").value = STATE.delaySync;
  $("sidechainPump").value = STATE.sidechainPump; setText("pumpVal", STATE.sidechainPump.toFixed(2));

  $("filterModel").value = STATE.filterModel;

  $("pitch").value = STATE.transpose; setText("pitchVal", String(STATE.transpose));
  $("rootNote").value = String(STATE.rootMidi);

  $("wobbleAmt").value = STATE.wobbleAmt; setText("wobbleAmtVal", STATE.wobbleAmt.toFixed(2));
  $("wobbleSync").value = STATE.wobbleSync;
  $("wobbleHz").value = STATE.wobbleHz; setText("wobbleHzVal", STATE.wobbleHz.toFixed(2));

  if ($("lfoWave")) $("lfoWave").value = (STATE.lfoWave||"sine");
  if ($("lfoFilter")) { $("lfoFilter").value = (STATE.lfoFilterHz||20); setText("lfoFilterVal", (STATE.lfoFilterHz||20).toFixed(1)); }
  if ($("lfoTarget")) $("lfoTarget").value = (STATE.lfoTarget||"filter");

  $("cutoff").value = STATE.cutoff; setText("cutoffVal", String(STATE.cutoff|0));
  $("res").value = STATE.res; setText("resVal", STATE.res.toFixed(2));
  $("drive").value = STATE.drive; setText("driveVal", STATE.drive.toFixed(2));
  $("chorus").value = STATE.chorus; setText("chorusVal", STATE.chorus.toFixed(2));
  $("delay").value = STATE.delay; setText("delayVal", STATE.delay.toFixed(2));
  $("reverb").value = STATE.reverb; setText("revVal", STATE.reverb.toFixed(2));
  $("glide").value = STATE.glideMs; setText("glideVal", String(STATE.glideMs|0));
  $("subMix").value = STATE.subMix; setText("subVal", STATE.subMix.toFixed(2));

  $("kickVol").value = STATE.vol.kick; setText("kickVolVal", STATE.vol.kick.toFixed(2));
  $("snareVol").value = STATE.vol.snare; setText("snareVolVal", STATE.vol.snare.toFixed(2));
  $("hatVol").value = STATE.vol.hat; setText("hatVolVal", STATE.vol.hat.toFixed(2));
  $("bassVol").value = STATE.vol.bass; setText("bassVolVal", STATE.vol.bass.toFixed(2));

  $("low").value = STATE.eq.lowDb; setText("lowVal", String(STATE.eq.lowDb|0));
  $("mid").value = STATE.eq.midDb; setText("midVal", String(STATE.eq.midDb|0));
  $("high").value = STATE.eq.highDb; setText("highVal", String(STATE.eq.highDb|0));

  updateSelectedNoteBadge();
  updateMuteButtons();
}

function updateMuteButtons(){
  function set(btn, on){
    btn.classList.toggle("btnDanger", on);
    btn.classList.toggle("btnAccent", !on);
  }
  set($("muteKick"), STATE.mutes.kick);
  set($("muteSnare"), STATE.mutes.snare);
  set($("muteHat"), STATE.mutes.hat);
  set($("muteBass"), STATE.mutes.bass);
}

function syncMixToGraph(){
  if (!master) return;
  master.kickBus.gain.value = STATE.vol.kick;
  master.snareBus.gain.value = STATE.vol.snare;
  master.hatBus.gain.value = STATE.vol.hat;
  master.bassBus.gain.value = STATE.vol.bass;
  master.rev.wet.gain.value = STATE.reverb;
  master.rev.dry.gain.value = 1.0 - STATE.reverb;
}
function syncEQToGraph(){
  if (!master) return;
  master.low.gain.value = STATE.eq.lowDb;
  master.mid.gain.value = STATE.eq.midDb;
  master.high.gain.value = STATE.eq.highDb;
}

// ---- Bind all UI events ----
function bindUI(){
  $("btnPlay").onclick = play;
  $("btnStop").onclick = stop;

  $("preset").onchange = ()=>applyPreset($("preset").value);

  $("style").onchange = ()=>{
    STATE.style = $("style").value;
    regenArrangementFromSeedStack();
  };

  $("seed").oninput = ()=>{
    const A = STATE.seedLayers.find(x=>x.id==="A");
    if (A){ A.seedStr = $("seed").value; }
    renderSeedLayersUI();
  };

  $("btnRandSeed").onclick = ()=>{
    const s = randSeedString();
    $("seed").value = s;
    const A = STATE.seedLayers.find(x=>x.id==="A");
    if (A){ A.seedStr = s; }
    renderSeedLayersUI();
    regenArrangementFromSeedStack();
  };

  $("btnRegen").onclick = ()=>regenArrangementFromSeedStack();

  $("bpm").oninput = ()=>{ STATE.bpm = parseInt($("bpm").value,10); setText("bpmVal", STATE.bpm); };
  $("swing").oninput = ()=>{ STATE.swing = parseFloat($("swing").value); setText("swingVal", STATE.swing.toFixed(2)); };
  $("humanize").oninput = ()=>{ STATE.humanize = parseFloat($("humanize").value); setText("humanVal", STATE.humanize.toFixed(2)); };

  $("stepsPerBar").onchange = ()=>{
    STATE.stepsPerBar = parseInt($("stepsPerBar").value,10);
    regenArrangementFromSeedStack();
  };

  $("editMode").onchange = ()=>{ STATE.editMode = $("editMode").value; };

  $("loopBars").onchange = ()=>{
    STATE.loopBars = parseInt($("loopBars").value,10);
    buildBarTabs();
    regenArrangementFromSeedStack();
  };

  $("variation").oninput = ()=>{
    STATE.variation = parseFloat($("variation").value);
    setText("varVal", STATE.variation.toFixed(2));
  };
  $("variation").onchange = ()=>regenArrangementFromSeedStack();

  $("mutator").onchange = ()=>{ STATE.mutator = $("mutator").value; };
  $("mutIntensity").oninput = ()=>{ STATE.mutIntensity = parseFloat($("mutIntensity").value); setText("mutVal", STATE.mutIntensity.toFixed(2)); };

  $("seedMode").onchange = ()=>{
    STATE.seedMode = $("seedMode").value;
    regenArrangementFromSeedStack();
  };

  $("btnAddLayer").onclick = ()=>{
    const id = String.fromCharCode(65 + STATE.seedLayers.length); // C, D, ...
    if (STATE.seedLayers.length>=6) return alert("Max 6 Layers (perf+clarity).");
    STATE.seedLayers.push({id, seedStr:randSeedString(), offset:0, weight:0.45, mode:"add", enabled:true});
    STATE.activeLayerId = id;
    renderSeedLayersUI();
    regenArrangementFromSeedStack();
  };
  $("btnNudgeLayer").onclick = ()=>{
    const L = STATE.seedLayers.find(x=>x.id===STATE.activeLayerId);
    if(!L) return;
    L.offset = (L.offset|0) + 1;
    renderSeedLayersUI();
    regenArrangementFromSeedStack();
  };

  $("autoLanes").onchange = ()=>{
    STATE.autoLanes = $("autoLanes").value;
    rebuildDerivedPlaybackData();
  };
  $("laneStrength").oninput = ()=>{
    STATE.laneStrength = parseFloat($("laneStrength").value);
    setText("laneStrVal", STATE.laneStrength.toFixed(2));
    rebuildDerivedPlaybackData();
  };

  $("autoFills").onchange = ()=>{
    STATE.autoFills = $("autoFills").value;
    rebuildDerivedPlaybackData();
  };
  $("fillPeriod").onchange = ()=>{
    STATE.fillPeriod = parseInt($("fillPeriod").value,10);
    rebuildDerivedPlaybackData();
  };
  $("fillIntensity").oninput = ()=>{
    STATE.fillIntensity = parseFloat($("fillIntensity").value);
    setText("fillIntVal", STATE.fillIntensity.toFixed(2));
    rebuildDerivedPlaybackData();
  };

  $("delaySync").onchange = ()=>{
    STATE.delaySync = $("delaySync").value;
    rebuildBassVoiceIfNeeded();
  };

  $("sidechainPump").oninput = ()=>{
    STATE.sidechainPump = parseFloat($("sidechainPump").value);
    setText("pumpVal", STATE.sidechainPump.toFixed(2));
  };

  $("filterModel").onchange = ()=>{
    STATE.filterModel = $("filterModel").value;
    rebuildBassVoiceIfNeeded();
  };

  $("pitch").oninput = ()=>{
    STATE.transpose = parseInt($("pitch").value,10);
    setText("pitchVal", String(STATE.transpose));
    updateSelectedNoteBadge();
    renderGrid();
  };

  $("rootNote").onchange = ()=>{
    STATE.rootMidi = parseInt($("rootNote").value,10);
    STATE.selectedMidi = STATE.rootMidi;
    updateSelectedNoteBadge();
    regenArrangementFromSeedStack();
  };

  $("wobbleAmt").oninput = ()=>{
    STATE.wobbleAmt = parseFloat($("wobbleAmt").value);
    setText("wobbleAmtVal", STATE.wobbleAmt.toFixed(2));
  };
  $("wobbleSync").onchange = ()=>{ STATE.wobbleSync = $("wobbleSync").value; };
  $("wobbleHz").oninput = ()=>{
    STATE.wobbleHz = parseFloat($("wobbleHz").value);
    setText("wobbleHzVal", STATE.wobbleHz.toFixed(2));
  };
  if ($("lfoWave")) $("lfoWave").onchange = ()=>{
    STATE.lfoWave = $("lfoWave").value;
    rebuildBassVoiceIfNeeded();
  };
  if ($("lfoFilter")) $("lfoFilter").oninput = ()=>{
    STATE.lfoFilterHz = parseFloat($("lfoFilter").value);
    setText("lfoFilterVal", STATE.lfoFilterHz.toFixed(1));
    if (audioCtx && SCHED && SCHED.bassVoice && SCHED.bassVoice._setLfoFilter){
      SCHED.bassVoice._setLfoFilter(STATE.lfoFilterHz);
    }
  };
  if ($("lfoTarget")) $("lfoTarget").onchange = ()=>{
    STATE.lfoTarget = $("lfoTarget").value;
    rebuildBassVoiceIfNeeded();
  };


  $("cutoff").oninput = ()=>{
    STATE.cutoff = parseInt($("cutoff").value,10);
    setText("cutoffVal", String(STATE.cutoff|0));
  };
  $("res").oninput = ()=>{
    STATE.res = parseFloat($("res").value);
    setText("resVal", STATE.res.toFixed(2));
  };
  $("drive").oninput = ()=>{
    STATE.drive = parseFloat($("drive").value);
    setText("driveVal", STATE.drive.toFixed(2));
  };

  $("chorus").oninput = ()=>{
    STATE.chorus = parseFloat($("chorus").value);
    setText("chorusVal", STATE.chorus.toFixed(2));
    rebuildBassVoiceIfNeeded();
  };
  $("delay").oninput = ()=>{
    STATE.delay = parseFloat($("delay").value);
    setText("delayVal", STATE.delay.toFixed(2));
    rebuildBassVoiceIfNeeded();
  };
  $("reverb").oninput = ()=>{
    STATE.reverb = parseFloat($("reverb").value);
    setText("revVal", STATE.reverb.toFixed(2));
    if (master){
      master.rev.wet.gain.value = STATE.reverb;
      master.rev.dry.gain.value = 1.0 - STATE.reverb;
    }
  };

  $("glide").oninput = ()=>{
    STATE.glideMs = parseInt($("glide").value,10);
    setText("glideVal", String(STATE.glideMs|0));
  };

  $("subMix").oninput = ()=>{
    STATE.subMix = parseFloat($("subMix").value);
    setText("subVal", STATE.subMix.toFixed(2));
    rebuildBassVoiceIfNeeded();
  };

  $("kickVol").oninput = ()=>{
    STATE.vol.kick = parseFloat($("kickVol").value);
    setText("kickVolVal", STATE.vol.kick.toFixed(2));
    syncMixToGraph();
  };
  $("snareVol").oninput = ()=>{
    STATE.vol.snare = parseFloat($("snareVol").value);
    setText("snareVolVal", STATE.vol.snare.toFixed(2));
    syncMixToGraph();
  };
  $("hatVol").oninput = ()=>{
    STATE.vol.hat = parseFloat($("hatVol").value);
    setText("hatVolVal", STATE.vol.hat.toFixed(2));
    syncMixToGraph();
  };
  $("bassVol").oninput = ()=>{
    STATE.vol.bass = parseFloat($("bassVol").value);
    setText("bassVolVal", STATE.vol.bass.toFixed(2));
    syncMixToGraph();
  };

  $("low").oninput = ()=>{
    STATE.eq.lowDb = parseInt($("low").value,10);
    setText("lowVal", String(STATE.eq.lowDb|0));
    syncEQToGraph();
  };
  $("mid").oninput = ()=>{
    STATE.eq.midDb = parseInt($("mid").value,10);
    setText("midVal", String(STATE.eq.midDb|0));
    syncEQToGraph();
  };
  $("high").oninput = ()=>{
    STATE.eq.highDb = parseInt($("high").value,10);
    setText("highVal", String(STATE.eq.highDb|0));
    syncEQToGraph();
  };

  $("muteKick").onclick = ()=>{ STATE.mutes.kick = !STATE.mutes.kick; updateMuteButtons(); };
  $("muteSnare").onclick = ()=>{ STATE.mutes.snare = !STATE.mutes.snare; updateMuteButtons(); };
  $("muteHat").onclick = ()=>{ STATE.mutes.hat = !STATE.mutes.hat; updateMuteButtons(); };
  $("muteBass").onclick = ()=>{ STATE.mutes.bass = !STATE.mutes.bass; updateMuteButtons(); };

  $("btnExportMix").onclick = exportWavMix;
  $("btnExportStems").onclick = exportWavStems;
  $("btnExportMIDI").onclick = exportMIDI;

  $("btnExportProject").onclick = exportProject;
  $("btnImportProject").onclick = ()=>$("fileImport").click();
  $("fileImport").onchange = ()=>{
    const f = $("fileImport").files?.[0];
    if (f) importProjectFromFile(f);
    $("fileImport").value = "";
  };
}

// ---- Boot ----
(function boot(){
  buildKeyboard();
  renderSeedLayersUI();
  buildBarTabs();
  syncUIFromState();

  // apply initial preset (keeps your current seed A text)
  const aSeed = $("seed").value;
  applyPreset($("preset").value);
  const A = STATE.seedLayers.find(x=>x.id==="A");
  if (A) A.seedStr = aSeed;
  $("seed").value = aSeed;

  renderSeedLayersUI();
  regenArrangementFromSeedStack();
  bindUI();

  log(`[T+0ms] READY { version:wobblebox.v4 }`);
})();
