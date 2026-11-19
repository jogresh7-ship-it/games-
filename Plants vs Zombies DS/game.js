(() => {
"use strict";
// PvZ Together — debug singleplayer build
// Grid: 9 columns x 5 rows. Peashooter idle animation via peaidle1-8.png.

// Eased fades can overshoot by a hair (e.g. 1.0005), and the browser throws on
// any volume outside 0..1, which used to kill the level-transition sequence.
(() => {
  const volumeProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  if (!volumeProp || !volumeProp.set || HTMLMediaElement.prototype.__volumeClamped) return;
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    configurable: true,
    enumerable: volumeProp.enumerable,
    get() { return volumeProp.get.call(this); },
    set(value) {
      const v = Number(value);
      volumeProp.set.call(this, Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    },
  });
  HTMLMediaElement.prototype.__volumeClamped = true;
})();

const COLS = 9;
const ROWS = 5;
// ---------- Campaign config ----------
// Each level tunes the regular trickle, cone odds and the final horde.
const MAX_LEVEL = 10;
const LEVELS = {
  1:  { regular: 7,  interval: 25, cone: 0,    horde: [7, 8] },
  2:  { regular: 7,  interval: 25, cone: 0,    horde: [10, 25] },
  3:  { regular: 7,  interval: 25, cone: 0.55, horde: [10, 25] },
  4:  { regular: 7,  interval: 25, cone: 0.62, horde: [10, 25] },
  5:  { regular: 8,  interval: 22, cone: 0.5,  horde: [14, 22] },
  6:  { regular: 9,  interval: 20, cone: 0.55, horde: [16, 24] },
  7:  { regular: 10, interval: 18, cone: 0.6,  horde: [18, 26] },
  8:  { regular: 11, interval: 16, cone: 0.65, horde: [20, 28] },
  9:  { regular: 12, interval: 14, cone: 0.7,  horde: [22, 30] },
  10: { regular: 14, interval: 12, cone: 0.75, horde: [26, 34] },
};
function levelCfg() { return LEVELS[game.levelIndex] || LEVELS[MAX_LEVEL]; }
// Plant -> level it first becomes usable on. Beating level N-1 hands you the packet.
const PLANT_UNLOCK_LEVEL = { peashooter: 1, sunflower: 2, cherrybomb: 3, walnut: 4, snowpea: 5, repeater: 6 };
function rewardPlantFor(level) {
  return Object.keys(PLANT_UNLOCK_LEVEL).find((t) => PLANT_UNLOCK_LEVEL[t] === level + 1) || null;
}
const SAVE_KEY = "pvzds_websim_progress";
function loadProgress() {
  try {
    const n = Number(JSON.parse(localStorage.getItem(SAVE_KEY) || "{}").level);
    return n >= 1 && n <= MAX_LEVEL ? Math.floor(n) : 1;
  } catch (e) { return 1; }
}
function saveProgress(level) {
  try {
    const best = Math.max(loadProgress(), Math.min(MAX_LEVEL, level));
    localStorage.setItem(SAVE_KEY, JSON.stringify({ level: best }));
  } catch (e) {}
}
function unlockedRows() { return game.levelIndex === 1 ? [2] : game.levelIndex >= 4 ? [0, 1, 2, 3, 4] : [1, 2, 3]; }
function seedLocked(type) {
  return (PLANT_UNLOCK_LEVEL[type] || 1) > game.levelIndex;
}
function levelLabel() { return "Level 1-" + (game.levelIndex || 1); }
const REF_W = 800;
const REF_H = 1212;
const LOW_PERFORMANCE_DEVICE = Boolean(
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (window.matchMedia && window.matchMedia("(update: slow)").matches)
);
document.documentElement.classList.toggle("low-performance", LOW_PERFORMANCE_DEVICE);

const PLANTS = {
  peashooter: {
    name: "Peashooter",
    cost: 100,
    icon: "hotbarpea.png",
    cooldown: 15, // seconds
    shooter: true,
    idlePrefix: "peaidle",
    idle: [1, 2, 3, 4, 5, 6, 7, 8],
    idleFps: 6,
  },
  sunflower: {
    name: "Sunflower",
    cost: 50,
    icon: "hotbarsun.png",
    cooldown: 7.5, // seconds
    idlePrefix: "sunidle",
    idle: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    idleFps: 6,
    sunReward: 25,
    sunInterval: 20, // seconds between sun productions
  },
  cherrybomb: {
    name: "Cherry Bomb",
    cost: 150,
    icon: "CherryBombSeed.png",
    cooldown: 50,
    instant: true,
  },
  snowpea: {
    name: "Snow Pea",
    cost: 175,
    icon: "hotbarsnowpea.png",
    cooldown: 15,
    idlePrefix: "peaidle",
    idle: [1, 2, 3, 4, 5, 6, 7, 8],
    idleFps: 6,
    shooter: true,
    frost: true,
    tint: "snowpea",
  },
  repeater: {
    name: "Repeater",
    cost: 200,
    icon: "hotbarrepeater.png",
    cooldown: 15,
    idlePrefix: "peaidle",
    idle: [1, 2, 3, 4, 5, 6, 7, 8],
    idleFps: 7,
    shooter: true,
    burst: 2,
    tint: "repeater",
  },
  walnut: {
    name: "Walnut",
    cost: 50,
    icon: "hotbarwalnut.png",
    cooldown: 20, // seconds
    idleFps: 6,
    hp: 350, // wall plant: lots of health
    // Damage stages shown as the walnut gets eaten. `min` is the fraction of
    // full HP below which this stage is shown.
    stages: [
      { min: 0.66, prefix: "walnutnorm", idle: [1] },
      { min: 0.33, prefix: "walnuthurt", idle: [1] },
      { min: 0, prefix: "walnutveryhurt", idle: [1] },
    ],
  },
};

const state = (window.__state = window.__state || {
  sun: 50,
  selected: null, // "peashooter" | null
  grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), // null | { type }
  cdEnd: {}, // type -> timestamp when cooldown ends (0 = ready)
});

// ---------- DOM refs ----------
const stageEl = document.getElementById("stage");
const gameScreenBlackout = document.getElementById("game-screen-blackout");
const topScreenBlackout = document.getElementById("top-screen-blackout");
const houseLabel = document.getElementById("house-label");
const topScreenZombieLayer = document.getElementById("top-screen-zombie-layer");
const levelProgressEl = document.getElementById("level-progress");
const levelProgressFill = document.getElementById("level-progress-fill");
const levelProgressHead = document.getElementById("level-progress-head");
const progressFlag = document.getElementById("progress-flag");
const lawn = document.getElementById("lawn");
const yardPan = document.getElementById("yard-pan");
const houseArt = document.getElementById("house-art");
const lawnGrid = document.getElementById("lawn-grid");
const laneRollLayer = document.getElementById("lane-roll-layer");
const roadZombieLayer = document.getElementById("road-zombies");
const ROAD_ZOMBIE_FRAMES = Array.from({ length: 5 }, (_, i) => `uploads/Zombie_Idle${i + 1}.png`);
const ROAD_CONE_ZOMBIE_FRAMES = Array.from({ length: 5 }, (_, i) => `uploads/ConeZombieidle${i + 1}.png`);
let roadZombieAnimationTimer = null;
const plantLayer = document.getElementById("plant-layer");
const hitLayer = document.getElementById("cell-hitlayer");
const sunLayer = document.getElementById("sun-layer");
const tutorialBar = document.getElementById("tutorial-bar");
const tutorialText = document.getElementById("tutorial-text");
const sunCounterEl = document.getElementById("sun-counter");
const sunAmountEl = document.getElementById("sun-amount");
const scaler = document.getElementById("scaler");
const shovelButton = document.getElementById("shovel-button");
const shovelCursor = document.getElementById("shovel-cursor");

// ---------- Scale to fit viewport ----------
function fit() {
  const horizontal = scaler.classList.contains("layout-side-by-side") || scaler.classList.contains("layout-side-reversed");
  const width = horizontal ? 1612 : REF_W;
  const height = horizontal ? 600 : REF_H;
  const s = Math.min(window.innerWidth / width, window.innerHeight / height);
  scaler.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener("resize", fit);
fit();

// ---------- Build lawn grid + hit cells + plant slots ----------
const cellEls = (window.__cellEls = window.__cellEls || []);
if (!window.__gridBuilt) {
  window.__gridBuilt = true;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const base = document.createElement("div");
      base.className = "cell " + ((r + c) % 2 === 0 ? "light" : "dark");
      lawnGrid.appendChild(base);

      const slot = document.createElement("div");
      slot.className = "plant-slot";
      plantLayer.appendChild(slot);

      const hit = document.createElement("div");
      hit.className = "cell-hit";
      hit.dataset.r = r;
      hit.dataset.c = c;
      hit.addEventListener("click", () => onCellClick(r, c));
      hit.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        hit.classList.add("plantable");
      });
      hit.addEventListener("dragleave", () => hit.classList.remove("plantable"));
      hit.addEventListener("drop", (ev) => {
        ev.preventDefault();
        hit.classList.remove("plantable");
        onCellClick(r, c);
      });
      hitLayer.appendChild(hit);

      cellEls.push({ r, c, slot, hit, base });
    }
  }
}

// ---------- Sprite cache + idle animation manager ----------
const spriteCache = (window.__spriteCache = window.__spriteCache || new Map());
function cacheSprite(src) {
  let image = spriteCache.get(src);
  if (!image) {
    image = new Image();
    image.src = src;
    spriteCache.set(src, image);
  }
  return image;
}
function showSpriteWhenReady(img, src) {
  if (img.dataset.spriteSrc === src) return;
  img.dataset.spriteSrc = src;
  const cached = cacheSprite(src);
  if (cached.complete) {
    if (cached.naturalWidth > 0) img.src = src;
    return;
  }
  cached.addEventListener("load", () => {
    if (img.dataset.spriteSrc === src && img.isConnected) img.src = src;
  }, { once: true });
}
const animators = (window.__animators = window.__animators || []); // { img, def, frame, acc, cell }

// Pick which animation frames to show for a plant based on its remaining HP.
// Plants without damage stages (peashooter, sunflower) always use def.idle.
function stageFor(def, hp) {
  if (!def.stages) return { prefix: def.idlePrefix, idle: def.idle };
  const frac = (hp ?? def.hp) / def.hp;
  for (const s of def.stages) {
    if (frac >= s.min) return s;
  }
  return def.stages[def.stages.length - 1];
}

function stepAnims(now) {
  for (const a of animators) {
    const stage = stageFor(a.def, a.cell.hp);
    const frames = stage.idle;
    const period = 1000 / (a.def.idleFps || 6);
    const frame = Math.floor(Math.max(0, now - a.startedAt) / period) % frames.length;
    if (frame !== a.frame || stage.prefix !== a.prefix) {
      a.frame = frame;
      a.prefix = stage.prefix;
      showSpriteWhenReady(a.img, stage.prefix + frames[frame] + '.png');
    }
  }
}

// ---------- Seed packets ----------
function buildSeedPackets() {
  const seedbar = document.getElementById("seedbar");
  seedbar.innerHTML = "";
  for (const [type, def] of Object.entries(PLANTS)) {
    const el = document.createElement("div");
    el.className = "seed-packet";
    el.classList.toggle("intro-locked", !game.canPlant);
    el.classList.toggle("temporarily-locked", seedLocked(type));
    el.id = `seed-${type}`;
    el.dataset.seed = type;
    el.innerHTML = `<div class="seed-icon"></div><span class="seed-cost">${def.cost}</span><span class="seed-cd"></span>`;
    const img = document.createElement("img");
    img.draggable = false;
    img.src = def.icon;
    const icon = el.querySelector(".seed-icon");
    icon.style.setProperty("--seed-mask", `url("${def.icon}")`);
    icon.appendChild(img);
    el._icon = img;
    el._cd = el.querySelector(".seed-cd");
    el.addEventListener("pointerdown", (ev) => seedPointerDown(ev, type));
    el.addEventListener("click", (ev) => {
      if (suppressSeedClick === type) {
        suppressSeedClick = null;
        clearTimeout(suppressSeedClickTimer);
        suppressSeedClickTimer = null;
        ev.preventDefault();
        return;
      }
      toggleSeed(type);
    });
    seedbar.appendChild(el);
  }
}

// ---------- Pointer-based seed dragging ----------
// Native HTML5 drag & drop is unreliable inside the embedded preview and does
// not work with touch at all. Dragging is reimplemented on pointer events so a
// seed can be dragged on mouse AND touch: press a seed to grab it (it costs
// sun/cooldown-checked), drag a ghost across the lawn, and release over a cell
// to plant. A short press on the seed with no drag is just a click -> the
// toggle-select behavior.
let dragPending = null; // { type, x, y } — press recorded, not yet a drag
let drag = null; // { type, ghost, el } — an active drag
let activeSeedPointerId = null;
let suppressSeedClick = null;
let suppressSeedClickTimer = null;

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(".cell-hit") : null;
}

function clearDragCells() {
  document.querySelectorAll(".cell-hit.plantable").forEach((h) => h.classList.remove("plantable"));
}

function seedPointerDown(ev, type) {
  if (!game.canPlant || seedLocked(type) || ev.isPrimary === false) return;
  if (ev.button !== undefined && ev.button !== 0) return;
  if (activeSeedPointerId !== null) return;
  const el = document.getElementById(`seed-${type}`);
  if (el.classList.contains("cooling") || state.sun < PLANTS[type].cost) return;
  activeSeedPointerId = ev.pointerId ?? -1;
  dragPending = { type, x: ev.clientX, y: ev.clientY };
  if (ev.pointerId !== undefined && el.setPointerCapture) {
    try { el.setPointerCapture(ev.pointerId); } catch {}
  }
}

function beginDrag() {
  const p = dragPending;
  if (!p) return;
  dragPending = null;
  selectSeed(p.type);
  playPickupSound();
  const ghost = document.createElement("img");
  ghost.className = "drag-ghost";
  ghost.src = PLANTS[p.type].icon;
  ghost.style.left = p.x + "px";
  ghost.style.top = p.y + "px";
  document.body.appendChild(ghost);
  drag = { type: p.type, ghost, el: document.getElementById(`seed-${p.type}`) };
}

function endDrag(ev) {
  if (!drag) return;
  const target = cellFromPoint(ev.clientX, ev.clientY);
  clearDragCells();
  if (drag.ghost) drag.ghost.remove();
  const type = drag.type;
  drag = null;
  if (target != null) {
    onCellClick(Number(target.dataset.r), Number(target.dataset.c));
  } else {
    // Dropped nowhere plantable: release the seed selection.
    state.selected = null;
    document.querySelectorAll(".seed-packet").forEach((p) => p.classList.remove("selected"));
  }
}

function selectSeed(type) {
  document.querySelectorAll(".seed-packet").forEach((p) => p.classList.remove("selected"));
  state.selected = type;
  const el = document.getElementById(`seed-${type}`);
  if (el) el.classList.add("selected");
}

// Global pointer tracking: a press becomes a drag only after moving past a
// small threshold; a short press is handled by the seed's click event.
document.addEventListener("pointermove", (ev) => {
  if (activeSeedPointerId === null || (ev.pointerId !== undefined && activeSeedPointerId !== ev.pointerId)) return;
  if (dragPending) {
    const dx = ev.clientX - dragPending.x;
    const dy = ev.clientY - dragPending.y;
    if (dx * dx + dy * dy > 36) beginDrag();
  }
  if (drag && drag.ghost) {
    drag.ghost.style.left = ev.clientX + "px";
    drag.ghost.style.top = ev.clientY + "px";
    clearDragCells();
    const target = cellFromPoint(ev.clientX, ev.clientY);
    if (target) target.classList.add("plantable");
  }
});

function finishPress(ev) {
  if (ev.pointerId !== undefined && activeSeedPointerId !== null && activeSeedPointerId !== ev.pointerId) return;
  const draggedType = drag?.type ?? null;
  if (drag) {
    endDrag(ev);
    drag = null;
    suppressSeedClick = draggedType;
    clearTimeout(suppressSeedClickTimer);
    suppressSeedClickTimer = setTimeout(() => { suppressSeedClick = null; }, 350);
  } else if (dragPending) {
    // Short press with no movement: this is a click, so let toggleSeed run.
    dragPending = null;
  }
  activeSeedPointerId = null;
}
function cancelSeedPress(ev) {
  if (ev.pointerId !== undefined && activeSeedPointerId !== null && activeSeedPointerId !== ev.pointerId) return;
  dragPending = null;
  activeSeedPointerId = null;
  if (drag?.ghost) drag.ghost.remove();
  drag = null;
  clearDragCells();
}
window.addEventListener("pointerup", finishPress);
window.addEventListener("pointercancel", cancelSeedPress);
window.addEventListener("mouseup", finishPress);

function toggleSeed(type) {
  if (!game.canPlant || seedLocked(type)) return;
  const el = document.getElementById(`seed-${type}`);
  if (el.classList.contains("cooling")) {
    flashSeed(el);
    blinkCooldownTimer(el);
    return;
  }
  if (state.sun < PLANTS[type].cost && state.selected !== type) {
    flashSeed(el);
    blinkSunCounter();
    return;
  }
  document.querySelectorAll(".seed-packet").forEach((p) => p.classList.remove("selected"));
  if (state.selected === type) {
    state.selected = null;
  } else {
    state.selected = type;
    el.classList.add("selected");
    playPickupSound();
  }
}

