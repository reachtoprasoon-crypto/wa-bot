const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const { readDutyRoster } = require('./database');
const { config } = require('./lib/config');
const { getTomorrowDateIST } = require('./lib/time');
const { formatDutyMessage, formatPersonalMessage } = require('./lib/messageFormat');
const { resolveChatId } = require('./lib/chatLookup');

// Try to send via API first (if server is running)
async function trySendViaAPI() {
  try {
    console.log('Trying to send via server API...');
    const response = await fetch('http://localhost:3000/send-duty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (response.ok) {
      console.log('✓ Message sent successfully via API!');
      console.log(data);
      return true;
    } else {
      console.log('API call failed:', data.error);
      return false;
    }
  } catch (error) {
    console.log('Server not running or API failed:', error.message);
    return false;
  }
}

/**
 * Send personal messages to all teachers
 */
async function sendPersonalMessages(client, duties) {
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

      const chatId = await resolveChatId(client, phone);

      const personalMessage = formatPersonalMessage(duty, duty.Duty, config);
      console.log(`Sending personal message to ${teacherName} (${phone})`);

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
async function sendDutyMessage(client) {
  try {
    console.log(`Attempting to send message to group: "${config.groupName}"`);

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

    if (targetChatId) {
      console.log(`Sending directly to configured group ID: ${targetChatId}`);
      try {
        const result = await client.sendMessage(targetChatId, message);
        const messageId = result?.id?._serialized || result?.id?.id || result?.id || 'N/A';
        console.log(`✓ Group message sent successfully!`);
        console.log(`Message ID: ${messageId}`);
        console.log(`Message sent to chat ID: ${targetChatId}`);

        // Send personal messages to teachers with duties
        console.log('\n📤 Sending personal messages to teachers...');
        await sendPersonalMessages(client, tomorrowDuties);
        return;
      } catch (directSendError) {
        console.error(`Direct send to configured group ID failed:`, directSendError.message);
      }
    }

    if (!targetChat) {
      console.log(`Looking up group by name: ${config.groupName}`);
      try {
        const chats = await client.getChats();
        console.log(`Total chats available: ${chats.length}`);
        console.log('All available chats:');
        chats.forEach((chat, index) => {
          console.log(`${index + 1}. Name: "${chat.name}", ID: ${chat.id._serialized}, Is Group: ${chat.isGroup}`);
        });
        console.log('---');

        const groups = chats.filter(c => c.isGroup);
        console.log(`Available groups (${groups.length}):`);
        groups.forEach((group, index) => {
          console.log(`${index + 1}. Name: "${group.name}", ID: ${group.id._serialized}`);
        });
        console.log('---');

        targetChat = chats.find(chat => chat.name === config.groupName);
      } catch (chatsError) {
        console.error(`Could not load chat list for fallback lookup:`, chatsError.message);
      }
    }

    if (targetChat) {
      console.log(`Found group: ${targetChat.name} (ID: ${targetChat.id._serialized})`);
      console.log(`Chat object:`, {
        name: targetChat.name,
        id: targetChat.id._serialized,
        isGroup: targetChat.isGroup,
        participantsCount: targetChat.participants?.length || 'N/A',
        lastMessage: targetChat.lastMessage?.body || 'No messages'
      });

      const result = await client.sendMessage(targetChat.id._serialized, message);
      const messageId = result?.id?._serialized || result?.id?.id || result?.id || 'N/A';
      console.log(`✓ Group message sent successfully!`);
      console.log(`Message ID: ${messageId}`);
      console.log(`Message sent to chat ID: ${targetChat.id._serialized}`);

      // Send personal messages to teachers with duties
      console.log('\n📤 Sending personal messages to teachers...');
      await sendPersonalMessages(client, tomorrowDuties);
    } else {
      console.error(`Group "${config.groupName}" not found.`);
      console.error('Available chats:', []);
    }
  } catch (error) {
    console.error('Error sending message:', error.message);
    console.error('Full error:', error);
  }
}

// Main execution
async function main() {
  // Try to send via API first
  const apiSuccess = await trySendViaAPI();
  if (apiSuccess) {
    process.exit(0);
  }

  // Fallback to direct client
  console.log('Falling back to direct client...');
  const client = new Client({
    authStrategy: new LocalAuth()
  });

  let clientReady = false;
  let messagesSent = false;

  client.on('qr', (qr) => {
    console.log('QR RECEIVED, scan this with WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    console.log('Client is ready!');
    console.log(`Bot authenticated and connected to WhatsApp.`);
    clientReady = true;

    // Try to get the authenticated user info
    client.getState().then(state => {
      console.log(`WhatsApp client state: ${state}`);
    }).catch(err => {
      console.log('Could not get state:', err.message);
    });

    // Wait a bit for chats to load
    console.log('Waiting 5 seconds for chats to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      await sendDutyMessage(client);
      messagesSent = true;
    } catch (error) {
      console.error('Error sending duty message:', error);
    }

    await client.destroy();
    process.exit(0);
  });

  client.on('authenticated', () => {
    console.log('Client authenticated!');
  });

  client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    process.exit(1);
  });

  client.on('disconnected', (reason) => {
    console.log('Client was logged out:', reason);
    process.exit(1);
  });

  client.initialize();

  // Set a timeout to ensure script doesn't hang indefinitely
  setTimeout(() => {
    if (!clientReady) {
      console.error('❌ Timeout: Client failed to initialize within 60 seconds');
      console.error('This usually means:');
      console.error('  1. The authentication session has expired');
      console.error('  2. WhatsApp Web is not accessible');
      console.error('  3. The device is blocked by WhatsApp');
      console.error('\nTry running "npm start" first to set up a fresh authentication');
      client.destroy().catch(() => {});
      process.exit(1);
    }
  }, 60000); // 60 second timeout
}

main();
