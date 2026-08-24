/**
 * Config page and config CRUD endpoints.
 */
const express = require('express');
const path = require('path');
const router = express.Router();

const { config, saveConfig } = require('../lib/config');
const scheduler = require('../lib/scheduler');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

router.post('/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat } = req.body;

  // Validate time format (00:00 through 23:59)
  if (!TIME_RE.test(sendTime)) {
    return res.status(400).send('Invalid time format. Use HH:MM between 00:00 and 23:59');
  }

  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  if (personalMessageFormat !== undefined) {
    config.personalMessageFormat = personalMessageFormat;
  }

  saveConfig(config);
  scheduler.rescheduleDailyMessage();

  res.redirect('/');
});

/**
 * Get current config (including personalMessageFormat)
 */
router.get('/api/config', (req, res) => {
  res.json(config);
});

/**
 * Update configuration
 */
router.post('/api/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat,
    birthdayEnabled, birthdayTime, birthdayMessageFormat, birthdayGroupMessageFormat,
    birthdayImageEnabled, birthdayCaptionEnabled, birthdayCardTheme, birthdayCardHeadline,
    birthdayCardFooter, birthdayCardMessageFormat, birthdayCardGroupMessageFormat } = req.body;

  if (!TIME_RE.test(sendTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM between 00:00 and 23:59' });
  }
  if (!TIME_RE.test(birthdayTime)) {
    return res.status(400).json({ error: 'Invalid birthday time format. Use HH:MM between 00:00 and 23:59' });
  }

  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  if (personalMessageFormat !== undefined) {
    config.personalMessageFormat = personalMessageFormat;
  }
  config.birthdayEnabled = birthdayEnabled !== false;
  config.birthdayTime = birthdayTime;
  config.birthdayMessageFormat = birthdayMessageFormat || config.birthdayMessageFormat;
  config.birthdayGroupMessageFormat = birthdayGroupMessageFormat || config.birthdayGroupMessageFormat;

  if (birthdayImageEnabled !== undefined) config.birthdayImageEnabled = birthdayImageEnabled !== false;
  if (birthdayCaptionEnabled !== undefined) config.birthdayCaptionEnabled = birthdayCaptionEnabled !== false;
  if (birthdayCardTheme) config.birthdayCardTheme = birthdayCardTheme;
  if (birthdayCardHeadline !== undefined) config.birthdayCardHeadline = birthdayCardHeadline;
  if (birthdayCardFooter !== undefined) config.birthdayCardFooter = birthdayCardFooter;
  config.birthdayCardMessageFormat = birthdayCardMessageFormat || config.birthdayCardMessageFormat;
  config.birthdayCardGroupMessageFormat = birthdayCardGroupMessageFormat || config.birthdayCardGroupMessageFormat;

  saveConfig(config);
  scheduler.rescheduleDailyMessage();

  res.json({ success: true, config });
});

module.exports = router;