// Flash the seed packet red to show it can't be afforded right now.
function flashSeed(el, playSound = true) {
  el.classList.remove("insuff-flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("insuff-flash");
  if (playSound) playErrorSound();
}

function blinkSunCounter() {
  sunAmountEl.classList.remove("sun-insuff-blink");
  void sunAmountEl.offsetWidth;
  sunAmountEl.classList.add("sun-insuff-blink");
}

function blinkCooldownTimer(el) {
  el.classList.remove("cooldown-blink");
  void el.offsetWidth;
  el.classList.add("cooldown-blink");
}

// ---------- Cooldowns ----------
function startCooldown(type) {
  const def = PLANTS[type];
  const el = document.getElementById(`seed-${type}`);
  state.cdEnd[type] = Date.now() + def.cooldown * 1000;
  el.classList.add("cooling");
  updateCooldowns();
}

function updateCooldowns() {
  for (const type of Object.keys(PLANTS)) {
    const el = document.getElementById(`seed-${type}`);
    const end = state.cdEnd[type];
    if (!end) continue; // no active cooldown
    const remaining = (end - Date.now()) / 1000;
    if (remaining > 0) {
      el.classList.add("cooling");
      el._cd.textContent = Math.ceil(remaining);
    } else {
      state.cdEnd[type] = null;
      el.classList.remove("cooling");
      el._cd.textContent = "";
    }
  }
}

// ---------- UI updates ----------
function updateSun() {
  sunAmountEl.textContent = state.sun;
  document.querySelectorAll(".seed-packet").forEach((p) => {
    const def = PLANTS[p.dataset.seed];
    p.classList.toggle("disabled", state.sun < def.cost);
  });
}

// ---------- Placing and shovel ----------
function setShovelActive(active) {
  game.shovelActive = active;
  shovelButton.querySelector("img").src = active ? "Shovel_Slot.png" : "Shovel_In_Slot.png";
  shovelCursor.classList.toggle("active", active);
  stageEl.classList.toggle("shovel-active", active);
  if (active) {
    state.selected = null;
    document.querySelectorAll(".seed-packet").forEach((packet) => packet.classList.remove("selected"));
  }
}

function removePlantAt(r, c) {
  if (!state.grid[r][c]) return false;
  state.grid[r][c] = null;
  const slot = cellEls.find((entry) => entry.r === r && entry.c === c).slot;
  for (let i = animators.length - 1; i >= 0; i--) {
    if (animators[i].img.parentElement === slot) animators.splice(i, 1);
  }
  const producerIndex = producers.findIndex((producer) => producer.slot === slot);
  if (producerIndex !== -1) producers.splice(producerIndex, 1);
  game.plantAnims = game.plantAnims.filter((job) => {
    if (job.dirt.parentElement !== slot) return true;
    job.dirt.remove();
    return false;
  });
  delete nextFire[`${r},${c}`];
  slot.innerHTML = "";
  return true;
}

function onCellClick(r, c) {
  if (!game.canPlant || !unlockedRows().includes(r) || (game.levelIndex === 1 && r !== 2)) return;
  if (game.shovelActive) {
    if (removePlantAt(r, c)) {
      playGameSfx("shovelRemove", shovelRemoveAudio);
      setShovelActive(false);
    }
    return;
  }
  if (!state.selected) return;
  const def = PLANTS[state.selected];
  const seedEl = document.getElementById(`seed-${state.selected}`);
  if (seedEl.classList.contains("cooling")) {
    flashSeed(seedEl);
    blinkCooldownTimer(seedEl);
    return;
  }
  if (state.sun < def.cost) {
    flashSeed(seedEl);
    blinkSunCounter();
    return;
  }
  if (state.grid[r][c]) return;

  state.sun -= def.cost;
  state.grid[r][c] = { type: state.selected, hp: def.hp ?? 20 };
  startCooldown(state.selected);
  updateSun();
  playPlantSound();
  if (def.instant) playCherryBomb(r, c);
  else playPlantAnim(r, c, def);
  if (def.sunReward) registerProducer(r, c, def);
  state.selected = null;
  document.querySelectorAll(".seed-packet").forEach((p) => p.classList.remove("selected"));
  if (game.levelIndex === 1 && def === PLANTS.peashooter) tutorialPeashooterPlanted();
  if (game.levelIndex === 2 && def === PLANTS.sunflower) tutorialSunflowerPlanted();
}

function playCherryBomb(r, c) {
  const slot = cellEls.find((entry) => entry.r === r && entry.c === c).slot;
  playGameSfx("cherryCharge", cherryChargeAudio);
  const bomb = document.createElement("img");
  bomb.className = "cherry-bomb-anim";
  bomb.draggable = false;
  bomb.src = "CBdeto1.png";
  slot.appendChild(bomb);
  const blast = () => {
    const effect = document.createElement("img");
    effect.className = "cherry-blast-sprite";
    effect.draggable = false;
    effect.src = "POWie1.png";
    effect.style.left = ((c + 0.5) / COLS * 100) + "%";
    effect.style.top = ((r + 0.5) / ROWS * 100) + "%";
    zombieLayer.appendChild(effect);
    for (let frame = 2; frame <= 8; frame++) {
      setTimeout(() => { if (effect.isConnected) effect.src = "POWie" + frame + ".png"; }, (frame - 1) * 62.5);
    }
    setTimeout(() => effect.remove(), 500);
    playGameSfx("cherryKaboom", cherryKaboomAudio);
    for (const z of [...zombies]) {
      const zombieCol = Math.max(0, Math.min(COLS - 1, Math.floor((z.x / 100) * COLS)));
      if (Math.abs(z.r - r) > 1 || Math.abs(zombieCol - c) > 1 || z.dead || z.crisped) continue;
      z.crisped = true;
      z.crispedTime = 0.75;
      z.eating = null;
      z.el.classList.add("zombie-crisped");
      z.img.src = "ZombieCrisped.png";
      recordZombieDefeat(z);
      setTimeout(() => {
        if (!z.crisped) return;
        z.el.remove();
        z.dead = true;
        const index = zombies.indexOf(z);
        if (index >= 0) zombies.splice(index, 1);
      }, 750);
    }
    state.grid[r][c] = null;
    setTimeout(() => { if (bomb.isConnected) bomb.remove(); }, 180);
  };
  [2, 3].forEach((frame, index) => {
    setTimeout(() => {
      if (!bomb.isConnected) return;
      bomb.src = "CBdeto" + frame + ".png";
    }, (index + 1) * 200);
  });
  setTimeout(() => {
    if (!bomb.isConnected) return;
    bomb.src = "CBdeto4.png";
    bomb.classList.add("cherry-bomb-charging");
    // Hold the final pose and shake through the end of the charge sound.
    setTimeout(() => {
      if (bomb.isConnected) blast();
    }, 300);
  }, 600);
}

function renderPlant(r, c, def) {
  const slot = cellEls.find((e) => e.r === r && e.c === c).slot;
  // Remove this slot's previous runner before clearing its image from the DOM.
  for (let i = animators.length - 1; i >= 0; i--) {
    if (animators[i].img.parentElement === slot) animators.splice(i, 1);
  }
  slot.innerHTML = "";
  const cell = state.grid[r][c];
  const img = document.createElement("img");
  img.draggable = false;
  const stage = stageFor(def, cell.hp);
  img.src = `${stage.prefix}${stage.idle[0]}.png`;
  if (def.tint) img.classList.add(`tint-${def.tint}`);
  slot.appendChild(img);
  animators.push({ img, def, frame: 0, prefix: stage.prefix, startedAt: performance.now(), cell });
}

const laneRollingAudio = new Audio("uploads/Lawn_Rolling.wav");
laneRollingAudio.preload = "auto";
laneRollingAudio.loop = true;
let laneRollAudioFadeFrame = 0;

function stopLaneRollingAudio() {
  if (laneRollAudioFadeFrame) cancelAnimationFrame(laneRollAudioFadeFrame);
  laneRollAudioFadeFrame = 0;
  laneRollingAudio.pause();
  laneRollingAudio.currentTime = 0;
  laneRollingAudio.volume = soundEffectsGain ? 1 : soundEffectsVolume;
}

function fadeOutLaneRollingAudio(durationMs) {
  const startedAt = performance.now();
  const fade = (now) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    laneRollingAudio.volume = (soundEffectsGain ? 1 : soundEffectsVolume) * (1 - progress);
    if (progress < 1) {
      laneRollAudioFadeFrame = requestAnimationFrame(fade);
      return;
    }
    laneRollAudioFadeFrame = 0;
    laneRollingAudio.pause();
    laneRollingAudio.currentTime = 0;
    laneRollingAudio.volume = soundEffectsGain ? 1 : soundEffectsVolume;
  };
  laneRollAudioFadeFrame = requestAnimationFrame(fade);
}

function resetGrassReveal() {
  stopLaneRollingAudio();
  laneRollLayer.classList.remove("rolling");
  laneRollLayer.replaceChildren();
  for (const { base, hit, r } of cellEls) {
    base.classList.toggle("grass-visible", game.levelIndex >= 5 ? true : game.levelIndex >= 3 ? (game.levelIndex === 3 ? unlockedRows().includes(r) : [1, 2, 3].includes(r)) : game.levelIndex === 2 && r === 2);
    base.classList.toggle("lane-locked", !unlockedRows().includes(r));
    hit.classList.toggle("lane-locked", !unlockedRows().includes(r));
  }
}

async function revealGrassLanes() {
  const stepMs = 240;
  const fadeSteps = Math.min(3, COLS);
  stopLaneRollingAudio();
  laneRollLayer.replaceChildren();
  laneRollLayer.style.setProperty("--lane-roll-duration", `${COLS * stepMs}ms`);
  if (game.levelIndex === 3 || game.levelIndex >= 5) {
    for (const { base, r } of cellEls) base.classList.toggle("grass-visible", unlockedRows().includes(r));
    return;
  }
  const rollingRows = game.levelIndex === 2 ? [1, 3] : game.levelIndex >= 4 ? [0, 4] : unlockedRows();
  for (const r of rollingRows) {
    const roll = document.createElement("div");
    roll.className = "lane-roll";
    roll.style.top = String(r * 20) + "%";
    const dirt = document.createElement("img");
    dirt.className = "lane-roll-dirt";
    dirt.src = "Lane_Roll.png";
    dirt.alt = "";
    const grassRollWrap = document.createElement("div");
    grassRollWrap.className = "lane-roll-wheel-wrap";
    const grassRoll = document.createElement("img");
    grassRoll.className = "lane-roll-wheel";
    grassRoll.src = "GrassRoll.png";
    grassRoll.alt = "";
    grassRollWrap.appendChild(grassRoll);
    roll.append(dirt, grassRollWrap);
    laneRollLayer.appendChild(roll);
  }
  laneRollLayer.classList.add("rolling");
  laneRollingAudio.currentTime = 0;
  laneRollingAudio.volume = soundEffectsGain ? 1 : soundEffectsVolume;
  laneRollingAudio.play().catch(() => {});
  for (let c = 0; c < COLS; c++) {
    if (c === COLS - fadeSteps) fadeOutLaneRollingAudio(fadeSteps * stepMs);
    for (const { c: cellColumn, base, r } of cellEls) {
      if (cellColumn === c && rollingRows.includes(r)) base.classList.add("grass-visible");
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  // The RAF-driven fade can be throttled in background tabs; never let the loop escape the reveal.
  stopLaneRollingAudio();
  laneRollLayer.classList.remove("rolling");
  laneRollLayer.replaceChildren();
}

// Restore saved plants after the lawn layers are rebuilt.
function renderGrid() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = state.grid[r][c];
      if (!cell) continue;
      const def = PLANTS[cell.type];
      if (!def) continue;
      renderPlant(r, c, def);
      if (def.sunReward) registerProducer(r, c, def);
    }
  }
}

// ---------- Plant-placement dirt animation ----------
// The plant appears instantly; dirt frames play on top of it, then clear.
// Tracked on `game` so a teardown/re-execution can't leave orphaned frames.
function playPlantAnim(r, c, def) {
  renderPlant(r, c, def);
  const slot = cellEls.find((e) => e.r === r && e.c === c).slot;
  const dirt = document.createElement("img");
  dirt.draggable = false;
  dirt.className = "dirt-anim";
  dirt.src = "plantdirt1.png"; // show frame 1 immediately
  slot.appendChild(dirt);
  const job = { dirt, frame: 1, last: 0, done: false };
  game.plantAnims.push(job);
}

function stepPlantAnims(now) {
  const anims = game.plantAnims;
  for (const job of anims) {
    if (job.done) continue;
    const interval = 1000 / 8;
    if (now - job.last < interval) continue;
    job.last = now;
    if (job.frame < 4) {
      job.dirt.src = `plantdirt${job.frame + 1}.png`;
      job.frame++;
    } else {
      job.done = true;
      job.dirt.remove();
    }
  }
  game.plantAnims = anims.filter((j) => !j.done);
}

// ---------- Plant sound ----------
// Reuses a single Audio node so rapid planting can't pile up overlapping
// "restart" plays and get noisy.
const plantAudio = (window.__plantAudio = window.__plantAudio || new Audio());
const cherryChargeAudio = (window.__cherryChargeAudio = window.__cherryChargeAudio || new Audio("uploads/CBcharging.wav"));
const cherryKaboomAudio = (window.__cherryKaboomAudio = window.__cherryKaboomAudio || new Audio("uploads/CBKaboom.wav"));
cherryChargeAudio.preload = cherryKaboomAudio.preload = "auto";
function preloadAudio(src) {
  plantAudio.preload = "auto";
  plantAudio.src = src;
  plantAudio.load();
}
preloadAudio("plant.wav");
function playPlantSound() {
  playGameSfx("plant", plantAudio);
}

// ---------- Plant pickup sound ----------
// Separate single Audio node for the drag-start sound (51.wav).
const pickupAudio = (window.__pickupAudio = window.__pickupAudio || new Audio());
pickupAudio.preload = "auto";
pickupAudio.src = "51.wav";
function playPickupSound() {
  playGameSfx("pickup", pickupAudio);
}

// ---------- Insufficient-sun error sound ----------
// Single Audio node for insufficient-sun and cooldown feedback.
const errorAudio = (window.__errorAudio = window.__errorAudio || new Audio());
errorAudio.preload = "auto";
errorAudio.src = "UCANTGETTHAT.wav";
function playErrorSound() {
  playGameSfx("error", errorAudio);
}
const pauseAudio = (window.__pauseAudio = window.__pauseAudio || new Audio());
pauseAudio.preload = "auto";
pauseAudio.src = "40.wav";
function playPauseSound() {
  playGameSfx("pause", pauseAudio);
}
const resumeAudio = (window.__resumeAudio = window.__resumeAudio || new Audio());
resumeAudio.preload = "auto";
resumeAudio.src = "Resume.wav";
function playResumeSound() {
  playGameSfx("resume", resumeAudio);
}
const menuClickAudio = (window.__menuClickAudio = window.__menuClickAudio || new Audio());
menuClickAudio.preload = "auto";
menuClickAudio.src = "Button_Click_Normal.wav";
const popAudio = (window.__popAudio = window.__popAudio || new Audio());
popAudio.preload = "auto";
popAudio.src = "Pop.wav";
const shovelPickupAudio = (window.__shovelPickupAudio = window.__shovelPickupAudio || new Audio());
shovelPickupAudio.preload = "auto";
shovelPickupAudio.src = "Shovel_Pickup.wav";
const shovelRemoveAudio = (window.__shovelRemoveAudio = window.__shovelRemoveAudio || new Audio());
shovelRemoveAudio.preload = "auto";
shovelRemoveAudio.src = "3F.wav";
function playMenuClickSound() {
  playGameSfx("menuClick", menuClickAudio);
}

// ---------- Intro sequence sounds ----------
// 4C.wav for READY + SET, 4D.wav for PLANT!.
const introReadyAudio = (window.__introReadyAudio = window.__introReadyAudio || new Audio());
const introPlantAudio = (window.__introPlantAudio = window.__introPlantAudio || new Audio());
introReadyAudio.preload = "auto";
introReadyAudio.src = "4C.wav";
introPlantAudio.preload = "auto";
introPlantAudio.src = "4D.wav";
function playIntroSound(ready) {
  const name = ready ? "introReady" : "introPlant";
  const node = ready ? introReadyAudio : introPlantAudio;
  let resolveEnded;
  const ended = new Promise((resolve) => { resolveEnded = resolve; });
  playGameSfx(name, node, resolveEnded);
  const buffer = gameSfxBuffers.get(name);
  return { duration: buffer?.duration || node.duration, ended };
}

// ---------- Background music ----------
// Plays 1s after the intro ("READY/SET/PLANT!") finishes.
const musicAudio = (window.__musicAudio = window.__musicAudio || new Audio());
musicAudio.preload = "auto";
musicAudio.src = "Plants_vs_Zombies_DS_-_Grasswalk__Fixed_Version_.mp3";
musicAudio.loop = true;
musicAudio.volume = 0.5;
const buildUpMusicAudio = (window.__buildUpMusicAudio = window.__buildUpMusicAudio || new Audio());
buildUpMusicAudio.preload = "auto";
buildUpMusicAudio.src = "uploads/grasswalk_Buildupver.mp3";
buildUpMusicAudio.loop = true;
buildUpMusicAudio.volume = 0.5;
const chooseSeedsAudio = (window.__chooseSeedsAudio = window.__chooseSeedsAudio || new Audio());
chooseSeedsAudio.preload = "auto";
chooseSeedsAudio.src = "Choose_Your_Seeds.mp3";
chooseSeedsAudio.loop = true;
chooseSeedsAudio.volume = 0.5;
const titleIntroAudio = (window.__titleIntroAudio = window.__titleIntroAudio || new Audio());
titleIntroAudio.preload = "auto";
titleIntroAudio.src = "CD_Intro_Music.mp3";
titleIntroAudio.loop = true;
titleIntroAudio.volume = 0.5;
let musicStarted = false;
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  chooseSeedsAudio.pause();
  chooseSeedsAudio.currentTime = 0;
  musicAudio.play().catch(() => {});
}
function resetBuildUpMusic() {
  buildUpMusicActive = false;
  buildUpMusicAudio.pause();
  buildUpMusicAudio.currentTime = 0;
  if (normalMusicTrackGain && eatingAudioContext) {
    normalMusicTrackGain.gain.cancelScheduledValues(eatingAudioContext.currentTime);
    normalMusicTrackGain.gain.setValueAtTime(1, eatingAudioContext.currentTime);
  }
  if (buildUpMusicTrackGain && eatingAudioContext) {
    buildUpMusicTrackGain.gain.cancelScheduledValues(eatingAudioContext.currentTime);
    buildUpMusicTrackGain.gain.setValueAtTime(0, eatingAudioContext.currentTime);
  }
}
function startBuildUpMusic() {
  if (buildUpMusicActive) return;
  buildUpMusicActive = true;
  const duration = buildUpMusicAudio.duration;
  const sourceTime = Number.isFinite(duration) && duration > 0
    ? musicAudio.currentTime % duration
    : musicAudio.currentTime;
  try { buildUpMusicAudio.currentTime = sourceTime; } catch (_) {}
  buildUpMusicAudio.play().catch(() => {});
  if (eatingAudioContext && normalMusicTrackGain && buildUpMusicTrackGain) {
    const now = eatingAudioContext.currentTime;
    const end = now + 1.8;
    normalMusicTrackGain.gain.cancelScheduledValues(now);
    buildUpMusicTrackGain.gain.cancelScheduledValues(now);
    normalMusicTrackGain.gain.setValueAtTime(normalMusicTrackGain.gain.value, now);
    buildUpMusicTrackGain.gain.setValueAtTime(buildUpMusicTrackGain.gain.value, now);
    normalMusicTrackGain.gain.linearRampToValueAtTime(0, end);
    buildUpMusicTrackGain.gain.linearRampToValueAtTime(1, end);
    setTimeout(() => { if (buildUpMusicActive) musicAudio.pause(); }, 1900);
  } else {
    const initialVolume = musicAudio.volume || 0.5;
    buildUpMusicAudio.volume = 0;
    const started = performance.now();
    const fade = (now) => {
      if (!buildUpMusicActive) return;
      const progress = Math.min(1, (now - started) / 1800);
      musicAudio.volume = initialVolume * (1 - progress);
      buildUpMusicAudio.volume = initialVolume * progress;
      if (progress < 1) requestAnimationFrame(fade);
      else musicAudio.pause();
    };
    requestAnimationFrame(fade);
  }
}

// ---------- Zombie eating sound ----------
const eatingAudio = (window.__eatingAudio = window.__eatingAudio || new Audio());
eatingAudio.preload = "auto";
eatingAudio.src = "Plant_Eating.mp3";
eatingAudio.loop = true;
let eatingAudioContext = window.__eatingAudioContext || null;
let audioLoFiFilter = window.__audioLoFiFilter || null;
let audioFallbackQuantizer = window.__audioFallbackQuantizer || null;
let soundEffectsGain = window.__soundEffectsGain || null;
let musicGain = window.__musicGain || null;
let chooseSeedsGain = window.__chooseSeedsGain || null;
let audioQualityNode = window.__audioQualityNode || null;
let audioQualityPromise = window.__audioQualityPromise || null;
const audioElementSources = window.__audioElementSources || (window.__audioElementSources = new WeakSet());
let soundEffectsVolume = 1;
let eatingFadeVolume = 1;
let normalMusicTrackGain = window.__normalMusicTrackGain || null;
let buildUpMusicTrackGain = window.__buildUpMusicTrackGain || null;
let buildUpMusicActive = false;
function prepareAudio() {
  // Opened straight from disk (file://), Chrome mutes <audio> routed through Web Audio
  // because local files count as cross-origin. Use plain <audio> playback there.
  if (location.protocol === "file:") return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!eatingAudioContext) {
      eatingAudioContext = window.__eatingAudioContext = new AudioContextClass();
      audioLoFiFilter = window.__audioLoFiFilter = eatingAudioContext.createBiquadFilter();
      audioLoFiFilter.type = "lowpass";
      audioLoFiFilter.frequency.value = 14500;
      soundEffectsGain = window.__soundEffectsGain = eatingAudioContext.createGain();
      soundEffectsGain.gain.value = soundEffectsVolume;
      musicGain = window.__musicGain = eatingAudioContext.createGain();
      musicGain.gain.value = Number(musicVolumeSlider.value);
      normalMusicTrackGain = window.__normalMusicTrackGain = eatingAudioContext.createGain();
      normalMusicTrackGain.gain.value = 1;
      buildUpMusicTrackGain = window.__buildUpMusicTrackGain = eatingAudioContext.createGain();
      buildUpMusicTrackGain.gain.value = 0;
      normalMusicTrackGain.connect(musicGain);
      buildUpMusicTrackGain.connect(musicGain);
      chooseSeedsGain = window.__chooseSeedsGain = eatingAudioContext.createGain();
      chooseSeedsGain.gain.value = 1;
      chooseSeedsGain.connect(musicGain);
      audioFallbackQuantizer = window.__audioFallbackQuantizer = eatingAudioContext.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const sample = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.round(sample * 2047) / 2047;
      }
      audioFallbackQuantizer.curve = curve;
      audioFallbackQuantizer.oversample = "none";
      soundEffectsGain.connect(audioLoFiFilter);
      musicGain.connect(audioLoFiFilter);
      audioLoFiFilter.connect(audioFallbackQuantizer);
      audioFallbackQuantizer.connect(eatingAudioContext.destination);
    }

    const route = (audio, bus) => {
      if (!audioElementSources.has(audio)) {
        eatingAudioContext.createMediaElementSource(audio).connect(bus);
        audioElementSources.add(audio);
      }
      audio.volume = 1;
    };
    route(eatingAudio, soundEffectsGain);
    for (const audio of soundEffectAudioNodes) route(audio, soundEffectsGain);
    route(musicAudio, normalMusicTrackGain || musicGain);
    route(buildUpMusicAudio, buildUpMusicTrackGain || musicGain);
    route(titleIntroAudio, musicGain);
    route(chooseSeedsAudio, chooseSeedsGain);

    if (!audioQualityPromise && eatingAudioContext.audioWorklet) {
      audioQualityPromise = window.__audioQualityPromise = eatingAudioContext.audioWorklet
        .addModule("ds-audio-processor.js")
        .then(() => {
          if (audioQualityNode) return;
          audioQualityNode = window.__audioQualityNode = new AudioWorkletNode(eatingAudioContext, "ds-quality");
          audioLoFiFilter.disconnect(audioFallbackQuantizer);
          audioLoFiFilter.connect(audioQualityNode);
          audioQualityNode.connect(eatingAudioContext.destination);
          audioFallbackQuantizer.disconnect();
        })
        .catch(() => {});
    }
    eatingAudioContext.resume().catch(() => {});
    preloadAdventureAudio();
    preloadGameSfx();
  } catch (_) {
    // Keep native playback if Web Audio setup is unavailable.
  }
}

