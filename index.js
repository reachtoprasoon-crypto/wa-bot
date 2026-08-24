const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');
require('dotenv').config();

const { readDutyRoster, readTeacherBirthdays } = require('./database');
const { renderBirthdayCard, themeList } = require('./birthdayCard');
const CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * Get current time in IST (Indian Standard Time)
 */
function getISTTime() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Get current time in IST as HH:MM:SS format
 */
function getISTTimeString() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Get tomorrow's date in IST (DD-MM-YYYY format)
 */
function getTomorrowDateIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(istNow.getDate() + 1);
  
  return `${String(istNow.getDate()).padStart(2, '0')}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${istNow.getFullYear()}`;
}

// Load configuration
function loadConfig() {
  try {
    const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.log('Config file not found, using defaults');
    return {
      sendTime: process.env.SEND_TIME || '18:00',
      groupName: process.env.GROUP_NAME || 'VSEC AVADH OFFICIAL',      groupId: process.env.GROUP_ID || '',      messageFormat: "📋 *Tomorrow's Morning Duty* 📋\n\n{{duties}}\n\n---\n⏰ Sent at {{time}}",
      birthdayEnabled: true,
      birthdayTime: process.env.BIRTHDAY_TIME || '06:00',
      birthdayMessageFormat: "🎂 Happy Birthday, {{fullName}}! 🎉\n\nWishing you a wonderful day filled with happiness and success.\n\nBest wishes from everyone at school!",
      birthdayGroupMessageFormat: "🎂 *Happy Birthday, {{fullName}}!* 🎉\n\nPlease join us in wishing {{fullName}} a very happy birthday. May your day be filled with happiness and success!"
    };
  }
}

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

// Save configuration
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();
config.birthdayEnabled = config.birthdayEnabled !== false;
config.birthdayTime = config.birthdayTime || '06:00';
config.birthdayMessageFormat = config.birthdayMessageFormat || '🎂 Happy Birthday, {{fullName}}! 🎉\n\nWishing you a wonderful day filled with happiness and success.\n\nBest wishes from everyone at school!';
config.birthdayGroupMessageFormat = config.birthdayGroupMessageFormat || '🎂 *Happy Birthday, {{fullName}}!* 🎉\n\nPlease join us in wishing {{fullName}} a very happy birthday. May your day be filled with happiness and success!';
config.birthdayImageEnabled = config.birthdayImageEnabled !== false;
config.birthdayCaptionEnabled = config.birthdayCaptionEnabled !== false;
config.birthdayCardTheme = config.birthdayCardTheme || BIRTHDAY_CARD_DEFAULTS.birthdayCardTheme;
config.birthdayCardHeadline = config.birthdayCardHeadline || BIRTHDAY_CARD_DEFAULTS.birthdayCardHeadline;
config.birthdayCardFooter = config.birthdayCardFooter === undefined ? BIRTHDAY_CARD_DEFAULTS.birthdayCardFooter : config.birthdayCardFooter;
config.birthdayCardMessageFormat = config.birthdayCardMessageFormat || BIRTHDAY_CARD_DEFAULTS.birthdayCardMessageFormat;
config.birthdayCardGroupMessageFormat = config.birthdayCardGroupMessageFormat || BIRTHDAY_CARD_DEFAULTS.birthdayCardGroupMessageFormat;
let scheduleTimeout = null;
let birthdayScheduleTimeout = null;
let isClientReady = false;
let isReconnecting = false;

function createClientOptions() {
  return {
    authStrategy: new LocalAuth(),
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    puppeteer: {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-resources',
        '--disable-component-update',
      ],
      timeout: 60000,
    },
  };
}

let client = new Client(createClientOptions());

// Express app for configuration interface
const app = express();
const PORT = process.env.PORT || 3000;

