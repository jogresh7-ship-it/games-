// Sonic the Hedgehog — Green Hill Zone (browser remake from the Genesis sprite rips)
(() => {
"use strict";

const VW = 400, VH = 224;
const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const SKY = "#2300b4";
const ACTS = ["ghz1", "ghz2", "ghz3"];

// ---------- scaling ----------
function fit() {
  const s = Math.max(1, Math.min(window.innerWidth / VW, window.innerHeight / VH));
  const k = s >= 2 ? Math.floor(s) : s;
  canvas.style.width = VW * k + "px";
  canvas.style.height = VH * k + "px";
}
window.addEventListener("resize", fit);
fit();

// ---------- assets ----------
const IMG = {};
let pending = 0;
function loadImg(key, src) {
  pending++;
  const im = new Image();
  im.onload = im.onerror = () => { pending--; };
  im.src = src;
  IMG[key] = im;
}
for (const n of window.SPRITE_NAMES) loadImg(n, "assets/sprites/" + n + ".png");
for (let i = 0; i < 6; i++) loadImg("bg" + i, "assets/bg" + i + ".png");
const chunkImgs = {};
function levelChunks(L) {
  if (!chunkImgs[L.name]) {
    chunkImgs[L.name] = [];
    for (let i = 0; i < L.chunks; i++) {
      const im = new Image();
      im.src = `assets/levels/${L.name}/${i}.png`;
      chunkImgs[L.name].push(im);
    }
  }
  return chunkImgs[L.name];
}
for (const a of ACTS) levelChunks(window.SONIC_LEVELS[a]);
const META = window.SONIC_META;

function spr(name, x, y, flip = false, alpha = 1) {
  const im = IMG[name];
  if (!im || !im.complete || !im.naturalWidth) return;
  x = Math.round(x); y = Math.round(y);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (flip) {
    ctx.save();
    ctx.translate(x + im.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(im, 0, 0);
    ctx.restore();
  } else ctx.drawImage(im, x, y);
  if (alpha !== 1) ctx.globalAlpha = 1;
}
// draw a sprite with its bottom-centre at (x, y)
function sprBC(name, x, y, flip = false, alpha = 1) {
  const im = IMG[name];
  if (!im || !im.naturalWidth) return;
  spr(name, x - im.width / 2, y - im.height, flip, alpha);
}
function sprC(name, x, y, flip = false) {
  const im = IMG[name];
  if (!im || !im.naturalWidth) return;
  spr(name, x - im.width / 2, y - im.height / 2, flip);
}

// ---------- sound (tiny synth; no audio files needed) ----------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, dur, type = "square", vol = 0.08, slide = 0, delay = 0) {
  const a = actx; if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.12) {
  const a = actx; if (!a) return;
  const b = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = b; g.gain.value = vol; s.connect(g); g.connect(a.destination); s.start();
}
const SYNTH = {
  ring() { tone(1318, 0.07, "square", 0.06); tone(1976, 0.18, "square", 0.06, 0, 0.06); },
  jump() { tone(300, 0.18, "square", 0.06, 500); },
  spring() { tone(200, 0.3, "square", 0.07, 900); },
  pop() { noise(0.25, 0.18); tone(120, 0.2, "sawtooth", 0.06, -60); },
  hurt() { tone(500, 0.35, "sawtooth", 0.07, -380); },
  lose() { for (let i = 0; i < 12; i++) tone(900 + (i % 2) * 300, 0.05, "square", 0.04, 0, i * 0.04); },
  monitor() { noise(0.15, 0.15); },
  life() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, "square", 0.06, 0, i * 0.12)); },
  shield() { tone(400, 0.3, "triangle", 0.1, 400); },
  sign() { for (let i = 0; i < 8; i++) tone(600 + i * 60, 0.06, "square", 0.04, 0, i * 0.07); },
  tally() { tone(880, 0.04, "square", 0.03); },
  death() { tone(700, 0.5, "square", 0.07, -600); },
  brake() { noise(0.12, 0.06); },
  roll() { tone(160, 0.2, "sawtooth", 0.05, 300); },
};
// Real Genesis sound effects (plain <audio>, so they work when opened from disk).
const WAV = {};
for (const n of ["ring", "jump", "spring", "pop", "lose", "death", "spikedeath", "brake", "roll", "sign", "tally", "shield", "monitor", "bonus", "sega"]) {
  const a = new Audio("assets/sfx/" + n + ".wav");
  a.preload = "auto";
  WAV[n] = a;
}
function playWav(n, vol = 0.6) {
  const base = WAV[n];
  if (!base) return false;
  const a = base.paused || base.ended || base.currentTime === 0 ? base : base.cloneNode();
  a.volume = vol;
  try { a.currentTime = 0; } catch (e) {}
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
  return true;
}
const SFX = new Proxy({}, {
  get: (_, n) => () => {
    const alias = { hurt: "lose" }[n] || n;
    if (n === "hurt" && G.rings === 0) return;     // ring-loss sound plays from scatterRings
    if (!playWav(alias) && SYNTH[n]) { audio(); SYNTH[n](); }
  },
});


