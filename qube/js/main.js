import { Renderer } from "./renderer.js";
import { Input } from "./input.js";
import { AudioEngine } from "./audio.js";
import { HUD } from "./hud.js";
import { Game } from "./game.js";

const canvas = document.getElementById("stage");
const renderer = new Renderer(canvas);
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD();

input.attach();

const game = new Game({ renderer, input, audio, hud });

// First user interaction unlocks the AudioContext (browsers require gesture).
const unlockAudio = () => { audio.init(); audio.resume(); };
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("pointerdown", unlockAudio, { once: true });

function loop(now) {
  game.update(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