const gameSfxPaths = {
  plant: "plant.wav",
  pickup: "51.wav",
  error: "UCANTGETTHAT.wav",
  pause: "40.wav",
  resume: "Resume.wav",
  menuClick: "Button_Click_Normal.wav",
  shovelPickup: "Shovel_Pickup.wav",
  shovelRemove: "3F.wav",
  pop: "Pop.wav",
  grace: "00.wav",
  collect: "46.wav",
  peaShot: "uploads/5C.wav",
  peaHit: "uploads/57.wav",
  setVolume: "Set_Volume.wav",
  hugeWave: "uploads/hugewave.wav",
  finalSiren: "uploads/Siren.wav",
  loadingClick: "uploads/Button_Click_Alt.wav",
  loadingFlower1: "uploads/Loadingpop.mp3",
  loadingFlower2: "uploads/Loadingpop.mp3",
  loadingFlower3: "uploads/Loadingpop.mp3",
  loadingFlower4: "uploads/Loadingpop.mp3",
  loadingZombie: "uploads/Rawh.wav",
  introReady: "4C.wav",
  introPlant: "4D.wav",
};
const gameSfxBuffers = window.__gameSfxBuffers || (window.__gameSfxBuffers = new Map());
const gameSfxLoads = window.__gameSfxLoads || (window.__gameSfxLoads = new Map());
const gameSfxSources = new Map();
let gameSfxGeneration = 0;
function preloadGameSfx() {
  if (!eatingAudioContext) return;
  for (const [name, url] of Object.entries(gameSfxPaths)) {
    if (gameSfxBuffers.has(name) || gameSfxLoads.has(name)) continue;
    const load = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load " + url);
        return response.arrayBuffer();
      })
      .then((data) => eatingAudioContext.decodeAudioData(data))
      .then((buffer) => {
        gameSfxBuffers.set(name, buffer);
        return buffer;
      })
      .catch((error) => {
        gameSfxLoads.delete(name);
        console.warn("SFX load failed (" + url + "):", error);
        return null;
      });
    gameSfxLoads.set(name, load);
  }
}
function playGameSfx(name, fallbackAudio, onEnded = null, playbackRate = 1) {
  const context = eatingAudioContext;
  const generation = gameSfxGeneration;
  const fallback = () => {
    if (generation !== gameSfxGeneration) return;
    fallbackAudio.currentTime = 0;
    fallbackAudio.playbackRate = playbackRate;
    if (onEnded) fallbackAudio.addEventListener("ended", onEnded, { once: true });
    fallbackAudio.play().catch(() => {
      if (onEnded) fallbackAudio.removeEventListener("ended", onEnded);
    });
  };
  const start = (buffer) => {
    if (generation !== gameSfxGeneration) return;
    if (!buffer || !context) {
      fallback();
      return;
    }
    const begin = () => {
      if (generation !== gameSfxGeneration) return;
      gameSfxSources.get(name)?.stop();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      source.connect(soundEffectsGain || context.destination);
      source.onended = () => {
        if (gameSfxSources.get(name) === source) gameSfxSources.delete(name);
        if (onEnded) onEnded();
      };
      gameSfxSources.set(name, source);
      source.start();
    };
    if (context.state === "running") begin();
    else context.resume().then(begin).catch(fallback);
  };
  if (!context) {
    fallback();
    return;
  }
  const buffer = gameSfxBuffers.get(name);
  const load = gameSfxLoads.get(name);
  if (buffer) start(buffer);
  else if (load) load.then(start);
  else fallback();
}
function stopGameSfx() {
  gameSfxGeneration++;
  for (const source of gameSfxSources.values()) source.stop();
  gameSfxSources.clear();
}

function syncEatingSound() {
  const shouldPlay = !game.paused && !game.dead && zombies.some((z) => z.eating);
  if (shouldPlay && eatingAudio.paused) {
    eatingAudio.currentTime = 0;
    eatingAudio.play().catch(() => {});
  } else if (!shouldPlay && !eatingAudio.paused) {
    eatingAudio.pause();
    eatingAudio.currentTime = 0;
  }
}

const gameOverAudio = (window.__gameOverAudio = window.__gameOverAudio || new Audio());
gameOverAudio.preload = "auto";
gameOverAudio.src = "GameOver.wav";
const evilLaughAudio = (window.__evilLaughAudio = window.__evilLaughAudio || new Audio());
evilLaughAudio.preload = "auto";
evilLaughAudio.src = "EHAHAHAHAHA.wav";
const noAudio = (window.__noAudio = window.__noAudio || new Audio());
noAudio.preload = "auto";
noAudio.src = "NOOOOOOOOOO.wav";
function playAudioToEnd(audio, onProgress) {
  return new Promise((resolve) => {
    let settled = false;
    let fallback;
    const trackProgress = () => onProgress?.(audio.currentTime, audio.duration);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      audio.removeEventListener("timeupdate", trackProgress);
      resolve();
    };
    audio.pause();
    audio.currentTime = 0;
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    if (onProgress) audio.addEventListener("timeupdate", trackProgress);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      fallback = setTimeout(finish, audio.duration * 1000 + 300);
    }
    audio.play().catch(finish);
  });
}
const adventureAudioBuffers = window.__adventureAudioBuffers || (window.__adventureAudioBuffers = new Map());
const adventureAudioLoads = window.__adventureAudioLoads || (window.__adventureAudioLoads = new Map());
function preloadAdventureAudio() {
  if (!eatingAudioContext) return Promise.resolve([]);
  return Promise.all([["gameOver", "GameOver.wav"], ["laugh", "EHAHAHAHAHA.wav"]].map(([name, url]) => {
    if (adventureAudioBuffers.has(name)) return adventureAudioBuffers.get(name);
    if (!adventureAudioLoads.has(name)) {
      adventureAudioLoads.set(name, fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error("Unable to load " + url);
          return response.arrayBuffer();
        })
        .then((data) => eatingAudioContext.decodeAudioData(data))
        .then((buffer) => {
          adventureAudioBuffers.set(name, buffer);
          return buffer;
        })
        .catch(() => null));
    }
    return adventureAudioLoads.get(name);
  }));
}
function playNativeAdventureMenuSounds() {
  let laughPlayback;
  const gameOverPlayback = playAudioToEnd(gameOverAudio, (currentTime, duration) => {
    if (!laughPlayback && duration > 0 && currentTime >= duration * 0.5) {
      laughPlayback = playAudioToEnd(evilLaughAudio);
    }
  });
  return gameOverPlayback.then(async () => {
    if (!laughPlayback) laughPlayback = playAudioToEnd(evilLaughAudio);
    await laughPlayback;
  });
}
async function playAdventureMenuSounds() {
  const context = eatingAudioContext;
  if (!context) return playNativeAdventureMenuSounds();

  try {
    await context.resume();
    const [gameOverBuffer, laughBuffer] = await preloadAdventureAudio();
    if (!gameOverBuffer || !laughBuffer) return playNativeAdventureMenuSounds();

    const startsAt = context.currentTime + 0.02;
    const playBuffer = (buffer, when) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(soundEffectsGain || context.destination);
      source.start(when);
    };
    playBuffer(gameOverBuffer, startsAt);
    playBuffer(laughBuffer, startsAt + gameOverBuffer.duration * 0.5);
    const totalDuration = Math.max(gameOverBuffer.duration, gameOverBuffer.duration * 0.5 + laughBuffer.duration);
    await new Promise((resolve) => setTimeout(resolve, totalDuration * 1000 + 100));
  } catch (_) {
    await playNativeAdventureMenuSounds();
  }
}

function fadeEatingAudio(duration = 800) {
  return new Promise((resolve) => {
    const started = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - started) / duration);
      setEatingFadeVolume(1 - progress);
      if (progress >= 1) {
        eatingAudio.pause();
        eatingAudio.currentTime = 0;
        setEatingFadeVolume(1);
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  });
}
function panToHouseForGameOver() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      yardPan.removeEventListener("transitionend", onTransitionEnd);
      resolve();
    };
    const onTransitionEnd = (event) => {
      if (event.target === yardPan && event.propertyName === "transform") finish();
    };
    const fallback = setTimeout(finish, 1500);
    yardPan.addEventListener("transitionend", onTransitionEnd);
    stageEl.classList.add("game-over-house-view");
  });
}

function zombieHousePoint(xFraction, yFraction) {
  const house = houseArt.getBoundingClientRect();
  const layer = zombieLayer.getBoundingClientRect();
  return {
    x: ((house.left + house.width * xFraction - layer.left) / layer.width) * 100,
    y: ((house.top + house.height * yFraction - layer.top) / layer.height) * 100,
  };
}

function walkGameOverZombieTo(z, target, durationMs) {
  if (!z?.el?.isConnected) return Promise.resolve();
  const startX = z.x;
  const startY = z.y;
  z.headless = false;
  z.headlessEating = false;
  z.falling = false;
  z.fading = false;
  z.eating = null;
  z.animFrame = 0;
  z.animT = 0;
  z.el.style.opacity = "1";
  zUpdateSprite(z);
  return new Promise((resolve) => {
    let previous = null;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = progress * progress * (3 - 2 * progress);
      const dt = previous === null ? 0 : Math.min(0.05, (now - previous) / 1000);
      previous = now;
      z.x = startX + (target.x - startX) * eased;
      z.y = startY + (target.y - startY) * eased;
      z.el.style.left = `${z.x}%`;
      z.el.style.top = `${z.y}%`;
      if (dt > 0) zAdvanceAnim(z, dt, ZWALK_FPS);
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function gameOverZombieEntersHouse(z) {
  if (!z?.el?.isConnected) return;
  // Walk directly along the doorway's horizontal line, then approach its step.
  await walkGameOverZombieTo(z, zombieHousePoint(0.51, 0.77), 3900);
  if (!z.el.isConnected) return;
  z.el.style.transition = "opacity 400ms ease";
  z.el.style.opacity = "0";
  await new Promise((resolve) => setTimeout(resolve, 420));
  z.el.remove();
  z.dead = true;
}

async function playGameOverSequence(fatalZombie) {
  const gameOverPlayback = playAudioToEnd(gameOverAudio);
  await panToHouseForGameOver();
  await gameOverZombieEntersHouse(fatalZombie);
  await gameOverPlayback;
  eatingAudio.pause();
  eatingAudio.loop = false;
  setEatingFadeVolume(1);
  eatingAudio.currentTime = 0;
  eatingAudio.play().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await fadeEatingAudio();

  gameoverOverlay.classList.add("show-text");
  const image = document.getElementById("gameover-image");
  image.classList.add("shake");
  await playAudioToEnd(noAudio);
  image.classList.remove("shake");
  menuBtn.classList.add("show");
}

// ---------- End-of-grace sound ----------
// 00.wav plays once when zombies start spawning.
const graceAudio = (window.__graceAudio = window.__graceAudio || new Audio());
graceAudio.preload = "auto";
graceAudio.src = "00.wav";
function playGraceSound() {
  playGameSfx("grace", graceAudio);
}

// ---------- Sun collected sound ----------
// 46.wav plays when a sun is collected.
const collectAudio = (window.__collectAudio = window.__collectAudio || new Audio());
collectAudio.preload = "auto";
collectAudio.src = "46.wav";
function playCollectSound() {
  // A little pitch variation keeps repeated sun pickups from sounding identical.
  const pitch = 0.97 + Math.random() * 0.06;
  playGameSfx("collect", collectAudio, null, pitch);
}

// ---------- Pea shot / hit sounds ----------
// 5C.wav plays whenever a peashooter fires, 57.wav whenever a pea hits a zombie.
const peaShotAudio = (window.__peaShotAudio = window.__peaShotAudio || new Audio());
peaShotAudio.preload = "auto";
peaShotAudio.src = "uploads/5C.wav";
const peaHitAudio = (window.__peaHitAudio = window.__peaHitAudio || new Audio());
peaHitAudio.preload = "auto";
peaHitAudio.src = "uploads/57.wav";
const setVolumeAudio = (window.__setVolumeAudio = window.__setVolumeAudio || new Audio());
setVolumeAudio.preload = "auto";
setVolumeAudio.src = "Set_Volume.wav";
const loadingClickAudio = (window.__loadingClickAudio = window.__loadingClickAudio || new Audio());
loadingClickAudio.preload = "auto";
loadingClickAudio.src = "uploads/Button_Click_Alt.wav";
const flowerPlopAudio = (window.__flowerPlopAudio = window.__flowerPlopAudio || new Audio());
flowerPlopAudio.preload = "auto";
flowerPlopAudio.src = "uploads/Loadingpop.mp3";
const loadingZombieAudio = (window.__loadingZombieAudio = window.__loadingZombieAudio || new Audio());
loadingZombieAudio.preload = "auto";
loadingZombieAudio.src = "uploads/Rawh.wav";
const hugeWaveAudio = (window.__hugeWaveAudio = window.__hugeWaveAudio || new Audio());
hugeWaveAudio.preload = "auto";
hugeWaveAudio.src = "uploads/hugewave.wav";
const finalSirenAudio = (window.__finalSirenAudio = window.__finalSirenAudio || new Audio());
finalSirenAudio.preload = "auto";
finalSirenAudio.src = "uploads/Siren.wav";
const plantUnlockedAudio = (window.__plantUnlockedAudio = window.__plantUnlockedAudio || new Audio());
plantUnlockedAudio.preload = "auto";
plantUnlockedAudio.src = "uploads/plant_unlocked_.wav";
const thingAudio = (window.__thingAudio = window.__thingAudio || new Audio());
thingAudio.preload = "auto";
thingAudio.src = "uploads/thing.wav";
const lawnmowerAudio = (window.__lawnmowerAudio = window.__lawnmowerAudio || new Audio());
lawnmowerAudio.preload = "auto";
lawnmowerAudio.src = "LawnMovering.wav";
lawnmowerAudio.loop = true;
const effectsVolumeSlider = document.getElementById("effects-volume");
const musicVolumeSlider = document.getElementById("music-volume");
const soundEffectAudioNodes = [plantAudio, cherryChargeAudio, cherryKaboomAudio, pickupAudio, errorAudio, pauseAudio, resumeAudio, menuClickAudio, shovelPickupAudio, shovelRemoveAudio, popAudio, introReadyAudio, introPlantAudio, graceAudio, collectAudio, peaShotAudio, peaHitAudio, setVolumeAudio, loadingClickAudio, flowerPlopAudio, loadingZombieAudio, hugeWaveAudio, finalSirenAudio, plantUnlockedAudio, thingAudio, lawnmowerAudio, laneRollingAudio, gameOverAudio, evilLaughAudio, noAudio];
function setSoundEffectsVolume(value) {
  soundEffectsVolume = Math.max(0, Math.min(1, Number(value)));
  if (soundEffectsGain) soundEffectsGain.gain.value = soundEffectsVolume;
  for (const audio of soundEffectAudioNodes) audio.volume = soundEffectsGain ? 1 : soundEffectsVolume;
  eatingAudio.volume = eatingFadeVolume * (soundEffectsGain ? 1 : soundEffectsVolume);
}
function setEatingFadeVolume(value) {
  eatingFadeVolume = value;
  eatingAudio.volume = eatingFadeVolume * (soundEffectsGain ? 1 : soundEffectsVolume);
}
let musicDuck = 1;
let chooseSeedsDuck = 1;
function setMusicVolume(value) {
  const volume = Math.max(0, Math.min(1, Number(value))) * musicDuck;
  if (musicGain) {
    musicGain.gain.value = volume;
    chooseSeedsGain.gain.value = chooseSeedsDuck;
    musicAudio.volume = 1;
    titleIntroAudio.volume = 1;
    chooseSeedsAudio.volume = 1;
    buildUpMusicAudio.volume = 1;
  } else {
    musicAudio.volume = volume;
    buildUpMusicAudio.volume = buildUpMusicActive ? volume : 0;
    titleIntroAudio.volume = volume;
    chooseSeedsAudio.volume = volume * chooseSeedsDuck;
  }
}
function setChooseSeedsDuck(value) {
  chooseSeedsDuck = Math.max(0, Math.min(1, value));
  if (chooseSeedsGain) chooseSeedsGain.gain.value = chooseSeedsDuck;
  else chooseSeedsAudio.volume = Math.max(0, Math.min(1, Number(musicVolumeSlider.value))) * musicDuck * chooseSeedsDuck;
}
function fadeChooseSeedsDuck(target, duration = 700) {
  const from = chooseSeedsDuck;
  const started = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - started) / duration);
    setChooseSeedsDuck(from + (target - from) * progress);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function setMusicDuck(value) {
  musicDuck = value;
  setMusicVolume(musicVolumeSlider.value);
}
setMusicVolume(musicVolumeSlider.value);
musicVolumeSlider.addEventListener("input", () => setMusicVolume(musicVolumeSlider.value));
effectsVolumeSlider.addEventListener("input", () => setSoundEffectsVolume(effectsVolumeSlider.value));
effectsVolumeSlider.addEventListener("change", () => playGameSfx("setVolume", setVolumeAudio));
setSoundEffectsVolume(effectsVolumeSlider.value);
function playPeaShotSound() {
  playGameSfx("peaShot", peaShotAudio);
}
function playPeaHitSound() {
  playGameSfx("peaHit", peaHitAudio);
}
function syncLawnmowerSound() {
  const shouldPlay = !game.paused && !game.dead && lawnmowers.some((mower) => mower.active);
  if (shouldPlay && lawnmowerAudio.paused) lawnmowerAudio.play().catch(() => {});
  else if (!shouldPlay && !lawnmowerAudio.paused) {
    lawnmowerAudio.pause();
    lawnmowerAudio.currentTime = 0;
  }
}

// ---------- Sun system ----------
const suns = (window.__suns = window.__suns || []);
const MAX_SUNS = 3; // cap concurrent suns on the lawn (1-3)

function currentSuns() {
  return suns.filter((s) => !s.dead).length;
}

function spawnSun() {
  // Never spawn beyond the cap. If the lawn is already full, just push the
  // next spawn further out instead of piling on more suns.
  if (currentSuns() >= MAX_SUNS) {
    scheduleNextSun();
    return;
  }
  makeSun({
    x: 4 + Math.random() * 92,
    y: -6,
    targetY: 30 + Math.random() * 55,
    value: 25,
    fall: true,
  });
  scheduleNextSun();
}

// Create a sun on the lawn. Falling suns can optionally pop upward first.
function sunflowerArcY(elapsed, startY, peakY, targetY) {
  if (elapsed <= 0.24) {
    const riseProgress = elapsed / 0.24;
    return startY - (startY - peakY) * riseProgress * (2 - riseProgress);
  }
  const fallDistance = Math.max(0, targetY - peakY);
  const fallDuration = Math.sqrt(fallDistance / 40);
  const fallProgress = fallDuration > 0 ? Math.min(1, (elapsed - 0.24) / fallDuration) : 1;
  return peakY + fallDistance * fallProgress * fallProgress;
}

function makeSun({ x, y, targetY, value, fall, popUp = false, popHeight = 0 }) {
  const sun = {
    el: document.createElement("img"),
    x,
    y,
    targetY,
    landed: !fall,
    ttl: fall ? 0 : 8,
    value,
    dead: false,
    frame: 0, // cycling sun1 <-> sun2
    frameT: 0,
    popUp,
    popStartY: y,
    popPeakY: y - popHeight,
    popElapsed: 0,
  };
  sun.el.className = "sun-item";
  sun.el.src = "sun1.png";
  sun.el.style.left = sun.x + "%";
  sun.el.style.top = sun.y + "%";
  sun.el.addEventListener("click", (e) => {
    e.stopPropagation();
    collectSun(sun);
  });
  sunLayer.appendChild(sun.el);
  suns.push(sun);
}

function flySunToCounter(sun, onDone) {
  if (sun.dead) return;
  sun.dead = true;
  const start = sun.el.getBoundingClientRect();
  const target = sunCounterEl.querySelector(".sun-coin").getBoundingClientRect();
  document.body.appendChild(sun.el);
  sun.el.style.animation = "none";
  sun.el.style.position = "fixed";
  sun.el.style.width = `${start.width}px`;
  sun.el.style.height = `${start.height}px`;
  sun.el.style.left = `${start.left + start.width / 2}px`;
  sun.el.style.top = `${start.top + start.height / 2}px`;
  sun.el.style.transform = "translate(-50%, -50%)";
  sun.el.style.transition = "none";
  requestAnimationFrame(() => {
    sun.el.style.transition = "left 0.32s cubic-bezier(0.2, 0.7, 0.3, 1), top 0.32s cubic-bezier(0.2, 0.7, 0.3, 1), transform 0.32s ease-in, opacity 0.32s ease-in";
    sun.el.style.left = `${target.left + target.width / 2}px`;
    sun.el.style.top = `${target.top + target.height / 2}px`;
    sun.el.style.transform = "translate(-50%, -50%) scale(0.2)";
    sun.el.style.opacity = "0";
  });
  setTimeout(() => {
    sun.el.remove();
    if (onDone) onDone();
  }, 320);
}

function fadeSunAway(sun) {
  if (sun.dead) return;
  sun.dead = true;
  sun.el.classList.add("sun-fading");
  setTimeout(() => sun.el.remove(), 1200);
}

function collectSun(sun) {
  if (sun.dead) return;
  state.sun += sun.value;
  updateSun();
  playCollectSound();
  flySunToCounter(sun);
  if (game.levelIndex === 1 && game.tutorialStep === "collect-first-sun") {
    game.tutorialStep = "more-sun";
    game.tutorialMessageTimer = 4.5;
    showTutorialMessage("The more sun you have the more plants you can plant");
  }
}

// ---------- Sunflower production ----------
const producers = (window.__producers = window.__producers || []); // { timer, def, slot }

function registerProducer(r, c, def) {
  const slot = cellEls.find((e) => e.r === r && e.c === c).slot;
  producers.push({ timer: def.sunInterval, def, slot });
}

function producerSunSpot(slot) {
  const slotRect = slot.getBoundingClientRect();
  const layerRect = sunLayer.getBoundingClientRect();
  const plantRect = slot.querySelector("img").getBoundingClientRect();
  const x = ((plantRect.left + plantRect.width / 2 - layerRect.left) / layerRect.width) * 100;
  const y = ((plantRect.top + plantRect.height / 2 - layerRect.top) / layerRect.height) * 100;
  // Keep the landing point below the flower so every produced sun has room
  // to rise first and then visibly fall, even if layout rounding shifts it.
  const targetY = Math.min(100, Math.max(
    ((slotRect.bottom - 30 - layerRect.top) / layerRect.height) * 100,
    y + 1
  ));
  const popHeight = Math.min((42 / layerRect.height) * 100, y);
  return { x, y, targetY, popHeight };
}

function stepProducers(dt) {
  for (const p of producers) {
    p.timer -= dt;
    if (p.timer > 0) continue;
    p.timer = p.def.sunInterval;
    // Flash the sunflowers white right as they produce, so the pop reads
    // clearly. The flash is a one-shot; remove the class so a later produce
    // can retrigger the animation.
    const img = p.slot.querySelector("img");
    if (img && !img.classList.contains("produce-flash")) {
      img.classList.add("produce-flash");
      img.addEventListener("animationend", function once() {
        img.classList.remove("produce-flash");
        img.removeEventListener("animationend", once);
      });
    }
    const { x, y, targetY, popHeight } = producerSunSpot(p.slot);
    makeSun({ x, y, targetY, value: p.def.sunReward, fall: true, popUp: true, popHeight });
  }
}

function scheduleNextSun() {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(spawnSun, (8 + Math.random() * 6) * 1000);
}

// ---------- Zombies (placeholder) + peashooter peas ----------
const peaLayer = document.getElementById("pea-layer");
const zombieLayer = document.getElementById("zombie-layer");
const lawnmowerLayer = document.getElementById("lawnmower-layer");
const zombies = (window.__zombies = window.__zombies || []);
const lawnmowers = [];
const MOWER_PARK_X = 0;
const MOWER_TRIGGER_X = 5.5;
const MOWER_SPEED = 65;
const MOWER_HIT_DISTANCE = 7;
function buildLawnmowers(startOffscreen = false) {
  lawnmowerLayer.innerHTML = "";
  lawnmowers.length = 0;
  for (const r of unlockedRows()) {
    const el = document.createElement("div");
    el.className = startOffscreen ? "lawnmower waiting" : "lawnmower";
    const startX = startOffscreen ? -12 : MOWER_PARK_X;
    el.style.left = startX + "%";
    el.style.top = ((r + 1) / ROWS) * 100 + "%";
    const img = document.createElement("img");
    img.src = "LawnMover.png";
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);
    lawnmowerLayer.appendChild(el);
    lawnmowers.push({ r, x: startX, used: false, active: false, el });
  }
}
function moveLawnmowersToPosition() {
  return new Promise((resolve) => {
    for (const mower of lawnmowers) {
      mower.el.classList.remove("waiting");
      mower.el.classList.add("entering");
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const mower of lawnmowers) {
        mower.x = MOWER_PARK_X;
        mower.el.style.left = MOWER_PARK_X + "%";
      }
      setTimeout(() => {
        for (const mower of lawnmowers) mower.el.classList.remove("entering");
        resolve();
      }, 850);
    }));
  });
}
const peas = (window.__peas = window.__peas || []);