// ---------- input ----------
const keys = {};
const pressed = {};
const KEYMAP = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowDown: "down", KeyS: "down", ArrowUp: "up", KeyW: "up",
  Space: "jump", KeyZ: "jump", KeyX: "jump", KeyC: "jump", KeyK: "jump",
  Enter: "start", KeyP: "start", Escape: "start",
};
window.addEventListener("keydown", (e) => {
  const k = KEYMAP[e.code]; if (!k) return;
  e.preventDefault();
  audio();
  if (!keys[k]) pressed[k] = true;
  keys[k] = true;
});
window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
if ("ontouchstart" in window || navigator.maxTouchPoints > 0) document.body.classList.add("touch");
for (const [id, k] of [["t-left", "left"], ["t-right", "right"], ["t-down", "down"], ["t-jump", "jump"], ["t-pause", "start"]]) {
  const el = document.getElementById(id);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); audio(); if (!keys[k]) pressed[k] = true; keys[k] = true; });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(ev, () => { keys[k] = false; });
}
canvas.addEventListener("pointerdown", () => { audio(); pressed.start = true; });

// ---------- level collision ----------
let L = null;
function solidAt(x, y) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || x >= L.w) return true;
  if (y < 0) return false;
  const c = L.cols[x];
  for (let i = 0; i < c.length; i += 2) {
    if (y < c[i]) return false;
    if (y < c[i + 1]) return true;
  }
  return false;
}
// top of the ground near feet height y at column x; null if none within range
function floorNear(x, y, up = 14, down = 14) {
  y = Math.floor(y);
  if (solidAt(x, y)) {
    for (let k = 1; k <= up; k++) if (!solidAt(x, y - k)) return y - k + 1;
    return null; // a wall
  }
  for (let k = 1; k <= down; k++) if (solidAt(x, y + k)) return y + k;
  return null;
}
function groundBelow(x, y, range = 400) {
  for (let k = 0; k < range; k++) if (solidAt(x, y + k) && !solidAt(x, y + k - 1)) return y + k;
  return null;
}

// ---------- game state ----------
const G = {
  mode: "boot", // boot | sega | title | card | play | results | gameover | ending
  t: 0, act: 0, score: 0, lives: 3, rings: 0, time: 0, nextLifeAt: 100,
  paused: false, camX: 0, camY: 0, objs: [], fx: [], lost: [], shots: [], modeT: 0,
};
let P = null;

function newPlayer() {
  return {
    x: L.start[0], y: L.start[1], gsp: 0, vx: 0, vy: 0, ground: false, ang: 0,
    face: 1, rolling: false, jumping: false, hurt: false, dead: false, inv: 0, shield: false,
    anim: "idle", animT: 0, frame: 0, idleT: 0, pushing: false, skid: false, crouch: false, lookup: false,
    control: true, springT: 0,
  };
}

function loadAct(i, keepRings = false) {
  G.act = i;
  L = window.SONIC_LEVELS[ACTS[i]];
  levelChunks(L);
  P = newPlayer();
  const gy = groundBelow(P.x, 0, L.h);
  if (gy !== null) P.y = gy;
  G.rings = 0; G.time = 0; G.nextLifeAt = 100;
  G.fx = []; G.lost = []; G.shots = [];
  G.objs = L.objects.map((o) => {
    const ob = Object.assign({}, o, { type: o.t, alive: true, t: 0, dir: -1, state: 0, fr: 0, up: 0, cool: 0 });
    if (o.t === "buzz") ob.x0 = o.x;
    return ob;
  });
  G.camX = Math.max(0, P.x - VW / 2);
  G.camY = Math.max(0, Math.min(L.h - VH, P.y - 130));
  G.mode = "card"; G.modeT = 0;
}

// ---------- player physics (Sonic 1 constants, 60fps) ----------
const ACC = 0.046875, DEC = 0.5, FRC = 0.046875, TOP = 6, JUMP = 6.5, GRV = 0.21875;
const AIR = 0.09375, ROLLFRC = 0.0234375, ROLLDEC = 0.125, MAXFALL = 16, MAXSPD = 16;
const HW = 9;
function bodyH() { return P.rolling || P.jumping ? 28 : 38; }

function wallAt(x, y, h, low = 10) {
  for (let yy = y - h + 4; yy <= y - low; yy += 4) if (solidAt(x, yy)) return true;
  return false;
}

function groundStep(dx) {
  const s = Math.sign(dx);
  const nx = P.x + dx;
  if (s && wallAt(nx + s * HW, P.y, bodyH(), 26)) {
    P.gsp = 0; P.pushing = (s === 1 && keys.right) || (s === -1 && keys.left);
    return false;
  }
  const a = floorNear(nx - 6, P.y, 28, 20), b = floorNear(nx + 6, P.y, 28, 20), c = floorNear(nx, P.y, 28, 20);
  const cands = [a, b, c].filter((v) => v !== null);
  if (!cands.length) {
    // ran off a ledge
    P.x = nx; P.ground = false; P.vx = P.gsp; P.vy = 0; return false;
  }
  const top = Math.min(...cands);
  if (P.y - top > 26) { P.gsp = 0; return false; }
  P.x = nx; P.y = top;
  return true;
}

