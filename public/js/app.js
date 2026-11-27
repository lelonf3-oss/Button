import { celebrate } from './celebration.js';

const POLL_INTERVAL_MS = 30000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const numberFormat = new Intl.NumberFormat('en-US');
const fmt = (value) => numberFormat.format(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const els = {
  wrap: document.getElementById('button-wrap'),
  button: document.getElementById('the-button'),
  total: document.getElementById('counter-total'),
  goal: document.getElementById('counter-goal'),
  progressFill: document.getElementById('progress-fill'),
  milestoneLine: document.getElementById('milestone-line'),
  reachedLine: document.getElementById('reached-line'),
  status: document.getElementById('status'),
  turnstileBox: document.getElementById('turnstile-box'),
  authOut: document.getElementById('auth-out'),
  authIn: document.getElementById('auth-in'),
  signIn: document.getElementById('sign-in'),
  signOut: document.getElementById('sign-out'),
  userLine: document.getElementById('user-line'),
  buyToggle: document.getElementById('buy-toggle'),
  packages: document.getElementById('packages'),
  packageList: document.getElementById('package-list'),
};

const app = {
  state: null, user: null, knownTotal: null, displayedTotal: null,
  lastCelebrated: 0, busy: false, statusIsDefault: true,
  loadErrorShown: false, retryScheduled: false, packagesKey: '',
  turnstileInit: null, turnstileWidgetId: null, turnstilePending: null,
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message); this.status = status; this.code = code;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (app.user && app.user.csrfToken) headers['X-CSRF-Token'] = app.user.csrfToken;
  }
  let response;
  try {
    response = await fetch(path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store',
    });
  } catch { throw new ApiError(0, 'network', 'Network error. Please check your connection and try again.'); }

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    const error = data && data.error ? data.error : {};
    throw new ApiError(response.status, error.code || 'error', error.message || 'Something went wrong. Please try again.');
  }
  return data;
}

function setStatus(text, tone = 'info', isDefault = false) {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
  app.statusIsDefault = isDefault;
}

function defaultStatus() {
  const u = app.user;
  if (!u) return 'Sign in with Google to press the button. Every account gets one free click.';
  if (u.canClick) return u.freeClickAvailable ? 'Your free click is ready. Press the button.' : 'Press the button.';
  return 'You have no clicks left. Get a click package to keep pressing.';
}

