/**
 * Sends the nightly duty-roster message to the group, plus a personal
 * reminder to each teacher on tomorrow's roster.
 */
const { readDutyRoster } = require('../database');
const whatsappClient = require('./whatsappClient');
const { config } = require('./config');
const { formatDutyMessage, formatPersonalMessage } = require('./messageFormat');
const { resolveChatId } = require('./chatLookup');
const { getISTTime, getTomorrowDateIST } = require('./time');

/**
 * Send personal messages to all teachers
 */
async function sendPersonalMessages(duties) {
  const client = whatsappClient.getClient();
  let successCount = 0;
  let failureCount = 0;

  for (const duty of duties) {
    try {
      const phone = duty.Phone?.trim();
      const teacherName = duty.Teacher || duty.name || 'N/A';

      if (!phone) {
        console.log(`⚠️  Skipping ${teacherName} - no phone number found`);
        failureCount++;
        continue;
      }

      // Format phone number for WhatsApp - ensure country code is present
      let phoneFormatted = phone.replace(/\D/g, ''); // Remove non-digits

      // If phone number is 10 digits (Indian without country code), add country code 91
      if (phoneFormatted.length === 10) {
        phoneFormatted = '91' + phoneFormatted;
        console.log(`⚠️  Phone number for ${teacherName} was missing country code, added it: ${phoneFormatted}`);
      } else if (!phoneFormatted.startsWith('91') && phoneFormatted.length === 12) {
        // If it's 12 digits but doesn't start with 91, it might be in wrong format
        console.log(`⚠️  Phone number for ${teacherName} doesn't start with 91: ${phoneFormatted}`);
      }

      const chatId = await resolveChatId(client, phoneFormatted);

      const personalMessage = formatPersonalMessage(duty, duty.Duty, config);
      console.log(`Sending personal message to ${teacherName} (${phoneFormatted})`);

      // Send personal message
      const result = await client.sendMessage(chatId, personalMessage);
      const messageId = result?.id?._serialized || result?.id?.id || result?.id || 'N/A';
      console.log(`✓ Personal message sent to ${teacherName}`);
      console.log(`  Message ID: ${messageId}`);
      successCount++;

      // Add small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      const teacherName = duty.Teacher || duty.name || 'N/A';
      console.error(`✗ Failed to send message to ${teacherName}: ${error.message}`);
      console.error(`  Error details:`, error);
      failureCount++;
    }
  }

  console.log(`\n📊 Personal Messages Summary:`);
  console.log(`✓ Sent: ${successCount}`);
  console.log(`✗ Failed: ${failureCount}`);
  return { successCount, failureCount };
}

/**
 * Send duty message to the group
 */
async function sendDutyMessage() {
  if (!whatsappClient.isClientReady()) {
    console.error(`[${getISTTime()}] Cannot send duty message - client not ready`);
    return;
  }
  const client = whatsappClient.getClient();
  try {
    console.log(`[${getISTTime()}] Attempting to send message to group: "${config.groupName}"`);

    const duties = await readDutyRoster();
    console.log(`Read ${duties.length} duties from database`);

    // Calculate tomorrow's date in DD-MM-YYYY format (IST timezone)
    const tomorrowStr = getTomorrowDateIST();

    // Filter duties for tomorrow
    const tomorrowDuties = duties.filter(duty => duty.Duty === tomorrowStr);
    console.log(`Filtered ${tomorrowDuties.length} duties for tomorrow (${tomorrowStr})`);

    const message = formatDutyMessage(tomorrowDuties, config);
    console.log('Message to send:');
    console.log(message);
    console.log('---');

    let targetChat;
    let targetChatId = (config.groupId || '').trim();

    // When a group ID is configured, send directly to it and stop there — do
    // not fall through to the name-based getChats() lookup. In testing,
    // whatsapp-web.js's confirmation step for group sends has proven
    // unreliable (it can return no result, or throw) even when the message
    // was actually dispatched and delivered, so neither outcome here is
    // treated as a real failure; both proceed to the personal messages.
    if (targetChatId) {
      console.log(`Sending directly to configured group ID: ${targetChatId}`);
      let result;
      let confirmed = true;
      try {
        result = await client.sendMessage(targetChatId, message);
        confirmed = !!result;
      } catch (directSendError) {
        confirmed = false;
        console.error(`Direct send didn't return a confirmation (message was likely still delivered):`, directSendError.message);
      }
      if (confirmed) {
        const messageId = result?.id?._serialized || result?.id?.id || 'N/A';
        console.log(`✓ Group message sent successfully at ${getISTTime()}!`);
        console.log(`Message ID: ${messageId}`);
      } else {
        console.log(`Group message dispatched at ${getISTTime()} — no confirmation returned, please verify manually.`);
      }
      console.log(`Message sent to chat ID: ${targetChatId}`);

      // Send personal messages to teachers with duties
      console.log('\n📤 Sending personal messages to teachers...');
      await sendPersonalMessages(tomorrowDuties);
      return;
    }

    if (!targetChat) {
      console.log(`Looking up group by name: ${config.groupName}`);
      try {
        const chats = await client.getChats();
        console.log(`Total chats available: ${chats.length}`);
        const groups = chats.filter(c => c.isGroup || c.name);
        console.log('Available groups:', groups.map(c => ({ name: c.name, id: c.id._serialized })));
        targetChat = chats.find(chat => chat.name === config.groupName);
      } catch (chatsError) {
        console.error(`Could not load chat list for fallback lookup:`, chatsError.message);
      }
    }

    if (targetChat) {
      console.log(`Found group: ${targetChat.name} (ID: ${targetChat.id._serialized})`);
      console.log(`Group is active: ${targetChat.isGroup}`);
      console.log(`Chat object:`, {
        name: targetChat.name,
        id: targetChat.id._serialized,
        isGroup: targetChat.isGroup,
        participantsCount: targetChat.participants?.length || 'N/A',
        lastMessage: targetChat.lastMessage?.body || 'No messages'
      });

      const result = await client.sendMessage(targetChat.id._serialized, message);
      const messageId = result?.id?._serialized || result?.id?.id || result?.id || 'N/A';
      console.log(`✓ Group message sent successfully at ${getISTTime()}!`);
      console.log(`Message ID: ${messageId}`);
      console.log(`Message sent to chat ID: ${targetChat.id._serialized}`);

      // Send personal messages to teachers with duties
      console.log('\n📤 Sending personal messages to teachers...');
      await sendPersonalMessages(tomorrowDuties);
    } else {
      console.error(`Group "${config.groupName}" not found.`);
      console.error('Available chats:', []);
    }
  } catch (error) {
    console.error('Error sending message:', error.message);
    console.error('Full error:', error);
    if (error.message && (error.message.includes('detached Frame') || error.message.includes('Session closed') || error.message.includes('Target closed'))) {
      console.error(`[${getISTTime()}] Puppeteer session lost. Triggering reconnect...`);
      whatsappClient.handleSessionLoss();
    }
  }
}

module.exports = { sendDutyMessage, sendPersonalMessages };
