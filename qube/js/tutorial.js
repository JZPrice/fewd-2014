// Title-screen tutorial wizard. A small three.js scene shows a rotating
// 3D subject (gray cube, forbidden cube, green cube, bomb model) per
// step, with title + description text below and prev/next + dot
// indicators at the bottom. One canvas, one renderer; we swap which
// subject is in the pivot per step so we don't pay for N WebGL contexts.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class Tutorial {
  constructor() {
    this.canvas = document.getElementById("tut-canvas");
    this.titleEl = document.getElementById("tut-title");
    this.descEl = document.getElementById("tut-desc");
    this.prevBtn = document.getElementById("tut-prev");
    this.nextBtn = document.getElementById("tut-next");
    this.dotsEl = document.getElementById("tut-dots");

    this._initScene();
    this._buildSteps();
    this._renderDots();
    this._wireButtons();

    this._step = 0;
    this._applyStep();

    this._raf = null;
    this._clock = new THREE.Clock();
    this._running = false;
    this._loop = this._loop.bind(this);
    this.start();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    this.camera.position.set(1.2, 1.05, 2.1);
    this.camera.lookAt(0, 0.05, 0);

    const hemi = new THREE.HemisphereLight(0xaab8d0, 0x202030, 0.9);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.0, 3.5, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xff9050, 0.35);
    fill.position.set(-2.5, 1.4, -2.0);
    this.scene.add(fill);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this._currentSubject = null;

    // Cached shared cube geometry; materials are built per step so the
    // forbidden + advantage subjects can keep their distinct emissive
    // glows.
    this._cubeGeom = new THREE.BoxGeometry(1, 1, 1);
  }

  _buildSteps() {
    const make = (color, emissive = 0x000000, emissiveIntensity = 0) => {
      const mat = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
      const mesh = new THREE.Mesh(this._cubeGeom, mat);
      return mesh;
    };

    // Bomb subject is lazy-loaded; placeholder until the GLB arrives.
    this._bombSubject = null;
    new GLTFLoader().load("assets/effects/bomb.glb?v=160", (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      // The bomb GLB has a 100x armature scale baked in - tame it so it
      // fits inside the same frame as the cubes.
      model.scale.setScalar(0.012);
      this._bombSubject = model;
      // If we're already on the bomb step, swap it in now.
      if (this.steps[this._step]?.kind === "bomb") this._applyStep();
    });

    this.steps = [
      {
        kind: "cube",
        title: "Goal",
        desc: "Cubes march toward you every tick. Capture every cube before it reaches your row.",
        build: () => make(0xb8c0d4),
      },
      {
        kind: "cube",
        title: "Capture",
        desc: "MARK a tile, then FIRE. Any cube standing on the mark is captured instantly.",
        build: () => make(0xb8c0d4),
      },
      {
        kind: "cube",
        title: "Forbidden",
        desc: "Black cubes are forbidden. Capturing one drops three rows of floor in front of you.",
        build: () => make(0x000000, 0xff3030, 0.40),
      },
      {
        kind: "cube",
        title: "Bombs",
        desc: "FIRE on a green cube to drop a bomb. Each bomb covers a 3x3 area.",
        build: () => make(0x4cd97a, 0xa9ffc5, 0.55),
      },
      {
        kind: "bomb",
        title: "Detonate",
        desc: "BOMB blasts every placed bomb at once. Time them well - the chain can clear half a wave.",
        build: () => this._bombSubject?.clone() ?? make(0x222a3a),
      },
    ];
  }

  _renderDots() {
    this.dotsEl.innerHTML = "";
    for (let i = 0; i < this.steps.length; i++) {
      const d = document.createElement("span");
      d.className = "tut-dot" + (i === 0 ? " active" : "");
      this.dotsEl.appendChild(d);
    }
  }

  _wireButtons() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    this.prevBtn.addEventListener("pointerdown", (e) => {
      stop(e); this.goTo(this._step - 1);
    });
    this.nextBtn.addEventListener("pointerdown", (e) => {
      stop(e); this.goTo(this._step + 1);
    });
    // Don't let dot taps fall through to the title's tap-to-start.
    this.dotsEl.addEventListener("pointerdown", stop);
  }

  goTo(idx) {
    const n = this.steps.length;
    if (idx < 0 || idx >= n) return;
    this._step = idx;
    this._applyStep();
  }

  _applyStep() {
    const s = this.steps[this._step];
    this.titleEl.textContent = s.title;
    this.descEl.textContent = s.desc;
    // Swap the subject in the pivot.
    if (this._currentSubject) {
      this.pivot.remove(this._currentSubject);
      this._currentSubject = null;
    }
    const subject = s.build();
    this.pivot.add(subject);
    this._currentSubject = subject;
    this.pivot.rotation.set(0, 0, 0);

    // Update arrow disabled state and active dot.
    this.prevBtn.disabled = this._step === 0;
    this.nextBtn.disabled = this._step === this.steps.length - 1;
    const dots = this.dotsEl.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("active", i === this._step);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _loop() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._loop);
    const dt = this._clock.getDelta();
    // The title overlay hides its descendants via display:none; skip
    // render while the canvas has no layout (saves the rAF battery
    // hit when the player is in-game).
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.pivot.rotation.y += dt * 0.6;
    this._resize();
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}
