const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const express = require('express');
require('dotenv').config();

const CONFIG_FILE = 'config.json';
const DUTY_FILE = 'duty.csv';

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
      groupName: process.env.GROUP_NAME || 'VSEC AVADH OFFICIAL',      groupId: process.env.GROUP_ID || '',      messageFormat: "📋 *Tomorrow's Morning Duty* 📋\n\n{{duties}}\n\n---\n⏰ Sent at {{time}}"
    };
  }
}

// Save configuration
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();
const scheduledMessages = new Map();
const client = new Client({
  authStrategy: new LocalAuth()
});

// Express app for configuration interface
const app = express();
const PORT = process.env.PORT || 3000;

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

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
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

  // Check for scheduled messages every minute
  setInterval(checkScheduledMessages, 60 * 1000);

  // Start web interface
  app.listen(PORT, () => {
    console.log(`Configuration interface available at http://localhost:${PORT}`);
  });
});

client.on('authenticated', () => {
  console.log('Client authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Client was logged out:', reason);
});

/**
 * Read duty roster from CSV file
 */
function readDutyRoster() {
  return new Promise((resolve, reject) => {
    const duties = [];
    fs.createReadStream(DUTY_FILE)
      .pipe(csv())
      .on('data', (row) => {
        duties.push(row);
      })
      .on('end', () => {
        resolve(duties);
      })
      .on('error', reject);
  });
}

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
      
      const chatId = `${phoneFormatted}@c.us`;
      
      const personalMessage = formatPersonalMessage(duty, duty.Duty);
      console.log(`Sending personal message to ${teacherName} (${phoneFormatted})`);
      
      // Send personal message
      const result = await client.sendMessage(chatId, personalMessage);
      console.log(`✓ Personal message sent to ${teacherName}`);
      console.log(`  Message ID: ${result.id.id}`);
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
  try {
    console.log(`[${getISTTime()}] Attempting to send message to group: "${config.groupName}"`);
    
    const duties = await readDutyRoster();
    console.log(`Read ${duties.length} duties from CSV`);
    
    // Calculate tomorrow's date in DD-MM-YYYY format (IST timezone)
    const tomorrowStr = getTomorrowDateIST();
    
    // Filter duties for tomorrow
    const tomorrowDuties = duties.filter(duty => duty.Duty === tomorrowStr);
    console.log(`Filtered ${tomorrowDuties.length} duties for tomorrow (${tomorrowStr})`);
    
    const message = formatDutyMessage(tomorrowDuties);
    console.log('Message to send:');
    console.log(message);
    console.log('---');
    
    const chats = await client.getChats();
    console.log(`Total chats available: ${chats.length}`);
    const groups = chats.filter(c => c.isGroup || c.name);
    console.log('Available groups:', groups.map(c => ({ name: c.name, id: c.id._serialized })));

    let targetChat;
    if (config.groupId) {
      console.log(`Looking up group by ID: ${config.groupId}`);
      try {
        targetChat = await client.getChatById(config.groupId);
      } catch (idError) {
        console.error(`Could not find chat by ID ${config.groupId}:`, idError.message);
      }
    }

    if (!targetChat) {
      console.log(`Looking up group by name: ${config.groupName}`);
      targetChat = chats.find(chat => chat.name === config.groupName);
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
      console.log(`✓ Group message sent successfully at ${getISTTime()}!`);
      console.log(`Message ID: ${result.id.id}`);
      console.log(`Message sent to chat ID: ${targetChat.id._serialized}`);
      
      // Send personal messages to teachers with duties
      console.log('\n📤 Sending personal messages to teachers...');
      await sendPersonalMessages(tomorrowDuties);
    } else {
      console.error(`Group "${config.groupName}" not found.`);
      console.error('Available chats:', chats.map(c => ({ name: c.name, isGroup: c.isGroup, id: c.id._serialized })));
    }
  } catch (error) {
    console.error('Error sending message:', error.message);
    console.error('Full error:', error);
  }
}

