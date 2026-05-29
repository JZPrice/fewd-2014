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
    this.camera.position.set(0, 0, 3.6);
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

    // Bomb (default 'mark' icon) and a 3D X (swapped in for 'fire' mode)
    // share the same pivot so they get the same gentle sway + bob.
    this._bombGroup = new THREE.Group();
    this.pivot.add(this._bombGroup);

    this._xGroup = this._buildX();
    this._xGroup.visible = false;
    this.pivot.add(this._xGroup);

    this._mode = "mark";

    this._clock = new THREE.Clock();
    this._elapsed = 0;
    this._raf = null;
    this._running = false;
    this._loop = this._loop.bind(this);

    new GLTFLoader().load("assets/effects/bomb.glb?v=143", (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      // The loaded scene already bakes the model's 100x armature scale,
      // so it reads at ~1.1 units in scene-root space. Centered vertically
      // inside the button.
      model.scale.setScalar(1.0);
      this._bombGroup.add(model);
    }, undefined, (err) => {
      console.warn("bomb preview failed to load:", err);
    });

    this.start();
  }

  // Swap which icon mesh is visible. Pivot animation (sway + bob)
  // keeps running on whichever is shown.
  setMode(mode) {
    if (mode !== "mark" && mode !== "fire") return;
    if (this._mode === mode) return;
    this._mode = mode;
    this._bombGroup.visible = mode === "mark";
    this._xGroup.visible = mode === "fire";
  }

  _buildX() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: 0x4cd97a,
      emissive: 0x0a3a18,
      emissiveIntensity: 0.5,
    });
    // Chunky bars crossed at 45 - reads as a chiseled 3D X rather than
    // two flat strokes.
    const bar = new THREE.BoxGeometry(0.28, 1.55, 0.28);
    const a = new THREE.Mesh(bar, mat);
    a.rotation.z = Math.PI / 4;
    const b = new THREE.Mesh(bar, mat);
    b.rotation.z = -Math.PI / 4;
    g.add(a);
    g.add(b);
    // Drifting sparkle particles around the X.
    g.add(this._buildSparkles());
    return g;
  }

  _buildSparkles() {
    const COUNT = 14;
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.55 + Math.random() * 0.7;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.sin(a) * r * 0.85;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("seed",     new THREE.BufferAttribute(seeds, 1));
    this._sparkleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: 70 } },
      vertexShader: `
        attribute float seed;
        varying float vSeed;
        uniform float uSize;
        uniform float uTime;
        void main() {
          vSeed = seed;
          vec3 p = position;
          p.x += sin(uTime * 1.4 + seed * 6.28) * 0.07;
          p.y += cos(uTime * 1.1 + seed * 4.10) * 0.07;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.55 + seed * 0.75) / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vSeed;
        uniform float uTime;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float soft = 1.0 - smoothstep(0.05, 0.5, d);
          float pulse = 0.4 + 0.6 * sin(uTime * 3.2 + vSeed * 12.56);
          vec3 col = mix(vec3(0.55, 1.0, 0.4), vec3(1.0, 1.0, 0.7), vSeed);
          gl_FragColor = vec4(col, soft * pulse * 0.85);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, this._sparkleMat);
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
    // bob. X mode sways noticeably slower than the bomb so the relic
    // feels heavier.
    const swingRate = this._mode === "fire" ? 0.55 : 1.4;
    this.pivot.rotation.y = Math.sin(this._elapsed * swingRate) * (Math.PI / 8);
    this.pivot.position.y = Math.sin(this._elapsed * 2.1) * 0.06;
    if (this._sparkleMat) this._sparkleMat.uniforms.uTime.value = this._elapsed;
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