function startHttpServer() {
  app.listen(PORT, () => {
    console.log(`Configuration interface available at http://localhost:${PORT}`);
  });
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Initialize WhatsApp client with error handling and retry logic
async function initializeClient(retryCount = 0, maxRetries = 3) {
  try {
    console.log(`[${getISTTime()}] Initializing WhatsApp client (attempt ${retryCount + 1}/${maxRetries + 1})...`);
    await client.initialize();
    console.log(`[${getISTTime()}] Client initialization successful!`);
  } catch (error) {
    console.error(`[${getISTTime()}] Client initialization failed:`, error.message);
    console.error('Error stack:', error.stack);
    
    // Cleanup current client instance
    try {
      console.log(`[${getISTTime()}] Cleaning up failed client instance...`);
      await client.destroy();
    } catch (destroyError) {
      console.warn(`[${getISTTime()}] Warning during cleanup:`, destroyError.message);
    }
    
    if (retryCount < maxRetries) {
      const delayMs = (retryCount + 1) * 5000; // 5s, 10s, 15s delays
      console.log(`[${getISTTime()}] Retrying in ${delayMs/1000}s...`);

      client = new Client(createClientOptions());
      attachClientListeners();
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return initializeClient(retryCount + 1, maxRetries);
    } else {
      console.error(`[${getISTTime()}] Failed to initialize after ${maxRetries + 1} attempts. Exiting.`);
      process.exit(1);
    }
  }
}

// Attach event listeners to client
function attachClientListeners() {
  client.on('qr', (qr) => {
    console.log('QR RECEIVED, scan this with WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    isClientReady = true;
    console.log('Client is ready!');
    console.log(`Bot authenticated and connected to WhatsApp.`);
    console.log(`Scheduling message send at ${config.sendTime} for group: ${config.groupName}`);
    console.log('---');
    
    // Try to get the authenticated user info
    client.getState().then(state => {
      console.log(`WhatsApp client state: ${state}`);
    }).catch(err => {
      console.log('Could not get state:', err.message);
    });
    
    scheduleDailyMessage();
    scheduleBirthdayMessage();
  });

  client.on('authenticated', () => {
    console.log('Client authenticated!');
  });

  client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
  });

  client.on('disconnected', async (reason) => {
    console.log(`[${getISTTime()}] Client disconnected: ${reason}. Scheduling reconnect...`);
    isClientReady = false;
    clearDailySchedule();
    clearBirthdaySchedule();
    await reconnect();
  });

  client.on('error', (error) => {
    console.error('Client error:', error.message);
    console.error('Error details:', error);
  });

  // Logs the chat ID for any group message received, so a group's ID can be
  // captured (e.g. by sending a message in it from the phone) without relying
  // on client.getChats(), which can fail for a group whose metadata hasn't
  // fully synced yet (such as one just created).
  client.on('message', (msg) => {
    if (msg.from && msg.from.endsWith('@g.us')) {
      console.log(`[${getISTTime()}] Message received in group ${msg.from} (from ${msg._data?.notifyName || msg.author || 'unknown'})`);
    }
  });
}

async function reconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log(`[${getISTTime()}] Reconnecting WhatsApp client...`);
  try {
    await client.destroy();
  } catch (err) {
    console.warn(`[${getISTTime()}] Warning during destroy:`, err.message);
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
  client = new Client(createClientOptions());
  attachClientListeners();
  isReconnecting = false;
  await initializeClient();
}

// Start the web interface immediately, then initialize the client in the background.
startHttpServer();
attachClientListeners();
initializeClient();

/**
 * Read duty roster from the database
 */
/**
 * Format duty message for WhatsApp
 */
function formatDutyMessage(duties) {
  let dutiesText = '';
  if (duties.length === 0) {
    dutiesText = 'No duties assigned for tomorrow.';
  } else {
    duties.forEach((duty, index) => {
      const teacher = duty.Teacher || duty.name || 'N/A';
      dutiesText += `${index + 1}. ${teacher}\n`;
    });
  }
  
  let message = config.messageFormat
    .replace('{{duties}}', dutiesText.trim())
    .replace('{{time}}', getISTTimeString());
  
  return message;
}

/**
 * Format personal message for a teacher using config template
 */
function formatPersonalMessage(teacher, dutyDate, customData = {}) {
   let fullName = teacher.Teacher || teacher.name || 'Teacher';
   const parts = fullName.split(' ');
   let teacherName = parts[0];
   const titles = ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'];
   if (titles.includes(teacherName)) {
     teacherName = parts[1] || parts[0];
   }

   let message = config.personalMessageFormat || `👋 Hi {{fullName}},\n\nYou have been assigned morning duty tomorrow, that is on {{dutyDate}}.\n\nPlease ensure you are available at 6:45 AM.\n\n📋 School morning duty notification\n⏰ Sent at {{time}}\n\nIts a computer generated message, no need to reply.`;

   // Replace all template variables
   message = message
     .replace(/\{\{fullName\}\}/g, fullName)
     .replace(/\{\{teacherName\}\}/g, teacherName)
     .replace(/\{\{dutyDate\}\}/g, dutyDate)
     .replace(/\{\{time\}\}/g, getISTTimeString())
     .replace(/\{\{duties\}\}/g, customData.duties || '');

  // Allow any custom data to be injected
  Object.entries(customData).forEach(([key, value]) => {
    message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  });

  return message;
}