const ZOMBIE_SPEED = 0.9; // % of lawn width/second; moves continuously, no steps
const ZOMBIE_HP = 16; // gameplay-scale equivalent of 270 normal HP
const CONE_ARMOR_HP = 370 * ZOMBIE_HP / 270;
const PEA_SPEED = 35; // % of lawn width per second
const PEA_HIT_MARGIN = 2; // % of lawn width; peas hit only once this close to the zombie's center
const PEA_DMG = 1;
const PEA_INTERVAL = 1.5; // seconds between shots
const PEA_GRACE = 20; // seconds before the first zombie
const REGULAR_WAVE_ZOMBIES = 7;
const EAT_DPS = 20 / 3; // damage a zombie deals per second (normal plant = 20hp, dies in 3s)

// Zombie sprite animations. Two damage stages: full -> "basic", under half
// health -> "injured". At zero health the head pops off; the zombie keeps
// moving or chewing without damaging plants before its fall topple.
// Frame files live in uploads/.
const ZSTAGE_BASIC = "basic";
const ZSTAGE_INJURED = "injured";
const ZOMBIE_INJURED_FRAC = 0.5; // hp fraction below which the injured sprites show
const ZSTAGE_CFG = {
  [ZSTAGE_BASIC]:   { walk: 7, eat: 7 },
  [ZSTAGE_INJURED]: { walk: 7, eat: 7 },
};
const ZFALL_FRAMES = 9;
const ZHEADLESS_WALK_FRAMES = 7;
const ZHEADLESS_EAT_FRAMES = 5;
const ZHEADLESS_DURATION = 3.5; // let the headless animation loop before the collapse
const ZWALK_FPS = 4; // 0.25s per frame
const ZEAT_FPS = 7;
const ZFALL_FPS = 5; // 0.2 seconds per fall sprite

// The death sprites are cropped (the head is removed), so their native files
// are much shorter than the standing walk sprite. Stretching them to the full
// container height makes the corpse look giant. Render them at a height that
// keeps the zombie the same physical size as when it stood (proportional to
// the 54px standing sprite). Height is given as a fraction of the 150px
// container: spriteNativeHeight / 54.
const Z_HEIGHT_NORMAL = 54; // standing walk/injured-walk native height (px)
const Z_HEIGHT_PHASE = {
  normal: 1,
  headlessWalk: 33 / Z_HEIGHT_NORMAL,
  headlessEat: 35 / Z_HEIGHT_NORMAL,
  fall: 40 / Z_HEIGHT_NORMAL,
};

// Set the rendered image height for the current phase so death sprites stay
// sized like the monster rather than blowing up to fill the whole container.
function zSetPhase(z, phase) {
  if (z.phase === phase) return;
  z.phase = phase;
  z.img.style.height = Z_HEIGHT_PHASE[phase] * 100 + "%";
}

// Choose the current damage stage from remaining HP.
function zStageFor(z) {
  return z.hp / ZOMBIE_HP >= ZOMBIE_INJURED_FRAC ? ZSTAGE_BASIC : ZSTAGE_INJURED;
}

const nextFire = {}; // "r,c" -> seconds until this peashooter fires again

// Cache of which lane has a live zombie, rebuilt once per loop tick.
let zombieLanes = new Set();

function stepLawnmowers(dt) {
  for (const mower of lawnmowers) {
    if (!mower.active) continue;
    mower.x += MOWER_SPEED * dt;
    mower.el.style.left = mower.x + "%";
    if (mower.x > 108) {
      mower.active = false;
      mower.el.remove();
    }
  }
  syncLawnmowerSound();
}

function updateLevelProgress() {
  if (!levelProgressEl || !levelProgressFill) return;
  const regularPart = 78;
  const progress = game.finalWaveStarted
    ? (game.finalProgressFilled ? 100 : regularPart + (game.finalHordeTotal ? Math.min(1, game.finalHordeSpawned / game.finalHordeTotal) * (100 - regularPart) : 0))
    : Math.min(1, game.regularZombiesSpawned / levelCfg().regular) * regularPart;
  const value = Math.max(0, Math.min(100, progress));
  const fillInset = ((237 - (value / 100) * 234) / 242) * 100;
  const flagInset = ((237 - (regularPart / 100) * 234) / 242) * 100;
  levelProgressFill.style.setProperty("--fill-inset", `${fillInset}%`);
  levelProgressHead.style.left = `${Math.min(100, fillInset + 2.5)}%`;
  progressFlag.style.left = `${flagInset}%`;
  levelProgressEl.setAttribute("aria-valuenow", String(Math.round(value)));
}

function recordZombieDefeat(z) {
  if (z.progressCounted) return;
  z.progressCounted = true;
  if (z.finalHorde) {
    game.finalHordeDefeated = (game.finalHordeDefeated || 0) + 1;
    const sunRect = sunLayer.getBoundingClientRect();
    const zombieRect = z.el.getBoundingClientRect();
    game.lastFinalZombieRewardPosition = {
      x: ((zombieRect.left + zombieRect.width / 2 - sunRect.left) / sunRect.width) * 100,
      y: ((zombieRect.top + zombieRect.height / 2 - sunRect.top) / sunRect.height) * 100,
    };
  } else game.regularZombiesDefeated = (game.regularZombiesDefeated || 0) + 1;
  maybeShowSunflowerReward();
}
function maybeShowSunflowerReward() {
  if (game.levelIndex < MAX_LEVEL && game.finalWaveStarted && game.finalHordeSpawnComplete && game.finalHordeDefeated >= game.finalHordeTotal) showSunflowerReward();
}

function checkLawnmower(z) {
  const mower = lawnmowers[z.r];
  if (!mower) return false;
  if (!mower.used && z.x <= MOWER_TRIGGER_X) {
    mower.used = true;
    mower.active = true;
    mower.el.classList.add("moving");
    syncLawnmowerSound();
  }
  if (!mower.active || Math.abs(z.x - mower.x) > MOWER_HIT_DISTANCE) return false;
  z.mowed = true;
  recordZombieDefeat(z);
  z.dead = true;
  z.el.remove();
  clearDebrisFor(z);
  return true;
}

function spawnZombie(options = {}) {
  levelProgressEl.classList.add("active");
  const lanes = unlockedRows();
  const requestedRow = options.row;
  const r = lanes.includes(requestedRow) ? requestedRow : lanes[Math.floor(Math.random() * lanes.length)];
  let coneHead = false;
  if (levelCfg().cone > 0) {
    const coneChance = levelCfg().cone;
    const shouldBeCone = game.regularZombiesSpawned >= 3 &&
      (!game.firstConeHeadSpawned || Math.random() < coneChance);
    coneHead = options.coneHead ?? shouldBeCone;
    if (coneHead) game.firstConeHeadSpawned = true;
  }
  const z = {
    r,
    y: ((r + 1) / ROWS) * 100,
    x: 104, // just off the right edge
    hp: ZOMBIE_HP + (coneHead ? CONE_ARMOR_HP : 0),
    coneHead,
    coneDamageTaken: 0,
    coneDamaged: false,
    eating: null, // { cell, c, timeLeft }
    // animation state
    stage: ZSTAGE_BASIC,
    phase: "normal",
    animFrame: 0,
    animT: 0,
    headless: false, // true after the head pops off and before the collapse
    headlessEating: false,
    headlessT: 0,
    falling: false, // true during the death topple
    fading: false, // true during the post-topple linger + fade-out
    fadeT: 0,
    armPopped: false, // true once the arm fell off on injury
    dead: false,
    finalHorde: Boolean(options.finalHorde),
    el: document.createElement("div"),
  };
  z.el.className = "zombie";
  z.el.style.left = z.x + "%";
  z.el.style.top = z.y + "%";
  z.img = document.createElement("img");
  z.img.draggable = false;
  z.img.src = zWalkSrc(z, 0);
  zSetPhase(z, "normal");
  z.el.appendChild(z.img);
  zombieLayer.appendChild(z.el);
  zombies.push(z);
}

// ---------- Zombie sprite helpers ----------
// File prefix per damage stage, then a walk/eat/fall frame name.
function zStagePrefix(stage) {
  return stage === ZSTAGE_INJURED ? "basicinjured" : "basic";
}
// Walk / eat frames cycle. Fall is a one-shot index into `basicfallN` (frame 3
// files as `bascfall3.png`).
function zWalkSrc(z, frame) {
  const frames = ZSTAGE_CFG[z.stage].walk;
  const n = ((frame % frames) + frames) % frames + 1;
  if (z.coneHead && z.coneDamaged) return `uploads/CZslightlydamagedwalk${n}.png`;
  return z.coneHead ? `uploads/ConeZombieokwalk${n}.png` : `uploads/${zStagePrefix(z.stage)}walk${n}.png`;
}
function zEatSrc(z, frame) {
  const frames = ZSTAGE_CFG[z.stage].eat;
  const n = ((frame % frames) + frames) % frames + 1;
  if (z.coneHead) {
    const coneEatFrames = [1, 2, 3, 4, 6, 7];
    return `uploads/ConeZombieokeat${coneEatFrames[(n - 1) % coneEatFrames.length]}.png`;
  }
  return `uploads/${zStagePrefix(z.stage)}eat${n}.png`;
}
function zHeadlessSrc(z, frame) {
  if (z.headlessEating) {
    const n = (frame % ZHEADLESS_EAT_FRAMES) + 1;
    return `uploads/basicdeadeat${n}.png`;
  }
  const n = (frame % ZHEADLESS_WALK_FRAMES) + 1;
  return `uploads/basicdeadwalk${n}.png`;
}
function zFallSrc(frame) {
  const n = Math.min(frame, ZFALL_FRAMES);
  return `uploads/${n === 3 ? "bascfall" : "basicfall"}${n}.png`;
}
// Update the sprite's damage stage + frame. Walking uses walk frames, chewing
// uses eat frames, and the death topple uses the fall sequence. Entering a death
// phase swaps in a fresh <img> so the old standing sprite can't flash at the
// corpse's height or be hidden by a cached-load race.
function zUpdateSprite(z) {
  const prevPhase = z.phase;
  const phase = z.falling ? "fall" : "normal";
  zSetPhase(z, phase);
  const src = z.falling ? zFallSrc(z.animFrame)
    : (z.headless ? zHeadlessSrc(z, z.animFrame)
      : (z.eating ? zEatSrc(z, z.animFrame) : zWalkSrc(z, z.animFrame)));
  const spriteHeight = z.falling ? Z_HEIGHT_PHASE.fall
    : z.headless
      ? Z_HEIGHT_PHASE[z.headlessEating ? "headlessEat" : "headlessWalk"]
      : Z_HEIGHT_PHASE.normal;
  if (z.img) z.img.style.height = spriteHeight * 100 + "%";
  if (phase !== prevPhase && phase !== "normal") {
    // Keep the previous sprite visible until the first fall frame is ready.
    const previous = z.img;
    const fresh = document.createElement("img");
    fresh.draggable = false;
    fresh.style.height = spriteHeight * 100 + "%";
    fresh.style.visibility = "hidden";
    const show = () => {
      if (!fresh.parentNode) return;
      fresh.style.visibility = "visible";
      if (previous && previous !== fresh) previous.remove();
    };
    fresh.addEventListener("load", show, { once: true });
    fresh.addEventListener("error", () => {
      if (!fresh.parentNode) return;
      fresh.remove();
      if (z.img === fresh) z.img = previous;
    }, { once: true });
    z.img = fresh;
    z.el.appendChild(fresh);
    fresh.src = src;
    if (fresh.complete && fresh.naturalWidth > 0) show();
  } else {
    showSpriteWhenReady(z.img, src);
  }
}

// Advance the current frame. Different cycle lengths & native sizes per stage,
// so per-frame time is derived from the preferred FPS.
function zAdvanceAnim(z, dt, fps) {
  z.animT += dt;
  const period = 1 / fps;
  while (z.animT >= period) {
    z.animT -= period;
    z.animFrame += 1;
    if (!z.falling) {
      const frames = z.headless
        ? (z.headlessEating ? ZHEADLESS_EAT_FRAMES : ZHEADLESS_WALK_FRAMES)
        : (z.eating ? ZSTAGE_CFG[z.stage].eat : ZSTAGE_CFG[z.stage].walk);
      z.animFrame %= frames;
    }
    zUpdateSprite(z);
  }
}

function getZombieCell(z) {
  // Column index from the zombie's x position.
  const c = Math.max(0, Math.floor((z.x / 100) * COLS));
  return { c, cell: state.grid[z.r][c] };
}

// ---------- Body-part debris (arm / head) ----------
// The arm and head fall onto the lawn, linger, then fade independently. Coordinates
// are percent of the stage, so gravity is tuned in those units (stage is 800x600,
// 1% y = 6px).
const debris = (window.__debris = window.__debris || []);
const DEBRIS_GRAVITY = 70; // %/s^2

