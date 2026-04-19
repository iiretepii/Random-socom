/* Operation Browser Strike — SOCOM-2 inspired browser shooter.
   Single-file game logic. Loaded after three.min.js. */
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { alert('Three.js failed to load.'); return; }

  // ---------------- Globals ----------------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b));
  const now = () => performance.now() / 1000;

  const WORLD = {
    size: 90,
    spawnPoints: [],
    obstacles: [],   // { box: THREE.Box3, mesh }
    botSpawnTimer: 0,
    maxBots: 5,
  };

  const state = {
    running: false,
    paused: false,
    lastTime: 0,
    player: null,
    bots: [],
    tracers: [],
    impacts: [],
    kills: 0,
    deaths: 0,
    touchMode: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
  };
  if (state.touchMode) document.body.classList.add('touch-mode');

  // ---------------- Renderer / Scene ----------------
  const renderer = new THREE.WebGLRenderer({
    antialias: !state.touchMode,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.touchMode ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xb8a98a); // matches horizon, only seen if sky fails
  document.getElementById('scene-root').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Warm-grey haze in the distance so buildings fade into the horizon band.
  scene.fog = new THREE.Fog(0xb8a98a, 55, 220);

  const camera = new THREE.PerspectiveCamera(
    72, window.innerWidth / window.innerHeight, 0.1, 400
  );
  camera.position.set(0, 3, 8);

  // ---------------- Audio (WebAudio synth, no external assets) ----------------
  const Audio = {
    ctx: null, master: null,
    init() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    _noiseBuffer(dur) {
      const n = Math.floor(this.ctx.sampleRate * dur);
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    },
    _out(pan) {
      // Optional stereo pan; falls back to a pass-through gain if unsupported.
      if (this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = clamp(pan || 0, -1, 1);
        p.connect(this.master);
        return p;
      }
      const g = this.ctx.createGain();
      g.connect(this.master);
      return g;
    },
    gunshot(volume, muffle, pan) {
      if (!this.ctx) return;
      volume = volume == null ? 1 : volume;
      const t = this.ctx.currentTime;
      const out = this._out(pan);
      // Noise burst → lowpass sweep for the crack.
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(0.22);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.9 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(muffle ? 1200 : 3800, t);
      lp.frequency.exponentialRampToValueAtTime(muffle ? 250 : 500, t + 0.15);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 0.25);
      // Low-frequency punch for body.
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0.45 * volume, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(g2); g2.connect(out);
      osc.start(t); osc.stop(t + 0.12);
    },
    hitConfirm(kill) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const out = this._out(0);
      const freqs = kill ? [880, 1320, 1760] : [1500];
      freqs.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const g = this.ctx.createGain();
        const st = t + i * 0.055;
        g.gain.setValueAtTime(kill ? 0.2 : 0.14, st);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
        o.connect(g); g.connect(out);
        o.start(st); o.stop(st + 0.12);
      });
    },
    reload() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const out = this._out(0);
      [0.02, 0.32, 0.85, 1.25].forEach((offset, i) => {
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuffer(0.05);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.28, t + offset);
        g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.05);
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 4;
        bp.frequency.value = 1100 + i * 450;
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t + offset); src.stop(t + offset + 0.06);
      });
    },
    damage() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const out = this._out(0);
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.35);
    },
    emptyClick() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const out = this._out(0);
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(0.02);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2200;
      src.connect(hp); hp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 0.03);
    },
    // Distance-attenuated enemy gunshot with simple stereo pan.
    enemyGunshot(worldPos) {
      if (!this.ctx) return;
      const p = state.player;
      if (!p) return;
      const dx = worldPos.x - p.pos.x;
      const dz = worldPos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const vol = clamp(28 / (28 + dist * dist * 0.018), 0, 1) * 0.9;
      // Pan: project offset onto player's right vector (cos(yaw), -sin(yaw)).
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      const right = dx * cy + dz * -sy;
      const pan = clamp(right / Math.max(1.5, dist), -1, 1);
      this.gunshot(vol, dist > 18, pan);
    },
  };

  // Lighting — tuned to match the sky's sun direction/color so shading
  // reads correctly at any camera angle.
  const SUN_DIR = new THREE.Vector3(0.48, 0.84, 0.24).normalize();
  scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x3a352e, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0c8, 0.95);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  scene.add(sun);

  // ---------------- Sky dome ----------------
  // Large inverted sphere with a custom shader: zenith/horizon gradient,
  // sun disc + halo, slight dithering to kill banding. Rendered first
  // (renderOrder -1) and re-centered on the camera each frame so the
  // horizon never shifts as the player moves.
  function buildSky() {
    const geo = new THREE.SphereGeometry(260, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon:  { value: new THREE.Color(0xd8c79c) },
        uZenith:   { value: new THREE.Color(0x3b6ea0) },
        uGround:   { value: new THREE.Color(0x1a1d24) },
        uSunDir:   { value: SUN_DIR.clone() },
        uSunColor: { value: new THREE.Color(0xfff4d2) },
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vDir;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uZenith;',
        'uniform vec3 uGround;',
        'uniform vec3 uSunDir;',
        'uniform vec3 uSunColor;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  vec3 sky;',
        '  if (d.y < 0.0) {',
        '    sky = mix(uHorizon, uGround, clamp(-d.y * 2.2, 0.0, 1.0));',
        '  } else {',
        '    float t = pow(clamp(d.y, 0.0, 1.0), 0.55);',
        '    sky = mix(uHorizon, uZenith, t);',
        '  }',
        '  float sd = max(dot(d, normalize(uSunDir)), 0.0);',
        '  float disc = smoothstep(0.9988, 0.9999, sd);',
        '  float halo = pow(sd, 180.0) * 0.45 + pow(sd, 20.0) * 0.06;',
        '  sky += uSunColor * (disc * 3.0 + halo);',
        '  // Cheap hash dither to hide 8-bit banding.',
        '  sky += (fract(sin(dot(d.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
        '  gl_FragColor = vec4(sky, 1.0);',
        '}',
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    scene.add(mesh);
    WORLD.sky = mesh;
  }
  buildSky();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------- Input ----------------
  const Input = {
    move: { x: 0, y: 0 },   // -1..1 (forward/strafe)
    look: { x: 0, y: 0 },   // -1..1 (aim delta per frame while held; mouse writes accum)
    mouseDX: 0, mouseDY: 0,
    fire: false, reload: false, crouch: false, sprint: false, jumpPressed: false,
    keys: Object.create(null),
    pointerLocked: false,
  };

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (!state.running) return;
    Input.keys[e.code] = true;
    if (e.code === 'KeyR') Input.reload = true;
    if (e.code === 'Space') { Input.jumpPressed = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') Input.sprint = true;
    if (e.code === 'KeyC' || e.code === 'ControlLeft') Input.crouch = !Input.crouch;
    if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
  });
  window.addEventListener('keyup', (e) => {
    Input.keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') Input.sprint = false;
  });

  function readKeyboardMove() {
    let x = 0, y = 0;
    if (Input.keys['KeyW'] || Input.keys['ArrowUp']) y -= 1;
    if (Input.keys['KeyS'] || Input.keys['ArrowDown']) y += 1;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) x -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) x += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return [x, y];
  }

  // Mouse + pointer lock
  renderer.domElement.addEventListener('click', () => {
    if (state.running && !state.touchMode && !document.pointerLockElement) {
      renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    Input.pointerLocked = document.pointerLockElement === renderer.domElement;
  });
  window.addEventListener('mousemove', (e) => {
    if (Input.pointerLocked) {
      Input.mouseDX += e.movementX;
      Input.mouseDY += e.movementY;
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.running) return;
    if (e.button === 0) Input.fire = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) Input.fire = false;
  });

  // Touch joysticks
  function setupJoystick(elId, onChange) {
    const el = document.getElementById(elId);
    if (!el) return;
    const knob = el.querySelector('.knob');
    let pointerId = null;
    let cx = 0, cy = 0, radius = 0;
    function start(e) {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (pointerId !== null) return;
      pointerId = t.identifier != null ? t.identifier : 'mouse';
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      radius = r.width * 0.45;
      el.classList.add('active');
      move(e);
      e.preventDefault();
    }
    function move(e) {
      if (pointerId === null) return;
      let t = null;
      if (e.changedTouches) {
        for (const tt of e.changedTouches) if (tt.identifier === pointerId) { t = tt; break; }
        if (!t) return;
      } else t = e;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) { dx = dx / d * radius; dy = dy / d * radius; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      onChange(dx / radius, dy / radius);
      e.preventDefault();
    }
    function end(e) {
      if (pointerId === null) return;
      if (e.changedTouches) {
        let found = false;
        for (const tt of e.changedTouches) if (tt.identifier === pointerId) { found = true; break; }
        if (!found) return;
      }
      pointerId = null;
      knob.style.transform = 'translate(0,0)';
      el.classList.remove('active');
      onChange(0, 0);
      e.preventDefault();
    }
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }
  setupJoystick('joy-left', (x, y) => { Input.move.x = x; Input.move.y = y; });
  setupJoystick('joy-right', (x, y) => { Input.look.x = x; Input.look.y = y; });

  // Touch buttons
  function setupButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    let active = false;
    const down = (e) => {
      active = true; el.classList.add('active');
      if (onDown) onDown();
      e.preventDefault();
    };
    const up = (e) => {
      if (!active) return;
      active = false; el.classList.remove('active');
      if (onUp) onUp();
      e.preventDefault();
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  }
  setupButton('btn-fire', () => Input.fire = true, () => Input.fire = false);
  setupButton('btn-reload', () => Input.reload = true, null);
  setupButton('btn-crouch', () => Input.crouch = !Input.crouch, null);
  setupButton('btn-jump', () => Input.jumpPressed = true, null);
  setupButton('btn-sprint', () => Input.sprint = true, () => Input.sprint = false);

  // Flush per-frame input (called at end of player update).
  function consumeInputFrame() {
    Input.reload = false;
    Input.jumpPressed = false;
    Input.mouseDX = 0;
    Input.mouseDY = 0;
  }

  // ---------------- Stubs (filled in later commits) ----------------
  // Create an AABB obstacle (box) at position (x,z) with given width/height/depth.
  // Origin of box is its center in XZ, base on the ground (y=0).
  function addBox(x, z, w, h, d, color, roughness) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: color, roughness: roughness != null ? roughness : 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
    const box = new THREE.Box3(
      V3(x - w / 2, 0, z - d / 2),
      V3(x + w / 2, h, z + d / 2)
    );
    const obs = { box, mesh, w, h, d, x, z, blocksBullet: true, blocksSight: h >= 1.6 };
    WORLD.obstacles.push(obs);
    return obs;
  }

  function buildMap() {
    // Interior half-size (meters). The playable floor spans [-S, S] on both axes.
    const S = 36;
    WORLD.size = S;

    // ---- Floor: dark oak parquet ----
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(S * 2, S * 2),
      new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Red runner strips along the central cross corridor.
    const carpetMat = new THREE.MeshStandardMaterial({ color: 0x6a1e1e, roughness: 0.95 });
    const carpetN = new THREE.Mesh(new THREE.PlaneGeometry(4.5, S * 2 - 2), carpetMat);
    carpetN.rotation.x = -Math.PI / 2;
    carpetN.position.y = 0.02;
    scene.add(carpetN);
    const carpetE = new THREE.Mesh(new THREE.PlaneGeometry(S * 2 - 2, 4.5), carpetMat);
    carpetE.rotation.x = -Math.PI / 2;
    carpetE.position.y = 0.02;
    scene.add(carpetE);

    // ---- Ceiling ----
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(S * 2, S * 2),
      new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.95 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 5.2;
    scene.add(ceiling);

    // Ceiling trim beams (cosmetic, non-colliding).
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x1a140e, roughness: 0.9 });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(S * 2, 0.25, 0.3), beamMat);
      beam.position.set(0, 5.05, i * 12);
      scene.add(beam);
    }

    // ---- Wood paneling colors ----
    const WOOD_DARK  = 0x3a2616;
    const WOOD_MID   = 0x5a3d24;
    const PLASTER    = 0x8c7a5c;
    const wallH = 5.0;
    const wallT = 0.6;

    // Outer walls (full perimeter, no gaps; windows are visual only).
    addBox(0,  S, S * 2, wallH, wallT, WOOD_MID);
    addBox(0, -S, S * 2, wallH, wallT, WOOD_MID);
    addBox( S, 0, wallT, wallH, S * 2, WOOD_MID);
    addBox(-S, 0, wallT, wallH, S * 2, WOOD_MID);

    // Wainscoting strip: a slightly-proud darker panel along each outer wall base.
    function wainscot(x, z, w, d) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, 1.6, d),
        new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.9 })
      );
      m.position.set(x, 0.8, z);
      scene.add(m);
    }
    wainscot(0,  S - 0.35, S * 2 - 1.2, 0.1);
    wainscot(0, -S + 0.35, S * 2 - 1.2, 0.1);
    wainscot( S - 0.35, 0, 0.1, S * 2 - 1.2);
    wainscot(-S + 0.35, 0, 0.1, S * 2 - 1.2);

    // ---- Windows: warm emissive panels glued to the inside of outer walls ----
    const winMat = new THREE.MeshStandardMaterial({
      color: 0xffe9b0, emissive: 0xffdc8c, emissiveIntensity: 1.4, roughness: 0.3
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a120a, roughness: 0.8 });
    function addWindow(x, y, z, faceRotY) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.2), winMat);
      w.position.set(x, y, z);
      w.rotation.y = faceRotY;
      scene.add(w);
      // Cross mullion.
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.08), frameMat);
      const h = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.08), frameMat);
      v.position.copy(w.position); h.position.copy(w.position);
      v.rotation.y = faceRotY; h.rotation.y = faceRotY;
      // Nudge frame slightly forward along wall normal.
      const nx = Math.sin(faceRotY) * 0.05, nz = Math.cos(faceRotY) * 0.05;
      v.position.x += nx; v.position.z += nz;
      h.position.x += nx; h.position.z += nz;
      scene.add(v); scene.add(h);
    }
    const winY = 3.1;
    for (const z of [-22, -8, 8, 22]) {
      addWindow(-S + wallT / 2 + 0.03, winY, z, Math.PI / 2);
      addWindow( S - wallT / 2 - 0.03, winY, z, -Math.PI / 2);
    }
    for (const x of [-22, -8, 8, 22]) {
      addWindow(x, winY, -S + wallT / 2 + 0.03, 0);
      addWindow(x, winY,  S - wallT / 2 - 0.03, Math.PI);
    }

    // Narrow light shafts from each window along the floor (cosmetic planes).
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xffe3a0, transparent: true, opacity: 0.12,
    });
    function addShaft(x, z, length, rotY) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, length), shaftMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY;
      m.position.set(x, 0.04, z);
      scene.add(m);
    }
    for (const z of [-22, -8, 8, 22]) {
      addShaft(-S + 6, z, 10, 0);
      addShaft( S - 6, z, 10, 0);
    }
    for (const x of [-22, -8, 8, 22]) {
      addShaft(x, -S + 6, 10, Math.PI / 2);
      addShaft(x,  S - 6, 10, Math.PI / 2);
    }

    // ---- Interior walls forming four rooms + central cross corridor ----
    // Doorways are 6 wide. Corridor is 10 wide (from -5 to 5 on each axis).
    // South-half vertical divider: z from -S+0.3 to -5 minus a doorway at z=-22..-16.
    function vDiv(x, z0, z1, gaps) {
      // gaps: array of [gzStart, gzEnd]
      let segs = [[z0, z1]];
      for (const [a, b] of gaps || []) {
        const next = [];
        for (const [s, e] of segs) {
          if (b < s || a > e) { next.push([s, e]); continue; }
          if (a > s) next.push([s, a]);
          if (b < e) next.push([b, e]);
        }
        segs = next;
      }
      for (const [s, e] of segs) {
        const cz = (s + e) / 2, len = e - s;
        if (len > 0.4) addBox(x, cz, wallT, wallH, len, PLASTER);
      }
    }
    function hDiv(z, x0, x1, gaps) {
      let segs = [[x0, x1]];
      for (const [a, b] of gaps || []) {
        const next = [];
        for (const [s, e] of segs) {
          if (b < s || a > e) { next.push([s, e]); continue; }
          if (a > s) next.push([s, a]);
          if (b < e) next.push([b, e]);
        }
        segs = next;
      }
      for (const [s, e] of segs) {
        const cx = (s + e) / 2, len = e - s;
        if (len > 0.4) addBox(cx, z, len, wallH, wallT, PLASTER);
      }
    }
    // Cross-corridor walls: stop 5 units short of center on each side.
    vDiv( 0, -S + 0.3,  -5, [[-22, -18]]);   // SW/SE divider, doorway into S corridor
    vDiv( 0,  5,  S - 0.3, [[ 18,  22]]);    // NW/NE divider, doorway into N corridor
    hDiv( 0, -S + 0.3, -5, [[-22, -18]]);    // NW/SW divider, doorway into W corridor
    hDiv( 0,  5,  S - 0.3, [[ 18,  22]]);    // NE/SE divider, doorway into E corridor

    // ---- Furniture ----
    const SHELF   = 0x2a1b0c;
    const DESK    = 0x4a3216;
    const CABINET = 0x5a5248;
    const CHAIR   = 0x2a2a2a;

    // Draw a bookshelf with colorful books on its front face.
    function bookshelf(x, z, rotY, length) {
      const body = addBox(x, z, rotY === 0 ? length : 0.55, 1.9, rotY === 0 ? 0.55 : length, SHELF, 0.9);
      body.blocksSight = false;
      // Books strip: thin emissive-free boxes of random colors on shelves at 0.5, 1.0, 1.5.
      const palette = [0x8a3a2a, 0x8a7a2a, 0x2a6a3a, 0x2a4a7a, 0x6a2a6a, 0xb0a080, 0x7a4a20];
      const facingX = rotY === 0 ? 0 : (rotY > 0 ? 1 : -1);
      const facingZ = rotY === 0 ? 1 : 0;
      const spanDir = rotY === 0 ? 'x' : 'z';
      const spanLen = length;
      for (let shelfY of [0.45, 1.0, 1.55]) {
        const n = Math.floor(spanLen / 0.18);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n - 0.5;
          const bx = x + (spanDir === 'x' ? t * spanLen : facingX * 0.24);
          const bz = z + (spanDir === 'z' ? t * spanLen : facingZ * 0.24);
          const bh = rand(0.22, 0.34);
          const bw = rand(0.1, 0.16);
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(
              spanDir === 'x' ? bw : 0.08,
              bh,
              spanDir === 'z' ? bw : 0.08
            ),
            new THREE.MeshStandardMaterial({
              color: palette[irand(0, palette.length)], roughness: 0.8
            })
          );
          book.position.set(bx, shelfY + bh / 2, bz);
          scene.add(book);
        }
      }
    }

    // Desk with a chair tucked under.
    function desk(x, z, rotY) {
      const d = addBox(x, z, rotY ? 0.9 : 1.6, 0.95, rotY ? 1.6 : 0.9, DESK, 0.8);
      d.blocksSight = false;
      // Desk lamp (small emissive dome).
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0xfff2c8, emissive: 0xffc266, emissiveIntensity: 1.3, roughness: 0.4
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lampMat);
      const lx = x + (rotY ? 0.3 : -0.55);
      const lz = z + (rotY ? -0.55 : 0.3);
      lamp.position.set(lx, 1.1, lz);
      scene.add(lamp);
      // Chair back.
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(rotY ? 0.15 : 0.55, 0.9, rotY ? 0.55 : 0.15),
        new THREE.MeshStandardMaterial({ color: CHAIR, roughness: 0.9 })
      );
      ch.position.set(x + (rotY ? 0.9 : 0), 0.45, z + (rotY ? 0 : 0.9));
      scene.add(ch);
    }

    // Filing cabinet: squat grey waist-high box.
    function cabinet(x, z) {
      const c = addBox(x, z, 0.9, 1.35, 0.6, CABINET, 0.7);
      c.blocksSight = false;
      // Drawer grooves (cosmetic).
      for (let g = 0; g < 3; g++) {
        const dr = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.04, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        dr.position.set(x, 0.35 + g * 0.32, z + 0.31);
        scene.add(dr);
      }
    }

    // Populate each quadrant room. Shelves go along OUTER walls only so they
    // never block the interior doorways (which sit at +/- 20 on each axis).
    // Freestanding furniture lives well inside the rooms.
    // NW room (x<0, z<0)
    bookshelf(-28, -S + 1.5, 0, 12);            // along north wall, left half
    bookshelf(-S + 1.5, -28, Math.PI / 2, 12);  // along west wall, top half
    bookshelf(-10, -S + 1.5, 0, 8);             // along north wall, right half
    desk(-24, -12, false);
    cabinet(-10, -10);
    cabinet(-28, -10);

    // NE room (x>0, z<0)
    bookshelf(28, -S + 1.5, 0, 12);
    bookshelf( S - 1.5, -28, Math.PI / 2, 12);
    bookshelf(10, -S + 1.5, 0, 8);
    desk(24, -12, true);
    cabinet(10, -10);
    cabinet(28, -10);

    // SW room (x<0, z>0)
    bookshelf(-28, S - 1.5, 0, 12);
    bookshelf(-S + 1.5, 28, Math.PI / 2, 12);
    bookshelf(-10, S - 1.5, 0, 8);
    desk(-24, 12, false);
    cabinet(-10, 10);
    cabinet(-28, 10);

    // SE room
    bookshelf(28, S - 1.5, 0, 12);
    bookshelf( S - 1.5, 28, Math.PI / 2, 12);
    bookshelf(10, S - 1.5, 0, 8);
    desk(24, 12, true);
    cabinet(10, 10);
    cabinet(28, 10);

    // Central atrium: a single long reading table along the east-west axis.
    function readingTable(x, z, rotY) {
      const t = addBox(x, z, rotY ? 1.3 : 4.6, 0.85, rotY ? 4.6 : 1.3, DESK, 0.8);
      t.blocksSight = false;
    }
    readingTable(0, 0, false);

    // ---- Interior lighting ----
    // Warm point lights per room for the archive feel.
    function roomLight(x, z, intensity) {
      const l = new THREE.PointLight(0xffd89a, intensity || 0.9, 30, 2);
      l.position.set(x, 4.4, z);
      scene.add(l);
    }
    roomLight(-18, -18, 0.9);
    roomLight( 18, -18, 0.9);
    roomLight(-18,  18, 0.9);
    roomLight( 18,  18, 0.9);
    roomLight(0, 0, 1.1);

    // ---- Spawn points: one in each room + central ----
    const spawns = [
      [-24, -24], [24, -24], [-24, 24], [24, 24],   // deep room corners
      [-22, -10], [22, -10], [-22, 10], [22, 10],   // room interiors near doorways
      [-10, -22], [10, -22], [-10, 22], [10, 22],
    ];
    for (const [x, z] of spawns) WORLD.spawnPoints.push(V3(x, 0, z));
    filterSpawnPoints();
  }

  // Some author-chosen spawns may overlap buildings added later. Throw those
  // out and backfill with random safe positions so players/bots never spawn
  // inside a wall (which would block all movement and hitscan).
  function filterSpawnPoints() {
    const r = 1.0;
    const safe = [];
    for (const p of WORLD.spawnPoints) {
      if (!collidesCircle(p.x, p.z, r, 1.0)) safe.push(p);
    }
    let guard = 0;
    while (safe.length < 8 && guard++ < 400) {
      const x = rand(-WORLD.size * 0.8, WORLD.size * 0.8);
      const z = rand(-WORLD.size * 0.8, WORLD.size * 0.8);
      if (!collidesCircle(x, z, r, 1.0)) safe.push(V3(x, 0, z));
    }
    WORLD.spawnPoints = safe;
  }

  // Return true if a horizontal circle (radius r) at (x,z) overlaps any obstacle.
  function collidesCircle(x, z, r, heightY) {
    for (const o of WORLD.obstacles) {
      if (heightY != null && heightY > o.box.max.y) continue;
      const cx = clamp(x, o.box.min.x, o.box.max.x);
      const cz = clamp(z, o.box.min.z, o.box.max.z);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return o;
    }
    return null;
  }
  WORLD.collidesCircle = collidesCircle;

  // Search an expanding ring around (x,z) for a spot that doesn't collide.
  // Used as a last-resort "unstick" for the player or a fresh spawn.
  function findFreeSpotNear(x, z, r, heightY) {
    if (!collidesCircle(x, z, r, heightY)) return [x, z];
    for (let ring = 1; ring <= 12; ring++) {
      const dist = ring * 0.8;
      const steps = 8 + ring * 4;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const tx = x + Math.cos(a) * dist;
        const tz = z + Math.sin(a) * dist;
        if (!collidesCircle(tx, tz, r, heightY)) return [tx, tz];
      }
    }
    return null;
  }
  WORLD.findFreeSpotNear = findFreeSpotNear;

  // Axis-separated movement: returns final (x,z) after sliding along walls.
  function moveWithCollision(fromX, fromZ, dx, dz, r, heightY) {
    let nx = fromX + dx;
    if (collidesCircle(nx, fromZ, r, heightY)) nx = fromX;
    let nz = fromZ + dz;
    if (collidesCircle(nx, nz, r, heightY)) nz = fromZ;
    return [nx, nz];
  }
  WORLD.moveWithCollision = moveWithCollision;

  // Raycast for line-of-sight / hitscan against obstacles + bots.
  // Returns { hit: 'obstacle'|'bot'|null, point, dist, target }.
  function raycastHit(origin, dir, maxDist, ignoreBot) {
    // Obstacle intersections via Box3.
    let best = { dist: maxDist, type: null, target: null };
    const inv = V3(1 / (dir.x || 1e-9), 1 / (dir.y || 1e-9), 1 / (dir.z || 1e-9));
    for (const o of WORLD.obstacles) {
      const b = o.box;
      const t1 = (b.min.x - origin.x) * inv.x;
      const t2 = (b.max.x - origin.x) * inv.x;
      const t3 = (b.min.y - origin.y) * inv.y;
      const t4 = (b.max.y - origin.y) * inv.y;
      const t5 = (b.min.z - origin.z) * inv.z;
      const t6 = (b.max.z - origin.z) * inv.z;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
      if (tmax < 0 || tmin > tmax) continue;
      const t = tmin > 0 ? tmin : tmax;
      if (t > 0 && t < best.dist) {
        best = { dist: t, type: 'obstacle', target: o };
      }
    }
    // Bot capsule approximation (vertical cylinder r=0.5 h=1.9).
    for (const bot of state.bots) {
      if (!bot.alive || bot === ignoreBot) continue;
      const t = rayVsCapsule(origin, dir, bot.pos, 0.55, 1.9);
      if (t != null && t < best.dist) best = { dist: t, type: 'bot', target: bot };
    }
    const point = origin.clone().addScaledVector(dir, best.dist);
    return { hit: best.type, point, dist: best.dist, target: best.target };
  }
  WORLD.raycastHit = raycastHit;

  // Ray vs vertical cylinder centered at base b, radius r, height h.
  function rayVsCapsule(o, d, b, r, h) {
    const dx = o.x - b.x, dz = o.z - b.z;
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-9) return null;
    const B = 2 * (dx * d.x + dz * d.z);
    const C = dx * dx + dz * dz - r * r;
    const disc = B * B - 4 * a * C;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t = (-B - s) / (2 * a);
    if (t < 0) return null;
    const y = o.y + d.y * t;
    if (y < b.y || y > b.y + h) return null;
    return t;
  }

  // Build a simple operator mesh: torso + head + arms. Returns group.
  function buildOperatorMesh(primary, accent) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), mat(primary));
    torso.position.y = 1.15;
    g.add(torso);
    const hips  = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.4), mat(accent));
    hips.position.y = 0.5;
    g.add(hips);
    const legs  = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.35), mat(primary));
    legs.position.y = 0.2;
    g.add(legs);
    const head  = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), mat(0x3a3530));
    head.position.y = 1.75;
    g.add(head);
    const arms  = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.25, 0.25), mat(primary));
    arms.position.set(0, 1.35, 0.3);
    g.add(arms);
    // Rifle
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.85), mat(0x1a1a1a));
    rifle.position.set(0.28, 1.35, 0.7);
    g.add(rifle);
    g.userData.rifle = rifle;
    return g;
  }

  function createPlayer() {
    const group = buildOperatorMesh(0x2f5a3a, 0x1a3324);
    group.position.set(0, 0, 0);
    scene.add(group);
    // First-person: don't render the local operator's body/arms/rifle.
    // Tracers and muzzle flash come from the camera instead.
    group.visible = false;

    // Muzzle flash (hidden until firing).
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flashMat);
    flash.visible = false;
    group.add(flash);

    state.player = {
      group,
      pos: group.position,
      vel: V3(0, 0, 0),
      yaw: 0, pitch: 0,
      radius: 0.5,
      standHeight: 1.8,
      crouchHeight: 1.2,
      onGround: true,
      hp: 100, maxHp: 100,
      mag: 30, ammo: 30, reserve: 180,
      reloading: false, reloadEnd: 0,
      fireCooldown: 0,
      fireRate: 0.09,      // seconds between shots
      damage: 22,
      alive: true,
      respawnAt: 0,
      flash,
      camOffset: V3(0.9, 1.8, -3.5),
      camTarget: V3(0, 1.55, 0),
      recoil: 0,
      footstepT: 0,
      // Viewmodel animation state (set up in buildViewmodel).
      viewmodel: null,
      vmFlash: null,
      vmRecoil: 0,
      vmReloadDip: 0,
      vmBobT: 0,
    };

    buildViewmodel();
  }

  // First-person viewmodel: arms + rifle attached to the camera so it sits at
  // the bottom of the screen and always faces the aim direction.
  function buildViewmodel() {
    scene.add(camera); // camera must be in the scene graph for children to render
    const vm = new THREE.Group();
    camera.add(vm);

    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a4030, roughness: 0.9 });
    const glove  = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.85 });
    const gun    = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.7, metalness: 0.35 });
    const gunMag = new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.8 });

    // Arms (forearms + gloves), angled inward so the rifle sits centered.
    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.42), sleeve);
    lArm.position.set(-0.16, -0.26, -0.55);
    lArm.rotation.y = 0.10;
    vm.add(lArm);
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.42), sleeve);
    rArm.position.set(0.20, -0.26, -0.55);
    rArm.rotation.y = -0.08;
    vm.add(rArm);
    const lGlove = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.14), glove);
    lGlove.position.set(-0.08, -0.28, -0.80);
    vm.add(lGlove);
    const rGlove = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.14), glove);
    rGlove.position.set( 0.14, -0.28, -0.70);
    vm.add(rGlove);

    // Rifle parts (receiver, barrel, stock, magazine, optic).
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.32), gun);
    receiver.position.set(0.06, -0.22, -0.70);
    vm.add(receiver);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.40), gun);
    barrel.position.set(0.06, -0.22, -0.98);
    vm.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.25), gun);
    stock.position.set(0.06, -0.22, -0.45);
    vm.add(stock);
    const magBox = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.10), gunMag);
    magBox.position.set(0.06, -0.34, -0.68);
    vm.add(magBox);
    const optic = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), gun);
    optic.position.set(0.06, -0.13, -0.70);
    vm.add(optic);

    // Muzzle flash at the end of the barrel.
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), flashMat);
    flash.position.set(0.06, -0.22, -1.20);
    flash.visible = false;
    vm.add(flash);
    // A short emissive spike to sell the flash visually.
    const spikeMat = new THREE.MeshBasicMaterial({ color: 0xffbb44, transparent: true, opacity: 0 });
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 8), spikeMat);
    spike.rotation.x = -Math.PI / 2;
    spike.position.set(0.06, -0.22, -1.28);
    spike.visible = false;
    vm.add(spike);

    state.player.viewmodel = vm;
    state.player.vmFlash = flash;
    state.player.vmFlashSpike = spike;
    state.player.vmRestPos = V3(0, 0, 0);
  }

  function respawnPlayer() {
    const p = state.player;
    const s = WORLD.spawnPoints[irand(0, WORLD.spawnPoints.length)] || V3(0, 0, 0);
    p.pos.set(s.x, 0, s.z);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(-s.x, -s.z);
    p.pitch = 0;
    p.hp = p.maxHp;
    p.mag = 30; p.reserve = 180;
    p.alive = true;
    p.reloading = false;
    document.getElementById('death-screen').classList.add('hidden');
  }

  function killPlayer(killerName) {
    const p = state.player;
    if (!p.alive) return;
    p.alive = false;
    state.deaths++;
    const stats = document.getElementById('death-stats');
    if (stats) stats.textContent =
      (killerName ? 'Eliminated by ' + killerName + '. ' : '') +
      'Kills: ' + state.kills + '   KIA: ' + state.deaths;
    document.getElementById('death-screen').classList.remove('hidden');
  }

  function damagePlayer(amount, attacker) {
    const p = state.player;
    if (!p.alive) return;
    p.hp -= amount;
    Audio.damage();
    const vig = document.getElementById('damage-vignette');
    if (vig) {
      vig.style.boxShadow = 'inset 0 0 140px 30px rgba(220, 40, 40, 0.55)';
      setTimeout(() => { vig.style.boxShadow = 'inset 0 0 120px 20px rgba(220, 40, 40, 0.0)'; }, 160);
    }
    if (p.hp <= 0) killPlayer(attacker ? attacker.name : 'Hostile');
  }
  WORLD.damagePlayer = damagePlayer;

  function startReload() {
    const p = state.player;
    if (p.reloading || p.mag >= 30 || p.reserve <= 0) return;
    p.reloading = true;
    p.reloadEnd = now() + 1.8;
    Audio.reload();
    flashMessage('RELOADING');
  }

  function finishReload() {
    const p = state.player;
    const need = 30 - p.mag;
    const take = Math.min(need, p.reserve);
    p.mag += take; p.reserve -= take;
    p.reloading = false;
  }

  function flashMessage(msg, dur) {
    const el = document.getElementById('message');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(flashMessage._t);
    flashMessage._t = setTimeout(() => el.classList.remove('show'), (dur || 1.2) * 1000);
  }
  WORLD.flashMessage = flashMessage;

  function updatePlayer(dt) {
    const p = state.player;
    if (!p) return;

    if (!p.alive) {
      consumeInputFrame();
      return;
    }

    // --- Look input (with stick deadzone) ---
    const mouseSens = 0.0022;
    const stickSens = 2.6;
    const DEAD = 0.12;
    const lookX = Math.abs(Input.look.x) < DEAD ? 0 : Input.look.x;
    const lookY = Math.abs(Input.look.y) < DEAD ? 0 : Input.look.y;
    p.yaw   -= Input.mouseDX * mouseSens;
    p.pitch -= Input.mouseDY * mouseSens;
    p.yaw   -= lookX * stickSens * dt;
    p.pitch -= lookY * stickSens * dt;
    p.pitch = clamp(p.pitch, -1.1, 0.9);

    // --- Move input ---
    let mx = Math.abs(Input.move.x) < DEAD ? 0 : Input.move.x;
    let my = Math.abs(Input.move.y) < DEAD ? 0 : Input.move.y;
    if (!state.touchMode) {
      const [kx, ky] = readKeyboardMove();
      mx += kx; my += ky;
    }
    const mm = Math.hypot(mx, my);
    if (mm > 1) { mx /= mm; my /= mm; }

    const crouching = Input.crouch;
    const sprinting = Input.sprint && my < -0.1 && !crouching;
    const baseSpeed = crouching ? 2.4 : (sprinting ? 7.2 : 4.8);

    // World-space velocity from local movement + yaw.
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    // my<0 = forward. In our convention forward = -Z when yaw=0.
    const forwardX = -sin, forwardZ = -cos;
    const rightX   =  cos, rightZ   = -sin;
    let vx = forwardX * (-my) + rightX * mx;
    let vz = forwardZ * (-my) + rightZ * mx;
    vx *= baseSpeed; vz *= baseSpeed;

    const h = crouching ? p.crouchHeight : p.standHeight;
    const [nx, nz] = moveWithCollision(p.pos.x, p.pos.z, vx * dt, vz * dt, p.radius, h * 0.5);
    p.pos.x = nx; p.pos.z = nz;

    // Safety eject: if we somehow end up embedded in an obstacle, search a
    // small ring for a clear spot so the player never gets permanently stuck.
    if (collidesCircle(p.pos.x, p.pos.z, p.radius, h * 0.5)) {
      const safe = findFreeSpotNear(p.pos.x, p.pos.z, p.radius + 0.1, h * 0.5);
      if (safe) { p.pos.x = safe[0]; p.pos.z = safe[1]; }
    }

    // Jump / gravity (simple).
    if (Input.jumpPressed && p.onGround && !crouching) {
      p.vel.y = 5.2;
      p.onGround = false;
    }
    p.vel.y -= 16 * dt;
    p.pos.y += p.vel.y * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.onGround = true; }

    // Face movement / look direction.
    p.group.rotation.y = p.yaw;

    // Crouch visual scale.
    const targetScaleY = crouching ? 0.7 : 1.0;
    p.group.scale.y = lerp(p.group.scale.y, targetScaleY, 1 - Math.pow(0.001, dt));

    // Footstep cue (visual wobble only; audio later).
    const moving = Math.hypot(vx, vz) > 0.5 && p.onGround;
    p.footstepT = moving ? (p.footstepT + dt * (sprinting ? 8 : 5)) : 0;
    p.group.position.y = p.pos.y + Math.abs(Math.sin(p.footstepT)) * 0.04;

    // Reload flow.
    if (Input.reload) startReload();
    if (p.reloading && now() >= p.reloadEnd) finishReload();

    // Fire cooldown / recoil decay.
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.recoil = Math.max(0, p.recoil - dt * 3);

    // Fire handled in shooting chunk (next).
    handleFiring(dt);

    updateViewmodel(dt);
    consumeInputFrame();
  }

  function updateViewmodel(dt) {
    const p = state.player;
    const vm = p.viewmodel;
    if (!vm) return;

    // Decay recoil and reload-dip.
    p.vmRecoil = Math.max(0, p.vmRecoil - dt * 5.5);
    const reloadTarget = p.reloading ? 1 : 0;
    p.vmReloadDip = lerp(p.vmReloadDip, reloadTarget, 1 - Math.pow(0.0015, dt));

    // Movement bob: stronger when sprinting.
    const moveMag = clamp(Math.hypot(Input.move.x, Input.move.y) +
      (state.touchMode ? 0 : Math.hypot(...readKeyboardMove())), 0, 1);
    const bobActive = (moveMag > 0.15 && p.onGround) ? 1 : 0;
    const bobSpeed = Input.sprint ? 14 : 9;
    p.vmBobT += dt * bobSpeed * bobActive;
    const bobX =  Math.sin(p.vmBobT) * 0.018 * bobActive;
    const bobY = -Math.abs(Math.sin(p.vmBobT)) * 0.024 * bobActive;

    // Aim sway opposite to look deltas for weight.
    const swayX = clamp(Input.look.x * 0.05 + Input.mouseDX * 0.0012, -0.06, 0.06);
    const swayY = clamp(Input.look.y * 0.04 + Input.mouseDY * 0.0012, -0.05, 0.05);

    // Apply as offsets relative to rest.
    vm.position.set(
      swayX + bobX,
      bobY - p.vmReloadDip * 0.22,
      p.vmRecoil * 0.10
    );
    vm.rotation.set(
      swayY * 0.5 - p.vmRecoil * 0.22 + p.vmReloadDip * 0.5,
      swayX * -0.8 + p.vmReloadDip * 0.4,
      p.vmReloadDip * -0.35
    );
  }

  // ---------------- Weapons / effects ----------------
  const _tracerGeo = new THREE.BufferGeometry();
  _tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const _tracerMat = new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.95 });

  function spawnTracer(fromV, toV, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      fromV.x, fromV.y, fromV.z, toV.x, toV.y, toV.z
    ]), 3));
    const mat = new THREE.LineBasicMaterial({
      color: color != null ? color : 0xfff0a0,
      transparent: true, opacity: 1,
    });
    const line = new THREE.Line(g, mat);
    scene.add(line);
    state.tracers.push({ line, life: 0.08, maxLife: 0.08 });
  }

  function spawnImpact(pt, fromObstacle) {
    const g = new THREE.SphereGeometry(0.08, 6, 4);
    const m = new THREE.MeshBasicMaterial({
      color: fromObstacle ? 0xffaa55 : 0xff5555,
      transparent: true, opacity: 1,
    });
    const spark = new THREE.Mesh(g, m);
    spark.position.copy(pt);
    scene.add(spark);
    state.impacts.push({ mesh: spark, life: 0.25, maxLife: 0.25 });
  }

  function updateEffects(dt) {
    // Tracers
    for (let i = state.tracers.length - 1; i >= 0; i--) {
      const t = state.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); state.tracers.splice(i, 1); }
    }
    // Impacts
    for (let i = state.impacts.length - 1; i >= 0; i--) {
      const imp = state.impacts[i];
      imp.life -= dt;
      const k = Math.max(0, imp.life / imp.maxLife);
      imp.mesh.material.opacity = k;
      imp.mesh.scale.setScalar(1 + (1 - k) * 2);
      if (imp.life <= 0) { scene.remove(imp.mesh); imp.mesh.geometry.dispose(); imp.mesh.material.dispose(); state.impacts.splice(i, 1); }
    }
    // Muzzle flash fade (viewmodel + any legacy flashes)
    const p = state.player;
    if (p) {
      if (p.flash && p.flash.visible) {
        p.flash.material.opacity -= dt * 22;
        if (p.flash.material.opacity <= 0) { p.flash.visible = false; p.flash.material.opacity = 0; }
      }
      if (p.vmFlash && p.vmFlash.visible) {
        p.vmFlash.material.opacity -= dt * 28;
        if (p.vmFlash.material.opacity <= 0) { p.vmFlash.visible = false; p.vmFlash.material.opacity = 0; }
      }
      if (p.vmFlashSpike && p.vmFlashSpike.visible) {
        p.vmFlashSpike.material.opacity -= dt * 26;
        if (p.vmFlashSpike.material.opacity <= 0) { p.vmFlashSpike.visible = false; p.vmFlashSpike.material.opacity = 0; }
      }
    }
    for (const b of state.bots) {
      if (b.flash && b.flash.visible) {
        b.flash.material.opacity -= dt * 22;
        if (b.flash.material.opacity <= 0) { b.flash.visible = false; b.flash.material.opacity = 0; }
      }
    }
  }

  // Player weapon muzzle position + forward aim direction in world space.
  function playerAim() {
    const p = state.player;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    // Muzzle slightly forward & right of chest.
    const origin = V3(
      p.pos.x + cy * 0.35 - sy * 0.4,
      p.pos.y + 1.45,
      p.pos.z - sy * 0.35 - cy * 0.4
    );
    // Aim straight forward along yaw + pitch.
    const dir = V3(-sy * cp, sp, -cy * cp).normalize();
    return { origin, dir };
  }

  // Convert aim direction to one that targets the screen-center world point,
  // so shots land on the crosshair regardless of shoulder offset.
  function crosshairAim() {
    const p = state.player;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    // Camera forward (same as lookAt target calc).
    const dir = V3(-sy * cp, sp, -cy * cp).normalize();
    // Origin from camera so hit scan matches what the player sees.
    const origin = camera.position.clone();
    return { origin, dir };
  }

  function fireOnce() {
    const p = state.player;
    if (p.reloading || p.mag <= 0) {
      if (p.mag <= 0 && !p.reloading) {
        Audio.emptyClick();
        startReload();
        flashMessage('RELOAD');
      }
      return;
    }
    Audio.gunshot(1.0, false, 0);
    p.mag--;
    p.fireCooldown = p.fireRate;
    p.recoil = Math.min(0.55, p.recoil + 0.08);
    p.pitch += rand(0.001, 0.005); // gentle climb on sustained fire

    // Hitscan from camera so what you see is what you hit.
    const aim = crosshairAim();
    // Add minor spread from recoil.
    const spread = 0.003 + p.recoil * 0.005;
    const dir = aim.dir.clone();
    dir.x += rand(-spread, spread);
    dir.y += rand(-spread, spread);
    dir.z += rand(-spread, spread);
    dir.normalize();
    const hit = raycastHit(aim.origin, dir, 220);

    // Tracer from just below/forward of the camera so it looks like it comes
    // from the muzzle of a first-person weapon rather than a phantom shoulder.
    const fwd = aim.dir;
    const rightX = -Math.cos(p.yaw), rightZ = Math.sin(p.yaw);
    const muzzle = camera.position.clone()
      .addScaledVector(fwd, 0.6)
      .add(V3(rightX * 0.18, -0.18, rightZ * 0.18));
    const endPt = hit.hit ? hit.point : aim.origin.clone().addScaledVector(dir, 220);
    spawnTracer(muzzle, endPt, 0xfff0b0);

    // Viewmodel kick + muzzle flash.
    p.vmRecoil = Math.min(0.6, p.vmRecoil + 0.35);
    if (p.vmFlash) { p.vmFlash.visible = true; p.vmFlash.material.opacity = 1; }
    if (p.vmFlashSpike) { p.vmFlashSpike.visible = true; p.vmFlashSpike.material.opacity = 0.9; }

    if (hit.hit === 'bot') {
      damageBot(hit.target, p.damage, 'you');
      spawnImpact(hit.point, false);
    } else if (hit.hit === 'obstacle') {
      spawnImpact(hit.point, true);
    }
  }

  function handleFiring(dt) {
    const p = state.player;
    if (!Input.fire) return;
    if (p.fireCooldown > 0) return;
    fireOnce();
  }

  // Bot takes damage; may kill.
  function damageBot(bot, amount, source) {
    if (!bot.alive) return;
    bot.hp -= amount;
    bot.lastHitAt = now();
    bot.alertLevel = 1;
    bot.lastKnownPlayer = state.player.pos.clone();
    // Small red flash on body
    bot.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.setRGB(0.6, 0, 0);
      }
    });
    setTimeout(() => {
      bot.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setRGB(0, 0, 0);
      });
    }, 80);
    const killed = bot.hp <= 0;
    if (killed) {
      bot.alive = false;
      bot.deathAt = now();
      bot.group.rotation.z = Math.PI / 2;
      bot.group.position.y = 0.3;
      state.kills++;
      flashMessage('HOSTILE DOWN');
    }
    if (source === 'you') {
      triggerHitmarker(killed);
      Audio.hitConfirm(killed);
      if (killed) addKillFeed('You', bot.name || 'Hostile');
    }
  }
  WORLD.damageBot = damageBot;

  // ---------------- Hit marker + kill feed ----------------
  let _hitmarkerTimer = null;
  function triggerHitmarker(kill) {
    const el = document.getElementById('hitmarker');
    if (!el) return;
    el.classList.remove('show', 'kill');
    // Force reflow so re-adding the class restarts the fade.
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
    clearTimeout(_hitmarkerTimer);
    _hitmarkerTimer = setTimeout(() => el.classList.remove('show', 'kill'),
      kill ? 280 : 140);
  }

  function addKillFeed(killer, target) {
    const feed = document.getElementById('killfeed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'kf-entry';
    row.innerHTML = '<b>' + killer + '</b> &rarr; <span class="target">' +
      target + '</span>';
    feed.appendChild(row);
    // Trigger entry animation next frame.
    requestAnimationFrame(() => row.classList.add('show'));
    setTimeout(() => { row.classList.remove('show'); }, 3800);
    setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 4200);
    // Cap the feed to 5 rows.
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  }

  function updateCameraFPS(dt) {
    const p = state.player;
    if (!p) return;
    const crouching = Input.crouch;
    const eyeY = p.pos.y + (crouching ? 1.1 : 1.65);
    camera.position.set(p.pos.x, eyeY, p.pos.z);

    const pitch = p.pitch - p.recoil * 0.12;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.lookAt(
      p.pos.x - sy * cp * 10,
      eyeY + sp * 10,
      p.pos.z - cy * cp * 10
    );

    // Sprint FOV kick for a sense of speed.
    const moveMag = Math.hypot(Input.move.x, Input.move.y);
    const sprintingVisual = Input.sprint && (moveMag > 0.3 || (!state.touchMode && Input.keys['KeyW']));
    const targetFov = sprintingVisual ? 86 : 72;
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.pow(0.005, dt));
    camera.updateProjectionMatrix();
  }

  // Replace the stub camera updater above with the first-person one.
  updateCamera = updateCameraFPS;
  // ---------------- Bots ----------------
  const BOT_NAMES = ['Kilo-1','Kilo-2','Delta-3','Echo-4','Victor-5','Bravo-6','Zulu-7'];
  const BOT_COLORS = [
    [0x7a2a2a, 0x502020],
    [0x54301a, 0x3a1e0f],
    [0x6a2a5a, 0x3e1a37],
    [0x1e3a6a, 0x13264a],
    [0x5a5a1e, 0x3c3c14],
  ];

  function lineOfSight(fromV, toV, ignoreBot) {
    const d = V3(toV.x - fromV.x, toV.y - fromV.y, toV.z - fromV.z);
    const dist = d.length();
    if (dist < 0.01) return true;
    d.divideScalar(dist);
    const hit = raycastHit(fromV, d, dist, ignoreBot);
    return hit.hit !== 'obstacle';
  }

  function spawnBot() {
    if (state.bots.filter(b => b.alive).length >= WORLD.maxBots) return;
    // Pick spawn far from player to avoid instant clash.
    const player = state.player;
    let spawn = null, tries = 0;
    while (tries++ < 12) {
      const s = WORLD.spawnPoints[irand(0, WORLD.spawnPoints.length)];
      if (!s) break;
      const dx = s.x - player.pos.x, dz = s.z - player.pos.z;
      if (dx * dx + dz * dz > 20 * 20) { spawn = s; break; }
    }
    if (!spawn) spawn = WORLD.spawnPoints[0] || V3(20, 0, 20);

    // Belt-and-braces: if the chosen spawn overlaps an obstacle, find a clear
    // spot nearby so the bot doesn't start embedded in a wall.
    let sx = spawn.x, sz = spawn.z;
    if (collidesCircle(sx, sz, 0.7, 1.0)) {
      const free = findFreeSpotNear(sx, sz, 0.7, 1.0);
      if (free) { sx = free[0]; sz = free[1]; }
    }

    const pair = BOT_COLORS[irand(0, BOT_COLORS.length)];
    const group = buildOperatorMesh(pair[0], pair[1]);
    group.position.set(sx, 0, sz);
    scene.add(group);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), flashMat);
    flash.visible = false;
    group.add(flash);

    const bot = {
      name: BOT_NAMES[irand(0, BOT_NAMES.length)],
      group, pos: group.position, yaw: rand(0, Math.PI * 2),
      flash,
      hp: 100,
      radius: 0.55,
      height: 1.9,
      alive: true,
      state: 'patrol', // patrol | investigate | engage | reposition
      stateUntil: 0,
      waypoint: null,
      seenPlayer: false,
      lastKnownPlayer: null,
      lastFireAt: 0,
      fireInterval: rand(0.25, 0.45),
      burstLeft: 0,
      aimYaw: 0, aimPitch: 0,
      aimNoise: V3(0, 0, 0),
      reactionTimer: 0,
      alertLevel: 0,     // 0..1, decays when no contact
      accuracy: rand(0.6, 0.85),
      skill: rand(0.7, 1.1),
      deathAt: 0,
      lastHitAt: 0,
    };
    bot.waypoint = pickWaypoint(bot);
    state.bots.push(bot);
  }

  function pickWaypoint(bot) {
    for (let tries = 0; tries < 10; tries++) {
      const x = rand(-WORLD.size * 0.85, WORLD.size * 0.85);
      const z = rand(-WORLD.size * 0.85, WORLD.size * 0.85);
      if (!collidesCircle(x, z, bot.radius + 0.4, 1.0)) return V3(x, 0, z);
    }
    return V3(0, 0, 0);
  }

  // Move bot toward target with simple wall-sliding AABB collision.
  function moveBotToward(bot, target, speed, dt) {
    const dx = target.x - bot.pos.x;
    const dz = target.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(speed * dt, d);
    const nxRaw = bot.pos.x + (dx / d) * step;
    const nzRaw = bot.pos.z + (dz / d) * step;
    const [nx, nz] = moveWithCollision(bot.pos.x, bot.pos.z, nxRaw - bot.pos.x, nzRaw - bot.pos.z, bot.radius, bot.height * 0.5);
    // If fully stuck, nudge perpendicular to add "try another way" behavior.
    if (nx === bot.pos.x && nz === bot.pos.z) {
      const perpX = -(dz / d), perpZ = (dx / d);
      const sign = Math.random() < 0.5 ? 1 : -1;
      const [mx, mz] = moveWithCollision(bot.pos.x, bot.pos.z, perpX * sign * step, perpZ * sign * step, bot.radius, bot.height * 0.5);
      bot.pos.x = mx; bot.pos.z = mz;
    } else {
      bot.pos.x = nx; bot.pos.z = nz;
    }
    bot.yaw = Math.atan2(-(dx), -(dz));
    return d;
  }

  function botAimAt(bot, targetV, dt, sway) {
    const dx = targetV.x - bot.pos.x;
    const dy = targetV.y - (bot.pos.y + 1.45);
    const dz = targetV.z - bot.pos.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    const horiz = Math.hypot(dx, dz);
    const desiredPitch = Math.atan2(dy, horiz);
    const smooth = 1 - Math.pow(0.001, dt * bot.skill);
    // wrap yaw smoothly
    const yawDelta = Math.atan2(Math.sin(desiredYaw - bot.aimYaw), Math.cos(desiredYaw - bot.aimYaw));
    bot.aimYaw += yawDelta * smooth;
    bot.aimPitch = lerp(bot.aimPitch, desiredPitch, smooth);
    if (sway) {
      bot.aimNoise.x = lerp(bot.aimNoise.x, rand(-sway, sway), 0.1);
      bot.aimNoise.y = lerp(bot.aimNoise.y, rand(-sway, sway), 0.1);
      bot.aimNoise.z = lerp(bot.aimNoise.z, rand(-sway, sway), 0.1);
    }
  }

  function botFire(bot) {
    const p = state.player;
    if (!p.alive) return;
    bot.lastFireAt = now();
    Audio.enemyGunshot(bot.pos);

    // Origin at bot's chest, aim toward player with accuracy-based spread.
    const origin = V3(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    const dx = p.pos.x - origin.x;
    const dy = (p.pos.y + 1.35) - origin.y;
    const dz = p.pos.z - origin.z;
    const dir = V3(dx, dy, dz).normalize();
    const dist = Math.hypot(dx, dy, dz);
    const inacc = (1 - bot.accuracy) * 0.06 + Math.min(0.05, dist / 1600) + bot.aimNoise.length() * 0.5;
    dir.x += rand(-inacc, inacc);
    dir.y += rand(-inacc, inacc);
    dir.z += rand(-inacc, inacc);
    dir.normalize();

    const hit = raycastHit(origin, dir, 220, bot);
    const endPt = hit.hit ? hit.point : origin.clone().addScaledVector(dir, 220);
    spawnTracer(origin, endPt, 0xff9966);

    // Muzzle flash
    if (bot.flash) {
      bot.flash.position.set(0.45, 1.38, -0.95);
      bot.flash.material.opacity = 1;
      bot.flash.visible = true;
    }

    if (hit.hit === 'bot') {
      // Friendly fire off
    } else if (hit.hit === 'obstacle') {
      spawnImpact(hit.point, true);
    } else if (!hit.hit) {
      // Check if the ray "should have" hit player (within reasonable distance).
      // Our raycast already tests bots; but the bot cannot hit 'bot' for itself.
      // To allow hitting the player, treat the player as another capsule.
      const t = rayVsCapsule(origin, dir, p.pos, 0.6, 1.85);
      if (t != null && t < 200) {
        const pt = origin.clone().addScaledVector(dir, t);
        spawnImpact(pt, false);
        damagePlayer(Math.round(rand(8, 16)), bot);
      }
    }
    // Also test player capsule against obstacle-first result: if obstacle was closer, miss.
    // (Player test above runs only when no obstacle hit, keeping cover honest.)
  }

  function updateBots(dt) {
    const p = state.player;
    // Spawn pacing.
    WORLD.botSpawnTimer -= dt;
    if (WORLD.botSpawnTimer <= 0) {
      spawnBot();
      WORLD.botSpawnTimer = rand(2.8, 5.2);
    }

    for (let i = state.bots.length - 1; i >= 0; i--) {
      const bot = state.bots[i];

      if (!bot.alive) {
        // Keep body for a few seconds, then remove.
        if (now() - bot.deathAt > 4.5) {
          scene.remove(bot.group);
          bot.group.traverse((o) => {
            if (o.isMesh) {
              if (o.geometry) o.geometry.dispose();
              if (o.material) o.material.dispose();
            }
          });
          state.bots.splice(i, 1);
        }
        continue;
      }

      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.aimYaw || bot.yaw;

      // Alert decay.
      bot.alertLevel = Math.max(0, bot.alertLevel - dt * 0.12);

      // Sense player: LOS + angular FOV (220° if alerted, 150° if patrolling).
      const eye = V3(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
      const playerChest = V3(p.pos.x, p.pos.y + 1.35, p.pos.z);
      const toP = V3(playerChest.x - eye.x, 0, playerChest.z - eye.z);
      const distP = toP.length();
      const seeRange = 55;
      let canSee = false;
      if (p.alive && distP < seeRange) {
        const facingX = -Math.sin(bot.aimYaw || bot.yaw);
        const facingZ = -Math.cos(bot.aimYaw || bot.yaw);
        const dot = (toP.x / (distP || 1)) * facingX + (toP.z / (distP || 1)) * facingZ;
        const fovCos = bot.alertLevel > 0.3 ? Math.cos(1.9) : Math.cos(1.3);
        if (dot > fovCos && lineOfSight(eye, playerChest, bot)) canSee = true;
      }

      if (canSee) {
        bot.seenPlayer = true;
        bot.alertLevel = 1;
        bot.lastKnownPlayer = playerChest.clone();
        if (bot.state !== 'engage') {
          bot.state = 'engage';
          bot.reactionTimer = rand(0.2, 0.5); // reaction lag before firing
        }
      } else if (bot.seenPlayer && bot.alertLevel > 0.1 && bot.lastKnownPlayer) {
        if (bot.state === 'engage') {
          bot.state = 'investigate';
          bot.stateUntil = now() + 6;
        }
      }

      switch (bot.state) {
        case 'patrol': {
          if (!bot.waypoint || Math.hypot(bot.waypoint.x - bot.pos.x, bot.waypoint.z - bot.pos.z) < 1.2) {
            bot.waypoint = pickWaypoint(bot);
          }
          moveBotToward(bot, bot.waypoint, 2.4, dt);
          // Keep aim forward-ish.
          bot.aimYaw = lerp(bot.aimYaw, bot.yaw, 1 - Math.pow(0.001, dt));
          bot.aimPitch = lerp(bot.aimPitch, 0, 1 - Math.pow(0.001, dt));
          // Hear damage taken recently? Escalate.
          if (now() - bot.lastHitAt < 3 && bot.lastKnownPlayer) {
            bot.state = 'investigate'; bot.stateUntil = now() + 6;
          }
          break;
        }
        case 'investigate': {
          if (bot.lastKnownPlayer) moveBotToward(bot, bot.lastKnownPlayer, 3.6, dt);
          botAimAt(bot, bot.lastKnownPlayer || bot.pos, dt, 0.01);
          if (now() > bot.stateUntil) { bot.state = 'patrol'; bot.waypoint = pickWaypoint(bot); }
          break;
        }
        case 'engage': {
          bot.reactionTimer -= dt;
          // Strafe-ish: bias motion sideways around player at medium range.
          const toPlayerX = p.pos.x - bot.pos.x;
          const toPlayerZ = p.pos.z - bot.pos.z;
          const dP = Math.hypot(toPlayerX, toPlayerZ);
          const desiredRange = 14;
          const perpX = -toPlayerZ / (dP || 1);
          const perpZ =  toPlayerX / (dP || 1);
          const rangeErr = dP - desiredRange;
          const moveX = (toPlayerX / (dP || 1)) * rangeErr * 0.4 + perpX * (bot._strafe || 1) * 1.8;
          const moveZ = (toPlayerZ / (dP || 1)) * rangeErr * 0.4 + perpZ * (bot._strafe || 1) * 1.8;
          // Occasionally flip strafe direction.
          if (!bot._strafeUntil || now() > bot._strafeUntil) {
            bot._strafe = Math.random() < 0.5 ? -1 : 1;
            bot._strafeUntil = now() + rand(1.0, 2.5);
          }
          const target = V3(bot.pos.x + moveX, 0, bot.pos.z + moveZ);
          moveBotToward(bot, target, 3.0, dt);
          botAimAt(bot, V3(p.pos.x, p.pos.y + 1.35, p.pos.z), dt, 0.005);
          // Fire in bursts.
          if (bot.reactionTimer <= 0 && now() - bot.lastFireAt > bot.fireInterval) {
            if (bot.burstLeft <= 0) {
              bot.burstLeft = irand(2, 5);
              bot.fireInterval = rand(0.6, 1.1);
            }
            if (canSee) {
              botFire(bot);
              bot.burstLeft--;
              bot.lastFireAt = now();
              // Quick intra-burst cadence.
              if (bot.burstLeft > 0) bot.fireInterval = rand(0.08, 0.14);
            }
          }
          break;
        }
      }
    }
  }
  function updateHUD() {
    const p = state.player;
    if (!p) return;
    const hpPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    const hpBar = document.getElementById('health-bar');
    if (hpBar) {
      hpBar.style.width = hpPct + '%';
      hpBar.style.background =
        hpPct > 55 ? 'linear-gradient(90deg,#3f6,#9f9)' :
        hpPct > 25 ? 'linear-gradient(90deg,#fc6,#ff9)' :
                     'linear-gradient(90deg,#f33,#f66)';
    }
    const hpNum = document.getElementById('health-num');
    if (hpNum) hpNum.textContent = Math.max(0, Math.round(p.hp));
    const ammoNum = document.getElementById('ammo-num');
    if (ammoNum) ammoNum.textContent = (p.reloading ? '..' : p.mag) + ' / ' + p.reserve;
    const sn = document.getElementById('score-num');
    if (sn) sn.textContent = state.kills;
    const dn = document.getElementById('death-num');
    if (dn) dn.textContent = state.deaths;
    drawMinimap();
  }

  // ---------------- Minimap ----------------
  const _mini = {
    canvas: null, ctx: null, size: 170, range: 55,
  };
  function initMinimap() {
    _mini.canvas = document.getElementById('minimap-canvas');
    if (!_mini.canvas) return;
    _mini.ctx = _mini.canvas.getContext('2d');
  }
  function drawMinimap() {
    if (!_mini.ctx) initMinimap();
    const ctx = _mini.ctx;
    if (!ctx) return;
    const W = _mini.canvas.width, H = _mini.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,18,28,0.85)';
    ctx.fillRect(0, 0, W, H);
    const p = state.player;
    if (!p) return;
    const cx = W / 2, cy = H / 2;
    const scale = (W / 2) / _mini.range;
    const yaw = p.yaw;
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw);

    // Obstacles
    ctx.fillStyle = 'rgba(140,170,200,0.45)';
    for (const o of WORLD.obstacles) {
      const dx = o.x - p.pos.x;
      const dz = o.z - p.pos.z;
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const sx = cx + rx * scale;
      const sy = cy + rz * scale;
      const sw = Math.max(2, o.w * scale);
      const sh = Math.max(2, o.d * scale);
      if (sx < -sw || sx > W + sw || sy < -sh || sy > H + sh) continue;
      ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
    }

    // Bots
    for (const b of state.bots) {
      if (!b.alive) continue;
      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const sx = cx + rx * scale;
      const sy = cy + rz * scale;
      if (sx < 0 || sx > W || sy < 0 || sy > H) {
        // Draw edge indicator clamped to border.
        const ex = clamp(sx, 4, W - 4);
        const ey = clamp(sy, 4, H - 4);
        ctx.fillStyle = '#ff8844';
        ctx.fillRect(ex - 2, ey - 2, 4, 4);
      } else {
        ctx.fillStyle = b.state === 'engage' ? '#ff4444' : '#ff9966';
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Player (center, facing up)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#6fe89a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Compass N
    ctx.fillStyle = '#9cf';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    // North corresponds to world -Z direction; rotate by yaw.
    const nx = cx + Math.sin(yaw) * (W / 2 - 10);
    const ny = cy - Math.cos(yaw) * (H / 2 - 10);
    ctx.fillText('N', nx, ny + 4);
  }

  // Simple orbit camera around player until the real controller is wired up.
  function updateCamera(dt) {
    const p = state.player;
    if (!p) return;
    const t = now() * 0.15;
    camera.position.set(
      p.pos.x + Math.cos(t) * 10,
      p.pos.y + 4,
      p.pos.z + Math.sin(t) * 10
    );
    camera.lookAt(p.pos.x, p.pos.y + 1.5, p.pos.z);
  }

  // ---------------- Main loop ----------------
  function loop() {
    requestAnimationFrame(loop);
    if (!state.running || state.paused) { renderer.render(scene, camera); return; }
    const t = now();
    const dt = Math.min(0.05, t - state.lastTime);
    state.lastTime = t;

    updatePlayer(dt);
    updateBots(dt);
    updateEffects(dt);
    updateCamera(dt);
    updateHUD();

    // Keep the sky dome centered on the camera so the horizon is stable.
    if (WORLD.sky) WORLD.sky.position.copy(camera.position);

    renderer.render(scene, camera);
  }

  // ---------------- UI wiring ----------------
  function startGame() {
    Audio.init();
    Audio.resume();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    if (!state.player) {
      buildMap();
      createPlayer();
      initMinimap();
      // Initial hostile contacts.
      for (let i = 0; i < 3; i++) spawnBot();
      WORLD.botSpawnTimer = 4.0;
    }
    respawnPlayer();
    state.lastTime = now();
    state.running = true;
    flashMessage('MISSION: ELIMINATE HOSTILES', 2.0);
  }

  document.getElementById('start-btn').addEventListener('click', startGame);
  const respawnBtn = document.getElementById('respawn-btn');
  if (respawnBtn) respawnBtn.addEventListener('click', () => {
    respawnPlayer();
    // Nudge bot alert down so respawn isn't instant re-death.
    for (const b of state.bots) {
      b.alertLevel *= 0.4;
      if (b.state === 'engage') b.state = 'investigate', b.stateUntil = now() + 4;
    }
  });

  // Expose for later chunks to extend.
  window.__GAME__ = { THREE, scene, camera, renderer, state, WORLD,
    V3, clamp, lerp, rand, irand, now };

  loop();
})();