function formatBirthdayMessage(teacher, template) {
  const fullName = teacher.Teacher || teacher.name || 'Teacher';
  const teacherName = fullName.split(' ')[0];
  return (template || '')
    .replace(/\{\{fullName\}\}/gi, fullName)
    .replace(/\{\{teacherName\}\}/gi, teacherName)
    .replace(/\{\{time\}\}/gi, getISTTimeString())
    .replace(/\{\{date\}\}/gi, getISTDateText());
}

/**
 * Today's date in IST, spelled out (e.g. "23 August 2026")
 */
function getISTDateText() {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric'
  });
}

/**
 * Render the birthday wish as a PNG card and wrap it as WhatsApp media.
 */
async function buildBirthdayCard(teacher, cardTemplate) {
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
async function sendBirthdayWish(chatId, teacher, textTemplate, cardTemplate) {
  const text = formatBirthdayMessage(teacher, textTemplate);

  if (config.birthdayImageEnabled === false) {
    return client.sendMessage(chatId, text);
  }

  try {
    const media = await buildBirthdayCard(teacher, cardTemplate || textTemplate);
    const options = config.birthdayCaptionEnabled === false ? {} : { caption: text };
    return await client.sendMessage(chatId, media, options);
  } catch (error) {
    console.error(`[${getISTTime()}] Birthday card failed, sending text instead:`, error.message);
    return client.sendMessage(chatId, text);
  }
}

/**
 * Looks up group chats directly from WhatsApp Web's in-memory Store, instead
 * of client.getChats() — which calls groupMetadata.update() for every group
 * and fails outright if even one group's metadata hasn't synced yet. This
 * reads names/IDs already cached on the chat objects, so no network
 * round-trip (and thus no such failure) is needed.
 * @param {string} [query] Case-insensitive substring to filter names by.
 * @returns {Promise<Array<{name: string, id: string}>>}
 */
async function findGroupsInStore(query) {
  const q = (query || '').trim().toLowerCase();
  return client.pupPage.evaluate((q) => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return chats
      .filter((chat) => !!chat.groupMetadata)
      .map((chat) => ({
        name: chat.formattedTitle || chat.name || '',
        id: chat.id._serialized,
      }))
      .filter((g) => !q || g.name.toLowerCase().includes(q));
  }, q);
}

/**
 * Resolve a phone number to WhatsApp's canonical chat ID via getNumberId,
 * rather than guessing `${phone}@c.us`. WhatsApp has been migrating some
 * accounts to privacy-preserving `@lid` addressing; a message sent to a
 * hand-built `@c.us` ID for one of those accounts can appear to succeed
 * (the send promise resolves without throwing) while never actually being
 * delivered, since it's the wrong identity for that contact.
 */
async function resolveChatId(phone) {
  let phoneFormatted = (phone || '').replace(/\D/g, '');
  if (phoneFormatted.length === 10) {
    phoneFormatted = `91${phoneFormatted}`;
  }
  const numberId = await client.getNumberId(phoneFormatted);
  if (!numberId) {
    throw new Error(`${phoneFormatted} is not registered on WhatsApp`);
  }
  return numberId._serialized;
}

/**
 * Send personal messages to all teachers
 */
async function sendPersonalMessages(duties) {
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

      const chatId = await resolveChatId(phoneFormatted);

      const personalMessage = formatPersonalMessage(duty, duty.Duty);
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
  if (!isClientReady) {
    console.error(`[${getISTTime()}] Cannot send duty message - client not ready`);
    return;
  }
  try {
    console.log(`[${getISTTime()}] Attempting to send message to group: "${config.groupName}"`);
    
    const duties = await readDutyRoster();
    console.log(`Read ${duties.length} duties from database`);
    
    // Calculate tomorrow's date in DD-MM-YYYY format (IST timezone)
    const tomorrowStr = getTomorrowDateIST();
    
    // Filter duties for tomorrow
    const tomorrowDuties = duties.filter(duty => duty.Duty === tomorrowStr);
    console.log(`Filtered ${tomorrowDuties.length} duties for tomorrow (${tomorrowStr})`);
    
    const message = formatDutyMessage(tomorrowDuties);
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
      isClientReady = false;
      reconnect().catch(e => console.error('Reconnect failed:', e.message));
    }
  }
}