function updatePlayer() {
  if (P.dead) {
    P.vy = Math.min(P.vy + GRV, MAXFALL); P.y += P.vy;
    if (P.y > G.camY + VH + 80) {
      G.lives--;
      if (G.lives <= 0) { G.mode = "gameover"; G.modeT = 0; }
      else loadAct(G.act);
    }
    return;
  }
  if (P.inv > 0) P.inv--;
  const L_ = keys.left && P.control, R_ = keys.right && P.control, D_ = keys.down && P.control, U_ = keys.up && P.control;
  P.pushing = false;

  if (P.ground) {
    P.skid = false;
    // slope factor
    const ha = floorNear(P.x - 8, P.y, 28, 20), hb = floorNear(P.x + 8, P.y, 28, 20);
    P.ang = ha !== null && hb !== null ? Math.atan2(hb - ha, 16) : 0;
    const sin = Math.sin(P.ang);
    if (P.rolling) {
      const f = Math.sign(P.gsp) === Math.sign(sin) ? 0.078125 : 0.3125;
      P.gsp += f * sin;
    } else if (Math.abs(P.gsp) > 0.05 || Math.abs(sin) > 0.35) P.gsp += 0.125 * sin;

    if (P.rolling) {
      if (L_ && P.gsp > 0) P.gsp -= ROLLDEC;
      if (R_ && P.gsp < 0) P.gsp += ROLLDEC;
      P.gsp -= Math.min(Math.abs(P.gsp), ROLLFRC) * Math.sign(P.gsp);
      if (Math.abs(P.gsp) < 0.5) P.rolling = false;
    } else {
      if (L_) {
        if (P.gsp > 0) { P.gsp -= DEC; if (P.gsp > 4) { P.skid = true; } if (P.gsp <= 0) P.gsp = -0.5; }
        else if (P.gsp > -TOP) P.gsp = Math.max(-TOP, P.gsp - ACC);
        P.face = -1;
      } else if (R_) {
        if (P.gsp < 0) { P.gsp += DEC; if (P.gsp < -4) { P.skid = true; } if (P.gsp >= 0) P.gsp = 0.5; }
        else if (P.gsp < TOP) P.gsp = Math.min(TOP, P.gsp + ACC);
        P.face = 1;
      } else P.gsp -= Math.min(Math.abs(P.gsp), FRC) * Math.sign(P.gsp);
      if (P.skid && P.animT % 8 === 0) SFX.brake();
      if (D_ && Math.abs(P.gsp) >= 1) { P.rolling = true; SFX.roll(); }
    }
    P.crouch = D_ && !P.rolling && Math.abs(P.gsp) < 1;
    P.lookup = U_ && Math.abs(P.gsp) < 0.1 && !P.crouch;
    P.gsp = Math.max(-MAXSPD, Math.min(MAXSPD, P.gsp));

    if (pressed.jump && P.control && !solidAt(P.x, P.y - bodyH() - 6)) {
      P.ground = false; P.jumping = true; P.rolling = true;
      P.vx = P.gsp; P.vy = -JUMP; P.crouch = P.lookup = false;
      SFX.jump();
    } else {
      // move along the ground in small steps
      let rem = P.gsp;
      while (Math.abs(rem) > 0.0001 && P.ground) {
        const st = Math.max(-4, Math.min(4, rem));
        if (!groundStep(st)) break;
        rem -= st;
      }
      if (P.ground && floorNear(P.x, P.y, 28, 20) === null) { P.ground = false; P.vx = P.gsp; P.vy = 0; }
    }
  }

  if (!P.ground) {
    P.crouch = P.lookup = false;
    if (P.control && !P.hurt) {
      if (L_) { P.vx = Math.max(-TOP, P.vx - AIR); P.face = -1; }
      if (R_) { P.vx = Math.min(TOP, P.vx + AIR); P.face = 1; }
    }
    if (P.jumping && !keys.jump && P.vy < -4) P.vy = -4;
    if (P.vy < 0 && P.vy > -4) P.vx -= P.vx / 0.125 / 256;
    P.vy = Math.min(MAXFALL, P.vy + (P.hurt ? 0.1875 : GRV));
    // horizontal
    let rem = P.vx;
    while (Math.abs(rem) > 0.0001) {
      const st = Math.max(-4, Math.min(4, rem));
      const s = Math.sign(st);
      if (wallAt(P.x + st + s * HW, P.y, bodyH())) { P.vx = 0; break; }
      P.x += st; rem -= st;
    }
    // vertical
    if (P.vy < 0) {
      const head = P.y + P.vy - bodyH();
      if (solidAt(P.x - 5, head) || solidAt(P.x + 5, head)) P.vy = 0;
      else P.y += P.vy;
    } else {
      const ny = P.y + P.vy;
      let land = null;
      for (const sx of [P.x - 7, P.x, P.x + 7]) {
        for (let yy = Math.floor(P.y); yy <= Math.ceil(ny); yy++) {
          if (solidAt(sx, yy)) { const top = floorNear(sx, yy, 16, 0); if (top !== null && (land === null || top < land)) land = top; break; }
        }
      }
      if (land !== null) {
        P.y = land; P.ground = true; P.gsp = P.vx; P.vy = 0;
        P.jumping = false; P.hurt = false; P.springT = 0;
        P.rolling = keys.down && Math.abs(P.gsp) > 1 && P.control;
      } else P.y = ny;
    }
    P.ang *= 0.85;
  }
  if (P.x < HW) { P.x = HW; P.gsp = Math.max(0, P.gsp); P.vx = Math.max(0, P.vx); }
  if (P.y > L.h + 40) killPlayer(true);

  // ---- animation ----
  P.animT++;
  const spd = Math.abs(P.ground ? P.gsp : P.vx);
  if (P.hurt) P.anim = "hurt";
  else if (P.rolling || P.jumping) P.anim = "roll";
  else if (!P.ground && P.springT > 0) P.anim = "spring";
  else if (!P.ground) P.anim = spd >= 6 ? "run" : "walk";
  else if (P.skid) P.anim = "skid";
  else if (P.pushing) P.anim = "push";
  else if (P.crouch) P.anim = "crouch";
  else if (P.lookup) P.anim = "lookup";
  else if (spd < 0.05) P.anim = "idle";
  else P.anim = spd >= 6 ? "run" : "walk";
  if (P.anim === "idle") P.idleT++; else P.idleT = 0;
  const rate = Math.max(1, Math.floor(8 - spd));
  if (P.animT % rate === 0) P.frame++;
}

