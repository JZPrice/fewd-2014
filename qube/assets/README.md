# qube/assets/

Drop game assets in here. Recommended layout:

- `character.glb` — main player model (binary GLTF preferred)
- `cubes/normal.glb`, `cubes/forbidden.glb`, `cubes/advantage.glb` — if/when we replace the plain box cubes
- `audio/*` — if we ever swap the Web Audio synth for sampled sounds
- `textures/*` — only if a model references external textures (`.glb` usually embeds them, so this stays empty)

## Uploading from iPhone

Safari → repo on github.com → `gh-pages` branch → navigate into `qube/assets/` → **Add file → Upload files**.
Commit straight to `gh-pages`. The version stamp in the top-right of the
game tells you when the new build is live (Pages takes ~30–90s).

## Formats

| Want                                  | Best file                |
| ------------------------------------- | ------------------------ |
| Rigged character with animations      | `.glb`                   |
| Rigged character, separate textures   | `.gltf` + bin + textures |
| Mixamo download                       | `.fbx`                   |
| Static prop (no animation)            | `.glb` still fine        |

After you upload one, tell me the path. I'll inspect the file, confirm
whether it's rigged + what animation clips it has, and wire it in as the
player model.
