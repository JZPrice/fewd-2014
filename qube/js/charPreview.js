// A small dedicated three.js scene that shows the currently-selected
// character on the title screen at high fidelity: bigger than the
// in-scene player avatar, lit from the side, turntable rotation, and
// idle-animated. Self-contained so the main playfield's renderer state
// is untouched.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    this.camera.position.set(0, 1.35, 3.4);
    this.camera.lookAt(0, 1.0, 0);

    const hemi = new THREE.HemisphereLight(0xaab8d0, 0x202030, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.4, 4.0, 3.0);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xff9050, 0.45);
    fill.position.set(-3.0, 1.8, -2.0);
    this.scene.add(fill);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this._loadedModel = null;
    this._mixer = null;
    this._currentId = null;
    this._clock = new THREE.Clock();
    this._raf = null;
    this._running = false;

    this._loop = this._loop.bind(this);
    this.start();
  }

  setCharacter(charDef) {
    if (!charDef || charDef.id === this._currentId) return;
    this._currentId = charDef.id;

    if (this._loadedModel) {
      this.pivot.remove(this._loadedModel);
      this._loadedModel = null;
    }
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }

    new GLTFLoader().load(charDef.file, (gltf) => {
      if (this._currentId !== charDef.id) return;
      const model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) o.castShadow = false; });

      // Same per-character scale as the playfield, scaled up so the
      // preview frames the character cleanly.
      const baseScale = charDef.scale ?? 1;
      const previewScale = baseScale * 1.85;
      model.scale.setScalar(previewScale);
      model.position.y = (charDef.yOffset ?? 0) * 1.85;

      this.pivot.add(model);
      this._loadedModel = model;

      this._mixer = new THREE.AnimationMixer(model);
      const clipMap = charDef.clips || {};
      const targetName = clipMap.idle;
      if (targetName) {
        const clip = gltf.animations.find(c => c.name === targetName);
        if (clip) this._mixer.clipAction(clip).play();
      }
    }, undefined, (err) => {
      console.error(`preview ${charDef.id} failed to load:`, err);
    });
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
    // When the title overlay is hidden the canvas is display:none -> 0x0;
    // skip render but keep the rAF alive so we resume when it returns.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this._mixer) this._mixer.update(dt);
    this.pivot.rotation.y += dt * 0.5;
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