let countFrame = 0;
function animateCounter(from, to) {
  cancelAnimationFrame(countFrame);
  if (reducedMotion.matches || from === null || from === to) {
    els.total.textContent = fmt(to); app.displayedTotal = to; return;
  }
  els.total.classList.remove('counter-total-bump');
  void els.total.offsetWidth;
  els.total.classList.add('counter-total-bump');
  const start = performance.now();
  const duration = Math.min(1200, 400 + (to - from) * 60);
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    els.total.textContent = fmt(value); app.displayedTotal = value;
    if (t < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

function setPackagesOpen(open) {
  els.packages.hidden = !open;
  els.buyToggle.setAttribute('aria-expanded', String(open));
}

function renderPackages() {
  const packages = app.state.packages;
  const key = JSON.stringify(packages);
  if (key === app.packagesKey) return;
  app.packagesKey = key;
  els.packageList.replaceChildren();
  for (const pkg of packages) {
    const price = new Intl.NumberFormat('en-IE', { style: 'currency', currency: pkg.currency.toUpperCase() }).format(pkg.amountCents / 100);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'link-btn';
    button.textContent = `${pkg.credits} clicks · ${price}`;
    button.addEventListener('click', () => startCheckout(pkg.id));
    els.packageList.append(button);
  }
}

function renderUser() {
  const u = app.user;
  els.authOut.hidden = Boolean(u);
  els.authIn.hidden = !u;
  els.wrap.dataset.ready = String(!u || u.canClick);
  els.button.setAttribute('aria-disabled', String(Boolean(u) && !u.canClick));
  els.button.setAttribute('aria-label', u ? 'Press the button' : 'Press the button (sign in required)');

  if (!u) { setPackagesOpen(false); els.buyToggle.disabled = false; els.buyToggle.title = ""; return; }

  const parts = [];
  if (u.freeClickAvailable) parts.push('Free click ready');
  parts.push(`Paid clicks: ${u.creditsRemaining}`);
  els.userLine.textContent = parts.join(' · ');

  if (u.clickedToday || u.boughtToday) {
    els.buyToggle.disabled = true;
    els.buyToggle.title = u.clickedToday 
      ? "You cannot buy credits on the same day you pressed the button. Come back tomorrow." 
      : "You can only buy one package per day. Come back tomorrow.";
  } else {
    els.buyToggle.disabled = false; els.buyToggle.title = "";
  }
}

function render() {
  const state = app.state;
  if (!state) return;
  els.goal.textContent = fmt(state.nextMilestone);
  const reached = state.completedMilestones.map((m) => m.threshold).filter((t) => t <= state.total);
  const previous = reached.length > 0 ? Math.max(...reached) : 0;
  const span = state.nextMilestone - previous;
  const progress = span > 0 ? Math.min(1, Math.max(0, (state.total - previous) / span)) : 0;
  els.progressFill.style.setProperty('--progress', progress.toFixed(4));
  const togo = Math.max(0, state.nextMilestone - state.total);
  els.milestoneLine.textContent = `Next milestone: ${fmt(state.nextMilestone)} · ${fmt(togo)} ${togo === 1 ? 'click' : 'clicks'} to go`;
  if (reached.length > 0) { els.reachedLine.textContent = `Reached so far: ${reached.slice(-8).map(fmt).join(' · ')}`; els.reachedLine.hidden = false; } else { els.reachedLine.hidden = true; }
  renderPackages(); renderUser();
  if (app.statusIsDefault) setStatus(defaultStatus(), 'info', true);
}

function setBusy(busy) {
  app.busy = busy;
  if (busy) els.wrap.dataset.busy = 'true'; else delete els.wrap.dataset.busy;
  for (const button of els.packageList.querySelectorAll('button')) button.disabled = busy;
}

function maybeCelebrate(threshold) {
  if (!threshold || threshold <= app.lastCelebrated) return;
  app.lastCelebrated = threshold; celebrate(threshold);
}

function applyState(data) {
  const previousTotal = app.knownTotal;
  const total = previousTotal !== null && data.total < previousTotal ? previousTotal : data.total;
  app.state = { ...data, total }; app.user = data.user;
  if (previousTotal !== null && total > previousTotal) {
    const crossed = data.completedMilestones.map((m) => m.threshold).filter((t) => t > previousTotal && t <= total);
    if (crossed.length > 0) maybeCelebrate(Math.max(...crossed));
  }
  const from = app.displayedTotal;
  app.knownTotal = total; animateCounter(from, total); render();
}

async function loadState({ silent = true } = {}) {
  try {
    const data = await api('/api/state');
    if (app.loadErrorShown) { app.loadErrorShown = false; setStatus('', 'info', true); }
    applyState(data); return data;
  } catch {
    if (!app.state) {
      if (!silent || !app.loadErrorShown) { setStatus('Could not load the counter. Retrying…', 'error'); app.loadErrorShown = true; }
      if (!app.retryScheduled) { app.retryScheduled = true; setTimeout(() => { app.retryScheduled = false; loadState(); }, 5000); }
    }
    return null;
  }
}

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    window.__turnstileOnLoad = resolve;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__turnstileOnLoad';
    script.async = true; script.defer = true;
    script.onerror = () => reject(new Error('The bot check could not be loaded. Please disable content blockers and reload the page.'));
    document.head.append(script);
  });
}

function settleTurnstile(error, token) {
  const pending = app.turnstilePending;
  if (!pending) return;
  app.turnstilePending = null; clearTimeout(pending.timer);
  if (error) pending.reject(error); else pending.resolve(token);
}

async function ensureTurnstile() {
  if (app.turnstileWidgetId !== null) return;
  if (!app.turnstileInit) {
    app.turnstileInit = (async () => {
      const config = await api('/api/config');
      await loadTurnstileScript();
      app.turnstileWidgetId = window.turnstile.render(els.turnstileBox, {
        sitekey: config.turnstileSiteKey, theme: 'dark', execution: 'execute', appearance: 'interaction-only',
        callback: (token) => settleTurnstile(null, token),
        'error-callback': (err) => { settleTurnstile(new Error('The bot check failed. Please try again.')); return true; },
        'timeout-callback': () => settleTurnstile(new Error('The bot check timed out. Please try again.')),
        'unsupported-callback': () => settleTurnstile(new Error('Your browser is not supported by the bot check.')),
        'before-interactive-callback': () => els.turnstileBox.classList.add('is-active'),
        'after-interactive-callback': () => els.turnstileBox.classList.remove('is-active'),
      });
    })().catch((err) => { app.turnstileInit = null; throw err; });
  }
  await app.turnstileInit;
}

async function getTurnstileToken() {
  await ensureTurnstile();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settleTurnstile(new Error('The bot check took too long. Please try again.')), 90000);
    app.turnstilePending = { resolve, reject, timer };
    window.turnstile.reset(app.turnstileWidgetId);
    window.turnstile.execute(app.turnstileWidgetId);
  });
}

function setPressed(on) {
  els.button.classList.toggle('is-pressed', on);
  els.wrap.classList.toggle('is-pressed', on);
}

function pointToSignIn() {
  els.signIn.classList.remove('attention');
  void els.signIn.offsetWidth;
  els.signIn.classList.add('attention');
  els.signIn.focus({ preventScroll: true });
}

function applyClickResult(result) {
  const total = Math.max(result.total, app.knownTotal ?? 0);
  const from = app.displayedTotal;
  app.user = result.user;
  app.state = { ...app.state, total, nextMilestone: result.total >= total ? result.nextMilestone : app.state.nextMilestone, user: result.user };
  app.knownTotal = total;
  animateCounter(from, total); render(); maybeCelebrate(result.milestoneReached);
  setStatus('Your click is counted. Thank you!', 'success');
  loadState();
}

