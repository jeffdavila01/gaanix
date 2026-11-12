/* ============================================================
   GAANIX — scroll-driven 3D gallery
   Three.js camera flight + GSAP DOM reveals
   ============================================================ */

import * as THREE from "./vendor/three.module.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  if (a === b) return v >= b ? 1 : 0;
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = window.matchMedia("(hover: none)").matches;

/* seeded random so the room is always the same room */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261112);

/* ------------------------------------------------------------
   DOM bits that do not depend on WebGL
   ------------------------------------------------------------ */

/* custom cursor */
(function cursor() {
  const dot = $("#cursor");
  if (!dot || isTouch) return;
  let x = window.innerWidth / 2, y = window.innerHeight / 2;
  let cx = x, cy = y;
  window.addEventListener("pointermove", (e) => {
    x = e.clientX; y = e.clientY;
    dot.classList.add("is-visible");
  }, { passive: true });
  document.addEventListener("pointerleave", () => dot.classList.remove("is-visible"));
  $$("a, button, [data-cursor]").forEach((el) => {
    el.addEventListener("pointerenter", () => dot.classList.add("is-active"));
    el.addEventListener("pointerleave", () => dot.classList.remove("is-active"));
  });
  (function loop() {
    cx = lerp(cx, x, 0.2);
    cy = lerp(cy, y, 0.2);
    dot.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    requestAnimationFrame(loop);
  })();
})();

/* 3D tilt on the print grid */
(function tilt() {
  if (reduceMotion || isTouch) return;
  $$("[data-frame]").forEach((frame) => {
    const inner = $(".frame__inner", frame);
    if (!inner) return;
    frame.addEventListener("pointermove", (e) => {
      const r = frame.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      frame.style.setProperty("--ry", `${(px * 11).toFixed(2)}deg`);
      frame.style.setProperty("--rx", `${(-py * 9).toFixed(2)}deg`);
    });
    frame.addEventListener("pointerleave", () => {
      frame.style.setProperty("--ry", "0deg");
      frame.style.setProperty("--rx", "0deg");
    });
  });
})();

/* ------------------------------------------------------------
   Rotating CSS-3D print rack
   ------------------------------------------------------------ */
(function rack() {
  const carousel = $("#carousel");
  const ring = $("#ring");
  if (!carousel || !ring) return;
  const items = $$(".ring-item", ring);
  const n = items.length;
  let rot = 0;
  let velocity = reduceMotion ? 0 : 0.05;
  let radius = 400;
  let dragging = false;
  let lastX = 0;
  let hovering = false;

  function layout() {
    const w = items[0].offsetWidth || 240;
    radius = Math.round(w * 1.75);
    items.forEach((item, i) => {
      item.style.transform = `rotateY(${(i * 360) / n}deg) translateZ(${radius}px)`;
    });
  }
  layout();
  window.addEventListener("resize", layout);

  carousel.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    carousel.classList.add("is-dragging");
    carousel.setPointerCapture?.(e.pointerId);
  });
  carousel.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const d = (e.clientX - lastX) * 0.35;
    lastX = e.clientX;
    rot += d;
    velocity = d * 0.55;
  });
  const end = () => {
    dragging = false;
    carousel.classList.remove("is-dragging");
  };
  carousel.addEventListener("pointerup", end);
  carousel.addEventListener("pointercancel", end);
  carousel.addEventListener("pointerenter", () => { hovering = true; });
  carousel.addEventListener("pointerleave", () => { hovering = false; end(); });

  (function loop() {
    if (!dragging) {
      rot += velocity;
      velocity *= 0.955;
      const idle = !hovering && !reduceMotion ? 0.045 : 0;
      velocity += (idle - velocity) * 0.02;
    }
    ring.style.transform = `rotateX(-6deg) rotateY(${rot.toFixed(3)}deg)`;
    requestAnimationFrame(loop);
  })();
})();

/* ------------------------------------------------------------
   Loader
   ------------------------------------------------------------ */
const loaderEl = $("#loader");
const pctEl = $("#loadPct");
let assetsReady = false;
let loaderDone = false;
let shownPct = 0;
let loadTarget = 0;
const startedAt = performance.now();