function hurtPlayer(srcX) {
  if (P.inv > 0 || P.hurt || P.dead) return;
  if (P.shield) {
    P.shield = false; SFX.pop();
  } else if (G.rings > 0) {
    scatterRings();
  } else { killPlayer(); return; }
  P.hurt = true; P.ground = false; P.rolling = P.jumping = false;
  P.vx = P.x < srcX ? -2 : 2; P.vy = -4; P.inv = 120;
}
function killPlayer(fell = false) {
  if (P.dead) return;
  P.dead = true; P.shield = false; P.vy = fell ? 0 : -7; P.ground = false; SFX.death();
}
function scatterRings() {
  const n = Math.min(G.rings, 32);
  G.rings = 0;
  let ang = 101.25 * Math.PI / 180, sp = 4, flip = false;
  for (let i = 0; i < n; i++) {
    if (i === 16) { sp = 2; ang = 101.25 * Math.PI / 180; }
    const vx = Math.cos(ang) * sp * (flip ? -1 : 1), vy = -Math.sin(ang) * sp;
    G.lost.push({ x: P.x, y: P.y - 20, vx, vy, t: 0 });
    if (flip) ang += 22.5 * Math.PI / 180;
    flip = !flip;
  }
  SFX.lose();
}
function addRing(n = 1) {
  G.rings += n;
  if (G.rings >= G.nextLifeAt) { G.lives++; G.nextLifeAt += 100; SFX.life(); }
}

// ---------- objects ----------
function box(o, w, h) { return { l: o.x - w / 2, r: o.x + w / 2, t: o.y - h, b: o.y }; }
function pbox() { const h = bodyH(); return { l: P.x - HW, r: P.x + HW, t: P.y - h, b: P.y }; }
function hit(a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; }
function attacking() { return P.rolling || P.jumping; }
function bounceOff() { if (!P.ground) { if (P.vy > 0) P.vy = -P.vy; else P.vy = Math.max(P.vy - 1, -P.vy); } }
function destroyEnemy(o) {
  o.alive = false; G.score += 100; SFX.pop();
  G.fx.push({ k: "boom", x: o.x, y: o.y - 14, t: 0 });
  G.fx.push({ k: "flicky", x: o.x, y: o.y - 10, vx: -2.5, vy: -4, t: 0 });
}

function updateObjects() {
  const pb = pbox();
  for (const o of G.objs) updateObj(o, pb);
}