function spawnDebris({ src, x, y, vy, vx, ground, rotSpeed, owner, width = null }) {
  const el = document.createElement("img");
  el.className = "zombie-debris";
  el.draggable = false;
  el.src = src;
  el.style.left = x + "%";
  el.style.top = y + "%";
  el.style.width = (width ?? (src.includes("arm") ? 50 : 100)) + "px";
  zombieLayer.appendChild(el);
  debris.push({ el, x, y, vy, vx, ground, rotSpeed, rot: 0, landed: false, fadeT: 0, owner });
}

function zPopCone(z) {
  playGameSfx("pop", popAudio);
  spawnDebris({
    src: "uploads/ConeBroken.png",
    x: z.x,
    y: z.y - 52,
    vy: -27,
    vx: -4,
    ground: z.y,
    rotSpeed: -55,
    owner: z,
    width: 54,
  });
  z.coneHead = false;
  z.hp = ZOMBIE_HP;
  z.stage = ZSTAGE_BASIC;
  z.animFrame = 0;
  z.animT = 0;
  zUpdateSprite(z);
}

function zPopPart(z, kind) {
  const arm = kind === "arm";
  playGameSfx("pop", popAudio);
  spawnDebris({
    src: arm ? "uploads/basicarm.png" : "uploads/basichead.png",
    x: z.x,
    y: z.y - (arm ? 24 : 40), // start near where the part sits
    vy: arm ? 0 : -30,        // arm pops off (drops); head flings up lightly
    vx: arm ? 0 : -6,
    ground: z.y,              // lands on the current lane
    rotSpeed: arm ? 0 : -40,  // arm doesn't spin
    owner: z,
  });
}

function zStartHeadless(z) {
  recordZombieDefeat(z);
  z.headless = true;
  z.headlessEating = Boolean(z.eating);
  z.headlessT = ZHEADLESS_DURATION;
  z.eating = null;
  z.animFrame = 0;
  z.animT = 0;
  zPopPart(z, "head");
  zUpdateSprite(z);
}

function zStartFall(z) {
  z.falling = true;
  z.animFrame = 1;
  z.animT = 0;
  zUpdateSprite(z);
}

function stepDebris(dt) {
  for (const d of debris) {
    if (!d.landed) {
      d.rot += d.rotSpeed * dt;
    } else {
      d.fadeT += dt;
      const hold = 1.4;
      const fade = 1.2;
      if (d.fadeT > hold) {
        const opacity = 1 - Math.min(1, (d.fadeT - hold) / fade);
        d.el.style.opacity = String(opacity);
        if (opacity <= 0) {
          d.el.remove();
          debris.splice(debris.indexOf(d), 1);
          continue;
        }
      }
    }
    if (!d.landed) {
      d.vy += DEBRIS_GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y >= d.ground) {
        d.y = d.ground;
        d.vy = 0;
        d.vx = 0;
        d.landed = true;
        d.rot = 0;
      }
    }
    d.el.style.left = d.x + "%";
    d.el.style.top = d.y + "%";
    d.el.style.transform = d.landed
      ? "translate(-50%,-50%)"
      : `translate(-50%,-50%) rotate(${d.rot}deg)`;
  }
}

function clearDebrisFor(z) {
  for (let i = debris.length - 1; i >= 0; i--) {
    if (debris[i].owner === z) {
      debris[i].el.remove();
      debris.splice(i, 1);
    }
  }
}

function stepZombies(rawDt) {
  zombieLanes = new Set();
  for (const z of zombies) {
    // Snow Pea frost: everything about a chilled zombie runs at half speed.
    if (z.slowT > 0) {
      z.slowT -= rawDt;
      if (z.slowT <= 0) z.el.classList.remove("chilled");
    }
    const dt = z.slowT > 0 ? rawDt * 0.5 : rawDt;
    if (z.crisped) {
      z.crispedTime -= dt;
      if (z.crispedTime <= 0) {
        z.el.remove();
        z.dead = true;
        zombies.splice(zombies.indexOf(z), 1);
      }
      continue;
    }
    if (z.mowed || checkLawnmower(z)) continue;
    // A dying zombie plays its topple animation to completion, then lingers on
    // the final frame and slowly fades out before despawning.
    if (z.falling) {
      if (!z.fading) {
        zAdvanceAnim(z, dt, ZFALL_FPS);
        if (z.animFrame >= ZFALL_FRAMES) {
          z.fading = true;
          z.fadeT = 0;
        }
      } else {
        z.fadeT += dt;
        const hold = 0.6; // seconds on the final frame before fading
        const fade = 1.2; // seconds to fade out
        if (z.fadeT > hold) {
          const t = Math.min(1, (z.fadeT - hold) / fade);
          z.el.style.opacity = String(1 - t);
          if (t >= 1) {
            z.el.remove();
            z.dead = true;
            clearDebrisFor(z);
            zombies.splice(zombies.indexOf(z), 1);
          }
        }
      }
      continue;
    }

    if (z.headless) {
      z.headlessT -= dt;
      if (z.headlessEating) {
        zAdvanceAnim(z, dt, ZEAT_FPS);
      } else {
        z.x -= ZOMBIE_SPEED * dt;
        zAdvanceAnim(z, dt, ZWALK_FPS);
      }
      if (z.headlessT <= 0) zStartFall(z);
      z.el.style.left = z.x + "%";
      if (!z.falling && z.x <= 100) zombieLanes.add(z.r);
      if (checkLawnmower(z)) continue;
      if (z.x <= 0) triggerGameOver(z);
      continue;
    }

    // Refresh the damage stage (arm falls off as HP drops).
    const nextStage = zStageFor(z);
    if (nextStage !== z.stage) {
      z.stage = nextStage;
      z.animFrame = 0; // restart the cycle so the swap reads cleanly
      if (nextStage === ZSTAGE_INJURED && !z.armPopped) {
        z.armPopped = true;
        zPopPart(z, "arm"); // arm flies off the moment it gets hurt
      }
      zUpdateSprite(z);
    }

    // If the zombie has reached a plant, eat it.
    const { c, cell } = getZombieCell(z);
    if (cell) {
      // Zombie is chewing on the plant: deal damage. The plant's HP drives
      // both how long it survives and its visual damage stage.
      if (!z.eating || z.eating.c !== c) {
        z.eating = { cell, c };
        z.animFrame = 0;
      }
      cell.hp = (cell.hp ?? 20) - EAT_DPS * dt;
      if (cell.hp <= 0) {
        // Plant fully eaten: remove it from the grid/layer.
        state.grid[z.r][c] = null;
        const slot = cellEls.find((e) => e.r === z.r && e.c === c).slot;
        // Drop the plant's animator + producer before detaching its image.
        const at = animators.findIndex((a) => a.img.parentElement === slot);
        if (at !== -1) animators.splice(at, 1);
        slot.innerHTML = "";
        const pi = producers.findIndex((p) => p.slot === slot);
        if (pi !== -1) producers.splice(pi, 1);
        z.eating = null;
      }
      zAdvanceAnim(z, dt, ZEAT_FPS);
    } else {
      // No plant here, keep walking: continuous slow shuffle, no pauses.
      z.eating = null;
      z.x -= ZOMBIE_SPEED * dt;
      zAdvanceAnim(z, dt, ZWALK_FPS);
    }
    z.el.style.left = z.x + "%";
    // Peashooters only open fire once the zombie has actually stepped onto the
    // lane (on the lawn at or left of the right lawn edge), not while it is
    // still off-screen or already dead. A zombie stays targetable through its
    // death topple so a peashooter keeps firing as the corpse falls.
    if (!z.falling && z.x <= 100) zombieLanes.add(z.r);
    // A zombie reaching a ready mower uses it before the normal loss threshold.
    if (checkLawnmower(z)) continue;
    if (z.x <= 0) triggerGameOver(z);
  }
  // Remove zombies hit by a mower without skipping adjacent entries mid-loop.
  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].mowed) zombies.splice(i, 1);
  }
  // Remove zombies that walked fully off the left edge.
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.x < -10 && !z.falling) {
      z.el.remove();
      z.dead = true;
      zombies.splice(i, 1);
    }
  }
  maybeShowSunflowerReward();
  syncEatingSound();
}

function laneHasZombie(r) {
  return zombieLanes.has(r);
}

function stepPeashooters(dt) {
  for (let r = 0; r < ROWS; r++) {
    if (!laneHasZombie(r)) continue;
    // Any peashooter in this lane fires at the zombie.
    for (let c = 0; c < COLS; c++) {
      const cell = state.grid[r][c];
      if (!cell || !PLANTS[cell.type]?.shooter) continue;
      const sourceX = ((c + 0.5) / COLS) * 100;
      if (!zombies.some((z) => z.r === r && z.x > sourceX && z.x <= 100 && !z.mowed)) continue;
      const key = r + "," + c;
      // Fire on a short startup delay after planting (or a zombie arrives),
      // so a freshly-planted peashooter doesn't shoot the instant a zombie is
      // on the lane; afterward it fires every PEA_INTERVAL.
      const cd = nextFire[key] ?? 0.5;
      nextFire[key] = cd - dt;
      if (nextFire[key] > 0) continue;
      nextFire[key] = PEA_INTERVAL;
      const shooterDef = PLANTS[cell.type];
      firePea(r, c, shooterDef.frost);
      for (let b = 1; b < (shooterDef.burst || 1); b++) {
        setTimeout(() => { if (!game.dead && state.grid[r][c] === cell) firePea(r, c, shooterDef.frost); }, 180 * b);
      }
    }
  }
}

function firePea(r, c, frost = false) {
  const sourceX = ((c + 0.5) / COLS) * 100;
  const p = {
    r,
    x: sourceX,
    sourceX,
    frost,
    el: document.createElement("img"),
  };
  p.el.src = "projectilenormalpea.png";
  p.el.className = frost ? "pea frost-pea" : "pea";
  p.el.style.left = p.x + "%";
  p.el.style.top = ((r + 0.5) / ROWS) * 100 + "%";
  peaLayer.appendChild(p.el);
  peas.push(p);
  playPeaShotSound();
}

function stepPeas(dt) {
  for (const p of peas) {
    p.x += PEA_SPEED * dt;
    p.el.style.left = p.x + "%";
  }
  // Hit test: pea lands on a zombie in its lane if it's reached/passed it.
  for (let pi = peas.length - 1; pi >= 0; pi--) {
    const p = peas[pi];
    let hit = false;
    for (const z of zombies) {
      if (z.r !== p.r || z.mowed || z.x <= p.sourceX) continue;
      if (p.x >= z.x - PEA_HIT_MARGIN) {
        z.hp -= PEA_DMG;
        if (p.frost) {
          z.slowT = 10;
          z.el.classList.add("chilled");
        }
        if (z.coneHead) {
          z.coneDamageTaken += PEA_DMG * 270 / ZOMBIE_HP;
          if (!z.coneDamaged && z.coneDamageTaken >= 130) {
            z.coneDamaged = true;
            zUpdateSprite(z);
          }
        }
        playPeaHitSound();
        if (z.coneHead && z.hp <= ZOMBIE_HP) {
          zPopCone(z);
        }
        if (z.hp <= 0 && !z.headless && !z.falling) {
          zStartHeadless(z);
        }
        hit = true;
        break;
      }
    }
    if (hit || p.x > 108) {
      p.el.remove();
      peas.splice(pi, 1);
    }
  }
}

// ---------- Game loop (sunfall + idle anim + cooldowns) ----------
const ZOMBIE_INTERVAL = 25; // seconds between zombie spawns after the grace period
let zombieSpawnTimer = PEA_GRACE; // 20s grace before the first zombie
let previousFrameTime = null;
let lastLoopFrameAt = -Infinity;
const TOP_SCREEN_ZOMBIE_WIDTH = 380;
const TOP_SCREEN_ZOMBIE_HEIGHT = TOP_SCREEN_ZOMBIE_WIDTH * 859 / 959;
const TOP_SCREEN_ZOMBIE_BOB = [-1, -2, -1, 0, 1, 2, 1, 0];
function nextTopScreenZombieDelay() {
  return 5 + Math.random() * 5;
}
function spawnTopScreenZombie() {
  const el = document.createElement("img");
  el.src = "Top_Screen_Zombie.png";
  el.alt = "";
  el.draggable = false;
  el.className = "top-screen-zombie";
  const zombie = {
    el,
    x: 800,
    progress: 0,
    baseTop: 600 - TOP_SCREEN_ZOMBIE_HEIGHT + 8,
    bobTimer: 0,
    bobStep: -1,
    exiting: false,
  };
  el.style.left = zombie.x + "px";
  el.style.top = zombie.baseTop + "px";
  topScreenZombieLayer.appendChild(el);
  game.topScreenZombies.push(zombie);
}
function stepTopScreenZombies(dt) {
  if (game.topZombieSpawnTimer !== null) {
    game.topZombieSpawnTimer -= dt;
    const active = game.topScreenZombies.filter((zombie) => !zombie.exiting);
    if (game.topZombieSpawnTimer <= 0 && active.length < 2 && (!active.length || active.some((zombie) => zombie.progress >= 0.5))) {
      spawnTopScreenZombie();
      game.topZombieSpawnTimer = nextTopScreenZombieDelay();
    }
  }
  for (let i = game.topScreenZombies.length - 1; i >= 0; i--) {
    const zombie = game.topScreenZombies[i];
    if (zombie.exiting) continue;
    zombie.x -= 14 * dt;
    zombie.progress = Math.min(1, (800 - zombie.x) / (800 + TOP_SCREEN_ZOMBIE_WIDTH));
    zombie.el.style.left = zombie.x + "px";
    zombie.bobTimer += dt;
    if (zombie.bobTimer >= 0.5) {
      zombie.bobTimer %= 0.5;
      zombie.bobStep = (zombie.bobStep + 1) % TOP_SCREEN_ZOMBIE_BOB.length;
      zombie.el.style.top = zombie.baseTop + TOP_SCREEN_ZOMBIE_BOB[zombie.bobStep] + "px";
    }
    if (zombie.x <= -TOP_SCREEN_ZOMBIE_WIDTH) {
      zombie.el.remove();
      game.topScreenZombies.splice(i, 1);
    }
  }
}
function dismissTopScreenZombies() {
  game.topZombieSpawnTimer = null;
  for (const zombie of game.topScreenZombies) {
    if (zombie.exiting) continue;
    zombie.exiting = true;
    zombie.el.classList.add("exiting");
    zombie.el.addEventListener("animationend", () => {
      zombie.el.remove();
      game.topScreenZombies = game.topScreenZombies.filter((item) => item !== zombie);
    }, { once: true });
  }
}
function loop(now = 0) {
  if (game.dead) return;
  if (LOW_PERFORMANCE_DEVICE && now - lastLoopFrameAt < 1000 / 30) {
    game.raf = requestAnimationFrame(loop);
    return;
  }
  lastLoopFrameAt = now;
  if (game.paused) {
    previousFrameTime = now;
    game.raf = requestAnimationFrame(loop);
    return;
  }
  const dt = previousFrameTime === null
    ? 1 / 60
    : Math.min(Math.max((now - previousFrameTime) / 1000, 0), 0.1);
  previousFrameTime = now;
  stepAnims(now);
  stepPlantAnims(now);
  stepTopScreenZombies(dt);
  stepProducers(dt);
  stepTutorial(dt);
  updateCooldowns();
  if (zombieSpawnTimer !== null) {
    zombieSpawnTimer -= dt;
    if (zombieSpawnTimer <= 0) {
      if (!game.graceSoundPlayed) {
        playGraceSound();
        game.graceSoundPlayed = true;
      }
      spawnZombie();
      game.regularZombiesSpawned++;
      if (game.levelIndex === 1 && game.tutorialStep === "complete" && !game.tutorialDefendShown) {
        game.tutorialDefendShown = true;
        game.tutorialStep = "defend";
        game.tutorialMessageTimer = 5;
        showTutorialMessage("Don't let the Zombies Reach your House!");
      }
      updateLevelProgress();
      if (game.topZombieSpawnTimer === null) game.topZombieSpawnTimer = nextTopScreenZombieDelay();
      if (game.regularZombiesSpawned >= levelCfg().regular) {
        // Stop the regular trickle at seven; wait for all seven to be cleared
        // before showing the wave warnings.
        zombieSpawnTimer = null;
      } else {
        zombieSpawnTimer = levelCfg().interval;
      }
    }
  }
  stepFinalHordeSpawn(dt);
  stepLawnmowers(dt);
  stepZombies(dt);
  stepDebris(dt);
  stepPeashooters(dt);
  stepPeas(dt);
  if (!game.waveSequenceStarted && game.regularZombiesSpawned >= levelCfg().regular && zombies.length === 0) {
    game.waveSequenceStarted = true;
    beginWaveSequence();
  }
  if (game.finalWaveStarted && game.finalHordeSpawnComplete && zombies.length === 0) {
    if (game.levelIndex < MAX_LEVEL) showSunflowerReward();
    else triggerWin();
    return;
  }
  for (const s of suns) {
    if (s.dead) continue;
    // Cycle between the two sun frames (~6fps) while the sun is on the lawn.
    s.frameT += dt;
    if (s.frameT >= 1 / 6) {
      s.frameT = 0;
      s.frame = 1 - s.frame;
      s.el.src = s.frame ? "sun2.png" : "sun1.png";
    }
    if (!s.landed) {
      if (s.popUp) {
        s.popElapsed += dt;
        // Share the sunflower's exact rise-and-fall curve with its reward packet.
        s.y = sunflowerArcY(s.popElapsed, s.popStartY, s.popPeakY, s.targetY);
      } else {
        s.y += 9 * dt; // percent units per tick
      }
      if (s.y >= s.targetY) {
        s.y = s.targetY;
        s.landed = true;
        s.ttl = 8;
      }
      s.el.style.top = s.y + "%";
    } else {
      s.ttl -= dt;
      if (s.ttl <= 1.2) s.el.classList.remove("glow");
      if (s.ttl <= 0) {
        fadeSunAway(s);
      }
    }
  }
  for (let i = suns.length - 1; i >= 0; i--) {
    if (suns[i].dead) suns.splice(i, 1);
  }
  game.raf = requestAnimationFrame(loop);
}

// ---------- Pause / resume ----------
const pauseBtn = document.getElementById("pause-btn");
const pauseReveal = pauseBtn && pauseBtn.parentElement;
const pauseOverlay = document.getElementById("pause-overlay");
const fullscreenToggle = document.getElementById("fullscreen-toggle");
const restartLevelBtn = document.getElementById("restart-level");
let lastFullscreenState = Boolean(document.fullscreenElement);
function syncFullscreenToggle() {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenToggle.setAttribute("aria-checked", String(isFullscreen));
  fullscreenToggle.querySelector(".fullscreen-checkbox").src = isFullscreen
    ? "uploads/CheckBox_Checked.png"
    : "uploads/Checkbox_Unchecked.png";
  if (isFullscreen !== lastFullscreenState) playResumeSound();
  lastFullscreenState = isFullscreen;
}
fullscreenToggle.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    syncFullscreenToggle();
  }
});
document.addEventListener("fullscreenchange", syncFullscreenToggle);
syncFullscreenToggle();

