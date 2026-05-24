import { Renderer } from "./renderer.js?v=65";
import { Input } from "./input.js?v=65";
import { AudioEngine } from "./audio.js?v=65";
import { HUD } from "./hud.js?v=65";
import { Game } from "./game.js?v=65";
import { Debugger } from "./debug.js?v=65";
import { Haptics } from "./haptics.js?v=65";
import { CHARACTERS, characterById, savedCharacterId, saveCharacterId } from "./characters.js?v=65";

const canvas = document.getElementById("stage");
const renderer = new Renderer(canvas);
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD();
const haptics = new Haptics();

input.attach();

const game = new Game({ renderer, input, audio, hud, haptics });
const dbg = new Debugger(game);

// --- Character selector ----------------------------------------------------

let charIdx = Math.max(0, CHARACTERS.findIndex(c => c.id === savedCharacterId()));
const charNameEl = document.getElementById("char-name");
function applyCharacter() {
  const c = CHARACTERS[charIdx];
  charNameEl.textContent = c.name;
  renderer.setCharacter(c);
  saveCharacterId(c.id);
}
applyCharacter();

function cycleChar(dir) {
  charIdx = (charIdx + dir + CHARACTERS.length) % CHARACTERS.length;
  applyCharacter();
}

// Block taps on the selector from triggering the title's tap-to-start.
function bindCharBtn(id, dir) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    cycleChar(dir);
  });
}
bindCharBtn("char-prev", -1);
bindCharBtn("char-next", +1);

// First user interaction unlocks the AudioContext (browsers require gesture).
const unlockAudio = () => { audio.init(); audio.resume(); };
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("pointerdown", unlockAudio, { once: true });

// --- Touch / pointer controls ----------------------------------------------

