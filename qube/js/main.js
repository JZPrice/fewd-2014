import { Renderer } from "./renderer.js?v=15";
import { Input } from "./input.js?v=15";
import { AudioEngine } from "./audio.js?v=15";
import { HUD } from "./hud.js?v=15";
import { Game } from "./game.js?v=15";
import { Debugger } from "./debug.js?v=15";
import { Haptics } from "./haptics.js?v=15";

const canvas = document.getElementById("stage");
const renderer = new Renderer(canvas);
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD();
const haptics = new Haptics();

input.attach();

const game = new Game({ renderer, input, audio, hud, haptics });
const dbg = new Debugger(game);

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
  const state = { arrowleft: false, arrowright: false, arrowup: false, arrowdown: false };

  function updateHeld(next) {
    for (const key of Object.keys(state)) {
      if (state[key] !== next[key]) {
        if (next[key]) input.holdVirtual(key);
        else input.releaseVirtual(key);
        state[key] = next[key];
      }
    }
  }

  // 4-way snap based on dominant axis, with a centered dead zone.
  function dirsFromOffset(dx, dy, r) {
    const mag = Math.hypot(dx, dy);
    const dz = r * 0.18;
    if (mag < dz) {
      return { arrowleft: false, arrowright: false, arrowup: false, arrowdown: false };
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      return { arrowleft: dx < 0, arrowright: dx > 0, arrowup: false, arrowdown: false };
    }
    return { arrowleft: false, arrowright: false, arrowup: dy < 0, arrowdown: dy > 0 };
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
    updateHeld(dirsFromOffset(dx, dy, radius));
  }

  function onUp(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    stick.classList.add("snap");
    moveStick(0, 0);
    updateHeld({ arrowleft: false, arrowright: false, arrowup: false, arrowdown: false });
    base.classList.remove("active");
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => stick.classList.remove("snap"), 220);
  }

  base.addEventListener("pointerdown", onDown);
  base.addEventListener("pointermove", onMove);
  base.addEventListener("pointerup", onUp);
  base.addEventListener("pointercancel", onUp);
  base.addEventListener("contextmenu", (e) => e.preventDefault());
}

setupJoystick(".joystick");

// Tap-to-start on title and gameover overlays.
function bindOverlayTap(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    // Ignore taps that originate on a child button (shouldn't happen here, but safe).
    if (e.target.closest(".tbtn")) return;
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

function loop(now) {
  game.update(now);
  dbg.update();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
