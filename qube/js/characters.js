// Catalog of selectable characters. Each entry includes the GLB path,
// display name, an explicit `scale` (auto-scale via Box3 turned out to
// be unreliable on most rigs), and a mapping from our canonical action
// names (idle/walk/run/death) to the model's actual animation clip
// names. Missing canonical clips fall back to idle.
//
// `yOffset` is optional; use it if a model's origin isn't at its feet.

const KAYKIT = {
  // All four KayKit Adventurers share the same skeleton + 76 animations,
  // the same intrinsic height (~3.36 units), and the same hips-at-origin
  // pivot - so they share scale + yOffset + clip mapping.
  scale: 0.28,
  yOffset: 0.31,
  clips: { idle: "Idle", walk: "Walking_A", run: "Running_A", death: "Death_A" },
};

export const CHARACTERS = [
  {
    id: "robot",
    name: "Robot",
    file: "assets/characters/robot.glb",
    scale: 0.18,
    yOffset: 0,
    clips: { idle: "Idle", walk: "Walking", run: "Running", death: "Death" },
  },
  { id: "knight",    name: "Knight",    file: "assets/characters/knight.glb",    ...KAYKIT },
  // Mage robe and Rogue cape extend below the feet in the mesh - shrinking
  // yOffset on these two so the FEET, not the cloth hem, touch the floor.
  { id: "mage",      name: "Mage",      file: "assets/characters/mage.glb",      ...KAYKIT, yOffset: 0.24 },
  { id: "rogue",     name: "Rogue",     file: "assets/characters/rogue.glb",     ...KAYKIT, yOffset: 0.26 },
  { id: "barbarian", name: "Barbarian", file: "assets/characters/barbarian.glb", ...KAYKIT },
  // KayKit Skeleton Minion - shares the Adventurers rig + clip names,
  // so the KAYKIT shortcut works. Pivot is higher than the heroes', so
  // override yOffset to plant the feet on the floor instead of hovering.
  { id: "skeleton", name: "Skeleton", file: "assets/characters/skeleton.glb", ...KAYKIT, yOffset: 0 },
  // Quaternius goblin (CC0 via poly.pizza). Smaller stature than the
  // KayKit heroes - scale is tuned so the goblin reads as ~2/3 hero
  // height. Clip names use the model's piped armature-prefixed format.
  {
    id: "goblin",
    name: "Goblin",
    file: "assets/characters/goblin.glb",
    scale: 0.40,
    yOffset: 0,
    clips: {
      idle:  "EnemyArmature|EnemyArmature|EnemyArmature|Idle",
      walk:  "EnemyArmature|EnemyArmature|EnemyArmature|Walk",
      run:   "EnemyArmature|EnemyArmature|EnemyArmature|Run",
      death: "EnemyArmature|EnemyArmature|EnemyArmature|Death",
    },
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