const isTouch =
  ("ontouchstart" in window) ||
  (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
  window.matchMedia("(pointer: coarse)").matches;

if (isTouch) document.body.classList.add("touch");

function bindHoldButton(btn, holdName) {
  const press = (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
    input.holdVirtual(holdName);
    btn.setPointerCapture?.(e.pointerId);
  };
  const release = (e) => {
    btn.classList.remove("pressed");
    input.releaseVirtual(holdName);
  };
  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("pointerleave", release);
  // Prevent the OS context menu on long-press.
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

function bindActionButton(btn, actionName) {
  const press = (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
    input.pushAction(actionName);
  };
  const release = () => btn.classList.remove("pressed");
  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

document.querySelectorAll(".tbtn[data-hold]").forEach((btn) => {
  bindHoldButton(btn, btn.dataset.hold);
});
document.querySelectorAll(".tbtn[data-action]").forEach((btn) => {
  bindActionButton(btn, btn.dataset.action);
});

// Single mark-then-fire button. Pushes "mark" while no mark is placed, then
// flips to push "trigger" once one is. The label / class toggle each frame
// off game.grid.mark so the player always sees what the next tap will do.
const markFireBtn = document.getElementById("mark-fire-btn");
if (markFireBtn) {
  const press = (e) => {
    e.preventDefault();
    markFireBtn.classList.add("pressed");
    input.pushAction(game.grid.mark ? "trigger" : "mark");
  };
  const release = () => markFireBtn.classList.remove("pressed");
  markFireBtn.addEventListener("pointerdown", press);
  markFireBtn.addEventListener("pointerup", release);
  markFireBtn.addEventListener("pointercancel", release);
  markFireBtn.addEventListener("pointerleave", release);
  markFireBtn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// Fast-forward button at top-center (hold to make blocks tick 2x faster).
// Lives outside the thumb zone so the player can reach it without losing
// their grip on the joystick / actions.
const fastBtn = document.getElementById("fast-btn");
if (fastBtn) {
  const fastDown = (e) => {
    e.preventDefault();
    fastBtn.classList.add("pressed");
    input.holdVirtual("fast");
    try { fastBtn.setPointerCapture?.(e.pointerId); } catch (_) {}
  };
  const fastUp = () => {
    fastBtn.classList.remove("pressed");
    input.releaseVirtual("fast");
  };
  fastBtn.addEventListener("pointerdown", fastDown);
  fastBtn.addEventListener("pointerup", fastUp);
  fastBtn.addEventListener("pointercancel", fastUp);
  fastBtn.addEventListener("pointerleave", fastUp);
  fastBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("pointerup", fastUp);
  window.addEventListener("blur", fastUp);
}

// --- Virtual joystick -------------------------------------------------------

function setupJoystick(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return;
  const base = root.querySelector(".joy-base");
  const stick = root.querySelector(".joy-stick");
  if (!base || !stick) return;

  let activePointerId = null;
  let cx = 0, cy = 0;
  let radius = 60;

  // Convert a screen-space offset from the stick center into an analog
  // 2D axis in grid space. Magnitude in [0, 1] scales the player velocity,
  // direction is the unit vector. Inside the dead zone returns (0, 0).
  function axisFromOffset(dx, dy, r) {
    const mag = Math.hypot(dx, dy);
    if (mag < r * 0.18) return { ax: 0, az: 0 };
    const m = Math.min(1, mag / r);
    const ux = dx / mag, uy = dy / mag;
    // Screen +dy points down, which is the player going TOWARD the front of
    // the platform (-dz in grid coords). Invert.
    return { ax: ux * m, az: -uy * m };
  }

  function moveStick(dx, dy) {
    const mag = Math.hypot(dx, dy);
    const clamp = mag > 0 ? Math.min(1, mag / radius) : 0;
    const ndx = mag > 0 ? (dx / mag) * radius * clamp : 0;
    const ndy = mag > 0 ? (dy / mag) * radius * clamp : 0;
    stick.style.transform = `translate(${ndx}px, ${ndy}px)`;
  }

  let snapTimer = 0;
  function onDown(e) {
    if (activePointerId !== null) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    try { base.setPointerCapture(e.pointerId); } catch (_) {}
    const rect = base.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
    radius = rect.width / 2 - 14;
    base.classList.add("active");
    stick.classList.remove("snap");
    clearTimeout(snapTimer);
    onMove(e);
  }

  function onMove(e) {
    if (e.pointerId !== activePointerId) return;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    moveStick(dx, dy);
    const { ax, az } = axisFromOffset(dx, dy, radius);
    input.setVirtualAxis(ax, az);
  }

  function onUp(e) {
    if (activePointerId === null) return;
    if (e && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    activePointerId = null;
    stick.classList.add("snap");
    moveStick(0, 0);
    input.setVirtualAxis(0, 0);
    base.classList.remove("active");
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => stick.classList.remove("snap"), 220);
  }

  base.addEventListener("pointerdown", onDown);
  base.addEventListener("pointermove", onMove);
  base.addEventListener("pointerup", onUp);
  base.addEventListener("pointercancel", onUp);
  base.addEventListener("contextmenu", (e) => e.preventDefault());

  // Safety net: setPointerCapture isn't 100% reliable on iOS Safari, and a
  // touch can end without firing pointerup (system interrupt, multitouch
  // confusion, tab visibility change). Mirror the release on window so the
  // joystick can't get stuck in the held state.
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("blur", () => onUp({}));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onUp({});
  });
}

setupJoystick(".joystick");

// Tap-to-start on title and gameover overlays.
function bindOverlayTap(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    // Ignore taps that originate on a child button (shouldn't happen here, but safe).
    if (e.target.closest(".tbtn, .char-arrow, .char-select")) return;
    input.pushAction("start");
  });
}
bindOverlayTap("title");
bindOverlayTap("gameover");

// Toggle a body class while an overlay is shown so we can dim the touch controls.
const titleEl = document.getElementById("title");
const gameoverEl = document.getElementById("gameover");
function refreshOverlayClass() {
  const shown = !titleEl.classList.contains("hidden") || !gameoverEl.classList.contains("hidden");
  document.body.classList.toggle("overlay-shown", shown);
}
const obs = new MutationObserver(refreshOverlayClass);
obs.observe(titleEl,    { attributes: true, attributeFilter: ["class"] });
obs.observe(gameoverEl, { attributes: true, attributeFilter: ["class"] });
refreshOverlayClass();

// --- main loop -------------------------------------------------------------

const bombBtn = document.getElementById("bomb-btn");

function loop(now) {
  game.update(now);
  dbg.update();
  if (markFireBtn) {
    const fire = !!game.grid.mark;
    const mode = fire ? "fire" : "mark";
    if (markFireBtn.dataset.mode !== mode) {
      markFireBtn.dataset.mode = mode;
      markFireBtn.setAttribute("aria-label", mode);
      markFireBtn.classList.toggle("is-fire", fire);
    }
  }
  if (bombBtn) {
    const has = game.grid.bombs.length > 0;
    if (bombBtn.hidden !== !has) bombBtn.hidden = !has;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