/**
 * Check and send any scheduled messages
 */
function checkScheduledMessages() {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();

  scheduledMessages.forEach((data, id) => {
    if (data.targetHour === currentHour && data.targetMinute === currentMinute) {
      sendScheduledMessage(id, data);
    }
  });
}

async function sendScheduledMessage(id, data) {
  try {
    const { phone, message, name } = data;
    let phoneFormatted = phone.replace(/\D/g, '');
    if (phoneFormatted.length === 10) {
      phoneFormatted = '91' + phoneFormatted;
    }

    const chatId = `${phoneFormatted}@c.us`;
    const personalizedMsg = message
      .replace(/\{\{name\}\}/g, name || '')
      .replace(/\{\{time\}\}/g, getISTTimeString())
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }));

    const result = await client.sendMessage(chatId, personalizedMsg);
    console.log(`✓ Scheduled message sent to ${phoneFormatted} (ID: ${id})`);
    scheduledMessages.delete(id);
  } catch (error) {
    console.error(`✗ Failed to send scheduled message ${id}:`, error.message);
  }
}

/**
 * Schedule daily message send
 */
function scheduleDailyMessage() {
  const [targetHour, targetMinute] = config.sendTime.split(':').map(Number);
  
  function checkAndSend() {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHour = istTime.getHours();
    const currentMinute = istTime.getMinutes();
    
    if (currentHour === targetHour && currentMinute === targetMinute) {
      sendDutyMessage();
    }
  }
  
  // Check every minute
  setInterval(checkAndSend, 60 * 1000);
  
  // Initial check on startup
  checkAndSend();
}

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/config', (req, res) => {
  res.redirect('/index.html');
});

app.post('/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat } = req.body;

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM between 00:00 and 23:59' });
  }

  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  if (personalMessageFormat !== undefined) {
    config.personalMessageFormat = personalMessageFormat;
  }

  saveConfig(config);

  if (req.headers.accept?.includes('text/html')) {
    res.redirect('/');
  } else {
    res.json({ success: true, config });
  }
});

/**
 * Bulk delete all scheduled messages
 */
app.delete('/api/scheduled-messages', (req, res) => {
  scheduledMessages.clear();
  res.json({ success: true, message: 'All scheduled messages cleared' });
});

// Initialize WhatsApp client