function finishLoading() {
  if (loaderDone) return;
  loaderDone = true;
  if (pctEl) pctEl.textContent = "100";
  loaderEl.classList.add("is-done");
  document.body.classList.remove("is-loading");
  document.body.classList.add("is-ready");
  loaderEl.setAttribute("aria-hidden", "true");
  intro();
}

(function loaderLoop() {
  shownPct = lerp(shownPct, loadTarget, 0.12);
  if (pctEl) pctEl.textContent = String(Math.round(shownPct));
  const elapsed = performance.now() - startedAt;
  if (assetsReady && shownPct > 99.4 && elapsed > 1250) {
    loadTarget = 100;
    finishLoading();
    return;
  }
  requestAnimationFrame(loaderLoop);
})();

/* ------------------------------------------------------------
   WebGL world
   ------------------------------------------------------------ */
const canvas = $("#webgl");
const journey = $("#journey");
const stage = $("#stage");
const chapters = $$(".chapter");
const hudFill = $("#hudFill");
const hudIndex = $("#hudIndex");
const hudLabel = $("#hudLabel");
const scrollCue = $(".scroll-cue");

const CHAPTER_LABELS = ["Entry", "Portrait", "Landscape", "Street", "Studio", "Exit"];

/* opacity windows along scroll progress */
const BANDS = [
  { in0: -1, in1: -1, out0: 0.055, out1: 0.125 }, // hero
  { in0: 0.12, in1: 0.175, out0: 0.275, out1: 0.325 },
  { in0: 0.325, in1: 0.375, out0: 0.46, out1: 0.51 },
  { in0: 0.51, in1: 0.56, out0: 0.65, out1: 0.70 },
  { in0: 0.70, in1: 0.75, out0: 0.84, out1: 0.89 },
  { in0: 0.90, in1: 0.95, out0: 2, out1: 2 }, // outro
];

const PHOTOS = [
  "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09",
  "p10", "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18",
];

let renderer, scene, camera, clock;
let camCurve, targetCurve;
let photoGroups = [];
let dust, cameraModel, glowSprite;
let worldReady = false;
let renderPaused = false;

let targetProgress = 0;
let smoothProgress = 0;
let pointer = { x: 0, y: 0, sx: 0, sy: 0 };

function scrollProgress() {
  if (!journey) return 0;
  const rect = journey.getBoundingClientRect();
  const total = journey.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return clamp(-rect.top / total);
}

try {
  initWorld();
} catch (err) {
  console.error("WebGL unavailable:", err);
  document.body.classList.add("no-webgl");
  if (canvas) canvas.style.display = "none";
  assetsReady = true;
  loadTarget = 100;
  if (loaderEl) {
    setTimeout(() => {
      loaderEl.classList.add("is-done");
      document.body.classList.remove("is-loading");
      document.body.classList.add("is-ready");
      intro();
    }, 600);
  }
}

