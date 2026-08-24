/**
 * Read-only data endpoints backing the control panel: duty roster, group
 * lookup, number-registration check, birthdays, and birthday card
 * theme/preview.
 */
const express = require('express');
const router = express.Router();

const whatsappClient = require('../lib/whatsappClient');
const { config } = require('../lib/config');
const { readDutyRoster, readTeacherBirthdays } = require('../database');
const { findGroupsInStore } = require('../lib/chatLookup');
const { getISTNow } = require('../lib/time');
const { formatBirthdayMessage } = require('../lib/messageFormat');
const { renderBirthdayCard, themeList } = require('../birthdayCard');

/**
 * Get duties from the database for recipient selection
 */
router.get('/api/duties', async (req, res) => {
  try {
    const duties = await readDutyRoster();
    res.json(duties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List groups the bot's WhatsApp account can see, optionally filtered by a
 * case-insensitive substring match on the group name (?name=...).
 *
 * This reads the chat list directly from WhatsApp Web's in-memory Store
 * instead of using client.getChats(), which calls groupMetadata.update() for
 * every group and fails outright if even one group's metadata isn't synced
 * yet. Group names/IDs are already present on the cached chat objects, so no
 * network round-trip (and thus no such failure) is needed to look them up.
 */
router.get('/api/groups', async (req, res) => {
  if (!whatsappClient.isClientReady()) {
    return res.status(503).json({ error: 'WhatsApp client not ready yet' });
  }
  try {
    const groups = await findGroupsInStore(whatsappClient.getClient(), req.query.name);
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/check-number', async (req, res) => {
  if (!whatsappClient.isClientReady()) {
    return res.status(503).json({ error: 'WhatsApp client not ready yet' });
  }
  try {
    let phoneFormatted = (req.query.phone || '').replace(/\D/g, '');
    if (phoneFormatted.length === 10) phoneFormatted = '91' + phoneFormatted;
    const numberId = await whatsappClient.getClient().getNumberId(phoneFormatted);
    res.json({
      phone: phoneFormatted,
      registered: !!numberId,
      canonicalId: numberId?._serialized || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/birthdays', async (req, res) => {
  try {
    const now = getISTNow();
    const currentMonth = now.getMonth() + 1;
    const nextMonth = (currentMonth % 12) + 1;
    const birthdays = await readTeacherBirthdays([currentMonth, nextMonth]);
    res.json({ currentMonth, nextMonth, birthdays });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/birthday-card-themes', (req, res) => {
  res.json({ themes: themeList() });
});

/**
 * Preview the birthday card as a PNG.
 * GET /api/birthday-card-preview?type=personal|group&name=...&theme=...
 * Unsaved template/theme values may be passed as query params so the control
 * panel can preview edits before they are saved.
 */
router.get('/api/birthday-card-preview', async (req, res) => {
  try {
    const type = req.query.type === 'group' ? 'group' : 'personal';
    const teacher = { Teacher: (req.query.name || '').trim() || 'Teacher Name' };
    const template = req.query.message
      || (type === 'group' ? config.birthdayCardGroupMessageFormat : config.birthdayCardMessageFormat);

    const client = whatsappClient.getClient();
    const png = await renderBirthdayCard({
      name: teacher.Teacher,
      headline: formatBirthdayMessage(teacher, req.query.headline || config.birthdayCardHeadline),
      message: formatBirthdayMessage(teacher, template),
      footer: formatBirthdayMessage(teacher, req.query.footer !== undefined ? req.query.footer : config.birthdayCardFooter),
      theme: req.query.theme || config.birthdayCardTheme,
      browser: client && client.pupBrowser,
    });

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (error) {
    console.error('Birthday card preview failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
