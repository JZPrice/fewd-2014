// Catalog of selectable characters. Each entry includes the GLB path,
// display name, an explicit `scale` (auto-scale via Box3 turned out to
// be unreliable on most rigs), and a mapping from our canonical action
// names (idle/walk/run/death) to the model's actual animation clip
// names. Missing canonical clips fall back to idle.
//
// `yOffset` is optional; use it if a model's origin isn't at its feet.

export const CHARACTERS = [
  {
    id: "robot",
    name: "Robot",
    file: "assets/characters/robot.glb",
    scale: 0.18,
    yOffset: 0,
    clips: { idle: "Idle", walk: "Walking", run: "Running", death: "Death" },
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
