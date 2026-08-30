// animatedBackground.js — optional animated canvas background with
// selectable shapes and a brightness control. Fully self-contained:
// does not touch any existing UI logic, only reads/writes its own
// localStorage keys and its own DOM elements.

const STORAGE_ENABLED = "mori_anim_enabled";
const STORAGE_SHAPE = "mori_anim_shape";
const STORAGE_BRIGHTNESS = "mori_anim_brightness";

const canvas = document.getElementById("animatedBgCanvas");
const toggle = document.getElementById("animBgToggle");
const shapeGrid = document.getElementById("animShapeGrid");
const brightnessSlider = document.getElementById("animBrightnessSlider");
const brightnessValue = document.getElementById("animBrightnessValue");

let ctx = null;
let rafId = null;
let particles = [];
let currentShape = localStorage.getItem(STORAGE_SHAPE) || "particles";
let width = 0;
let height = 0;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function getThemeColor() {
  const isDark =
    document.documentElement.getAttribute("data-theme") === "dark";
  return isDark
    ? { r: 248, g: 248, b: 250 }
    : { r: 26, g: 25, b: 23 };
}

function resizeCanvas() {
  if (!canvas) return;
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function seedShape(shape) {
  particles = [];
  const count =
    shape === "stars" ? 90 : shape === "bubbles" ? 26 : shape === "waves" ? 5 : 55;

  if (shape === "waves") {
    for (let i = 0; i < count; i++) {
      particles.push({
        amplitude: rand(14, 34),
        wavelength: rand(180, 340),
        speed: rand(0.15, 0.4) * (i % 2 === 0 ? 1 : -1),
        yOffset: (height / (count + 1)) * (i + 1),
        phase: rand(0, Math.PI * 2),
        opacity: rand(0.05, 0.16),
      });
    }
    return;
  }

  for (let i = 0; i < count; i++) {
    const base = {
      x: rand(0, width),
      y: rand(0, height),
      r: shape === "stars" ? rand(0.6, 1.8) : rand(2, shape === "bubbles" ? 22 : 3),
      vx: rand(-0.15, 0.15),
      vy:
        shape === "bubbles" ? -rand(0.15, 0.5) : rand(-0.15, 0.15),
      opacity: shape === "stars" ? rand(0.2, 1) : rand(0.15, 0.55),
      twinkleSpeed: rand(0.01, 0.03),
      twinklePhase: rand(0, Math.PI * 2),
    };
    particles.push(base);
  }
}

function wrap(p) {
  if (p.x < -30) p.x = width + 30;
  if (p.x > width + 30) p.x = -30;
  if (p.y < -30) p.y = height + 30;
  if (p.y > height + 30) p.y = -30;
}

function drawParticles(color) {
  ctx.clearRect(0, 0, width, height);
  const maxDist = 130;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    wrap(p);
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i];
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDist) {
        const op = (1 - dist / maxDist) * 0.15;
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${op})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  for (const p of particles) {
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${p.opacity})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBubbles(color) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.y < -p.r - 10) {
      p.y = height + p.r;
      p.x = rand(0, width);
    }
    if (p.x < -p.r) p.x = width + p.r;
    if (p.x > width + p.r) p.x = -p.r;

    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${p.opacity})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStars(color) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    p.twinklePhase += p.twinkleSpeed;
    const twinkle = (Math.sin(p.twinklePhase) + 1) / 2;
    const op = p.opacity * (0.4 + 0.6 * twinkle);
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${op})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

let waveTime = 0;
function drawWaves(color) {
  ctx.clearRect(0, 0, width, height);
  waveTime += 0.01;
  for (const w of particles) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${w.opacity})`;
    ctx.lineWidth = 2;
    for (let x = 0; x <= width; x += 6) {
      const y =
        w.yOffset +
        Math.sin(x / w.wavelength + waveTime * w.speed + w.phase) * w.amplitude;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function loop() {
  if (!ctx) return;
  const color = getThemeColor();
  if (currentShape === "bubbles") drawBubbles(color);
  else if (currentShape === "stars") drawStars(color);
  else if (currentShape === "waves") drawWaves(color);
  else drawParticles(color);
  rafId = requestAnimationFrame(loop);
}

function start() {
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  resizeCanvas();
  seedShape(currentShape);
  canvas.classList.remove("hidden");
  document.body.classList.add("anim-bg-active");
  if (!rafId) loop();
}

function stop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (canvas) {
    canvas.classList.add("hidden");
    const c = canvas.getContext("2d");
    c && c.clearRect(0, 0, canvas.width, canvas.height);
  }
  document.body.classList.remove("anim-bg-active");
}

function applyBrightness(value) {
  if (!canvas) return;
  const pct = Math.max(20, Math.min(150, Number(value) || 100));
  canvas.style.filter = `brightness(${pct}%)`;
  if (brightnessValue) brightnessValue.textContent = `${pct}%`;
}

function setActiveShapeUI(shape) {
  if (!shapeGrid) return;
  shapeGrid.querySelectorAll(".anim-shape-option").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-shape") === shape);
  });
}

function initAnimatedBackground() {
  if (!canvas) return;

  const savedEnabled = localStorage.getItem(STORAGE_ENABLED) === "1";
  const savedBrightness = localStorage.getItem(STORAGE_BRIGHTNESS) || "100";

  if (toggle) toggle.checked = savedEnabled;
  if (brightnessSlider) brightnessSlider.value = savedBrightness;
  applyBrightness(savedBrightness);
  setActiveShapeUI(currentShape);

  if (savedEnabled) start();

  toggle?.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    localStorage.setItem(STORAGE_ENABLED, enabled ? "1" : "0");
    if (enabled) start();
    else stop();
  });

  shapeGrid?.addEventListener("click", (e) => {
    const btn = e.target.closest(".anim-shape-option");
    if (!btn) return;
    const shape = btn.getAttribute("data-shape");
    if (!shape || shape === currentShape) return;
    currentShape = shape;
    localStorage.setItem(STORAGE_SHAPE, shape);
    setActiveShapeUI(shape);
    if (rafId || (toggle && toggle.checked)) {
      seedShape(currentShape);
    }
  });

  brightnessSlider?.addEventListener("input", (e) => {
    const val = e.target.value;
    localStorage.setItem(STORAGE_BRIGHTNESS, val);
    applyBrightness(val);
  });

  window.addEventListener("resize", () => {
    if (!rafId) return;
    resizeCanvas();
    seedShape(currentShape);
  });
}

initAnimatedBackground();

export { initAnimatedBackground };