const layoutOptions = [...document.querySelectorAll(".layout-option")];
const layoutToggle = document.getElementById("layout-toggle");
const layoutMenu = document.getElementById("layout-menu");
const quickLoadControls = document.getElementById("quick-load-controls");
const quickLoadToggle = document.getElementById("quick-load-toggle");
const quickLoadMenu = document.getElementById("quick-load-menu");
const quickLoadLevel = document.getElementById("quick-load-level");
const quickLoadConfirm = document.getElementById("quick-load-confirm");
const QUICK_LOAD_USERNAME = "ParisOnWebsim";
let quickLoadAuthorized = false;
function syncQuickLoadControl() {
  // Level select: everyone can replay any level they've reached; the author's
  // websim account can jump to any level for testing.
  const reached = quickLoadAuthorized ? MAX_LEVEL : loadProgress();
  const current = reached;
  quickLoadLevel.replaceChildren();
  for (let n = 1; n <= reached; n++) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = `1-${n}`;
    quickLoadLevel.appendChild(option);
  }
  quickLoadLevel.value = String(Math.min(current, reached));
  quickLoadControls.hidden = reached <= 1 || menuOverlay.classList.contains("hidden");
}
function setScreenLayout(layout) {
  scaler.classList.remove("layout-stacked-reversed", "layout-side-by-side", "layout-side-reversed");
  if (layout !== "stacked") scaler.classList.add(`layout-${layout}`);
  for (const option of layoutOptions) {
    const selected = option.dataset.layout === layout;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
  fit();
}
layoutToggle.addEventListener("click", () => {
  const open = layoutMenu.hidden;
  layoutMenu.hidden = !open;
  layoutToggle.setAttribute("aria-expanded", String(open));
});
quickLoadToggle.addEventListener("click", () => {
  const open = quickLoadMenu.hidden;
  quickLoadMenu.hidden = !open;
  quickLoadToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    layoutMenu.hidden = true;
    layoutToggle.setAttribute("aria-expanded", "false");
  }
});
quickLoadConfirm.addEventListener("click", () => {
  quickLoadMenu.hidden = true;
  quickLoadToggle.setAttribute("aria-expanded", "false");
  const pick = Number(quickLoadLevel.value);
  if (quickLoadAuthorized) saveProgress(pick);
  startAdventure(pick);
});
for (const option of layoutOptions) {
  option.addEventListener("click", () => {
    setScreenLayout(option.dataset.layout);
    layoutMenu.hidden = true;
    layoutToggle.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#layout-controls")) {
    layoutMenu.hidden = true;
    layoutToggle.setAttribute("aria-expanded", "false");
    quickLoadMenu.hidden = true;
    quickLoadToggle.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (!layoutMenu.hidden || !quickLoadMenu.hidden)) {
    layoutMenu.hidden = true;
    layoutToggle.setAttribute("aria-expanded", "false");
    quickLoadMenu.hidden = true;
    quickLoadToggle.setAttribute("aria-expanded", "false");
    layoutToggle.focus();
  }
  if (/^[1-4]$/.test(event.key) && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const type = Object.keys(PLANTS)[Number(event.key) - 1];
    if (type && game.canPlant && !seedLocked(type)) toggleSeed(type);
  }
});
const backToGameBtn = document.getElementById("back-to-game");
const optionsOkBtn = document.getElementById("options-ok");
const pauseMainMenuBtn = document.getElementById("pause-main-menu");
const returnMenuConfirmation = document.getElementById("return-menu-confirmation");
const returnMenuConfirmBtn = document.getElementById("return-menu-confirm");
const returnMenuCancelBtn = document.getElementById("return-menu-cancel");
const restartLevelConfirmation = document.getElementById("restart-level-confirmation");
const restartLevelConfirmBtn = document.getElementById("restart-level-confirm");
const restartLevelCancelBtn = document.getElementById("restart-level-cancel");
if (pauseReveal) {
  pauseReveal.addEventListener("animationend", (event) => {
    if (event.animationName !== "pauseDrop" || game.dead) return;
    game.canPause = true;
    pauseBtn.disabled = false;
  });
}
function togglePause() {
  if (!game.canPause || game.dead) return;
  game.paused = !game.paused;
  if (game.paused) {
    playPauseSound();
    musicAudio.pause();
    buildUpMusicAudio.pause();
    pauseOverlay.classList.add("show");
  } else {
    playResumeSound();
    if (buildUpMusicActive) buildUpMusicAudio.play().catch(() => {});
    else musicAudio.play().catch(() => {});
    pauseOverlay.classList.remove("show");
  }
  pauseOverlay.setAttribute("aria-hidden", String(!game.paused));
  pauseBtn.title = game.paused ? "Resume" : "Pause";
  pauseBtn.setAttribute("aria-label", pauseBtn.title);
  syncEatingSound();
  syncLawnmowerSound();
}
function resetGameProgress() {
  state.sun = game.levelIndex === 1 ? 150 : 50;
  game.rewardShown = false;
  state.selected = null;
  state.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  state.cdEnd = {};
  for (const key of Object.keys(nextFire)) delete nextFire[key];
  for (const { slot } of cellEls) slot.innerHTML = "";
  document.querySelectorAll(".seed-packet").forEach((packet) => packet.classList.remove("selected"));
  updateSun();
}
function closeReturnMenuConfirmation() {
  returnMenuConfirmation.classList.remove("show");
  returnMenuConfirmation.setAttribute("aria-hidden", "true");
}
function openReturnMenuConfirmation() {
  playMenuClickSound();
  returnMenuConfirmation.classList.add("show");
  returnMenuConfirmation.setAttribute("aria-hidden", "false");
}
function closeRestartLevelConfirmation() {
  restartLevelConfirmation.classList.remove("show");
  restartLevelConfirmation.setAttribute("aria-hidden", "true");
}
function openRestartLevelConfirmation() {
  playMenuClickSound();
  restartLevelConfirmation.classList.add("show");
  restartLevelConfirmation.setAttribute("aria-hidden", "false");
}
function confirmReturnToMenu() {
  showMenu();
}
function restartLevel() {
  closeRestartLevelConfirmation();
  dismissTopScreenZombies();
  stopAudio();
  playResumeSound();
  resetGameProgress();
  game.paused = false;
  pauseOverlay.classList.remove("show");
  pauseOverlay.setAttribute("aria-hidden", "true");
  boot(true, true);
}
if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
if (restartLevelBtn) restartLevelBtn.addEventListener("click", openRestartLevelConfirmation);
if (restartLevelConfirmBtn) restartLevelConfirmBtn.addEventListener("click", restartLevel);
if (restartLevelCancelBtn) restartLevelCancelBtn.addEventListener("click", () => {
  closeRestartLevelConfirmation();
  playResumeSound();
});
if (backToGameBtn) backToGameBtn.addEventListener("click", togglePause);
if (optionsOkBtn) optionsOkBtn.addEventListener("click", () => {
  pauseOverlay.classList.remove("show", "options-mode");
  pauseOverlay.setAttribute("aria-hidden", "true");
  playResumeSound();
});
if (pauseMainMenuBtn) pauseMainMenuBtn.addEventListener("click", openReturnMenuConfirmation);
if (returnMenuConfirmBtn) returnMenuConfirmBtn.addEventListener("click", confirmReturnToMenu);
if (returnMenuCancelBtn) returnMenuCancelBtn.addEventListener("click", () => {
  closeReturnMenuConfirmation();
  playResumeSound();
});

// ---------- Game over ----------
// Ends the match when a zombie reaches the end of the lawn. Stops the loop,
// shows the overlay, and kills the music. Idempotent so it only fires once.
const gameoverOverlay = document.getElementById("gameover-overlay");
const winOverlay = document.getElementById("win-overlay");
const waveAnnouncement = document.getElementById("wave-announcement");
const waveAnnouncementText = document.getElementById("wave-announcement-text");
function cancelWaveSequence() {
  game.waveSequenceToken = (game.waveSequenceToken || 0) + 1;
  game.finalWaveStarted = false;
  game.waveSequenceStarted = false;
  game.finalHordeSpawnComplete = false;
  game.finalHordeQueue = [];
  waveAnnouncement.classList.remove("show", "stomp", "fade-out");
  waveAnnouncement.setAttribute("aria-hidden", "true");
  waveAnnouncementText.textContent = "";
}
function waveSequenceIsActive(token) {
  return token === game.waveSequenceToken && !game.dead;
}
const waveWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function showWaveAnnouncement(message, token, onStomp = null) {
  if (!waveSequenceIsActive(token)) return false;
  waveAnnouncementText.textContent = message;
  waveAnnouncement.classList.remove("fade-out", "stomp");
  waveAnnouncement.classList.add("show");
  waveAnnouncement.setAttribute("aria-hidden", "false");
  void waveAnnouncementText.offsetWidth;
  waveAnnouncement.classList.add("stomp");
  await waveWait(1180);
  if (!waveSequenceIsActive(token)) return false;
  playGameSfx("hugeWave", hugeWaveAudio);
  if (onStomp) await onStomp();
  if (!waveSequenceIsActive(token)) return false;
  await waveWait(2200);
  if (!waveSequenceIsActive(token)) return false;
  waveAnnouncement.classList.remove("stomp");
  waveAnnouncement.classList.add("fade-out");
  await waveWait(550);
  waveAnnouncement.classList.remove("show", "stomp", "fade-out");
  waveAnnouncement.setAttribute("aria-hidden", "true");
  return waveSequenceIsActive(token);
}
async function beginWaveSequence() {
  const token = game.waveSequenceToken;
  startBuildUpMusic();
  if (!await showWaveAnnouncement("A Huge wave of Zombies are Approaching", token)) return;
  await showWaveAnnouncement("Final Wave", token, async () => {
    await waveWait(200);
    if (!waveSequenceIsActive(token)) return;
    playGameSfx("finalSiren", finalSirenAudio);
    startFinalHorde();
  });
}
function startFinalHorde() {
  game.finalWaveStarted = true;
  progressFlag.classList.add("raised");
  game.finalHordeSpawnComplete = false;
  const [hordeMin, hordeMax] = levelCfg().horde;
  const count = hordeMin + Math.floor(Math.random() * (hordeMax - hordeMin + 1));
  const lanes = unlockedRows().slice();
  while (lanes.length < count) lanes.push(unlockedRows()[Math.floor(Math.random() * unlockedRows().length)]);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  game.finalHordeTotal = count;
  game.finalHordeSpawned = 0;
  game.finalProgressFilled = false;
  updateLevelProgress();
  game.finalHordeQueue = lanes;
  levelProgressEl.classList.add("final-filling");
  requestAnimationFrame(() => {
    if (game.dead || !game.finalWaveStarted) return;
    game.finalProgressFilled = true;
    updateLevelProgress();
  });
  // Let the bar travel from the raised flag to the end before the horde arrives.
  game.finalHordeSpawnTimer = 2.8;
}
function stepFinalHordeSpawn(dt) {
  if (!game.finalWaveStarted || game.finalHordeSpawnComplete) return;
  game.finalHordeSpawnTimer -= dt;
  if (game.finalHordeSpawnTimer > 0) return;
  const row = game.finalHordeQueue.shift();
  if (row === undefined) {
    game.finalHordeSpawnComplete = true;
    return;
  }
  spawnZombie({ row, finalHorde: true });
  game.finalHordeSpawned++;
  updateLevelProgress();
  if (!game.finalHordeQueue.length) {
    game.finalHordeSpawnComplete = true;
    maybeShowSunflowerReward();
  } else {
    game.finalHordeSpawnTimer = 0.34 + Math.random() * 0.18;
  }
}
function showSunflowerReward() {
  if (game.rewardShown || game.dead) return;
  game.rewardShown = true;
  game.dead = true;
  eatingAudio.pause();
  eatingAudio.currentTime = 0;
  game.canPlant = false;
  game.canPause = false;
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  if (pauseBtn) pauseBtn.disabled = true;
  pauseOverlay.classList.remove("show");
  stageEl.classList.add("game-over-freeze");
  const reward = document.getElementById("sunflower-reward");
  const rewardImage = reward.querySelector("img");
  const rewardType = rewardPlantFor(game.levelIndex);
  reward.classList.remove("bonus-reward");
  if (rewardType) {
    const rewardDef = PLANTS[rewardType];
    rewardImage.src = rewardDef.icon;
    rewardImage.alt = rewardType === "walnut" ? "Wall-nut" : rewardDef.name;
    reward.setAttribute("aria-label", rewardImage.alt + " seed packet");
  } else {
    // No new plant this time: a trophy sun carries you to the next level.
    rewardImage.src = "Sun.png";
    rewardImage.alt = "Level complete";
    reward.classList.add("bonus-reward");
    reward.setAttribute("aria-label", "Collect reward and continue");
  }
  const position = game.lastFinalZombieRewardPosition || { x: 50, y: 50 };
  const sunRect = sunLayer.getBoundingClientRect();
  const stageRect = stageEl.getBoundingClientRect();
  const startY = position.y;
  const peakY = Math.max(0, startY - (42 / sunRect.height) * 100);
  const targetY = Math.min(100, startY + (48 / sunRect.height) * 100);
  reward.classList.add("show");
  const rewardRect = reward.getBoundingClientRect();
  const halfW = rewardRect.width / 2;
  const halfH = rewardRect.height / 2;
  const visibleLeft = Math.max(0, stageRect.left) + halfW;
  const visibleRight = Math.min(window.innerWidth, stageRect.right) - halfW;
  const visibleTop = Math.max(0, stageRect.top) + halfH;
  const visibleBottom = Math.min(window.innerHeight, stageRect.bottom) - halfH;
  const leftPx = Math.max(visibleLeft, Math.min(visibleRight, sunRect.left + (position.x / 100) * sunRect.width));
  const setRewardPosition = (y) => {
    const topPx = Math.max(visibleTop, Math.min(visibleBottom, sunRect.top + (y / 100) * sunRect.height));
    reward.style.left = `${((leftPx - stageRect.left) / stageRect.width) * 100}%`;
    reward.style.top = `${((topPx - stageRect.top) / stageRect.height) * 100}%`;
  };
  reward.style.transition = "none";
  setRewardPosition(startY);
  reward.setAttribute("aria-hidden", "false");
  let arcStartedAt = null;
  const animateRewardArc = (now) => {
    if (arcStartedAt === null) arcStartedAt = now;
    const elapsed = (now - arcStartedAt) / 1000;
    setRewardPosition(sunflowerArcY(elapsed, startY, peakY, targetY));
    const fallDuration = Math.sqrt(Math.max(0, targetY - peakY) / 40);
    if (elapsed < 0.24 + fallDuration) {
      requestAnimationFrame(animateRewardArc);
    } else {
      setRewardPosition(targetY);
      reward.style.opacity = "";
      reward.style.transition = "";
      reward.classList.add("arrived");
    }
  };
  requestAnimationFrame(animateRewardArc);
}
function playAudioUntilEnded(audio) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    audio.currentTime = 0;
    const playback = audio.play();
    if (playback && typeof playback.catch === "function") playback.catch(finish);
  });
}
async function collectSunflowerReward() {
  const reward = document.getElementById("sunflower-reward");
  if (!reward.classList.contains("show") || !reward.classList.contains("arrived") || reward.classList.contains("collecting")) return;

  const rewardRect = reward.getBoundingClientRect();
  const stageRect = stageEl.getBoundingClientRect();
  document.body.appendChild(reward);
  reward.style.transition = "none";
  reward.style.position = "fixed";
  reward.style.width = `${rewardRect.width}px`;
  reward.style.height = `${rewardRect.height}px`;
  reward.style.left = `${rewardRect.left + rewardRect.width / 2}px`;
  reward.style.top = `${rewardRect.top + rewardRect.height / 2}px`;
  reward.style.transform = "translate(-50%, -50%)";
  reward.style.zIndex = "1100";
  void reward.offsetWidth;
  reward.style.transition = "left 1.2s cubic-bezier(.2,.7,.3,1), top 1.2s cubic-bezier(.2,.7,.3,1)";
  // Duck the lawn music so both plant-unlock sounds are clear.
  setMusicDuck(0);
  const unlockSound = playAudioUntilEnded(plantUnlockedAudio);
  reward.classList.add("collecting");
  reward.style.left = `${stageRect.left + stageRect.width / 2}px`;
  reward.style.top = `${stageRect.top + stageRect.height / 2}px`;

  const whiteout = document.getElementById("level-whiteout");
  const topWhiteout = document.getElementById("top-level-whiteout");
  await unlockSound;
  whiteout.classList.add("visible");
  topWhiteout.classList.add("visible");
  reward.style.transition = "opacity 1.5s ease-in-out";
  reward.style.opacity = "0";
  await playAudioUntilEnded(thingAudio);

  reward.classList.remove("show", "arrived", "collecting");
  reward.setAttribute("aria-hidden", "true");
  stageEl.appendChild(reward);
  reward.style.cssText = "";
  game.levelIndex += 1;
  saveProgress(game.levelIndex);
  game.rewardShown = false;
  game.won = false;
  game.dead = false;
  resetGameProgress();
  document.getElementById("top-level-label").textContent = levelLabel();
  boot(true);
  requestAnimationFrame(() => {
    whiteout.classList.remove("visible");
    topWhiteout.classList.remove("visible");
  });
}
document.getElementById("sunflower-reward").addEventListener("click", collectSunflowerReward);
function triggerWin() {
  if (game.dead || game.won) return;
  levelProgressFill.style.setProperty("--fill-inset", `${(3 / 242) * 100}%`);
  levelProgressHead.style.left = `${(3 / 242) * 100 + 2.5}%`;
  levelProgressEl.setAttribute("aria-valuenow", "100");
  levelProgressEl.classList.add("complete");
  game.won = true;
  game.dead = true;
  cancelWaveSequence();
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  if (pauseBtn) pauseBtn.disabled = true;
  setShovelActive(false);
  shovelButton.classList.remove("ready");
  stageEl.classList.add("game-over-freeze");
  levelProgressEl.classList.remove("active");
  pauseOverlay.classList.remove("show");
  gameoverOverlay.classList.remove("show", "show-text");
  for (const audio of [musicAudio, buildUpMusicAudio, chooseSeedsAudio, eatingAudio, lawnmowerAudio, ...soundEffectAudioNodes]) {
    audio.pause();
    audio.currentTime = 0;
  }
  resetBuildUpMusic();
  stopGameSfx();
  winOverlay.classList.add("show");
  winOverlay.setAttribute("aria-hidden", "false");
}
function triggerGameOver(fatalZombie = null) {
  if (game.over) return;
  game.over = true;
  game.dead = true; // halt the simulation while the sound-led sequence runs
  cancelWaveSequence();
  setShovelActive(false);
  shovelButton.classList.remove("ready");
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  if (pauseBtn) pauseBtn.disabled = true;
  stageEl.classList.add("game-over-freeze");
  levelProgressEl.classList.remove("active", "complete", "final-filling");
  progressFlag.classList.remove("raised");
  pauseOverlay.classList.remove("show");
  for (const audio of [musicAudio, buildUpMusicAudio, chooseSeedsAudio, popAudio, plantAudio, cherryChargeAudio, cherryKaboomAudio, pickupAudio, errorAudio, introReadyAudio, introPlantAudio, graceAudio, collectAudio, peaShotAudio, peaHitAudio, setVolumeAudio, hugeWaveAudio, finalSirenAudio, plantUnlockedAudio, thingAudio, lawnmowerAudio, eatingAudio, shovelPickupAudio, shovelRemoveAudio]) {
    audio.pause();
    audio.currentTime = 0;
  }
  stopGameSfx();
  resetBuildUpMusic();
  eatingAudio.loop = true;
  gameoverOverlay.classList.add("show");
  menuBtn.classList.remove("show");
  document.getElementById("gameover-image").classList.remove("shake");
  playGameOverSequence(fatalZombie);
}

// ---------- Main menu ----------
const menuOverlay = document.getElementById("menu-overlay");
const menuUsername = document.getElementById("menu-username");
const menuPlay = document.getElementById("menu-play");
houseLabel.textContent = "Your House";
window.websim?.getUser().then((user) => {
  const username = user?.username?.trim();
  quickLoadAuthorized = username?.toLowerCase() === QUICK_LOAD_USERNAME.toLowerCase();
  syncQuickLoadControl();
  if (username && username.toLowerCase() !== "anonymous") {
    menuUsername.textContent = username;
    houseLabel.textContent = `${username}'s House`;
  } else {
    menuUsername.textContent = "";
    houseLabel.textContent = "Your House";
  }
}).catch(() => {
  quickLoadAuthorized = false;
  syncQuickLoadControl();
  menuUsername.textContent = "";
  houseLabel.textContent = "Your House";
});
const menuPlayImage = document.getElementById("menu-play-image");
const menuMore = document.getElementById("menu-more");
const moreOptions = document.getElementById("more-options");
const moreBack = document.getElementById("more-back");
const moreBottomLayer = document.getElementById("more-bottom-layer");
const menuCrow = document.getElementById("menu-crow");
const menuCrowFly = document.getElementById("menu-crow-fly");
const menuCrowStrikeFrames = [
  document.getElementById("menu-crow-strike-1"),
  document.getElementById("menu-crow-strike-2"),
];
const menuCrowStrikeFramesReady = Promise.all(menuCrowStrikeFrames.map((image) =>
  image.decode().catch(() => {})
));
let menuCrowEmoteTimer = null;
let menuCrowEmoteInterval = null;
const menuCrowEmoteFrameClasses = ["emote-frame-1", "emote-frame-2", "emote-frame-3"];