function initWorld() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08080a);
  scene.fog = new THREE.FogExp2(0x08080a, 0.0145);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    420
  );

  /* ---- lights (only the camera model is lit; prints are unlit) ---- */
  scene.add(new THREE.AmbientLight(0x9098ac, 1.15));

  const key = new THREE.DirectionalLight(0xffdcb6, 3.1);
  key.position.set(5, 7, 8);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x86aaff, 2.4);
  rim.position.set(-7, 3, -6);
  scene.add(rim);

  const warm = new THREE.PointLight(0xffab6b, 55, 34, 2);
  warm.position.set(3.2, 0.4, 4.5);
  scene.add(warm);

  const fill = new THREE.PointLight(0xfff0d8, 30, 40, 2);
  fill.position.set(-4, 2.5, -40);
  scene.add(fill);

  /* ---- camera path through the room ---- */
  const camPoints = [
    [0, 0.5, 15],
    [2.35, 0.85, 4],
    [-2.8, 0.1, -10],
    [2.7, -0.6, -25],
    [-2.1, 1.0, -41],
    [1.9, 0.3, -57],
    [-1.4, 1.25, -71],
    [0, 1.8, -86],
  ].map((p) => new THREE.Vector3(...p));

  const targetPoints = [
    [2.6, -0.45, 4],
    [-1.1, 0.45, -7],
    [1.4, 0.55, -22],
    [-1.6, 0.4, -38],
    [1.0, 0.8, -53],
    [-0.8, 1.1, -68],
    [0.5, 1.5, -82],
    [0, 0.9, -99],
  ].map((p) => new THREE.Vector3(...p));

  camCurve = new THREE.CatmullRomCurve3(camPoints, false, "catmullrom", 0.35);
  targetCurve = new THREE.CatmullRomCurve3(targetPoints, false, "catmullrom", 0.35);

  /* ---- atmosphere ---- */
  buildDust();
  buildGlow();
  buildFloor();

  /* ---- the floating camera ---- */
  cameraModel = buildCameraModel(0.92);
  cameraModel.group.position.set(2.95, -0.6, 4.1);
  cameraModel.group.rotation.set(0.05, -0.55, 0.04);
  scene.add(cameraModel.group);

  /* ---- load the prints ---- */
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    loadTarget = Math.min(96, (loaded / total) * 96);
  };
  manager.onLoad = () => {
    assetsReady = true;
    loadTarget = 100;
  };
  manager.onError = () => {
    assetsReady = true;
    loadTarget = 100;
  };

  const texLoader = new THREE.TextureLoader(manager);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  PHOTOS.forEach((name, i) => {
    texLoader.load(`images/${name}.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      const group = makePrint(tex, i);
      scene.add(group);
      photoGroups.push(group);
      worldReady = true;
    });
  });

  clock = new THREE.Clock();
  bindScroll();
  bindPointer();
  window.addEventListener("resize", onResize);
  onResize();

  smoothProgress = reduceMotion ? 0.35 : scrollProgress();
  targetProgress = reduceMotion ? 0.35 : smoothProgress;

  renderer.setAnimationLoop(tick);
}

/* a framed print on an invisible wall */
function makePrint(tex, i) {
  const group = new THREE.Group();
  const img = tex.image;
  const aspect = img && img.width ? img.width / img.height : 2 / 3;
  const portrait = aspect < 1;
  const h = (portrait ? 3.2 : 2.4) * (0.92 + rand() * 0.16);
  const w = h * aspect;

  const frameMat = new THREE.MeshBasicMaterial({ color: 0x101013 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3), frameMat);
  frame.position.z = -0.03;
  group.add(frame);

  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.12, h + 0.12),
    new THREE.MeshBasicMaterial({ color: 0x22222a })
  );
  mat.position.z = -0.015;
  group.add(mat);

  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  group.add(print);

  /* layout: alternate sides of the corridor
     first two prints stay wide so the hero stays readable */
  const z = -2 - i * 5.65;
  const side = i % 2 === 0 ? 1 : -1;
  const spread = i < 2 ? 5.8 : 4.2 + rand() * 2.2;
  const x = side * spread;
  const y = -1.4 + rand() * 3.6;

  group.position.set(x, y, z);
  group.rotation.y = -side * (0.22 + rand() * 0.3);
  group.rotation.z = (rand() - 0.5) * 0.05;

  group.userData = {
    baseY: y,
    baseRotY: group.rotation.y,
    phase: rand() * Math.PI * 2,
  };
  return group;
}

function buildDust() {
  const count = isTouch ? 420 : 780;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() - 0.5) * 34;
    positions[i * 3 + 1] = (rand() - 0.5) * 16;
    positions[i * 3 + 2] = 6 - rand() * 120;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xd9c4a4,
    size: 0.052,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

function buildGlow() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255, 208, 160, 0.95)");
  g.addColorStop(0.25, "rgba(255, 172, 110, 0.42)");
  g.addColorStop(0.6, "rgba(200, 120, 70, 0.08)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  glowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    })
  );
  glowSprite.position.set(0, 1.2, -104);
  glowSprite.scale.set(30, 30, 1);
  scene.add(glowSprite);

  /* soft haze pockets through the corridor */
  for (let i = 0; i < 5; i++) {
    const haze = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.1 + rand() * 0.07,
      })
    );
    haze.position.set((rand() - 0.5) * 12, rand() * 4 - 1.5, -14 - i * 18);
    haze.scale.setScalar(10 + rand() * 8);
    scene.add(haze);
  }
}

function buildFloor() {
  const grid = new THREE.GridHelper(240, 60, 0x2b2b33, 0x16161b);
  grid.position.set(0, -4.4, -50);
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  grid.material.depthWrite = false;
  scene.add(grid);
}

/* procedural 3D film camera */
function buildCameraModel(scale = 1) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x16161b, metalness: 0.88, roughness: 0.34,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0c, metalness: 0.6, roughness: 0.55,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc59a63, metalness: 1, roughness: 0.3,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x06131a, metalness: 1, roughness: 0.06,
    emissive: 0x0e3d4c, emissiveIntensity: 1.1,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.86), bodyMat);
  group.add(body);

  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.1, 0.9), brass);
  topPlate.position.y = 0.7;
  group.add(topPlate);

  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.86), brass);
  basePlate.position.y = -0.68;
  group.add(basePlate);

  const hump = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.34, 0.62), bodyMat);
  hump.position.set(0, 0.9, -0.02);
  group.add(hump);

  const flash = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0xf3e7d4, emissive: 0xf6d9ae, emissiveIntensity: 1.6, roughness: 0.4,
    })
  );
  flash.position.set(0, 0.87, 0.32);
  group.add(flash);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.06, 0.16), darkMat);
  grip.position.set(-1.02, -0.02, 0.44);
  group.add(grip);

  const lensBase = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.6, 0.42, 48), darkMat);
  lensBase.rotation.x = Math.PI / 2;
  lensBase.position.z = 0.6;
  group.add(lensBase);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 0.4, 48), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.92;
  group.add(barrel);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.032, 16, 64), brass);
  ring.position.z = 1.12;
  group.add(ring);

  const frontGlass = new THREE.Mesh(new THREE.CircleGeometry(0.4, 48), glass);
  frontGlass.position.z = 1.13;
  group.add(frontGlass);

  const innerGlass = new THREE.Mesh(
    new THREE.CircleGeometry(0.19, 40),
    new THREE.MeshStandardMaterial({
      color: 0x020608, metalness: 1, roughness: 0.02,
      emissive: 0x1d6d86, emissiveIntensity: 0.8,
    })
  );
  innerGlass.position.z = 1.135;
  group.add(innerGlass);

  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.11, 32), brass);
  dial.position.set(0.8, 0.8, 0.02);
  group.add(dial);

  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 24), brass);
  shutter.position.set(-0.68, 0.82, 0.02);
  group.add(shutter);

  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.28), brass);
  shoe.position.set(0, 1.1, -0.02);
  group.add(shoe);

  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.02), brass);
  plaque.position.set(0.62, 0.44, 0.44);
  group.add(plaque);

  [-1.14, 1.14].forEach((x) => {
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 8, 24), brass);
    lug.position.set(x, 0.45, 0);
    group.add(lug);
  });

  group.scale.setScalar(scale);
  return { group };
}

/* ------------------------------------------------------------
   Scroll / pointer wiring
   ------------------------------------------------------------ */
function bindScroll() {
  targetProgress = scrollProgress();
  smoothProgress = targetProgress;

  const onScroll = () => {
    targetProgress = scrollProgress();
    const rect = journey.getBoundingClientRect();
    renderPaused = rect.bottom < 0 || rect.top > window.innerHeight;
    if (canvas) canvas.classList.toggle("is-hidden", rect.bottom < 0);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  document.addEventListener("visibilitychange", () => {
    renderPaused = document.hidden;
  });
  onScroll();
}

function bindPointer() {
  if (isTouch) return;
  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------
   Per-frame update: camera flight + chapter overlays
   ------------------------------------------------------------ */
const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

function tick() {
  const t = clock ? clock.getElapsedTime() : 0;

  if (!reduceMotion) {
    smoothProgress = lerp(smoothProgress, targetProgress, 0.075);
  } else {
    smoothProgress = targetProgress;
  }
  const p = smoothProgress;

  /* pointer easing */
  pointer.sx = lerp(pointer.sx, pointer.x, 0.045);
  pointer.sy = lerp(pointer.sy, pointer.y, 0.045);

  /* cinematic camera flight */
  if (camCurve && targetCurve) {
    camCurve.getPointAt(clamp(p), tmpPos);
    targetCurve.getPointAt(clamp(p), tmpTarget);

    const sway = reduceMotion ? 0 : 1;
    camera.position.set(
      tmpPos.x + pointer.sx * 0.62 * sway,
      tmpPos.y - pointer.sy * 0.36 * sway,
      tmpPos.z
    );
    camera.lookAt(tmpTarget);
    if (sway) {
      camera.rotateZ(pointer.sx * 0.022 + Math.sin(p * Math.PI * 5) * 0.012);
    }
  }

  /* floating prints */
  if (!reduceMotion) {
    for (let i = 0; i < photoGroups.length; i++) {
      const g = photoGroups[i];
      const u = g.userData;
      g.position.y = u.baseY + Math.sin(t * 0.55 + u.phase) * 0.085;
      g.rotation.y = u.baseRotY + Math.sin(t * 0.28 + u.phase) * 0.02;
    }
    if (dust) dust.rotation.y = Math.sin(t * 0.05) * 0.1;
    if (glowSprite) {
      const s = 30 + Math.sin(t * 0.6) * 1.6;
      glowSprite.scale.set(s, s, 1);
    }
  }

  /* the prop camera drifts and turns */
  if (cameraModel && !reduceMotion) {
    const g = cameraModel.group;
    g.rotation.y = -0.55 + Math.sin(t * 0.42) * 0.16 + p * 0.9;
    g.rotation.x = 0.05 + Math.sin(t * 0.62) * 0.035;
    g.position.y = -0.6 + Math.sin(t * 0.75) * 0.06;
  }

  updateOverlays(p, targetProgress);

  if (renderer && !renderPaused) renderer.render(scene, camera);
}

function updateOverlays(p, raw) {
  for (let i = 0; i < chapters.length; i++) {
    const band = BANDS[i];
    if (!band) continue;
    const inF = band.in0 < 0 ? 1 : smoothstep(band.in0, band.in1, p);
    const outF = band.out0 > 1 ? 0 : smoothstep(band.out0, band.out1, p);
    const op = clamp(inF * (1 - outF));
    const el = chapters[i];
    const shift = (1 - op) * (i === 0 ? -18 : 24);
    el.style.opacity = op.toFixed(3);
    el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    el.style.pointerEvents = op > 0.55 ? "auto" : "none";
  }

  const index = Math.min(5, Math.round(clamp(p) * 5));
  if (hudFill) hudFill.style.width = `${(clamp(p) * 100).toFixed(2)}%`;
  if (hudIndex) hudIndex.textContent = String(index).padStart(2, "0");
  if (hudLabel) hudLabel.textContent = CHAPTER_LABELS[index];
  if (scrollCue) scrollCue.style.opacity = (1 - smoothstep(0, 0.035, raw)).toFixed(3);
}

/* ------------------------------------------------------------
   Intro + section reveals
   ------------------------------------------------------------ */
function intro() {
  if (typeof gsap === "undefined") return;
  if (reduceMotion) return;

  if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.from(".hero__title span", {
    yPercent: 70, opacity: 0, duration: 1.5, stagger: 0.09,
  })
    .from(".chapter--hero .eyebrow", { y: 16, opacity: 0, duration: 1 }, 0.15)
    .from(".hero__meta > p", { y: 16, opacity: 0, duration: 1, stagger: 0.1 }, 0.4)
    .from(".hud", { opacity: 0, duration: 1 }, 0.7)
    .from(".scroll-cue", { opacity: 0, duration: 1 }, 0.9);

  if (window.ScrollTrigger) {
    const groups = [
      { sel: ".frames__head > *", y: 34 },
      { sel: ".frame", y: 55 },
      { sel: ".studio__copy > *", y: 30 },
      { sel: ".studio__visual", y: 45 },
      { sel: ".contact__head > *", y: 34 },
      { sel: ".contact__block", y: 30 },
    ];
    groups.forEach(({ sel, y }) => {
      $$(sel).forEach((el) => {
        gsap.from(el, {
          y,
          opacity: 0,
          duration: 1.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            once: true,
          },
        });
      });
    });
  }
}

/* expose scroll progress for debugging */
window.__gaanix = { get progress() { return smoothProgress; } };