async function sendBirthdayMessages() {
  if (!isClientReady) {
    console.error(`[${getISTTime()}] Cannot send birthday messages - client not ready`);
    return { sent: 0, failed: 0 };
  }
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
      const matches = await findGroupsInStore(config.groupName);
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
        groupChatId,
        teacher,
        config.birthdayGroupMessageFormat,
        config.birthdayCardGroupMessageFormat
      );
      if (!teacher.Phone) throw new Error('No phone number found');
      await sendBirthdayWish(
        await resolveChatId(teacher.Phone),
        teacher,
        config.birthdayMessageFormat,
        config.birthdayCardMessageFormat
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

/**
 * Get current IST time as a Date object
 */
function getISTNow() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

/**
 * Get the next scheduled send Date in IST for the configured sendTime.
 */
function getNextSendDate(sendTime) {
  const [targetHour, targetMinute] = sendTime.split(':').map(Number);
  const now = new Date();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30
  // Get current IST date components via UTC arithmetic
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUTC = new Date(
    Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate()) - IST_OFFSET_MS
  );
  let next = new Date(istMidnightUTC.getTime() + (targetHour * 60 + targetMinute) * 60 * 1000);
  if (next <= now) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return next;
}

function clearDailySchedule() {
  if (scheduleTimeout) {
    clearTimeout(scheduleTimeout);
    scheduleTimeout = null;
  }
}

function clearBirthdaySchedule() {
  if (birthdayScheduleTimeout) {
    clearTimeout(birthdayScheduleTimeout);
    birthdayScheduleTimeout = null;
  }
}

function scheduleDailyMessage() {
  clearDailySchedule();

  const nextSend = getNextSendDate(config.sendTime);
  const delayMs = nextSend.getTime() - Date.now();

  console.log(`[${getISTTime()}] Next scheduled send at ${nextSend.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} for ${config.sendTime} (in ${Math.round(delayMs / 1000)}s)`);

  scheduleTimeout = setTimeout(async () => {
    try {
      await sendDutyMessage();
    } catch (error) {
      console.error('Scheduled send failed:', error);
    }
    scheduleDailyMessage();
  }, delayMs);
}