function updateObj(o, pb) {
  if (!o.alive) return;
  const near = Math.abs(o.x - P.x) < VW * 1.3;
  if (!near) return;
  const type = o.type;
  if (type === "ring") {
    if (P.dead || P.hurt && P.inv > 90) return;
    if (Math.abs(P.x - o.x) < 15 && P.y - bodyH() < o.y + 8 && P.y > o.y - 8) {
      o.alive = false; addRing(); SFX.ring(); G.fx.push({ k: "sparkle", x: o.x, y: o.y, t: 0 });
    }
  } else if (type === "spring") {
    if (o.up > 0) o.up--;
    const b = box(o, 32, 44);   // generous: catches Sonic skimming just above it at speed
    if (!P.dead && hit(pb, b) && P.vy >= 0) {
      P.vx = P.ground ? P.gsp : P.vx; P.ground = false; P.vy = -(o.pow || 10); P.y = o.y - 16;
      P.jumping = false; P.rolling = false; P.springT = 1; o.up = 12; SFX.spring();
    }
  } else if (type === "monitor") {
    const b = box(o, 28, 30);
    if (!P.dead && hit(pb, b)) {
      if (attacking() || (!P.ground && P.vy > 0)) {
        o.alive = false; bounceOff(); SFX.monitor();
        G.fx.push({ k: "boom", x: o.x, y: o.y - 15, t: 0 });
        G.fx.push({ k: "broken", x: o.x, y: o.y, t: 0 });
        G.fx.push({ k: "icon", x: o.x, y: o.y - 22, t: 0, icon: o.kind });
        if (o.kind === "ring") { addRing(10); SFX.ring(); }
        else if (o.kind === "shield") { P.shield = true; SFX.shield(); }
        else if (o.kind === "life") { G.lives++; SFX.life(); }
      } else if (P.ground) {
        // solid sides
        if (P.x < o.x) P.x = b.l - HW; else P.x = b.r + HW;
        P.gsp = 0; P.pushing = true;
      }
    }
  } else if (type === "spikes") {
    const b = box(o, 40, 26);
    if (!P.dead && hit(pb, b)) {
      if (P.ground && P.y <= o.y - 20) return;
      hurtPlayer(o.x);
    }
  } else if (type === "sign") {
    if (o.state === 0 && P.x > o.x) { o.state = 1; o.t = 0; SFX.sign(); P.control = false; }
    if (o.state === 1) {
      o.t++;
      if (o.t > 150) { o.state = 2; G.mode = "results"; G.modeT = 0; G.tally = { time: timeBonus(), ring: G.rings * 100 }; }
    }
  } else if (type === "moto" || type === "crab") {
    o.t++;
    const speed = type === "moto" ? 1 : 0.5;
    if (type === "crab" && o.state === 1) {
      if (o.t > 60) { o.state = 0; o.t = 0; }
      if (o.t === 30) {
        G.shots.push({ x: o.x - 16, y: o.y - 26, vx: -1, vy: -4 });
        G.shots.push({ x: o.x + 16, y: o.y - 26, vx: 1, vy: -4 });
      }
    } else {
      o.x += o.dir * speed;
      if (o.x < o.minx || o.x > o.maxx || wallAt(o.x + o.dir * 16, o.y, 24)) { o.dir *= -1; o.x += o.dir * speed * 2; }
      const g = floorNear(o.x, o.y, 12, 12);
      if (g === null) { o.dir *= -1; o.x += o.dir * 2; } else o.y = g;
      if (type === "crab" && o.t > 128 && Math.abs(o.x - P.x) < 200) { o.state = 1; o.t = 0; }
    }
    o.fr = Math.floor(o.t / 8) % 2;
    enemyContact(o, type === "moto" ? 34 : 38, 26);
  } else if (type === "buzz") {
    o.t++;
    if (o.state === 0) {
      o.x += o.dir * 2;
      if (Math.abs(o.x - o.x0) > 260) o.dir *= -1;
      if (Math.abs(P.x - o.x) < 70 && P.y > o.y && o.cool <= 0) { o.state = 1; o.t = 0; }
      o.cool = (o.cool || 0) - 1;
    } else {
      if (o.t === 30) {
        const dx = P.x - o.x, dy = P.y - 20 - o.y, d = Math.hypot(dx, dy) || 1;
        G.shots.push({ x: o.x + o.dir * 12, y: o.y + 6, vx: dx / d * 2.2, vy: dy / d * 2.2, ng: true });
      }
      if (o.t > 60) { o.state = 0; o.cool = 120; }
    }
    o.fr = Math.floor(o.t / 2) % 2;
    enemyContact(o, 36, 18, true);
  }
}
function enemyContact(o, w, h, flying = false) {
  if (P.dead) return;
  const b = flying ? { l: o.x - w / 2, r: o.x + w / 2, t: o.y - h / 2, b: o.y + h / 2 } : box(o, w, h);
  if (!hit(pbox(), b)) return;
  if (attacking()) { destroyEnemy(o); bounceOff(); }
  else hurtPlayer(o.x);
}

function updateShots() {
  for (const s of G.shots) {
    s.x += s.vx; s.y += s.vy;
    if (!s.ng) s.vy += 0.21875;
    s.t = (s.t || 0) + 1;
    if (!P.dead && Math.abs(s.x - P.x) < 10 && s.y > P.y - bodyH() && s.y < P.y) { s.dead = true; hurtPlayer(s.x); }
    if (s.t > 300 || solidAt(s.x, s.y)) s.dead = true;
  }
  G.shots = G.shots.filter((s) => !s.dead);
}
function updateLostRings() {
  for (const r of G.lost) {
    r.t++;
    r.vy += 0.09375; r.x += r.vx; r.y += r.vy;
    if (r.vy > 0 && solidAt(r.x, r.y + 8)) { r.vy *= -0.75; r.y -= 2; }
    if (solidAt(r.x + Math.sign(r.vx) * 8, r.y)) r.vx *= -0.75;
    if (r.t > 64 && !P.dead && Math.abs(r.x - P.x) < 14 && r.y > P.y - bodyH() - 8 && r.y < P.y + 8) {
      r.dead = true; addRing(); SFX.ring(); G.fx.push({ k: "sparkle", x: r.x, y: r.y, t: 0 });
    }
    if (r.t > 256) r.dead = true;
  }
  G.lost = G.lost.filter((r) => !r.dead);
}
function updateFx() {
  for (const f of G.fx) {
    f.t++;
    if (f.k === "flicky") { if (f.t > 20) { f.vy += 0.1; f.x += f.vx; f.y += f.vy; if (f.vy > 1) f.vy = -3.5; } }
    if (f.k === "icon") f.y -= f.t < 30 ? 1 : 0;
  }
  G.fx = G.fx.filter((f) => !((f.k === "boom" && f.t > 24) || (f.k === "sparkle" && f.t > 24) || (f.k === "flicky" && f.t > 200) || (f.k === "icon" && f.t > 60)));
}
function timeBonus() {
  const s = Math.floor(G.time / 60);
  if (s < 30) return 50000; if (s < 45) return 10000; if (s < 60) return 5000;
  if (s < 90) return 4000; if (s < 120) return 3000; if (s < 180) return 2000; if (s < 240) return 1000;
  if (s < 300) return 500; return 0;
}

