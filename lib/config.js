/**
 * Config file loading/saving, plus the live in-memory config singleton the
 * rest of the app reads and mutates directly.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// Defaults for the birthday image card (message rendered as a graphic)
const BIRTHDAY_CARD_DEFAULTS = {
  birthdayImageEnabled: true,
  birthdayCaptionEnabled: true,
  birthdayCardTheme: 'confetti',
  birthdayCardHeadline: 'Happy Birthday!',
  birthdayCardFooter: '{{date}}',
  birthdayCardMessageFormat: 'Wishing you a wonderful day filled with happiness and success.\n\nWith warm wishes from everyone at school.',
  birthdayCardGroupMessageFormat: 'Please join us in wishing {{fullName}} a very happy birthday.\n\nMay the year ahead bring joy and success.',
};

function readConfigFile() {
  try {
    const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.log('Config file not found, using defaults');
    return {
      sendTime: process.env.SEND_TIME || '18:00',
      groupName: process.env.GROUP_NAME || 'VSEC AVADH OFFICIAL',
      groupId: process.env.GROUP_ID || '',
      messageFormat: "📋 *Tomorrow's Morning Duty* 📋\n\n{{duties}}\n\n---\n⏰ Sent at {{time}}",
      birthdayEnabled: true,
      birthdayTime: process.env.BIRTHDAY_TIME || '06:00',
      birthdayMessageFormat: "🎂 Happy Birthday, {{fullName}}! 🎉\n\nWishing you a wonderful day filled with happiness and success.\n\nBest wishes from everyone at school!",
      birthdayGroupMessageFormat: "🎂 *Happy Birthday, {{fullName}}!* 🎉\n\nPlease join us in wishing {{fullName}} a very happy birthday. May your day be filled with happiness and success!"
    };
  }
}

function applyDefaults(cfg) {
  cfg.birthdayEnabled = cfg.birthdayEnabled !== false;
  cfg.birthdayTime = cfg.birthdayTime || '06:00';
  cfg.birthdayMessageFormat = cfg.birthdayMessageFormat || '🎂 Happy Birthday, {{fullName}}! 🎉\n\nWishing you a wonderful day filled with happiness and success.\n\nBest wishes from everyone at school!';
  cfg.birthdayGroupMessageFormat = cfg.birthdayGroupMessageFormat || '🎂 *Happy Birthday, {{fullName}}!* 🎉\n\nPlease join us in wishing {{fullName}} a very happy birthday. May your day be filled with happiness and success!';
  cfg.birthdayImageEnabled = cfg.birthdayImageEnabled !== false;
  cfg.birthdayCaptionEnabled = cfg.birthdayCaptionEnabled !== false;
  cfg.birthdayCardTheme = cfg.birthdayCardTheme || BIRTHDAY_CARD_DEFAULTS.birthdayCardTheme;
  cfg.birthdayCardHeadline = cfg.birthdayCardHeadline || BIRTHDAY_CARD_DEFAULTS.birthdayCardHeadline;
  cfg.birthdayCardFooter = cfg.birthdayCardFooter === undefined ? BIRTHDAY_CARD_DEFAULTS.birthdayCardFooter : cfg.birthdayCardFooter;
  cfg.birthdayCardMessageFormat = cfg.birthdayCardMessageFormat || BIRTHDAY_CARD_DEFAULTS.birthdayCardMessageFormat;
  cfg.birthdayCardGroupMessageFormat = cfg.birthdayCardGroupMessageFormat || BIRTHDAY_CARD_DEFAULTS.birthdayCardGroupMessageFormat;
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Live singleton: other modules mutate this object's properties directly and
// call saveConfig(config) to persist, mirroring the app's single-bot,
// single-config design.
const config = applyDefaults(readConfigFile());

module.exports = { config, saveConfig, BIRTHDAY_CARD_DEFAULTS, CONFIG_FILE };
