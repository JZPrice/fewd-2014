// Small dedicated three.js scene that renders the cartoon bomb model
// (Quaternius via poly.pizza) rotating inside a canvas - used as the
// 3D icon on the mark / fire action button instead of a flat plus.
// Self-contained: own renderer / scene / camera so the playfield's
// state is untouched.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class BombPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    this.camera.position.set(0, 0.15, 3.6);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xbac0d8, 0x303040, 0.95);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.2, 3.5, 2.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xff9050, 0.4);
    fill.position.set(-2.5, 1.6, -1.8);
    this.scene.add(fill);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this._clock = new THREE.Clock();
    this._elapsed = 0;
    this._raf = null;
    this._running = false;
    this._loop = this._loop.bind(this);

    new GLTFLoader().load("assets/effects/bomb.glb?v=115", (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      // The loaded scene already bakes the model's 100x armature scale,
      // so it reads at ~1.1 units in scene-root space. A modest scale +
      // pulled-back camera frames it cleanly inside the round button.
      model.scale.setScalar(1.0);
      model.position.y = -0.1;
      this.pivot.add(model);
    }, undefined, (err) => {
      console.warn("bomb preview failed to load:", err);
    });

    this.start();
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
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this._elapsed += dt;
    // Gentle sway: ±22.5 (45 deg total) about Y, plus a small vertical
    // bob. Keeps the icon alive without being dizzy.
    this.pivot.rotation.y = Math.sin(this._elapsed * 1.4) * (Math.PI / 8);
    this.pivot.position.y = Math.sin(this._elapsed * 2.1) * 0.06;
    this._resize();
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}
