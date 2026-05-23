// Catalog of selectable characters. Each entry includes the GLB path,
// display name, and a mapping from our canonical action names
// (idle/walk/run/death) to the model's actual animation clip names.
// Missing clips fall back to other states (death -> idle).

export const CHARACTERS = [
  {
    id: "robot",
    name: "Robot",
    file: "assets/characters/robot.glb",
    clips: { idle: "Idle", walk: "Walking", run: "Running", death: "Death" },
  },
  {
    id: "soldier",
    name: "Soldier",
    file: "assets/characters/soldier.glb",
    clips: { idle: "Idle", walk: "Walk", run: "Run" },
  },
  {
    id: "xbot",
    name: "X-Bot",
    file: "assets/characters/xbot.glb",
    clips: { idle: "idle", walk: "walk", run: "run" },
  },
];

export function characterById(id) {
  return CHARACTERS.find(c => c.id === id) ?? CHARACTERS[0];
}

const STORAGE_KEY = "qube.character";

export function savedCharacterId() {
  try { return localStorage.getItem(STORAGE_KEY) || CHARACTERS[0].id; }
  catch (_) { return CHARACTERS[0].id; }
}

export function saveCharacterId(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
}
