// Small milestone celebration: a message plus a burst of rainbow confetti
// from the center of the button. With "prefers-reduced-motion" only the
// message is shown (no particles).

const COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#30d158', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f'];
const MESSAGE_DURATION_MS = 5200;

const numberFormat = new Intl.NumberFormat('en-US');

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showMessage(threshold) {
  const previous = document.querySelector('.celebration');
  if (previous) previous.remove();

  const box = document.createElement('div');
  box.className = 'celebration';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');

  const kicker = document.createElement('p');
  kicker.className = 'celebration-kicker';
  kicker.textContent = 'MILESTONE REACHED';

  const number = document.createElement('p');
  number.className = 'celebration-number';
  number.textContent = numberFormat.format(threshold);

  const text = document.createElement('p');
  text.className = 'celebration-text';
  text.textContent = 'Thank you to everyone who pressed the button.';

  box.append(kicker, number, text);
  document.body.append(box);

  requestAnimationFrame(() => box.classList.add('is-visible'));
  setTimeout(() => {
    box.classList.remove('is-visible');
    setTimeout(() => box.remove(), 600);
  }, MESSAGE_DURATION_MS);
}

function getOrigin() {
  const button = document.getElementById('the-button');
  if (!button) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function burst() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement('canvas');
  canvas.className = 'celebration-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  document.body.append(canvas);

  const origin = getOrigin();
  const particles = Array.from({ length: 150 }, (_, index) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 180 + Math.random() * 520;
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 120,
      size: 3 + Math.random() * 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 10,
      color: COLORS[index % COLORS.length],
      life: 1.4 + Math.random() * 1.4,
      age: 0,
      round: Math.random() < 0.4,
    };
  });

  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);

    let alive = 0;
    for (const p of particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      alive++;

      p.vx *= 1 - 1.8 * dt;
      p.vy = p.vy * (1 - 1.8 * dt) + 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;

      ctx.globalAlpha = 1 - Math.pow(p.age / p.life, 3);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    if (alive > 0) requestAnimationFrame(frame);
    else canvas.remove();
  }

  requestAnimationFrame(frame);
}

export function celebrate(threshold) {
  showMessage(threshold);
  if (!prefersReducedMotion()) burst();
}