function stopMenuCrowEmotes() {
  clearTimeout(menuCrowEmoteTimer);
  clearInterval(menuCrowEmoteInterval);
  menuCrowEmoteTimer = null;
  menuCrowEmoteInterval = null;
  menuCrow.classList.remove("emoting", ...menuCrowEmoteFrameClasses);
}


const CROW_MORE_TRANSFORM = "translate(-243.75%, -55.5556%)";
async function transitionMenuView(toMore) {
  const isMore = menuOverlay.classList.contains("more-mode");
  if (isMore === toMore || menuOverlay.classList.contains("more-transitioning")) return;
  menuOverlay.classList.add("more-transitioning");
  stopMenuCrowEmotes();
  menuCrow.classList.add("flying", toMore ? "more-flight" : "return-flight");

  // Keep the flight sprite's box fixed at its home anchor and animate only a
  // transform. This avoids left/size transitions being re-triggered when the
  // view classes change on landing.
  const homeTransform = "none";
  const moreTransform = CROW_MORE_TRANSFORM;
  const start = isMore ? moreTransform : homeTransform;
  const destination = toMore ? moreTransform : homeTransform;
  menuCrowFly.style.transition = "none";
  menuCrowFly.style.transformOrigin = "top left";
  menuCrowFly.style.transform = start;
  void menuCrowFly.offsetWidth;
  topScreen.classList.toggle("more-mode", toMore);
  menuOverlay.classList.toggle("more-mode", toMore);
  moreBottomLayer.setAttribute("aria-hidden", String(!toMore));

  const flight = menuCrowFly.animate(
    [{ transform: start }, { transform: destination }],
    { duration: 650, easing: "linear", fill: "forwards" },
  );
  try { await flight.finished; } catch (_) {}
  menuCrowFly.style.transform = destination;
  flight.cancel();

  if (toMore) {
    menuCrow.classList.remove("more-flight");
    menuCrow.classList.add("more-facing");
  } else {
    menuCrow.classList.remove("more-facing", "return-flight");
  }
  menuCrow.classList.remove("flying");
  menuOverlay.classList.remove("more-transitioning");
  scheduleMenuCrowEmote();
}

function openMenuOptions() {
  playMenuClickSound();
  pauseOverlay.classList.add("options-mode", "show");
  pauseOverlay.setAttribute("aria-hidden", "false");
}

function scheduleMenuCrowEmote() {
  if (!topScreen.classList.contains("menu") || topScreen.classList.contains("leaving")) return;
  menuCrowEmoteTimer = setTimeout(() => {
    menuCrowEmoteTimer = null;
    if (!topScreen.classList.contains("menu") || topScreen.classList.contains("leaving")) return;

    let frame = 1;
    const showFrame = () => {
      menuCrow.classList.remove(...menuCrowEmoteFrameClasses);
      menuCrow.classList.add("emoting", menuCrowEmoteFrameClasses[frame - 1]);
    };
    const finishEmote = () => {
      clearTimeout(menuCrowEmoteTimer);
      clearInterval(menuCrowEmoteInterval);
      menuCrowEmoteTimer = null;
      menuCrowEmoteInterval = null;
      menuCrow.classList.remove("emoting", ...menuCrowEmoteFrameClasses);
      scheduleMenuCrowEmote();
    };

    showFrame();
    if (Math.random() < 0.1) {
      menuCrowEmoteTimer = setTimeout(finishEmote, 400);
      return;
    }

    const loops = 2 + Math.floor(Math.random() * 4);
    let completedLoops = 0;
    menuCrowEmoteInterval = setInterval(() => {
      frame = frame === 3 ? 1 : frame + 1;
      showFrame();
      if (frame === 1 && ++completedLoops >= loops) finishEmote();
    }, 200);
  }, 4000 + Math.random() * 5000);
}
const menuBtn = document.getElementById("menu-btn");
const winMenuBtn = document.getElementById("win-menu-btn");
if (winMenuBtn) winMenuBtn.addEventListener("click", showMenu);

// Silence every audio node so nothing keeps ringing out when the menu shows.
function stopAudio() {
  for (const a of [musicAudio, buildUpMusicAudio, titleIntroAudio, chooseSeedsAudio, popAudio, plantAudio, pickupAudio, errorAudio, pauseAudio, introReadyAudio, introPlantAudio, graceAudio, collectAudio, peaShotAudio, peaHitAudio, setVolumeAudio, hugeWaveAudio, finalSirenAudio, plantUnlockedAudio, thingAudio, lawnmowerAudio, eatingAudio, gameOverAudio, evilLaughAudio, noAudio, resumeAudio, menuClickAudio, shovelPickupAudio, shovelRemoveAudio]) {
    a.pause();
    a.currentTime = 0;
  }
  resetBuildUpMusic();
  stopGameSfx();
}

const titleIntroOverlay = document.getElementById("intro-sequence");
const titleIntroImage = document.getElementById("intro-sequence-image");
const topScreen = document.getElementById("top-screen");
const topIntroImage = document.getElementById("top-intro-image");
const titleLoading = document.getElementById("title-loading");
const loadingPrompt = document.getElementById("loading-prompt");
const loadingTrail = document.getElementById("loading-trail-wrap");
const loadingRoll = document.getElementById("loading-roll");
const menuGrassFrames = [...document.querySelectorAll("#menu-grass-wind .menu-grass-frame")];
let grassWindTimer = null;
function runGrassWind(frame = 1, direction = 1) {
  if (!menuGrassFrames.length) return;
  menuGrassFrames.forEach((image, index) => image.classList.toggle("active", index === frame - 1));
  clearTimeout(grassWindTimer);
  if (frame === 3 && direction === 1) {
    grassWindTimer = setTimeout(() => runGrassWind(2, -1), 1200);
    return;
  }
  if (frame === 1 && direction === -1) {
    grassWindTimer = setTimeout(() => runGrassWind(2, 1), 200);
    return;
  }
  grassWindTimer = setTimeout(() => runGrassWind(frame + direction, direction), 200);
}
Promise.all(menuGrassFrames.map((image) => image.decode().catch(() => {}))).then(() => runGrassWind());
let titleIntroRun = 0;
const loadingCuesPlayed = new Set();
const loadingCues = [
  { progress: 0.08, name: "loadingFlower1", audio: flowerPlopAudio },
  { progress: 0.23, name: "loadingFlower2", audio: flowerPlopAudio },
  { progress: 0.48, name: "loadingFlower3", audio: flowerPlopAudio },
  { progress: 0.66, name: "loadingFlower4", audio: flowerPlopAudio },
  { progress: 0.88, name: "loadingZombie", audio: loadingZombieAudio },
];