// ---------- camera ----------
function updateCamera() {
  if (!P.dead) {
    const tx = P.x - VW / 2 + 16;
    if (tx > G.camX + 16) G.camX = Math.min(tx - 16, G.camX + 16);
    if (tx < G.camX - 16) G.camX = Math.max(tx + 16, G.camX - 16);
    let ty = P.y - 120 + (P.lookup && P.idleT > 60 ? -60 : 0) + (P.crouch ? 50 : 0);
    const dy = ty - G.camY;
    G.camY += Math.max(-16, Math.min(16, P.ground ? dy * 0.25 : (Math.abs(dy) > 32 ? dy - Math.sign(dy) * 32 : 0)));
  }
  G.camX = Math.max(0, Math.min(L.w - VW, G.camX));
  G.camY = Math.max(0, Math.min(L.h - VH, G.camY));
}

// ---------- drawing ----------
function drawBackground(scrollX, camY = 400) {
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, VW, VH);
  const factors = [0.04, 0.06, 0.08, 0.12, 0.2, 0.3];
  const hs = [0, 1, 2, 3, 4].map((i) => (IMG["bg" + i].height || 0));
  const horizon = 150 - Math.max(-30, Math.min(40, (camY - 400) * 0.06));
  let y = horizon - hs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 6; i++) {
    const im = IMG["bg" + i];
    if (!im.naturalWidth) continue;
    const drift = i < 3 ? G.t * (0.15 - i * 0.04) : 0;
    let ox = -((scrollX * factors[i] + drift) % im.width);
    if (ox > 0) ox -= im.width;
    const yy = i === 5 ? horizon : y;
    for (let x = ox; x < VW; x += im.width) ctx.drawImage(im, Math.round(x), Math.round(yy));
    if (i === 5) { ctx.fillStyle = "#0090fd"; ctx.fillRect(0, yy + im.height, VW, VH); }
    if (i < 5) y += im.height;
  }
}
function drawLevel() {
  const ch = levelChunks(L);
  const cx = Math.floor(G.camX), cy = Math.floor(G.camY);
  const i0 = Math.floor(cx / L.chunk), i1 = Math.floor((cx + VW) / L.chunk);
  for (let i = i0; i <= i1 && i < ch.length; i++) {
    const im = ch[i];
    if (im.complete && im.naturalWidth) ctx.drawImage(im, i * L.chunk - cx, -cy);
  }
  for (const [x0, x1, by] of L.bridges) {
    for (let x = x0 + 2; x < x1 - 8; x += 16) spr("log", x - cx, by - 4 - cy);
  }
}
function drawObjects() {
  const cx = G.camX, cy = G.camY;
  const ringFrame = ["ring1", "ring2", "ring3", "ring2"][Math.floor(G.t / 8) % 4];
  for (const o of G.objs) {
    if (!o.alive && o.type !== "spring") continue;
    const sx = o.x - cx, sy = o.y - cy;
    if (sx < -80 || sx > VW + 80) continue;
    switch (o.type) {
      case "ring": sprC(ringFrame, sx, sy, Math.floor(G.t / 8) % 4 === 3); break;
      case "spring": sprBC(o.up > 0 ? "spring_yel_up" : "spring_yel", sx, sy); break;
      case "monitor":
        sprBC("monitor", sx, sy);
        if (Math.floor(G.t / 4) % 8) sprC("icon_" + o.kind, sx, sy - 18);
        break;
      case "spikes": for (let k = -1.5; k <= 1.5; k++) sprBC("spike", sx + k * 10, sy); break;
      case "sign": {
        const seq = ["sign_robotnik", "sign_edge", "sign_thin", "sign_edge", "sign_sonic", "sign_edge", "sign_thin", "sign_edge"];
        const n = o.state === 0 ? "sign_robotnik" : o.state === 2 || o.t > 120 ? "sign_sonic" : seq[Math.floor(o.t / 4) % seq.length];
        sprBC(n, sx, sy);
        break;
      }
      case "moto": sprBC("moto" + (1 + o.fr), sx, sy, o.dir > 0); break;
      case "crab": sprBC(o.state === 1 ? "crab3" : "crab" + (1 + o.fr), sx, sy); break;
      case "buzz": sprC("buzz" + (1 + o.fr), sx, sy, o.dir > 0); break;
    }
  }
  for (const s of G.shots) sprC("crab_ball", s.x - cx, s.y - cy);
  for (const r of G.lost) {
    if (r.t > 180 && r.t % 4 < 2) continue;
    sprC(["ring1", "ring2", "ring3", "ring2"][Math.floor(r.t / 4) % 4], r.x - cx, r.y - cy);
  }
  for (const f of G.fx) {
    const sx = f.x - cx, sy = f.y - cy;
    if (f.k === "boom") sprC("boom" + (1 + Math.min(4, Math.floor(f.t / 5))), sx, sy);
    else if (f.k === "sparkle") sprC("sparkle" + (1 + Math.min(3, Math.floor(f.t / 6))), sx, sy);
    else if (f.k === "flicky") sprC("flicky" + (1 + Math.floor(f.t / 6) % 2), sx, sy, true);
    else if (f.k === "icon") sprC("icon_" + f.icon, sx, sy);
  }
  for (const o of G.objs) if (o.type === "monitor" && !o.alive) sprBC("monitor_broken", o.x - cx, o.y - cy);
}
const ANIMS = {
  idle: ["idle"], walk: ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6"], run: ["run1", "run2", "run3", "run4"],
  roll: ["roll1", "roll5", "roll2", "roll5", "roll3", "roll5", "roll4", "roll5"], skid: ["skid1", "skid2"],
  push: ["push1", "push2", "push3", "push4"], crouch: ["crouch"], lookup: ["lookup"], hurt: ["hurt"], spring: ["spring"],
};
function drawPlayer() {
  if (P.inv > 0 && !P.hurt && Math.floor(P.inv / 3) % 2) return;
  let name;
  if (P.dead) name = "death";
  else if (P.anim === "idle" && P.idleT > 180) name = ["bored1", "bored2"][Math.floor(P.idleT / 20) % 2];
  else { const a = ANIMS[P.anim] || ANIMS.idle; name = a[P.frame % a.length]; }
  const key = "sonic_" + name;
  const im = IMG[key], m = META[key];
  if (!im || !im.naturalWidth || !m) return;
  const sx = Math.round(P.x - G.camX), sy = Math.round(P.y - G.camY);
  const flip = P.face < 0;
  ctx.save();
  ctx.translate(sx, sy);
  if (P.ground && !P.rolling && Math.abs(P.ang) > 0.35) { ctx.translate(0, -18); ctx.rotate(Math.round(P.ang / (Math.PI / 4)) * Math.PI / 4); ctx.translate(0, 18); }
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, m.ox, m.oy);
  ctx.restore();
  if (P.shield && !P.dead) {
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(G.t / 3);
    ctx.strokeStyle = "#9ad0ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy - 18, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(120,170,255,0.25)"; ctx.fill();
    ctx.globalAlpha = 1;
  }
}
function drawNumber(n, rightX, y, small = false) {
  const s = String(Math.max(0, Math.floor(n)));
  const w = small ? 8 : 8;
  for (let i = 0; i < s.length; i++) spr((small ? "sdigit" : "digit") + s[s.length - 1 - i], rightX - (i + 1) * w, y);
}
function drawHUD() {
  spr("hud_score", 16, 8); drawNumber(G.score, 120, 8);
  spr("hud_time", 16, 24);
  const secs = Math.floor(G.time / 60);
  drawNumber(Math.floor(secs / 60), 72, 24);
  ctx.fillStyle = "#fff"; ctx.fillRect(74, 28, 2, 2); ctx.fillRect(74, 33, 2, 2);
  const ss = String(secs % 60).padStart(2, "0");
  spr("digit" + ss[0], 78, 24); spr("digit" + ss[1], 86, 24);
  spr(G.rings === 0 && Math.floor(G.t / 8) % 2 ? "hud_rings_red" : "hud_rings", 16, 40); drawNumber(G.rings, 96, 40);
  spr("hud_lives", 16, VH - 26);
  ctx.fillStyle = "#fff"; ctx.font = "bold 8px monospace"; ctx.fillText("×", 36, VH - 13);
  drawNumber(G.lives, 54, VH - 18, true);
}
function text(str, x, y, size = 12, color = "#fff", align = "center") {
  ctx.font = `bold ${size}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- screens ----------
function drawTitle() {
  drawBackground(G.t * 3, 400);
  const lg = IMG.logo, ts = IMG.title_sonic;
  if (ts.naturalWidth) spr("title_sonic", VW / 2 - ts.width / 2 + 60, 46 + Math.sin(G.t / 20) * 2);
  if (lg.naturalWidth) {
    ctx.save(); ctx.translate(VW / 2 - 110, 70); ctx.scale(2, 2); ctx.drawImage(lg, -lg.width / 2, -lg.height / 2); ctx.restore();
  }
  text("GREEN HILL ZONE", VW / 2 - 110, 112, 12, "#ffe14a");
  text("BETA PROTOTYPE", VW / 2 - 110, 130, 10, "#ff6a6a");
  if (Math.floor(G.t / 30) % 2 === 0) text("PRESS START", VW / 2, 196, 14);
  text("Arrows: move   Down: roll   Space/Z: jump   Enter: pause", VW / 2, 216, 8, "#cfe");
}
function drawCard() {
  const k = G.modeT;
  const im = IMG["card" + (G.act + 1)];
  const fade = k < 20 ? 1 : Math.max(0, 1 - (k - 20) / 30);
  if (k < 110) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, VW, VH); }
  if (im && im.naturalWidth) {
    let x = VW / 2 - im.width / 2;
    if (k < 25) x += (25 - k) * 20;
    if (k > 110) x -= (k - 110) * 24;
    ctx.fillStyle = "#1438a8"; ctx.fillRect(0, VH / 2 - 40 - (k < 25 ? (25 - k) * 8 : 0), VW, 4);
    spr("card" + (G.act + 1), x, VH / 2 - im.height / 2);
  }
}
function drawResults() {
  const k = G.modeT, T = G.tally;
  const im = IMG.passed;
  if (im.naturalWidth) spr("passed", Math.min(VW / 2 - im.width / 2, -im.width + k * 12), 40);
  if (k > 40) {
    spr("hud_score", 110, 110); drawNumber(G.score, 290, 110);
    text("TIME BONUS", 110, 136, 11, "#ffe14a", "left"); drawNumber(T.time, 290, 130);
    text("RING BONUS", 110, 158, 11, "#ffe14a", "left"); drawNumber(T.ring, 290, 152);
  }
}
function updateResults() {
  G.modeT++;
  const T = G.tally;
  if (G.modeT > 110 && (T.time > 0 || T.ring > 0)) {
    const a = Math.min(100, T.time), b = Math.min(100, T.ring);
    T.time -= a; T.ring -= b; G.score += a + b;
    if (G.modeT % 6 === 0) SFX.tally();
    G.tallyDone = G.modeT;
  } else if (G.modeT > 110 && G.modeT - (G.tallyDone || 110) > 150) {
    if (G.act + 1 < ACTS.length) loadAct(G.act + 1);
    else { G.mode = "ending"; G.modeT = 0; }
  }
}
function drawEnding() {
  drawBackground(G.t * 4, 400);
  spr("title_sonic", VW / 2 - IMG.title_sonic.width / 2, 30);
  text("CONGRATULATIONS!", VW / 2, 176, 16, "#ffe14a");
  text("You cleared Green Hill Zone   Score " + G.score, VW / 2, 196, 10);
  if (Math.floor(G.t / 30) % 2 === 0) text("PRESS START", VW / 2, 214, 10);
}
function drawGameOver() {
  const k = Math.min(G.modeT * 6, VW / 2);
  const g = IMG.gameover;
  if (g.naturalWidth) {
    ctx.drawImage(g, 0, 0, 72, g.height, k - 72 - 6, VH / 2 - g.height / 2, 72, g.height);
    ctx.drawImage(g, 72, 0, g.width - 72, g.height, VW - k + 6, VH / 2 - g.height / 2, g.width - 72, g.height);
  }
}

// ---------- main loop ----------
function startGame() {
  G.score = 0; G.lives = 3;
  loadAct(0);
}
function step() {
  G.t++;
  if (pending > 0 && G.t < 600) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
    text("LOADING...", VW / 2, VH / 2, 12);
    for (const k in pressed) pressed[k] = false;
    return;
  }
  switch (G.mode) {
    case "boot":
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
      if (Math.floor(G.t / 30) % 2 === 0) text("PRESS ANY KEY", VW / 2, VH / 2, 12);
      if (pressed.start || pressed.jump || pressed.left || pressed.right || pressed.up || pressed.down) { G.mode = "sega"; G.modeT = 0; }
      break;
    case "sega": {
      G.modeT++;
      const k = G.modeT;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, VW, VH);
      // sweep: frames 0-19, then the logo cycles through its palettes (20-23)
      const f = k < 40 ? Math.floor(k / 2) : k < 64 ? 20 + Math.floor((k - 40) / 8) : 23;
      spr("sega" + Math.min(23, f), (VW - 320) / 2, 0);
      if (k === 64) SFX.sega();
      if (k > 190) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (k - 190) / 20)})`; ctx.fillRect(0, 0, VW, VH); }
      if (k > 212 || (k > 10 && pressed.start)) { G.mode = "title"; G.modeT = 0; }
      break;
    }
    case "title":
      drawTitle();
      if (pressed.start || pressed.jump) startGame();
      break;
    case "ending":
      drawEnding();
      if ((pressed.start || pressed.jump) && G.t > 60) { G.mode = "title"; }
      break;
    case "gameover":
      G.modeT++;
      render();
      drawGameOver();
      if (G.modeT > 240 || ((pressed.start || pressed.jump) && G.modeT > 60)) G.mode = "title";
      break;
    case "card":
      G.modeT++;
      if (G.modeT > 60) { updatePlayer(); updateCamera(); }
      render();
      drawCard();
      if (G.modeT > 135) G.mode = "play";
      break;
    case "results":
      updatePlayer(); updateCamera();
      if (P.ground) { P.gsp = Math.min(P.gsp + 0.1, 4); }
      render();
      drawResults();
      updateResults();
      break;
    case "play":
      if (pressed.start) G.paused = !G.paused;
      if (!G.paused) {
        if (P.control && !P.dead) G.time++;
        if (G.time >= 60 * 60 * 10 - 1 && !P.dead) killPlayer();
        updatePlayer();
        updateObjects();
        updateShots();
        updateLostRings();
        updateFx();
        updateCamera();
      }
      render();
      if (G.paused) text("PAUSE", VW / 2, VH / 2, 18);
      break;
  }
  for (const k in pressed) pressed[k] = false;
}
function render() {
  drawBackground(G.camX, G.camY);
  drawLevel();
  drawObjects();
  drawPlayer();
  drawHUD();
}

// fixed 60 Hz simulation regardless of display refresh rate
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  let n = 0;
  while (acc >= 1000 / 60 && n < 4) {
    acc -= 1000 / 60; n++;
    for (let k = 0; k < (window.__sonicSpeed || 1); k++) step();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (location.hash === "#debug") window.__sonic = { G, get P() { return P; }, get L() { return L; }, loadAct };
})();
