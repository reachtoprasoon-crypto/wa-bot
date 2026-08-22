const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const express = require('express');
require('dotenv').config();

const CONFIG_FILE = 'config.json';
const DUTY_FILE = 'duty.csv';

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
    .replace('{{time}}', new Date().toLocaleTimeString());
  
  return message;
}

/**
 * Send duty message to the group
 */
async function sendDutyMessage() {
  try {
    console.log(`[${new Date().toLocaleString()}] Attempting to send message to group: "${config.groupName}"`);
    
    const duties = await readDutyRoster();
    console.log(`Read ${duties.length} duties from CSV`);
    
    // Calculate tomorrow's date in DD-MM-YYYY format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${String(tomorrow.getDate()).padStart(2, '0')}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${tomorrow.getFullYear()}`;
    
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
      console.log(`✓ Message sent successfully at ${new Date().toLocaleString()}!`);
      console.log(`Message ID: ${result.id.id}`);
      console.log(`Message sent to chat ID: ${targetChat.id._serialized}`);
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
 * Schedule daily message send
 */
function scheduleDailyMessage() {
  const [targetHour, targetMinute] = config.sendTime.split(':').map(Number);
  
  function checkAndSend() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    if (currentHour === targetHour && currentMinute === targetMinute) {
      sendDutyMessage();
    }
  }
  
  // Check every minute
  setInterval(checkAndSend, 60 * 1000);
  
  // Initial check on startup
  checkAndSend();
}

// Express routes for configuration interface
app.get('/', (req, res) => {
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
        
        <label for="messageFormat">Message Format:</label>
        <textarea id="messageFormat" name="messageFormat" rows="8" required>${config.messageFormat}</textarea>
        <p><small>Use {{duties}} for the duty list and {{time}} for the current time.</small></p>
        
        <button type="submit">Save Configuration</button>
      </form>
      
      <hr>
      <h3>Test Features</h3>
      <button onclick="sendTestToGroup()">Send Test Message to Group</button>
      <button onclick="sendTestToPhone()">Send Test to Your Phone</button>
      <div id="testResult" style="margin-top: 10px; color: green;"></div>
      
      <script>
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
      </script>
    </body>
    </html>
  `);
});

app.post('/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat } = req.body;
  
  // Validate time format (00:00 through 23:59)
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    return res.status(400).send('Invalid time format. Use HH:MM between 00:00 and 23:59');
  }
  
  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  
  saveConfig(config);
  
  res.redirect('/');
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const { sendTime, groupName, groupId, messageFormat } = req.body;

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM between 00:00 and 23:59' });
  }

  config.sendTime = sendTime;
  config.groupName = groupName;
  config.groupId = groupId?.trim() || '';
  config.messageFormat = messageFormat;
  saveConfig(config);

  res.json({ success: true, config });
});

app.post('/send-test', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const testMessage = `[TEST] WhatsApp Bot is working! Sent at ${new Date().toLocaleString()}`;
    const chatId = phone + '@c.us';
    
    await client.sendMessage(chatId, testMessage);
    res.json({ success: true, message: `Test message sent to ${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-to-group', async (req, res) => {
  try {
    const testMessage = `[TEST] Sending to group at ${new Date().toLocaleString()}`;

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

client.initialize();
