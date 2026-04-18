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
  renderer.setClearColor(0x0f1622);
  document.getElementById('scene-root').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0f1622, 45, 160);

  const camera = new THREE.PerspectiveCamera(
    72, window.innerWidth / window.innerHeight, 0.1, 400
  );
  camera.position.set(0, 3, 8);

  // Lighting
  scene.add(new THREE.HemisphereLight(0xb8d0ff, 0x2a2f38, 0.85));
  const sun = new THREE.DirectionalLight(0xffd9a0, 0.9);
  sun.position.set(40, 70, 20);
  scene.add(sun);

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
    const S = WORLD.size;

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(S * 2, S * 2, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x394355, roughness: 0.97 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Subtle asphalt grid lines
    const grid = new THREE.GridHelper(S * 2, 36, 0x4a5a74, 0x2d3848);
    grid.position.y = 0.015;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    scene.add(grid);

    // Perimeter walls (keeps player/bots in the arena)
    const WH = 6, WT = 2;
    addBox(0,  S, S * 2, WH, WT, 0x2a3340);
    addBox(0, -S, S * 2, WH, WT, 0x2a3340);
    addBox( S, 0, WT, WH, S * 2, 0x2a3340);
    addBox(-S, 0, WT, WH, S * 2, 0x2a3340);

    // Central plaza building (big, with corner offices)
    addBox( 0,  0,  14, 8, 14, 0x6a5540);
    addBox(-18, 14, 10, 7, 10, 0x5a4a38);
    addBox( 20, -18, 12, 9, 9,  0x5a4a38);
    addBox(-28, -24, 9, 6, 16, 0x6a5540);
    addBox( 30,  22, 16, 7, 8,  0x6a5540);

    // Long warehouse walls (create sightline corridors)
    addBox(-10, -40, 30, 5, 2, 0x4a5264);
    addBox( 14,  36, 28, 5, 2, 0x4a5264);
    addBox(-42,  10, 2, 5, 22, 0x4a5264);
    addBox( 42, -10, 2, 5, 26, 0x4a5264);

    // Low cover: crates, concrete barriers (waist-height)
    const lowColors = [0x8a6a3c, 0x6a6a6a, 0x7a5a35, 0x556677];
    const coverSpots = [
      [-6, -8], [6, -8], [-8, 6], [8, 8], [-22, -8], [22, -8],
      [-14, 22], [14, -22], [-30, 2], [30, 2], [-4, 30], [4, -30],
      [-36, 26], [36, 26], [-26, -36], [26, -36], [0, 40], [0, -44],
      [-14, -14], [14, 14], [-20, 32], [22, 32],
    ];
    for (const [cx, cz] of coverSpots) {
      const w = rand(1.6, 3.2), d = rand(1.6, 3.2), h = rand(1.0, 1.5);
      const color = lowColors[irand(0, lowColors.length)];
      const obs = addBox(cx, cz, w, h, d, color, 0.9);
      obs.blocksSight = false; // can shoot over when standing
    }

    // Decorative pillars (full-height, small footprint)
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const r = 46;
      addBox(Math.cos(ang) * r, Math.sin(ang) * r, 2, 7, 2, 0x3a4252);
    }

    // Spawn points spread around the map
    const spawns = [
      [0, -36], [36, 0], [-36, 0], [0, 36],
      [-26, -26], [26, 26], [-26, 26], [26, -26],
      [12, -12], [-12, 12],
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
    };
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

    consumeInputFrame();
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
    // Muzzle flash fade
    const p = state.player;
    if (p && p.flash && p.flash.visible) {
      p.flash.material.opacity -= dt * 22;
      if (p.flash.material.opacity <= 0) { p.flash.visible = false; p.flash.material.opacity = 0; }
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
      if (p.mag <= 0 && !p.reloading) { startReload(); flashMessage('RELOAD'); }
      return;
    }
    p.mag--;
    p.fireCooldown = p.fireRate;
    p.recoil = Math.min(1.2, p.recoil + 0.25);
    p.pitch += rand(0.005, 0.02); // kick up slightly

    // Hitscan from camera so what you see is what you hit.
    const aim = crosshairAim();
    // Add minor spread from recoil.
    const spread = 0.004 + p.recoil * 0.01;
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
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.deathAt = now();
      bot.group.rotation.z = Math.PI / 2;
      bot.group.position.y = 0.3;
      state.kills++;
      flashMessage('HOSTILE DOWN');
    }
  }
  WORLD.damageBot = damageBot;

  function updateCameraFPS(dt) {
    const p = state.player;
    if (!p) return;
    const crouching = Input.crouch;
    const eyeY = p.pos.y + (crouching ? 1.1 : 1.65);
    camera.position.set(p.pos.x, eyeY, p.pos.z);

    const pitch = p.pitch - p.recoil * 0.35;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.lookAt(
      p.pos.x - sy * cp * 10,
      eyeY + sp * 10,
      p.pos.z - cy * cp * 10
    );
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

    renderer.render(scene, camera);
  }

  // ---------------- UI wiring ----------------
  function startGame() {
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