function scheduleBirthdayMessage() {
  clearBirthdaySchedule();
  if (config.birthdayEnabled === false) {
    console.log('Birthday messages are disabled.');
    return;
  }

  const nextSend = getNextSendDate(config.birthdayTime || '06:00');
  const delayMs = nextSend.getTime() - Date.now();
  console.log(`[${getISTTime()}] Next birthday check at ${nextSend.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  birthdayScheduleTimeout = setTimeout(async () => {
    try {
      await sendBirthdayMessages();
    } catch (error) {
      console.error('Scheduled birthday send failed:', error);
    }
    scheduleBirthdayMessage();
  }, delayMs);
}

function rescheduleDailyMessage() {
  if (!isClientReady) {
    console.log(`[${getISTTime()}] Config updated; schedule will start when the client becomes ready.`);
    return;
  }

  console.log(`[${getISTTime()}] Rescheduling daily send to ${config.sendTime}`);
  scheduleDailyMessage();
  scheduleBirthdayMessage();
}

// Express routes for configuration interface
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'index.html'));

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WA Bot Configuration</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        form { max-width: 600px; }
        label { display: block; margin-top: 10px; }
        input, textarea { width: 100%; padding: 8px; margin-top: 5px; }
        button { margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
        button:hover { background: #0056b3; }
        .current { background: #f8f9fa; padding: 10px; margin-bottom: 20px; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f8f9fa; }
        .checkbox-cell { width: 30px; text-align: center; }
        .select-all { margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Bot Configuration</h1>
      <div class="current">
        <h3>Current Settings:</h3>
        <p><strong>Send Time:</strong> ${config.sendTime}</p>
        <p><strong>Group Name:</strong> ${config.groupName}</p>
        <p><strong>Message Format:</strong></p>
        <pre>${config.messageFormat}</pre>
      </div>
      <form action="/config" method="POST">
        <label for="sendTime">Send Time (HH:MM):</label>
        <input type="time" id="sendTime" name="sendTime" value="${config.sendTime}" required>
        
        <label for="groupName">Group Name:</label>
        <input type="text" id="groupName" name="groupName" value="${config.groupName}" required>
        
        <label for="groupId">Group ID (optional):</label>
        <input type="text" id="groupId" name="groupId" value="${config.groupId || ''}" placeholder="120363428035369512@g.us">
        <p><small>If the group name is duplicated, enter the exact group ID.</small></p>
        
        <label for="messageFormat">Group Message Format:</label>
        <textarea id="messageFormat" name="messageFormat" rows="8" required>${config.messageFormat}</textarea>
        <p><small>Use {{duties}} for the duty list and {{time}} for the current time.</small></p>
        
        <label for="personalMessageFormat">Personal Message Format:</label>
        <textarea id="personalMessageFormat" name="personalMessageFormat" rows="8">${config.personalMessageFormat || ''}</textarea>
        <p><small>Use {{teacherName}}, {{dutyDate}}, {{time}}, and any custom {{variables}}.</small></p>
        
        <button type="submit">Save Configuration</button>
      </form>
      
      <hr>
      <h3>Test Features</h3>
      <button onclick="sendTestToGroup()">Send Test Message to Group</button>
      <button onclick="sendTestToPhone()">Send Test to Your Phone</button>
      <div id="testResult" style="margin-top: 10px; color: green;"></div>
      
      <hr>
      <h3>Send Personal Messages to Multiple Recipients</h3>
      <div class="select-all">
        <label><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"> Select All</label>
      </div>
      <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
        <table id="recipientsTable">
          <thead>
            <tr>
              <th class="checkbox-cell">Select</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Duty Date</th>
            </tr>
          </thead>
          <tbody id="recipientsBody">
            <tr><td colspan="4">Loading recipients...</td></tr>
          </tbody>
        </table>
      </div>
      <br>
      <label for="bulkMessage">Custom Message (optional, uses template if empty):</label>
      <textarea id="bulkMessage" rows="3" placeholder="Leave empty to use default template"></textarea>
      <br>
      <button onclick="sendBulkMessages()">Send Messages to Selected Recipients</button>
      <div id="bulkResult" style="margin-top: 10px;"></div>
      
      <hr>
      <h3>Send Personal Message to Specific Person</h3>
      <form id="personalMessageForm" onsubmit="sendPersonalMessage(event)">
        <label for="personalPhone">Phone Number (with country code):</label>
        <input type="tel" id="personalPhone" name="phone" placeholder="9839607855" required>
        
        <label for="personalName">Recipient Name (optional):</label>
        <input type="text" id="personalName" name="name" placeholder="Mr. John">
        
        <label for="personalDate">Date (optional, defaults to today):</label>
        <input type="date" id="personalDate" name="date">
        
        <label for="personalMessage">Custom Message (optional, uses template if empty):</label>
        <textarea id="personalMessage" name="message" rows="4" placeholder="Leave empty to use default template"></textarea>
        
        <button type="submit">Send Personal Message</button>
      </form>
      <div id="personalResult" style="margin-top: 10px;"></div>
      
      <script>
        let recipients = [];
        
        async function loadRecipients() {
          try {
            const response = await fetch('/api/duties');
            recipients = await response.json();
            const tbody = document.getElementById('recipientsBody');
            tbody.innerHTML = recipients.map(r => \`
              <tr>
                <td class="checkbox-cell"><input type="checkbox" class="recipient-checkbox" data-phone="\${r.Phone}" data-name="\${r.Teacher || ''}" data-date="\${r.Duty || ''}"></td>
                <td>\${r.Teacher || ''}</td>
                <td>\${r.Phone || ''}</td>
                <td>\${r.Duty || ''}</td>
              </tr>
            \`).join('');
          } catch (error) {
            document.getElementById('recipientsBody').innerHTML = '<tr><td colspan="4">Error loading recipients</td></tr>';
          }
        }
        
        function toggleSelectAll() {
          const selectAll = document.getElementById('selectAll');
          const checkboxes = document.querySelectorAll('.recipient-checkbox');
          checkboxes.forEach(cb => cb.checked = selectAll.checked);
        }
        
        async function sendBulkMessages() {
          const selected = Array.from(document.querySelectorAll('.recipient-checkbox:checked'));
          if (selected.length === 0) {
            document.getElementById('bulkResult').innerHTML = '<span style="color: red;">Please select at least one recipient</span>';
            return;
          }
          
          const recipients = selected.map(cb => ({
            phone: cb.dataset.phone,
            teacher: { Teacher: cb.dataset.name },
            dutyDate: cb.dataset.date
          }));
          
          const message = document.getElementById('bulkMessage').value;
          
          try {
            const response = await fetch('/send-personal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipients, messageFormat: message || null })
            });
            const data = await response.json();
            document.getElementById('bulkResult').innerHTML = response.ok 
              ? '<span style="color: green;">✓ Sent: ' + data.summary.sent + ' | Failed: ' + data.summary.failed + '</span>' 
              : '<span style="color: red;">Error: ' + data.error + '</span>';
          } catch (error) {
            document.getElementById('bulkResult').innerHTML = '<span style="color: red;">Error: ' + error.message + '</span>';
          }
        }
        
        async function sendTestToGroup() {
          try {
            const response = await fetch('/send-to-group', { method: 'POST' });
            const data = await response.json();
            document.getElementById('testResult').innerHTML = response.ok 
              ? 'Test message sent to group! Check your WhatsApp.' 
              : 'Error: ' + data.error;
          } catch (error) {
            document.getElementById('testResult').innerHTML = 'Error: ' + error.message;
          }
        }
        
        async function sendTestToPhone() {
          const phone = prompt('Enter your phone number (e.g., 9839607855):');
          if (!phone) return;
          
          try {
            const response = await fetch('/send-test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const data = await response.json();
            document.getElementById('testResult').innerHTML = response.ok 
              ? 'Test message sent to your phone! Check your WhatsApp.' 
              : 'Error: ' + data.error;
          } catch (error) {
            document.getElementById('testResult').innerHTML = 'Error: ' + error.message;
          }
        }
        
        async function sendPersonalMessage(event) {
          event.preventDefault();
          const phone = document.getElementById('personalPhone').value;
          const name = document.getElementById('personalName').value;
          const date = document.getElementById('personalDate').value;
          const message = document.getElementById('personalMessage').value;
          
          try {
            const response = await fetch('/send-personal-message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, name, date, message })
            });
            const data = await response.json();
            document.getElementById('personalResult').innerHTML = response.ok 
              ? '<span style="color: green;">✓ Message sent to ' + phone + '!</span>' 
              : '<span style="color: red;">Error: ' + data.error + '</span>';
          } catch (error) {
            document.getElementById('personalResult').innerHTML = '<span style="color: red;">Error: ' + error.message + '</span>';
          }
        }
        
        loadRecipients();
      </script>
    </body>
    </html>
  `);
});

