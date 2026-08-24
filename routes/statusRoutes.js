/**
 * Bot status endpoint for the control panel.
 */
const express = require('express');
const router = express.Router();

const whatsappClient = require('../lib/whatsappClient');
const { config } = require('../lib/config');
const { getISTTime, getNextSendDate } = require('../lib/time');

router.get('/api/status', (req, res) => {
  const ready = whatsappClient.isClientReady();
  res.json({
    ready,
    uptime: process.uptime(),
    config: {
      sendTime: config.sendTime,
      groupName: config.groupName,
      groupId: config.groupId,
      birthdayEnabled: config.birthdayEnabled,
      birthdayTime: config.birthdayTime,
    },
    nextSend: ready ? getNextSendDate(config.sendTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
    nextBirthday: (ready && config.birthdayEnabled) ? getNextSendDate(config.birthdayTime || '06:00').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
    istTime: getISTTime(),
  });
});

module.exports = router;
