const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const csv = require('csv-parser');
const qrcode = require('qrcode-terminal');
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
      groupName: process.env.GROUP_NAME || 'VSEC AVADH OFFICIAL',
      groupId: process.env.GROUP_ID || '',
      messageFormat: "📋 *Tomorrow's Duty Roster* 📋\n\n{{duties}}\n\n---\n⏰ Sent at {{time}}"
    };
  }
}

const config = loadConfig();

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
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth_sendnow' })
});

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('Client is ready!');
  console.log(`Bot authenticated and connected to WhatsApp.`);
  
  // Try to get the authenticated user info
  client.getState().then(state => {
    console.log(`WhatsApp client state: ${state}`);
  }).catch(err => {
    console.log('Could not get state:', err.message);
  });
  
  // Wait a bit for chats to load
  console.log('Waiting 5 seconds for chats to load...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  await sendDutyMessage(client);
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
async function sendDutyMessage(client) {
  try {
    console.log(`Attempting to send message to group: "${config.groupName}"`);
    
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

    let targetChat;

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
      console.log(`Chat object:`, { 
        name: targetChat.name, 
        id: targetChat.id._serialized,
        isGroup: targetChat.isGroup,
        participantsCount: targetChat.participants?.length || 'N/A',
        lastMessage: targetChat.lastMessage?.body || 'No messages'
      });
      
      const result = await client.sendMessage(targetChat.id._serialized, message);
      console.log(`✓ Message sent successfully!`);
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

  client.on('qr', (qr) => {
    console.log('QR RECEIVED, scan this with WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    console.log('Client is ready!');
    console.log(`Bot authenticated and connected to WhatsApp.`);
    
    // Try to get the authenticated user info
    client.getState().then(state => {
      console.log(`WhatsApp client state: ${state}`);
    }).catch(err => {
      console.log('Could not get state:', err.message);
    });
    
    // Wait a bit for chats to load
    console.log('Waiting 5 seconds for chats to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await sendDutyMessage(client);
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
}

main();