app.post('/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat } = req.body;

  // Validate time format (00:00 through 23:59)
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
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
  rescheduleDailyMessage();

  res.redirect('/');
});

app.post('/send-test', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const testMessage = `[TEST] WhatsApp Bot is working! Sent at ${getISTTime()}`;
    const chatId = await resolveChatId(phone);

    await client.sendMessage(chatId, testMessage);
    res.json({ success: true, message: `Test message sent to ${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-to-group', async (req, res) => {
  try {
    const testMessage = `[TEST] Sending to group at ${getISTTime()}`;

    let targetChat;
    let targetChatId = (config.groupId || '').trim();

    // When a group ID is configured, send directly to it and stop there.
    // whatsapp-web.js's confirmation step for group sends has proven unreliable
    // in testing — it can return no result, or throw, even though the message
    // was actually dispatched and delivered. Falling through to a name-based
    // getChats() lookup on top of that just produces a misleading "not found"
    // for a group that plainly received the message, so we don't do that here.
    if (targetChatId) {
      let result;
      let confirmed = true;
      try {
        result = await client.sendMessage(targetChatId, testMessage);
        confirmed = !!result;
      } catch (directSendError) {
        confirmed = false;
        console.error(`Direct send to configured group ID didn't return a confirmation (message was likely still delivered):`, directSendError.message);
      }
      return res.json({
        success: true,
        message: confirmed
          ? 'Test message sent to group'
          : "WhatsApp Web didn't confirm the send, but the message was likely delivered — please verify in the group.",
        messageId: result?.id?._serialized || result?.id?.id || 'N/A',
        groupId: targetChatId,
        groupName: config.groupName,
        isGroup: true
      });
    }

    let availableGroups = [];
    let chatsErrorMessage;
    if (!targetChat) {
      try {
        const chats = await client.getChats();
        availableGroups = chats.filter(c => c.isGroup).map(c => ({ name: c.name, id: c.id._serialized }));
        targetChat = chats.find(chat => chat.name === config.groupName);
      } catch (chatsError) {
        chatsErrorMessage = chatsError.message;
        console.error(`Could not load chat list for fallback lookup:`, chatsError.message);
      }
    }

    if (!targetChat) {
      return res.status(404).json({
        error: `Group ${config.groupName} not found`,
        chatListError: chatsErrorMessage,
        availableGroups
      });
    }

    const result = await client.sendMessage(targetChat.id._serialized, testMessage);
    res.json({
      success: true,
      message: 'Test message sent to group',
      messageId: result?.id?._serialized || result?.id?.id || 'N/A',
      groupId: targetChat.id._serialized,
      groupName: targetChat.name,
      isGroup: targetChat.isGroup
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-duty', async (req, res) => {
  try {
    console.log('Received request to send duty message');
    await sendDutyMessage();
    res.json({ success: true, message: 'Duty message sent successfully' });
  } catch (error) {
    console.error('Error sending duty message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-birthday', async (req, res) => {
  try {
    const summary = await sendBirthdayMessages();
    res.json({ success: true, message: 'Birthday messages processed', summary });
  } catch (error) {
    console.error('Error sending birthday messages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send personal messages to specific recipients with custom template
 * POST /send-personal
 * Body: {
 *   recipients: [{ phone: "number", teacher: { Teacher: "Name" }, dutyDate: "date", customData: { ... } }],
 *   messageFormat?: "custom template with {{variables}}"
 * }
 */
app.post('/send-personal', async (req, res) => {
  try {
    const { recipients, messageFormat } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients array is required' });
    }

    let successCount = 0;
    let failureCount = 0;
    const results = [];

    for (const recipient of recipients) {
      try {
        const phone = (recipient.phone || '').trim();
        const teacher = recipient.teacher || {};
        const dutyDate = recipient.dutyDate || getTomorrowDateIST();
        const customData = recipient.customData || {};

        if (!phone) {
          console.log(`⚠️  Skipping recipient - no phone number found`);
          failureCount++;
          results.push({ phone: '', success: false, error: 'No phone number' });
          continue;
        }

        // Format phone number for WhatsApp
        let phoneFormatted = phone.replace(/\D/g, '');
        if (phoneFormatted.length === 10) {
          phoneFormatted = '91' + phoneFormatted;
        }

        const chatId = await resolveChatId(phoneFormatted);

        // Use provided messageFormat or fall back to config
        const template = (messageFormat && messageFormat.trim()) ? messageFormat : config.personalMessageFormat;
        let personalMessage = template;

         // Replace variables (case-insensitive)
         const fullName = teacher.Teacher || teacher.name || 'Teacher';
         const teacherName = (() => {
           const parts = fullName.split(' ');
           let name = parts[0];
           const titles = ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'];
           if (titles.includes(name)) {
             name = parts[1] || parts[0];
           }
           return name;
         })();
         personalMessage = personalMessage
           .replace(/\{\{fullName\}\}/gi, fullName)
           .replace(/\{\{teacherName\}\}/gi, teacherName)
           .replace(/\{\{dutyDate\}\}/gi, dutyDate)
           .replace(/\{\{time\}\}/gi, getISTTimeString());

        // Replace any custom data variables
        Object.entries(customData).forEach(([key, value]) => {
          personalMessage = personalMessage.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        });

        console.log(`Sending personal message to ${teacherName} (${phoneFormatted})`);

        const result = await client.sendMessage(chatId, personalMessage);
        console.log(`✓ Personal message sent`);
        successCount++;
        results.push({ phone: phoneFormatted, success: true, messageId: result?.id?._serialized || result?.id?.id || result?.id || 'N/A' });

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        failureCount++;
        const teacherName = recipient.teacher?.Teacher || recipient.teacher?.name || 'N/A';
        console.error(`✗ Failed to send message to ${teacherName}: ${error.message}`);
        results.push({ phone: recipient.phone, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      summary: { total: recipients.length, sent: successCount, failed: failureCount },
      results
    });
  } catch (error) {
    console.error('Error in /send-personal:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send a custom message to multiple phone numbers
 * POST /send-bulk
 * Body: {
 *   message: "your message or template with {{variables}}",
 *   recipients: [{ phone: "number", variables: { var1: "value1", ... } }]
 * }
 */
app.post('/send-bulk', async (req, res) => {
  try {
    const { message, recipients } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients array is required' });
    }

    let successCount = 0;
    let failureCount = 0;
    const results = [];

    for (const recipient of recipients) {
      try {
        const phone = (recipient.phone || '').trim();
        const variables = recipient.variables || {};

        if (!phone) {
          failureCount++;
          results.push({ phone: '', success: false, error: 'No phone number' });
          continue;
        }

        // Format phone number
        let phoneFormatted = phone.replace(/\D/g, '');
        if (phoneFormatted.length === 10) {
          phoneFormatted = '91' + phoneFormatted;
        }

        const chatId = await resolveChatId(phoneFormatted);

        // Replace template variables in message
        let msg = message;
        Object.entries(variables).forEach(([key, value]) => {
          msg = msg.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        });

        console.log(`Sending bulk message to ${phoneFormatted}`);

        const result = await client.sendMessage(chatId, msg);
        successCount++;
        results.push({ phone: phoneFormatted, success: true, messageId: result?.id?._serialized || result?.id?.id || result?.id || 'N/A' });

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failureCount++;
        console.error(`✗ Failed to send bulk message: ${error.message}`);
        results.push({ phone: recipient.phone, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      summary: { total: recipients.length, sent: successCount, failed: failureCount },
      results
    });
  } catch (error) {
    console.error('Error in /send-bulk:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    ready: isClientReady,
    uptime: process.uptime(),
    config: {
      sendTime: config.sendTime,
      groupName: config.groupName,
      groupId: config.groupId,
      birthdayEnabled: config.birthdayEnabled,
      birthdayTime: config.birthdayTime,
    },
    nextSend: isClientReady ? getNextSendDate(config.sendTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
    nextBirthday: (isClientReady && config.birthdayEnabled) ? getNextSendDate(config.birthdayTime || '06:00').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
    istTime: getISTTime(),
  });
});

/**
 * Get current config (including personalMessageFormat)
 */
app.get('/api/config', (req, res) => {
  res.json(config);
});

/**
 * Get duties from the database for recipient selection
 */
app.get('/api/duties', async (req, res) => {
  try {
    const duties = await readDutyRoster();
    res.json(duties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List groups the bot's WhatsApp account can currently see, for diagnosing
 * "group not found" errors caused by name mismatches or missing membership.
 */
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
app.get('/api/groups', async (req, res) => {
  if (!isClientReady) {
    return res.status(503).json({ error: 'WhatsApp client not ready yet' });
  }
  try {
    const groups = await findGroupsInStore(req.query.name);
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/check-number', async (req, res) => {
  if (!isClientReady) {
    return res.status(503).json({ error: 'WhatsApp client not ready yet' });
  }
  try {
    let phoneFormatted = (req.query.phone || '').replace(/\D/g, '');
    if (phoneFormatted.length === 10) phoneFormatted = '91' + phoneFormatted;
    const numberId = await client.getNumberId(phoneFormatted);
    res.json({
      phone: phoneFormatted,
      registered: !!numberId,
      canonicalId: numberId?._serialized || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/birthdays', async (req, res) => {
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

app.get('/api/birthday-card-themes', (req, res) => {
  res.json({ themes: themeList() });
});

/**
 * Preview the birthday card as a PNG.
 * GET /api/birthday-card-preview?type=personal|group&name=...&theme=...
 * Unsaved template/theme values may be passed as query params so the control
 * panel can preview edits before they are saved.
 */
app.get('/api/birthday-card-preview', async (req, res) => {
  try {
    const type = req.query.type === 'group' ? 'group' : 'personal';
    const teacher = { Teacher: (req.query.name || '').trim() || 'Teacher Name' };
    const template = req.query.message
      || (type === 'group' ? config.birthdayCardGroupMessageFormat : config.birthdayCardMessageFormat);

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

/**
 * Update configuration
 */
app.post('/api/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat,
    birthdayEnabled, birthdayTime, birthdayMessageFormat, birthdayGroupMessageFormat,
    birthdayImageEnabled, birthdayCaptionEnabled, birthdayCardTheme, birthdayCardHeadline,
    birthdayCardFooter, birthdayCardMessageFormat, birthdayCardGroupMessageFormat } = req.body;

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM between 00:00 and 23:59' });
  }
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(birthdayTime)) {
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
  rescheduleDailyMessage();

  res.json({ success: true, config });
});

/**
 * Send a personalized message to a single recipient
 * POST /send-personal-message
 * Body: { phone, name, date, message }
 */
app.post('/send-personal-message', async (req, res) => {
  try {
    const { phone, name, date, message } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    let phoneFormatted = phone.replace(/\D/g, '');
    if (phoneFormatted.length === 10) {
      phoneFormatted = '91' + phoneFormatted;
    }

    const chatId = await resolveChatId(phoneFormatted);

    let msg;
    if (message && message.trim()) {
      msg = message;
      const currentDate = date ? new Date(date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
      const recipientName = name || 'Teacher';
      msg = msg
        .replace(/\{\{fullName\}\}/gi, recipientName)
        .replace(/\{\{teacherName\}\}/gi, recipientName.split(' ')[0])
        .replace(/\{\{dutyDate\}\}/gi, currentDate)
        .replace(/\{\{time\}\}/gi, getISTTimeString());
    } else {
      const currentDate = date ? new Date(date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
      const recipientName = name || 'Teacher';
      msg = config.personalMessageFormat
        .replace(/\{\{fullName\}\}/gi, recipientName)
        .replace(/\{\{teacherName\}\}/gi, recipientName.split(' ')[0])
        .replace(/\{\{dutyDate\}\}/gi, currentDate)
        .replace(/\{\{time\}\}/gi, getISTTimeString());
    }
    
    const result = await client.sendMessage(chatId, msg);
    res.json({ success: true, phone: phoneFormatted, messageId: result?.id?._serialized || result?.id?.id || result?.id || 'N/A' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