async function handlePress() {
  if (app.busy) return;
  if (!app.state) { await loadState({ silent: false }); if (!app.state) return; }

  const u = app.user;
  if (!u) { setStatus('Sign in with Google to press the button.', 'info'); pointToSignIn(); return; }
  
  if (!u.canClick) {
    setStatus('You have no clicks left. Get a click package to keep pressing.', 'info');
    setPackagesOpen(true); return;
  }

  setBusy(true);
  try {
    setStatus('Checking…', 'info');
    const turnstileToken = await getTurnstileToken();
    const result = await api('/api/click', { method: 'POST', body: { turnstileToken } });
    applyClickResult(result);
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Please try again.', 'error');
    if (err instanceof ApiError) {
      const refresh = ['not_authenticated', 'bad_csrf', 'no_credits', 'click_failed'];
      if (refresh.includes(err.code)) loadState();
    }
  } finally {
    setBusy(false); els.turnstileBox.classList.remove('is-active');
  }
}

async function startCheckout(packageId) {
  if (app.busy || !app.user) return;
  setBusy(true);
  try {
    setStatus('Checking…', 'info');
    const turnstileToken = await getTurnstileToken();
    setStatus('Opening secure checkout…', 'info');
    const { url } = await api('/api/checkout', { method: 'POST', body: { packageId, turnstileToken } });
    if (typeof url !== 'string' || !url.startsWith('https://checkout.stripe.com/')) throw new Error('Unexpected checkout address. Please try again.');
    window.location.assign(url);
  } catch (err) {
    setBusy(false); els.turnstileBox.classList.remove('is-active');
    setStatus(err.message || 'Something went wrong. Please try again.', 'error');
  }
}

async function pollForCredits() {
  let last = app.user ? app.user.creditsRemaining : null;
  for (let i = 0; i < 10; i++) {
    await sleep(3000);
    const data = await loadState();
    if (!data || !data.user) continue;
    if (last !== null && data.user.creditsRemaining > last) {
      const n = data.user.creditsRemaining;
      setStatus(`Payment confirmed. You now have ${n} paid ${n === 1 ? 'click' : 'clicks'}.`, 'success');
      return;
    }
    last = data.user.creditsRemaining;
  }
  setStatus('Still waiting? Your clicks appear automatically once the payment is confirmed. Reload this page in a minute.', 'info');
}

function handleReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth'); const payment = params.get('payment');
  const validAuth = ['ok', 'cancelled', 'error'].includes(auth) ? auth : null;
  const validPayment = ['success', 'cancelled'].includes(payment) ? payment : null;
  if (!validAuth && !validPayment) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return { auth: validAuth, payment: validPayment };
}

function showReturnMessage(returned) {
  if (returned.payment === 'success') setStatus('Thank you! Your clicks are added as soon as Stripe confirms the payment, usually within seconds.', 'success');
  else if (returned.payment === 'cancelled') setStatus('Checkout cancelled. No payment was made.', 'info');
  else if (returned.auth === 'ok') { if (app.user) setStatus('Signed in with Google. ' + defaultStatus(), 'success'); else setStatus('Sign-in could not be completed. Please make sure cookies are enabled and try again.', 'error'); }
  else if (returned.auth === 'cancelled') setStatus('Sign-in was cancelled.', 'info');
  else if (returned.auth === 'error') setStatus('Sign-in failed. Please try again.', 'error');
}

function bindEvents() {
  els.button.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse' || event.button === 0) setPressed(true); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) els.button.addEventListener(type, () => setPressed(false));
  els.button.addEventListener('keydown', (event) => { if (event.key === ' ' || event.key === 'Enter') setPressed(true); });
  els.button.addEventListener('keyup', () => setPressed(false));
  els.button.addEventListener('blur', () => setPressed(false));
  els.button.addEventListener('click', handlePress);

  els.buyToggle.addEventListener('click', () => {
    if (els.buyToggle.disabled) { setStatus(els.buyToggle.title, 'error'); return; }
    setPackagesOpen(els.packages.hidden);
  });

  els.signOut.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (err) { setStatus(err.message, 'error'); return; }
    app.user = null; setStatus('', 'info', true); await loadState();
  });

  window.addEventListener('pageshow', (event) => { if (event.persisted) { setBusy(false); loadState(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadState(); });
}

function startPolling() {
  setInterval(() => { if (document.visibilityState === 'visible' && !app.busy) loadState(); }, POLL_INTERVAL_MS);
}

async function init() {
  const returned = handleReturnParams();
  bindEvents();
  await loadState({ silent: false });
  if (returned && app.state) showReturnMessage(returned);
  if (app.user) ensureTurnstile().catch(() => {});
  startPolling();
  if (returned && returned.payment === 'success' && app.user) pollForCredits();
}

init();
