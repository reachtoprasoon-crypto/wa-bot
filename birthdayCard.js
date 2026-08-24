/**
 * Birthday card renderer.
 *
 * Renders the birthday wish as a PNG graphic (headline + name + message drawn
 * into a decorated card) so the wish can be sent as an image instead of plain
 * text. Rendering reuses the Chromium instance whatsapp-web.js already runs,
 * falling back to its own headless browser if that one is unavailable.
 */

const CARD_SIZE = 1080;

let ownBrowser = null;
let ownBrowserPromise = null;

/* ------------------------------------------------------------------ *
 * Small pure helpers (exported for tests)
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/**
 * Emoji are dropped from the drawn text: servers without a colour emoji font
 * render them as empty boxes. The decorations carry the festive weight instead,
 * and the chat caption keeps the original emoji.
 */
function stripEmoji(value) {
  return String(value == null ? '' : value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** WhatsApp markdown (*bold*, _italic_) has no meaning in a picture. */
function stripWhatsAppMarkup(value) {
  return String(value == null ? '' : value)
    .replace(/(^|[\s(])[*_~]([^*_~\n]+)[*_~](?=$|[\s.,!?)])/g, '$1$2');
}

function cardText(value) {
  return stripEmoji(stripWhatsAppMarkup(value));
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG so a given teacher always gets the same card layout. */
function makeRandom(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Themes
 * ------------------------------------------------------------------ */

function confettiDecor(rand) {
  const colors = ['#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#fde047', '#fb7185'];
  let out = '';
  for (let i = 0; i < 90; i++) {
    const x = rand() * CARD_SIZE;
    const y = rand() * CARD_SIZE;
    const w = 10 + rand() * 16;
    const h = 5 + rand() * 9;
    const rot = rand() * 360;
    const color = colors[Math.floor(rand() * colors.length)];
    const opacity = (0.45 + rand() * 0.5).toFixed(2);
    out += rand() > 0.75
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(w / 2.6).toFixed(1)}" fill="${color}" opacity="${opacity}"/>`
      : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" opacity="${opacity}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return out;
}

function balloonDecor(rand) {
  const colors = ['#fecdd3', '#fef08a', '#bfdbfe', '#bbf7d0', '#fbcfe8'];
  let out = '';
  const spots = [
    [120, 190], [300, 110], [960, 180], [790, 105], [90, 880], [980, 900], [250, 960], [840, 985]
  ];
  spots.forEach((spot, i) => {
    const [cx, cy] = spot;
    const rx = 52 + rand() * 22;
    const ry = rx * 1.24;
    const color = colors[i % colors.length];
    const sway = (rand() - 0.5) * 70;
    out += `<g opacity="0.9">
      <path d="M ${cx} ${cy + ry} C ${cx + sway} ${cy + ry + 120}, ${cx - sway} ${cy + ry + 200}, ${cx + sway / 2} ${cy + ry + 300}"
            fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${color}" opacity="0.92"/>
      <ellipse cx="${(cx - rx / 3).toFixed(1)}" cy="${(cy - ry / 3).toFixed(1)}" rx="${(rx / 4).toFixed(1)}" ry="${(ry / 5).toFixed(1)}" fill="#ffffff" opacity="0.45"/>
      <path d="M ${cx - 12} ${cy + ry} L ${cx + 12} ${cy + ry} L ${cx} ${cy + ry + 20} Z" fill="${color}"/>
    </g>`;
  });
  for (let i = 0; i < 40; i++) {
    out += `<circle cx="${(rand() * CARD_SIZE).toFixed(1)}" cy="${(rand() * CARD_SIZE).toFixed(1)}" r="${(3 + rand() * 6).toFixed(1)}" fill="#ffffff" opacity="${(0.2 + rand() * 0.4).toFixed(2)}"/>`;
  }
  return out;
}

function elegantDecor(rand) {
  const corner = (x, y, flipX, flipY) => `<g transform="translate(${x} ${y}) scale(${flipX} ${flipY})" fill="none" stroke="#c08a2e" stroke-width="4" opacity="0.75">
      <path d="M 0 150 C 0 60, 60 0, 150 0"/>
      <path d="M 22 150 C 22 74, 74 22, 150 22" opacity="0.6"/>
      <circle cx="150" cy="0" r="7" fill="#c08a2e" stroke="none"/>
      <path d="M 46 118 C 70 80, 96 66, 132 60" stroke-width="3" opacity="0.5"/>
      <circle cx="46" cy="118" r="5" fill="#c08a2e" stroke="none" opacity="0.7"/>
    </g>`;
  let sparkle = '';
  for (let i = 0; i < 36; i++) {
    const x = (rand() * CARD_SIZE).toFixed(1);
    const y = (rand() * CARD_SIZE).toFixed(1);
    const r = (2 + rand() * 4).toFixed(1);
    sparkle += `<circle cx="${x}" cy="${y}" r="${r}" fill="#c08a2e" opacity="${(0.12 + rand() * 0.28).toFixed(2)}"/>`;
  }
  return `${sparkle}
    <rect x="46" y="46" width="${CARD_SIZE - 92}" height="${CARD_SIZE - 92}" rx="18" fill="none" stroke="#c08a2e" stroke-width="3" opacity="0.55"/>
    <rect x="60" y="60" width="${CARD_SIZE - 120}" height="${CARD_SIZE - 120}" rx="12" fill="none" stroke="#c08a2e" stroke-width="1.5" opacity="0.4"/>
    ${corner(70, 70, 1, 1)}${corner(CARD_SIZE - 70, 70, -1, 1)}${corner(70, CARD_SIZE - 70, 1, -1)}${corner(CARD_SIZE - 70, CARD_SIZE - 70, -1, -1)}`;
}

const THEMES = {
  confetti: {
    label: 'Confetti (purple)',
    background: 'linear-gradient(155deg, #4c1d95 0%, #7c3aed 45%, #db2777 100%)',
    glow: 'radial-gradient(circle at 50% 32%, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%)',
    panel: 'rgba(255,255,255,0.95)',
    ink: '#3b0764',
    accent: '#c026d3',
    muted: '#6b21a8',
    decor: confettiDecor,
  },
  balloons: {
    label: 'Balloons (sunset)',
    background: 'linear-gradient(155deg, #f97316 0%, #fb7185 48%, #a855f7 100%)',
    glow: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.32), rgba(255,255,255,0) 58%)',
    panel: 'rgba(255,255,255,0.95)',
    ink: '#7c2d12',
    accent: '#e11d48',
    muted: '#9a3412',
    decor: balloonDecor,
  },
  elegant: {
    label: 'Elegant (gold)',
    background: 'linear-gradient(155deg, #fffbeb 0%, #fdf1d6 55%, #f5e3bc 100%)',
    glow: 'radial-gradient(circle at 50% 28%, rgba(255,255,255,0.65), rgba(255,255,255,0) 60%)',
    panel: 'rgba(255,255,255,0.82)',
    ink: '#3f2d16',
    accent: '#b45309',
    muted: '#8a6a34',
    decor: elegantDecor,
  },
};

function resolveTheme(name) {
  return THEMES[name] || THEMES.confetti;
}

function themeList() {
  return Object.keys(THEMES).map(key => ({ key, label: THEMES[key].label }));
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

function buildCardHtml({ name, headline, message, footer, theme }) {
  const t = resolveTheme(theme);
  const rand = makeRandom(hashSeed(`${name || ''}|${theme || ''}`));
  const paragraphs = cardText(message)
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD_SIZE}px; height: ${CARD_SIZE}px; }
  body {
    background: ${t.background};
    font-family: 'DejaVu Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    position: relative; overflow: hidden;
  }
  .glow { position: absolute; inset: 0; background: ${t.glow}; }
  .decor { position: absolute; inset: 0; }
  .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 96px; }
  .panel {
    width: 100%; max-height: 100%;
    background: ${t.panel};
    border-radius: 34px;
    padding: 62px 64px 54px;
    text-align: center;
    box-shadow: 0 30px 70px rgba(0,0,0,0.22);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .eyebrow {
    font-size: 24px; letter-spacing: 7px; text-transform: uppercase;
    color: ${t.muted}; opacity: .85; margin-bottom: 18px;
  }
  .headline {
    font-family: 'DejaVu Serif', Georgia, 'Times New Roman', serif;
    font-size: 88px; line-height: 1.02; font-weight: 700; color: ${t.accent};
    letter-spacing: -1px;
  }
  .name {
    font-family: 'DejaVu Serif', Georgia, 'Times New Roman', serif;
    font-size: 76px; line-height: 1.14; font-weight: 700; color: ${t.ink};
    margin-top: 22px; width: 100%;
  }
  .rule { display: flex; align-items: center; gap: 16px; width: 74%; margin: 30px 0 28px; }
  .rule .bar { flex: 1; height: 2px; background: ${t.accent}; opacity: .45; }
  .rule .dot { width: 13px; height: 13px; background: ${t.accent}; transform: rotate(45deg); opacity: .8; }
  .body { width: 100%; color: ${t.ink}; font-size: 36px; line-height: 1.52; opacity: .92; }
  .body p + p { margin-top: 20px; }
  .footer {
    margin-top: 34px; font-size: 23px; letter-spacing: 2.5px; text-transform: uppercase;
    color: ${t.muted}; opacity: .8;
  }
</style></head>
<body>
  <div class="glow"></div>
  <svg class="decor" viewBox="0 0 ${CARD_SIZE} ${CARD_SIZE}" xmlns="http://www.w3.org/2000/svg">${t.decor(rand)}</svg>
  <div class="stage">
    <div class="panel" id="panel">
      <div class="eyebrow">Celebrating you</div>
      <div class="headline" id="headline">${escapeHtml(cardText(headline) || 'Happy Birthday!')}</div>
      <div class="name" id="name">${escapeHtml(cardText(name) || 'Teacher')}</div>
      <div class="rule"><span class="bar"></span><span class="dot"></span><span class="bar"></span></div>
      <div class="body" id="body">${paragraphs}</div>
      ${footer ? `<div class="footer">${escapeHtml(cardText(footer))}</div>` : ''}
    </div>
  </div>
</body></html>`;
}

/**
 * Shrink oversized text in-page: long names and long templates must stay
 * inside the panel instead of overflowing or being clipped.
 */
function fitCardText() {
  const shrink = (el, start, min) => {
    if (!el) return;
    let size = start;
    el.style.fontSize = size + 'px';
    while (size > min && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1)) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  };
  shrink(document.getElementById('headline'), 88, 46);
  shrink(document.getElementById('name'), 76, 34);
  shrink(document.getElementById('body'), 36, 20);

  const panel = document.getElementById('panel');
  const body = document.getElementById('body');
  let guard = 30;
  while (panel && panel.scrollHeight > panel.clientHeight && guard-- > 0) {
    const size = parseFloat(getComputedStyle(body).fontSize) - 2;
    if (size < 18) break;
    body.style.fontSize = size + 'px';
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

async function getBrowser(preferred) {
  if (preferred && typeof preferred.newPage === 'function') {
    const connected = typeof preferred.isConnected !== 'function' || preferred.isConnected();
    if (connected) return preferred;
  }
  if (ownBrowser && ownBrowser.isConnected()) return ownBrowser;
  if (!ownBrowserPromise) {
    const puppeteer = require('puppeteer');
    ownBrowserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }).then(browser => {
      ownBrowser = browser;
      ownBrowserPromise = null;
      browser.on('disconnected', () => { ownBrowser = null; });
      return browser;
    }).catch(error => {
      ownBrowserPromise = null;
      throw error;
    });
  }
  return ownBrowserPromise;
}

/**
 * Render a birthday card to a PNG Buffer.
 *
 * @param {Object} options
 * @param {string} options.name      Teacher's name, drawn large on the card
 * @param {string} options.headline  Headline text (default "Happy Birthday!")
 * @param {string} options.message   Body text; {{...}} must already be resolved
 * @param {string} [options.footer]  Small uppercase line under the message
 * @param {string} [options.theme]   confetti | balloons | elegant
 * @param {Object} [options.browser] Puppeteer browser to reuse (client.pupBrowser)
 */
async function renderBirthdayCard(options = {}) {
  const browser = await getBrowser(options.browser);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: CARD_SIZE, height: CARD_SIZE, deviceScaleFactor: 1 });
    await page.setContent(buildCardHtml(options), { waitUntil: 'domcontentloaded' });
    // Fonts must be settled before measuring text, and the returned FontFaceSet
    // is not serializable — resolve to undefined instead.
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; }).catch(() => {});
    await page.evaluate(fitCardText);
    const shot = await page.screenshot({ type: 'png' });
    return Buffer.from(shot);
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (ownBrowser) {
    const browser = ownBrowser;
    ownBrowser = null;
    await browser.close().catch(() => {});
  }
}

module.exports = {
  CARD_SIZE,
  renderBirthdayCard,
  buildCardHtml,
  fitCardText,
  closeBrowser,
  themeList,
  resolveTheme,
  cardText,
  stripEmoji,
  stripWhatsAppMarkup,
  escapeHtml,
};
