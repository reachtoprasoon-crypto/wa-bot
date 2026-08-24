const assert = require('assert');
const {
  buildCardHtml, cardText, stripEmoji, stripWhatsAppMarkup, resolveTheme, themeList, CARD_SIZE
} = require('../birthdayCard');

// Emoji are dropped from card artwork (servers may lack a colour emoji font)
assert.strictEqual(stripEmoji('🎂 Happy Birthday, Priya! 🎉'), 'Happy Birthday, Priya!');
assert.strictEqual(stripEmoji('Hello ✨ world'), 'Hello world');

// WhatsApp markup is meaningless in an image
assert.strictEqual(stripWhatsAppMarkup('Happy Birthday, *Priya Sharma*!'), 'Happy Birthday, Priya Sharma!');
assert.strictEqual(stripWhatsAppMarkup('a _lovely_ day'), 'a lovely day');
assert.strictEqual(stripWhatsAppMarkup('2 * 3 = 6'), '2 * 3 = 6');

assert.strictEqual(cardText('🎂 *Happy Birthday, Priya!* 🎉'), 'Happy Birthday, Priya!');

// Unknown themes fall back instead of throwing
assert.strictEqual(resolveTheme('nope'), resolveTheme('confetti'));
assert.ok(themeList().some(t => t.key === 'elegant'));

const html = buildCardHtml({
  name: 'Priya <script>alert(1)</script>',
  headline: 'Happy Birthday!',
  message: 'Line one\n\nLine two',
  footer: '23 August 2026',
  theme: 'balloons',
});
assert.ok(!html.includes('<script>alert(1)</script>'), 'name must be HTML-escaped');
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(html.includes('<p>Line one</p><p>Line two</p>'), 'blank lines become paragraphs');
assert.ok(html.includes(`width: ${CARD_SIZE}px`));

// Same input renders the same decoration layout every time
assert.strictEqual(buildCardHtml({ name: 'Priya', theme: 'confetti' }), buildCardHtml({ name: 'Priya', theme: 'confetti' }));

// Missing fields still produce a usable card
const fallback = buildCardHtml({});
assert.ok(fallback.includes('Happy Birthday!') && fallback.includes('Teacher'));

console.log('birthdayCard tests passed');
