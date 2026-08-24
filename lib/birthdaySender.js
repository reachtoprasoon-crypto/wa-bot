/**
 * Finds today's birthdays and sends group + personal birthday wishes.
 */
const { readTeacherBirthdays } = require('../database');
const whatsappClient = require('./whatsappClient');
const { config } = require('./config');
const { findGroupsInStore, resolveChatId } = require('./chatLookup');
const { sendBirthdayWish } = require('./birthdayCardSender');
const { getISTTime, getISTNow } = require('./time');

async function sendBirthdayMessages() {
  if (!whatsappClient.isClientReady()) {
    console.error(`[${getISTTime()}] Cannot send birthday messages - client not ready`);
    return { sent: 0, failed: 0 };
  }
  const client = whatsappClient.getClient();

  const today = getISTNow();
  const month = today.getMonth() + 1;
  const monthDay = `${String(month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const teachers = await readTeacherBirthdays([month]);
  const birthdays = teachers.filter(teacher => (teacher.DOB || '').slice(5) === monthDay);

  console.log(`[${getISTTime()}] Found ${birthdays.length} birthdays for ${monthDay}`);
  if (birthdays.length === 0) return { sent: 0, failed: 0 };

  // Prefer the configured group ID directly, without verifying it first via
  // getChatById/getChats — both call groupMetadata.update() and fail outright
  // if that group's metadata hasn't synced, even though sending to the ID
  // works fine regardless. Only fall back to a name-based lookup (via the
  // in-memory Store, not client.getChats()) when no ID is configured.
  let groupChatId = (config.groupId || '').trim();
  if (!groupChatId) {
    try {
      const matches = await findGroupsInStore(client, config.groupName);
      const exact = matches.find(g => g.name === config.groupName);
      groupChatId = (exact || matches[0])?.id;
    } catch (error) {
      console.error(`Could not look up birthday group by name:`, error.message);
    }
  }
  if (!groupChatId) throw new Error(`Group ${config.groupName} not found`);

  let sent = 0;
  let failed = 0;
  for (const teacher of birthdays) {
    const fullName = teacher.Teacher || teacher.name || 'Teacher';
    try {
      await sendBirthdayWish(
        client,
        groupChatId,
        teacher,
        config.birthdayGroupMessageFormat,
        config.birthdayCardGroupMessageFormat,
        config
      );
      if (!teacher.Phone) throw new Error('No phone number found');
      await sendBirthdayWish(
        client,
        await resolveChatId(client, teacher.Phone),
        teacher,
        config.birthdayMessageFormat,
        config.birthdayCardMessageFormat,
        config
      );
      sent++;
      console.log(`Birthday messages sent for ${fullName}`);
    } catch (error) {
      failed++;
      console.error(`Failed birthday messages for ${fullName}:`, error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return { sent, failed };
}

module.exports = { sendBirthdayMessages };