function updateTitleLoadingProgress(done, total) {
  const progress = total ? Math.min(1, done / total) : 1;
  const percent = Math.floor(progress * 100);
  for (const cue of loadingCues) {
    if (progress >= cue.progress && !loadingCuesPlayed.has(cue.name)) {
      loadingCuesPlayed.add(cue.name);
      playGameSfx(cue.name, cue.audio);
    }
  }
  loadingPrompt.textContent = `Loading... ${percent}%`;
  if (loadingTrail) loadingTrail.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`;
  if (loadingRoll) {
    loadingRoll.style.left = `${-29 + 337 * progress}px`;
    loadingRoll.style.transform = `translateY(${25 * progress}px) rotate(${1080 * progress}deg) scale(${1 - 0.76 * progress})`;
    loadingRoll.style.opacity = String(progress >= 1 ? 0 : 1);
  }
}

function startTitleMusic(restart = false) {
  if (restart) titleIntroAudio.currentTime = 0;
  setMusicVolume(musicVolumeSlider.value);
  titleIntroAudio.play().catch(() => {});
}

async function playTitleSequence() {
  const run = ++titleIntroRun;
  const slides = [
    { src: "Intro1.png", hold: 1900 },
    { src: "Intro2.png", hold: 1900 },
    { src: "popcap_logo.jpeg", hold: 2800, music: true },
  ];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const artReady = slides.map(({ src }) => {
    const image = new Image();
    image.src = src;
    return image.decode().catch(() => {});
  });

  loadScreen.classList.add("done");
  topScreen.classList.remove("loading");
  topIntroImage.classList.remove("visible");
  menuOverlay.classList.add("hidden");
  titleIntroOverlay.classList.remove("hidden");
  titleIntroOverlay.setAttribute("aria-hidden", "false");
  await artReady[0];

  for (let i = 0; i < slides.length && run === titleIntroRun; i++) {
    await artReady[i];
    if (run !== titleIntroRun) return;
    const slide = slides[i];
    titleIntroImage.src = slide.src;
    titleIntroImage.classList.toggle("popcap-logo", slide.src === "popcap_logo.jpeg");
    titleIntroImage.classList.toggle("stretched", i < 2);
    titleIntroImage.classList.remove("visible");
    if (i > 0) await wait(180);
    await wait(40);
    if (slide.music) startTitleMusic();
    titleIntroImage.classList.add("visible");
    if (i === 0) topIntroImage.classList.add("visible");
    await wait(slide.hold);
    titleIntroImage.classList.remove("visible");
    if (i === 1) topIntroImage.classList.remove("visible");
    await wait(850);
  }

  if (run !== titleIntroRun) return;
  titleIntroOverlay.classList.add("hidden");
  titleIntroOverlay.setAttribute("aria-hidden", "true");
  titleLoading.classList.remove("hidden", "ready", "active", "loader-visible");
  titleLoading.disabled = true;
  loadingPrompt.textContent = "loading...";
  titleLoading.setAttribute("aria-hidden", "false");
  topScreen.classList.add("loading");
  titleLoading.classList.add("active");
  loadingCuesPlayed.clear();
  updateTitleLoadingProgress(0, 1);
  const loadingComplete = preloadAll((done, total) => updateTitleLoadingProgress(done, total));
  await wait(700);
  if (run !== titleIntroRun) return;
  titleLoading.classList.add("loader-visible");
  await loadingComplete;
  if (run !== titleIntroRun) return;
  loadingPrompt.textContent = "Touch to start!";
  titleLoading.classList.add("ready");
  titleLoading.disabled = false;
  await new Promise((resolve) => {
    titleLoading.addEventListener("click", async () => {
      if (run !== titleIntroRun) return;
      titleLoading.disabled = true;
      prepareAudio();
      playGameSfx("loadingClick", loadingClickAudio);
      gameScreenBlackout.classList.add("covering", "title-transition");
      topScreenBlackout.classList.add("covering", "title-transition");
      await wait(520);
      if (run !== titleIntroRun) return;
      titleLoading.classList.add("hidden");
      titleLoading.classList.remove("active", "ready", "loader-visible");
      topScreen.classList.remove("loading");
      topScreen.classList.add("menu");
      scheduleMenuCrowEmote();
      titleLoading.setAttribute("aria-hidden", "true");
      menuOverlay.classList.remove("hidden", "revealing");
      syncQuickLoadControl();
      requestAnimationFrame(() => {
        menuOverlay.classList.add("revealing");
        requestAnimationFrame(() => {
          gameScreenBlackout.classList.remove("covering");
          topScreenBlackout.classList.remove("covering");
        });
      });
      setTimeout(() => {
        gameScreenBlackout.classList.remove("title-transition", "fading");
        topScreenBlackout.classList.remove("title-transition", "fading");
      }, 700);
      resolve();
    }, { once: true });
  });
}

function showMenu() {
  stopMenuCrowEmotes();
  closeReturnMenuConfirmation();
  closeRestartLevelConfirmation();
  resetGameProgress();
  levelProgressEl.classList.remove("active", "complete", "final-filling");
  progressFlag.classList.remove("raised");
  teardown();
  winOverlay.classList.remove("show");
  winOverlay.setAttribute("aria-hidden", "true");
  titleIntroRun++;
  titleIntroOverlay.classList.add("hidden");
  game.dead = true;
  stageEl.classList.remove("game-over-freeze", "game-over-house-view");
  game.canPause = false;
  if (pauseBtn) {
    pauseBtn.disabled = true;
    pauseBtn.parentElement.classList.remove("ready");
  }
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.timer) clearTimeout(game.timer);
  stopAudio();
  playResumeSound();
  gameoverOverlay.classList.remove("show", "show-text");
  winOverlay.classList.remove("show");
  winOverlay.setAttribute("aria-hidden", "true");
  document.getElementById("gameover-image").classList.remove("shake");
  menuBtn.classList.remove("show");
  pauseOverlay.classList.remove("show");
  loadScreen.classList.add("done");
  menuPlay.disabled = false;
  menuPlay.classList.remove("blinking");
  menuPlayImage.src = "StartAdvNormal.png";
  menuCrow.classList.remove("lightning", "frame-1", "frame-2", "more-facing", "flying", "more-flight", "return-flight", "landed");
  topScreen.classList.remove("leaving", "game", "more-mode");
  topScreen.classList.add("menu");
  menuOverlay.classList.remove("leaving", "hidden", "more-mode", "more-transitioning", "adventure-starting");
  menuOverlay.classList.add("revealing");
  syncQuickLoadControl();
  moreBottomLayer.setAttribute("aria-hidden", "true");
  pauseOverlay.classList.remove("options-mode");
  startTitleMusic(true);
  scheduleMenuCrowEmote();
}
function startGame(keepMenuVisible = false, levelIndex = 1) {
  quickLoadControls.hidden = true;
  game.levelIndex = levelIndex;
  document.getElementById("top-level-label").textContent = levelLabel();
  resetGameProgress();
  titleIntroRun++;
  titleIntroOverlay.classList.add("hidden");
  titleIntroAudio.pause();
  titleIntroAudio.currentTime = 0;
  if (!keepMenuVisible) menuOverlay.classList.add("hidden");
  prepareAudio();
  preloadGameSfx();
  boot(true);
}
async function startAdventure(levelToLoad = 1) {
  if (menuPlay.disabled || menuOverlay.classList.contains("more-transitioning")) return;
  const requested = Number(levelToLoad);
  const requestedLevel = Number.isInteger(requested) && requested >= 1 && requested <= loadProgress() ? requested : loadProgress();
  if (menuOverlay.classList.contains("more-mode")) {
    playResumeSound();
    await transitionMenuView(false);
  }
  menuOverlay.classList.add("adventure-starting");
  menuPlay.disabled = true;
  stopMenuCrowEmotes();
  prepareAudio();
  playMenuClickSound();
  await menuCrowStrikeFramesReady;
  const menuSounds = playAdventureMenuSounds();
  titleIntroAudio.pause();
  titleIntroAudio.currentTime = 0;
  menuPlay.classList.add("blinking");
  menuPlayImage.src = "StartAdvNormal.png";
  let crowFrame = 1;
  menuCrow.classList.add("lightning", "frame-1");
  const crowBlinkInterval = setInterval(() => {
    crowFrame = crowFrame === 1 ? 2 : 1;
    menuCrow.classList.toggle("frame-1", crowFrame === 1);
    menuCrow.classList.toggle("frame-2", crowFrame === 2);
  }, 100);
  const blinkStartedAt = performance.now();

  await menuSounds;
  const blinkRemaining = 1500 - (performance.now() - blinkStartedAt);
  if (blinkRemaining > 0) await new Promise((resolve) => setTimeout(resolve, blinkRemaining));
  clearInterval(crowBlinkInterval);
  menuPlay.classList.remove("blinking");
  menuPlayImage.src = "StartAdvNormal.png";
  topScreen.classList.add("leaving");
  menuOverlay.classList.add("leaving");

  await new Promise((resolve) => {
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      menuOverlay.removeEventListener("transitionend", onTransitionEnd);
      resolve();
    };
    const onTransitionEnd = (event) => {
      if (event.target === menuOverlay && event.propertyName === "opacity" && event.pseudoElement === "::after") finish();
    };
    menuOverlay.addEventListener("transitionend", onTransitionEnd);
    timeout = setTimeout(finish, 900);
  });
  menuCrow.classList.remove("lightning", "frame-1", "frame-2");
  startGame(true, requestedLevel);
  menuOverlay.classList.add("hidden");
  menuOverlay.classList.remove("leaving");
}
if (menuPlay) menuPlay.addEventListener("click", () => startAdventure(loadProgress()));
if (menuMore) menuMore.addEventListener("click", () => {
  if (menuOverlay.classList.contains("adventure-starting")) return;
  playResumeSound();
  transitionMenuView(true);
});
if (moreOptions) moreOptions.addEventListener("click", openMenuOptions);
if (moreBack) moreBack.addEventListener("click", () => {
  playResumeSound();
  transitionMenuView(false);
});
if (menuBtn) menuBtn.addEventListener("click", showMenu);

// ---------- Teardown / single-instance ----------
// One canonical game instance keyed on window. Any re-execution of this
// module (dev reload / future multiplayer re-join) tears down the previous
// instance first, so loops, timers, and sun DOM can never stack.
const game = (window.__game = window.__game || { dead: false, canPause: false, canPlant: false, shovelActive: false, raf: null, timer: null, plantAnims: [] });
game.levelIndex = game.levelIndex || 1;
function showTutorialMessage(message) {
  if (!tutorialBar || (game.levelIndex !== 1 && game.levelIndex !== 2)) return;
  tutorialText.textContent = message;
  tutorialBar.classList.add("visible");
  tutorialBar.setAttribute("aria-hidden", "false");
}
function hideTutorialMessage() {
  if (!tutorialBar) return;
  tutorialBar.classList.remove("visible");
  tutorialBar.setAttribute("aria-hidden", "true");
}
function tutorialPeashooterPlanted() {
  if (game.tutorialStep !== "plant") return;
  game.tutorialStep = "wait-first-sun";
  game.tutorialSunDelay = 3.2;
  showTutorialMessage("Nicely Done!");
}
function tutorialSunflowerPlanted() {
  if (game.tutorialStep !== "sunflower-count") return;
  // Read the lawn itself so click, drag, and touch placement all count consistently.
  game.tutorialSunflowersPlanted = state.grid.reduce((total, row) =>
    total + row.filter((cell) => cell?.type === "sunflower").length, 0);
  if (game.tutorialSunflowersPlanted >= 3) {
    game.tutorialStep = "sunflower-wrapup";
    game.tutorialMessageTimer = 5;
    showTutorialMessage("The more sunflowers you have the more sun you get!");
  }
}
function spawnTutorialSun() {
  makeSun({
    x: 4 + Math.random() * 92,
    y: -6,
    targetY: 30 + Math.random() * 55,
    value: 25,
    fall: true,
  });
}
function stepTutorial(dt) {
  if (game.levelIndex === 2) {
    if (game.tutorialStep === "sunflower-intro") {
      game.tutorialMessageTimer -= dt;
      if (game.tutorialMessageTimer <= 0) {
        game.tutorialStep = "sunflower-count";
        showTutorialMessage("Try to plant at least 3 of em!");
      }
    } else if (game.tutorialStep === "sunflower-count") {
      tutorialSunflowerPlanted();
    } else if (game.tutorialStep === "sunflower-wrapup") {
      game.tutorialMessageTimer -= dt;
      if (game.tutorialMessageTimer <= 0) {
        game.tutorialStep = "done";
        hideTutorialMessage();
        zombieSpawnTimer = PEA_GRACE;
      }
    }
    return;
  }
  if (game.levelIndex !== 1) return;
  if (game.tutorialStep === "wait-first-sun") {
    game.tutorialSunDelay -= dt;
    if (game.tutorialSunDelay <= 0) {
      game.tutorialStep = "collect-first-sun";
      spawnTutorialSun();
      scheduleNextSun();
      showTutorialMessage("Click on the Falling Sun To Collect it!");
    }
  } else if (game.tutorialStep === "more-sun" || game.tutorialStep === "defend") {
    game.tutorialMessageTimer -= dt;
    if (game.tutorialMessageTimer <= 0) {
      const wasMoreSun = game.tutorialStep === "more-sun";
      game.tutorialStep = wasMoreSun ? "complete" : "done";
      hideTutorialMessage();
      if (wasMoreSun) zombieSpawnTimer = PEA_GRACE;
    }
  }
}
game.waveSequenceToken = game.waveSequenceToken || 0;
game.regularZombiesSpawned = 0;
game.finalWaveStarted = false;
game.waveSequenceStarted = false;
game.finalHordeQueue = [];
game.finalHordeSpawnTimer = 0;
game.finalHordeSpawnComplete = false;
game.won = false;
game.topScreenZombies = game.topScreenZombies || [];
game.topZombieSpawnTimer = null;
game.shovelActive = false;
shovelButton.addEventListener("click", (event) => {
  if (!game.canPlant || game.dead) return;
  playGameSfx("shovelPickup", shovelPickupAudio);
  setShovelActive(!game.shovelActive);
  if (game.shovelActive) moveShovelCursor(event);
});
function moveShovelCursor(event) {
  if (!game.shovelActive) return;
  const bounds = stageEl.getBoundingClientRect();
  shovelCursor.style.left = `${(event.clientX - bounds.left) * 800 / bounds.width}px`;
  shovelCursor.style.top = `${(event.clientY - bounds.top) * 600 / bounds.height}px`;
}
window.addEventListener("pointermove", moveShovelCursor);
let gameScreensRevealPromise = Promise.resolve();

function hideRoadZombies() {
  if (roadZombieAnimationTimer) clearInterval(roadZombieAnimationTimer);
  roadZombieAnimationTimer = null;
  roadZombieLayer.replaceChildren();
  stageEl.classList.remove("road-zombie-visible");
}

function showRoadZombies() {
  hideRoadZombies();
  const roadZombieCount = Math.max(3, game.levelIndex + 2);
  const roadConeChance = game.levelIndex >= 4 ? 0.62 : 0.55;
  const zombies = Array.from({ length: roadZombieCount }, (_, index) => {
    const bottom = 12 + Math.random() * 56;
    const depth = (68 - bottom) / 56;
    const spread = 10 + depth * 22;
    // Match the lawn's progression: three brown coats, then a guaranteed
    // conehead, with later road zombies using that level's conehead odds.
    const isConeHead = game.levelIndex >= 3 && index >= 3 &&
      (index === 3 || Math.random() < roadConeChance);
    const frames = isConeHead ? ROAD_CONE_ZOMBIE_FRAMES : ROAD_ZOMBIE_FRAMES;
    const frameOffset = Math.floor(Math.random() * frames.length);
    const zombie = document.createElement("img");
    zombie.className = "road-zombie";
    zombie.src = frames[frameOffset];
    zombie.dataset.coneHead = String(isConeHead);
    zombie.alt = "";
    zombie.draggable = false;
    zombie.dataset.frameOffset = String(frameOffset);
    zombie.style.left = (50 + (Math.random() * 2 - 1) * spread) + "%";
    zombie.style.bottom = bottom + "%";
    zombie.style.height = "144px";
    zombie.style.zIndex = String(2 + Math.round(depth * 5));
    roadZombieLayer.appendChild(zombie);
    return zombie;
  });
  stageEl.classList.add("road-zombie-visible");
  let frame = 0;
  roadZombieAnimationTimer = setInterval(() => {
    frame = (frame + 1) % ROAD_ZOMBIE_FRAMES.length;
    for (const zombie of zombies) {
      const offset = Number(zombie.dataset.frameOffset);
      const frames = zombie.dataset.coneHead === "true" ? ROAD_CONE_ZOMBIE_FRAMES : ROAD_ZOMBIE_FRAMES;
      zombie.src = frames[(frame + offset) % frames.length];
    }
  }, 200);
}

function teardown(preserveExitingTopZombies = false) {
  hideRoadZombies();
  cancelWaveSequence();
  resetBuildUpMusic();
  musicAudio.pause();
  musicAudio.currentTime = 0;
  game.dead = true;
  game.topZombieSpawnTimer = null;
  game.topScreenZombies = game.topScreenZombies.filter((zombie) => {
    if (preserveExitingTopZombies && zombie.exiting) return true;
    zombie.el.remove();
    return false;
  });
  setShovelActive(false);
  shovelButton.classList.remove("ready");
  musicStarted = false;
  chooseSeedsAudio.pause();
  chooseSeedsAudio.currentTime = 0;
  setChooseSeedsDuck(1);
  setMusicDuck(1);
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.timer) clearTimeout(game.timer);
  game.raf = null;
  game.timer = null;
  game.plantAnims = [];
  previousFrameTime = null;
  // Drop stale animator entries so a re-executed module can't cascade
  // multiple counters over the same <img> (that makes frames flicker/fight
  // and look like fewer frames than the eight peashooter idle sprites).
  animators.length = 0;
  for (const s of suns) s.el && s.el.remove();
  suns.length = 0;
  producers.length = 0;
  for (const z of zombies) z.el && z.el.remove();
  zombies.length = 0;
  for (const d of debris) d.el && d.el.remove();
  debris.length = 0;
  for (const p of peas) p.el && p.el.remove();
  peas.length = 0;
  for (const mower of lawnmowers) mower.el.remove();
  lawnmowers.length = 0;
  lawnmowerAudio.pause();
  lawnmowerAudio.currentTime = 0;
}

function boot(mowerEntrance = false, preserveExitingTopZombies = false) {
  teardown(preserveExitingTopZombies);
  game.tutorialStep = game.levelIndex === 1 ? "plant" : "off";
  game.tutorialSunflowersPlanted = 0;
  game.tutorialSunDelay = 0;
  game.tutorialMessageTimer = 0;
  game.tutorialDefendShown = false;
  hideTutorialMessage();
  game.regularZombiesSpawned = 0;
  game.firstConeHeadSpawned = false;
  game.regularZombiesDefeated = 0;
  game.finalHordeDefeated = 0;
  game.lastFinalZombieRewardPosition = null;
  game.finalHordeSpawned = 0;
  game.finalHordeTotal = 0;
  game.finalWaveStarted = false;
  game.finalProgressFilled = false;
  levelProgressEl.classList.remove("complete", "active", "final-filling");
  progressFlag.classList.remove("raised");
  updateLevelProgress();
  game.waveSequenceStarted = false;
  game.finalHordeQueue = [];
  game.finalHordeSpawnTimer = 0;
  game.finalHordeSpawnComplete = false;
  game.won = false;
  gameoverOverlay.classList.remove("show", "show-text");
  winOverlay.classList.remove("show");
  winOverlay.setAttribute("aria-hidden", "true");
  gameScreensRevealPromise = Promise.resolve();
  stageEl.classList.remove("house-preview", "house-positioned", "road-preview", "road-zombie-visible", "game-over-house-view");
  houseLabel.classList.remove("visible", "fading");
  if (mowerEntrance) {
    stageEl.classList.add("house-preview", "house-positioned");
    gameScreenBlackout.classList.add("covering");
    topScreenBlackout.classList.add("covering");
    topScreen.classList.add("game-under-black");
    gameScreensRevealPromise = new Promise((resolve) => {
      const fadeBlackout = (screen) => new Promise((screenReady) => {
        screen.classList.add("fading");
        let fadeStep = 0;
        const fadeTimer = setInterval(() => {
          fadeStep++;
          screen.style.opacity = String(1 - fadeStep / 10);
          if (fadeStep === 10) {
            clearInterval(fadeTimer);
            screen.style.opacity = "";
            screen.classList.remove("covering", "fading");
            screenReady();
          }
        }, 200);
      });
      requestAnimationFrame(() => requestAnimationFrame(async () => {
        await fadeBlackout(gameScreenBlackout);
        await fadeBlackout(topScreenBlackout);
        topScreen.classList.remove("game-under-black");
        houseLabel.classList.add("visible");
        resolve();
      }));
    });
    setChooseSeedsDuck(1);
    chooseSeedsAudio.currentTime = 0;
    chooseSeedsAudio.play().catch(() => {});
  }
  game.canPlant = false;
  document.getElementById("top-level-label").textContent = levelLabel();
  stageEl.classList.remove("game-over-freeze", "game-over-house-view");
  game.canPause = false;
  if (pauseBtn) {
    pauseBtn.disabled = true;
    pauseBtn.title = "Pause";
    pauseBtn.setAttribute("aria-label", "Pause");
    pauseReveal.classList.remove("ready");
  }
  eatingAudio.loop = true;
  setEatingFadeVolume(1);
  game.over = false;
  game.paused = false;
  game.graceSoundPlayed = false;
  game.dead = false;
  gameoverOverlay.classList.remove("show", "show-text");
  document.getElementById("gameover-image").classList.remove("shake");
  buildLawnmowers(mowerEntrance);
  resetGrassReveal();
  stageEl.classList.add("preparing");
  topScreen.classList.remove("menu", "leaving");
  topScreen.classList.add("game");
  menuBtn.classList.remove("show");
  previousFrameTime = null;
  updateSun();
  // Warm the cache in the background so sprites paint as soon as they come in;
  // never gate gameplay on the network (a stalled request must not block start).
  preloadAll().catch(() => {});
  // Keep the load screen visible just long enough to feel real, then begin.
  // Newly-arriving cached images simply appear the instant they're ready.
  setTimeout(() => {
    if (game.dead) return;
    loadScreen.classList.add("done");
    renderGrid();
    zombieSpawnTimer = null;
    revealGameHud(mowerEntrance);
  }, 500);
}

// ---------- Intro sequence ----------
// Shows "READY" -> "SET" -> "PLANT!" slowly in red, then fades out.
const introEl = document.getElementById("intro");
const introText = document.getElementById("intro-text");
async function revealGameHud(mowerEntrance) {
  await gameScreensRevealPromise;
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (game.dead) return;
  if (mowerEntrance) {
    stageEl.classList.remove("house-positioned", "house-preview");
    stageEl.classList.add("road-preview");
    houseLabel.classList.add("fading");
    showRoadZombies();
    await new Promise((resolve) => setTimeout(resolve, 1350));
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (game.dead) {
      hideRoadZombies();
      return;
    }
    stageEl.classList.remove("road-preview");
    await new Promise((resolve) => setTimeout(resolve, 1350));
    hideRoadZombies();
  }
  await revealGrassLanes();
  if (game.dead) return;
  buildSeedPackets();
  updateSun();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const packets = [...document.querySelectorAll(".seed-packet")];
  packets.forEach((packet) => packet.classList.add("hud-entering"));
  stageEl.classList.remove("preparing");
  setTimeout(() => packets.forEach((packet) => packet.classList.remove("hud-entering")), 800);
  if (mowerEntrance) await moveLawnmowersToPosition();
  if (!game.dead) playIntroSequence();
}

function playIntroSequence() {
  if (!introEl) return;
  fadeChooseSeedsDuck(0.35);
  setMusicDuck(0.72);
  introEl.style.display = "";
  introText.classList.remove("show", "hide");
  const steps = ["READY", "SET", "PLANT!"];
  let i = 0;
  function show() {
    if (game.dead) {
      introEl.style.display = "none";
      return;
    }
    if (i >= steps.length) {
      introEl.style.display = "none";
      game.canPlant = true;
      shovelButton.classList.add("ready");
      document.querySelectorAll(".seed-packet.intro-locked").forEach((packet) => packet.classList.remove("intro-locked"));
      pauseReveal.classList.add("ready");
      chooseSeedsAudio.pause();
      chooseSeedsAudio.currentTime = 0;
      setChooseSeedsDuck(1);
      setMusicDuck(1);
      startMusic();
      game.topZombieSpawnTimer = null;
      previousFrameTime = null;
      if (game.levelIndex === 1) {
        game.tutorialStep = "plant";
        showTutorialMessage("Drag a Plant on the lawn to plant it or Choose a plant and click on the Lawn to Plant it!");
        zombieSpawnTimer = null;
      } else if (game.levelIndex === 2) {
        game.tutorialStep = "sunflower-intro";
        game.tutorialMessageTimer = 3.5;
        showTutorialMessage("Sun Flowers are very important plant");
        zombieSpawnTimer = null;
        scheduleNextSun();
      } else {
        game.tutorialStep = "off";
        hideTutorialMessage();
        zombieSpawnTimer = PEA_GRACE;
        scheduleNextSun();
      }
      loop(0);
      return;
    }
    const word = steps[i];
    const isPlant = word === "PLANT!";
    const introSound = playIntroSound(!isPlant); // READY/SET -> 4C, PLANT! -> 4D
    introText.textContent = word;
    introText.classList.remove("hide", "ready-set", "plant");
    introText.classList.add(isPlant ? "plant" : "ready-set");
    const hold = (introSound.duration && isFinite(introSound.duration))
      ? introSound.duration * 1000
      : (isPlant ? 2833 : 900);
    introText.style.setProperty("--intro-duration", hold + "ms");
    introText.classList.add("show");
    let finished = false;
    let fallback;
    const finishStep = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      i++;
      if (isPlant) {
        introText.classList.remove("show");
        introEl.style.display = "none";
        show();
        return;
      }
      introText.classList.replace("show", "hide");
      setTimeout(show, 120);
    };
    const onAudioEnded = () => {
      clearTimeout(fallback);
      setTimeout(finishStep, 180);
    };
    introSound.ended.then(isPlant ? onAudioEnded : finishStep);
    fallback = setTimeout(finishStep, hold + 1000);
  }
  show();
}

// ---------- Asset preloading ----------
const loadScreen = document.getElementById("load-screen");
const loadStatus = document.getElementById("load-status");

function preloadAll(onProgress = null) {
  // Every image asset the game can render, listed explicitly so a sprite can
  // never be missing at runtime (falls back to nothing rather than late-load).
  const urls = [
    // Hotbar seed-packet icons
    "hotbarpea.png",
    "hotbarsnowpea.png",
    "hotbarrepeater.png",
    "hotbarsun.png",
    "CherryBombSeed.png",
    "hotbarwalnut.png",
    "CBdeto1.png", "CBdeto2.png", "CBdeto3.png", "CBdeto4.png",
    "ZombieCrisped.png",
    "POWie1.png", "POWie2.png", "POWie3.png", "POWie4.png",
    "POWie5.png", "POWie6.png", "POWie7.png", "POWie8.png",
    // Peashooter idle
    "peaidle1.png", "peaidle2.png", "peaidle3.png", "peaidle4.png",
    "peaidle5.png", "peaidle6.png", "peaidle7.png", "peaidle8.png",
    // Sunflower idle + sun coin
    "sunidle1.png", "sunidle2.png", "sunidle3.png", "sunidle4.png",
    "sunidle5.png", "sunidle6.png", "sunidle7.png", "sunidle8.png", "sunidle9.png",
    // Walnut stages: normal / hurt / very hurt (one frame per state)
    "walnutnorm1.png", "walnuthurt1.png", "walnutveryhurt1.png",
    // Placement dirt animation
    "plantdirt1.png", "plantdirt2.png", "plantdirt3.png", "plantdirt4.png",
    // Projectile + board tiles + sun
    "projectilenormalpea.png",
    "tilelight.png", "tiledark.png",
    "sun.svg", "sun1.png", "sun2.png",
    // Death-phase topple sprites are cached so the fall starts without a blank frame.
    "uploads/basicdeadeat1.png", "uploads/basicdeadeat2.png", "uploads/basicdeadeat3.png",
    "uploads/basicdeadeat4.png", "uploads/basicdeadeat5.png",
    "uploads/basicfall1.png", "uploads/basicfall2.png", "uploads/bascfall3.png",
    "uploads/basicfall4.png", "uploads/basicfall5.png", "uploads/basicfall6.png",
    "uploads/basicfall7.png", "uploads/basicfall8.png", "uploads/basicfall9.png",
    "uploads/basichead.png", "uploads/basicarm.png",
    // Living zombie sprites: walk/eat for each damage stage
    "uploads/basicwalk1.png", "uploads/basicwalk2.png", "uploads/basicwalk3.png", "uploads/basicwalk4.png",
    "uploads/basicwalk5.png", "uploads/basicwalk6.png", "uploads/basicwalk7.png",
    ...ROAD_ZOMBIE_FRAMES,
    ...ROAD_CONE_ZOMBIE_FRAMES,
    ...Array.from({ length: 7 }, (_, i) => `uploads/ConeZombieokwalk${i + 1}.png`),
    ...Array.from({ length: 7 }, (_, i) => `uploads/CZslightlydamagedwalk${i + 1}.png`),
    ...[1, 2, 3, 4, 6, 7].map((i) => `uploads/ConeZombieokeat${i}.png`),
    "uploads/ConeBroken.png",
    "uploads/basicinjuredwalk1.png", "uploads/basicinjuredwalk2.png", "uploads/basicinjuredwalk3.png",
    "uploads/basicinjuredwalk4.png", "uploads/basicinjuredwalk5.png", "uploads/basicinjuredwalk6.png",
    "uploads/basicinjuredwalk7.png",
    "uploads/basiceat1.png", "uploads/basiceat2.png", "uploads/basiceat3.png",
    "uploads/basiceat4.png", "uploads/basiceat5.png", "uploads/basiceat6.png", "uploads/basiceat7.png",
    "uploads/basicinjuredeat1.png", "uploads/basicinjuredeat2.png", "uploads/basicinjuredeat3.png",
    "uploads/basicinjuredeat4.png", "uploads/basicinjuredeat5.png", "uploads/basicinjuredeat6.png",
    "uploads/basicinjuredeat7.png",
  ];
  preloadAudio("plant.wav");
  pickupAudio.preload = "auto";
  pickupAudio.src = "51.wav";
  pickupAudio.load();
  errorAudio.preload = "auto";
  errorAudio.src = "UCANTGETTHAT.wav";
  errorAudio.load();
  pauseAudio.load();
  resumeAudio.load();
  introReadyAudio.load();
  introPlantAudio.load();
  peaShotAudio.load();
  peaHitAudio.load();
  eatingAudio.load();
  gameOverAudio.load();
  noAudio.load();

  // Decorate the game loading panel once, then load the actual images and
  // sound files with a small pool so the displayed progress follows real work.
  if (!loadScreen.querySelector(".seed-load-thumb")) {
    const preview = document.createElement("img");
    preview.src = "plantdirt1.png";
    preview.className = "seed-load-thumb";
    loadScreen.appendChild(preview);
  }

  const audioUrls = [...new Set([
    ...Object.values(gameSfxPaths),
    "uploads/Lawn_Rolling.wav",
    "CD_Intro_Music.mp3",
    "Choose_Your_Seeds.mp3",
    "Plants_vs_Zombies_DS_-_Grasswalk__Fixed_Version_.mp3",
    "uploads/grasswalk_Buildupver.mp3",
    "Plant_Eating.mp3",
    "GameOver.wav",
    "EHAHAHAHAHA.wav",
    "NOOOOOOOOOO.wav",
  ])];
  const jobs = [
    ...urls.map((src) => async () => {
      const img = cacheSprite(src);
      if (!img.complete) {
        await new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }
      if (img.naturalWidth && img.decode) await img.decode().catch(() => {});
      if (!img.naturalWidth) throw new Error(`Image failed: ${src}`);
    }),
    ...audioUrls.map((src) => async () => {
      if (location.protocol === "file:") return; // fetch is blocked on file://; <audio> still plays these
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Audio failed: ${src}`);
      await response.arrayBuffer();
    }),
  ];
  const total = jobs.length;
  const CONCURRENCY = LOW_PERFORMANCE_DEVICE ? 3 : 6;
  let nextIndex = 0;
  let doneCount = 0;
  let failedCount = 0;
  loadStatus.textContent = `0/${total}`;
  onProgress?.(doneCount, total, failedCount);

  const worker = async () => {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex++];
      try {
        await job();
      } catch (error) {
        failedCount++;
        console.warn("Asset preload failed:", error);
      } finally {
        doneCount++;
        loadStatus.textContent = `${doneCount}/${total}`;
        onProgress?.(doneCount, total, failedCount);
      }
    }
  };
  return Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// Initialize the DS audio graph on page load; browsers may suspend it until interaction.
prepareAudio();

// Play the title cards before revealing the main menu.
playTitleSequence();

})();
