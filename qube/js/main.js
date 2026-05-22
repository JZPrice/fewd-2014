import { Renderer } from "./renderer.js?v=7";
import { Input } from "./input.js?v=7";
import { AudioEngine } from "./audio.js?v=7";
import { HUD } from "./hud.js?v=7";
import { Game } from "./game.js?v=7";
import { Debugger } from "./debug.js?v=7";
import { Haptics } from "./haptics.js?v=7";

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