app.post('/send-test', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const testMessage = `[TEST] WhatsApp Bot is working! Sent at ${getISTTime()}`;
    const chatId = phone + '@c.us';
    
    await client.sendMessage(chatId, testMessage);
    res.json({ success: true, message: `Test message sent to ${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-to-group', async (req, res) => {
  try {
    const testMessage = `[TEST] Sending to group at ${getISTTime()}`;

    const chats = await client.getChats();
    let targetChat;

    if (config.groupId) {
      try {
        targetChat = await client.getChatById(config.groupId);
      } catch (idError) {
        console.error(`Could not find chat by ID ${config.groupId}:`, idError.message);
      }
    }

    if (!targetChat) {
      targetChat = chats.find(chat => chat.name === config.groupName);
    }

    if (!targetChat) {
      return res.status(404).json({ error: `Group ${config.groupName} not found` });
    }

    const result = await client.sendMessage(targetChat.id._serialized, testMessage);
    res.json({ 
      success: true, 
      message: 'Test message sent to group',
      messageId: result.id?.id,
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

        const chatId = `${phoneFormatted}@c.us`;

        // Use provided messageFormat or fall back to config
        const template = messageFormat || config.personalMessageFormat;
        let personalMessage = template;

         // Replace variables
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
           .replace(/\{\{fullName\}\}/g, fullName)
           .replace(/\{\{teacherName\}\}/g, teacherName)
           .replace(/\{\{dutyDate\}\}/g, dutyDate)
           .replace(/\{\{time\}\}/g, getISTTimeString());

        // Replace any custom data variables
        Object.entries(customData).forEach(([key, value]) => {
          personalMessage = personalMessage.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        });

        console.log(`Sending personal message to ${teacherName} (${phoneFormatted})`);

        const result = await client.sendMessage(chatId, personalMessage);
        console.log(`✓ Personal message sent`);
        successCount++;
        results.push({ phone: phoneFormatted, success: true, messageId: result.id.id });

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

        const chatId = `${phoneFormatted}@c.us`;

        // Replace template variables in message
        let msg = message;
        Object.entries(variables).forEach(([key, value]) => {
          msg = msg.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        });

        console.log(`Sending bulk message to ${phoneFormatted}`);

        const result = await client.sendMessage(chatId, msg);
        successCount++;
        results.push({ phone: phoneFormatted, success: true, messageId: result.id.id });

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

/**
 * Get current config (including personalMessageFormat)
 */
/**
 * Get contacts from duty CSV
 */
app.get('/api/contacts', async (req, res) => {
  try {
    const duties = await readDutyRoster();
    const contacts = duties.map((duty, index) => ({
      id: index,
      name: duty.Teacher || duty.name || `Unknown ${index + 1}`,
      phone: duty.Phone?.trim() || '',
      dutyDate: duty.Duty || '',
      srNo: duty['Sr.no'] || (index + 1)
    }));
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read contacts: ' + error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

/**
 * Send a custom personalized message to a specific contact
 * POST /api/send-contact
 * Body: { phone, message, name }
 */
app.post('/api/send-contact', async (req, res) => {
  try {
    const { phone, message, name } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }

    let phoneFormatted = phone.replace(/\D/g, '');
    if (phoneFormatted.length === 10) {
      phoneFormatted = '91' + phoneFormatted;
    }

    const chatId = `${phoneFormatted}@c.us`;
    const personalizedMsg = message
      .replace(/\{\{name\}\}/g, name || '')
      .replace(/\{\{time\}\}/g, getISTTimeString())
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }));

    const result = await client.sendMessage(chatId, personalizedMsg);
    res.json({ success: true, messageId: result.id.id, phone: phoneFormatted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Schedule a personalized message
 * POST /api/schedule-message
 * Body: { phone, message, name, scheduleTime }
 */
app.post('/api/schedule-message', async (req, res) => {
  try {
    const { phone, message, name, scheduleTime } = req.body;

    if (!phone || !message || !scheduleTime) {
      return res.status(400).json({ error: 'Phone, message, and schedule time are required' });
    }

    const [targetHour, targetMinute] = scheduleTime.split(':').map(Number);
    if (isNaN(targetHour) || isNaN(targetMinute) || targetHour < 0 || targetHour > 23 || targetMinute < 0 || targetMinute > 59) {
      return res.status(400).json({ error: 'Invalid schedule time format. Use HH:MM' });
    }

    const id = `scheduled_${Date.now()}`;
    scheduledMessages.set(id, { phone, message, name, targetHour, targetMinute, createdAt: new Date() });

    res.json({ success: true, id, message: `Message scheduled for ${scheduleTime} IST` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all scheduled messages
 */
app.get('/api/scheduled-messages', (req, res) => {
  const list = [];
  scheduledMessages.forEach((data, id) => {
    list.push({ id, ...data });
  });
  res.json({ scheduledMessages: list });
});

/**
 * Delete a scheduled message
 */
app.delete('/api/scheduled-messages/:id', (req, res) => {
  const { id } = req.params;
  if (scheduledMessages.delete(id)) {
    res.json({ success: true, message: 'Scheduled message cancelled' });
  } else {
    res.status(404).json({ error: 'Scheduled message not found' });
  }
});

/**
 * Update configuration
 */
app.post('/api/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat, personalMessageFormat } = req.body;

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM between 00:00 and 23:59' });
  }

  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  if (personalMessageFormat !== undefined) {
    config.personalMessageFormat = personalMessageFormat;
  }

  saveConfig(config);

  res.json({ success: true, config });
});

// Initialize WhatsApp client
client.initialize();
