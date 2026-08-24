/**
 * Renders a teacher's birthday wish as a PNG card and sends it (falling back
 * to plain text if rendering or sending the image fails).
 */
const { MessageMedia } = require('whatsapp-web.js');
const { renderBirthdayCard } = require('../birthdayCard');
const { formatBirthdayMessage } = require('./messageFormat');
const { getISTTime } = require('./time');

/**
 * Render the birthday wish as a PNG card and wrap it as WhatsApp media.
 */
async function buildBirthdayCard(teacher, cardTemplate, config, client) {
  const fullName = teacher.Teacher || teacher.name || 'Teacher';
  const png = await renderBirthdayCard({
    name: fullName,
    headline: formatBirthdayMessage(teacher, config.birthdayCardHeadline),
    message: formatBirthdayMessage(teacher, cardTemplate),
    footer: formatBirthdayMessage(teacher, config.birthdayCardFooter),
    theme: config.birthdayCardTheme,
    browser: client && client.pupBrowser,
  });
  const fileName = `birthday-${fullName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  return new MessageMedia('image/png', png.toString('base64'), fileName);
}

/**
 * Send one birthday wish as an image card, falling back to plain text if the
 * card cannot be rendered or sent.
 */
async function sendBirthdayWish(client, chatId, teacher, textTemplate, cardTemplate, config) {
  const text = formatBirthdayMessage(teacher, textTemplate);

  if (config.birthdayImageEnabled === false) {
    return client.sendMessage(chatId, text);
  }

  try {
    const media = await buildBirthdayCard(teacher, cardTemplate || textTemplate, config, client);
    const options = config.birthdayCaptionEnabled === false ? {} : { caption: text };
    return await client.sendMessage(chatId, media, options);
  } catch (error) {
    console.error(`[${getISTTime()}] Birthday card failed, sending text instead:`, error.message);
    return client.sendMessage(chatId, text);
  }
}

module.exports = { buildBirthdayCard, sendBirthdayWish };
