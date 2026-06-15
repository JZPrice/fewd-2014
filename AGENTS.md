# AGENTS.md

## Cursor Cloud specific instructions

This repo (the `gh-pages` branch of `fewd-2014`) is a **static, client-side site** — no
package manager, no build step, and no lint/test tooling. There is nothing to install.

It hosts two independent front-end apps plus a small redirect/landing page:

- `qube/` — **Castles**, a 3D browser game built with vanilla ES modules. It imports
  `three` (Three.js `0.160.0`) at runtime from the **unpkg CDN** via an `importmap` in
  `qube/index.html`, and loads `.glb` character/effect models from `qube/assets/`. The
  root `index.html` redirects to `qube/`.
- `snapshat/` — a vanilla-JS Bristol Stool Chart tracker. It persists entries in the
  browser's `localStorage`; photos are never uploaded.

### Running (development)

Serve the repo root over HTTP and open the apps in a browser. Do **not** use `file://` —
the apps use ES modules and `fetch` for assets, which require an HTTP origin.

```
python3 -m http.server 8000
```

- Castles: `http://localhost:8000/qube/`
- snapshat: `http://localhost:8000/snapshat/`

### Non-obvious caveats

- **Network is required for Castles.** Three.js is fetched from `https://unpkg.com` at
  runtime. With no outbound network the 3D scene will not render. snapshat has no CDN
  runtime deps.
- **Camera is unavailable in headless/cloud environments.** In snapshat's capture flow,
  use the "skip photo, classify only" button (the right-most arrow icon) to proceed; the
  classification + save flow is what matters and works without a camera.
- **Aggressive cache-busting.** HTML references assets with `?v=NNN` query strings and
  no-cache meta tags; bump these when changing cached assets if testing stale content.
- **No build / lint / test commands exist.** Verification is manual via the browser.
