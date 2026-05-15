const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const csv = require('csv-parser');
const qrcode = require('qrcode-terminal');
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
    groupName: process.env.GROUP_NAME || 'VSEC AVADH OFFICIAL',
    groupId: process.env.GROUP_ID || '',
    messageFormat: "📋 *Tomorrow's Duty Roster* 📋\n\n{{duties}}\n\n---\n⏰ Sent at {{time}}",
    personalMessageFormat: "👋 Hi {{teacherName}},\n\nYou have been assigned morning duty tomorrow, that is on {{dutyDate}}.\n\nPlease ensure you are available at 6:45 AM.\n\n📋 School morning duty notification\n⏰ Sent at {{time}}\n\nIts a computer generated message, no need to reply."
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
function formatPersonalMessage(teacher, dutyDate) {
  let fullName = teacher.Teacher || teacher.name || 'Teacher';
  const parts = fullName.split(' ');
  let teacherName = parts[0];
  const titles = ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'];
  if (titles.includes(teacherName)) {
    teacherName = parts[1] || parts[0];
  }

  let message = config.personalMessageFormat || `👋 Hi {{teacherName}},\n\nYou have been assigned morning duty tomorrow, that is on ${dutyDate}.\n\nPlease ensure you are available at 6:45 AM.\n\n📋 School morning duty notification\n⏰ Sent at ${getISTTimeString()}\n\nIts a computer generated message, no need to reply.`;

  message = message
    .replace(/\{\{teacherName\}\}/g, teacherName)
    .replace(/\{\{dutyDate\}\}/g, dutyDate)
    .replace(/\{\{time\}\}/g, getISTTimeString());

  return message;
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
async function sendDutyMessage(client) {
  try {
    console.log(`Attempting to send message to group: "${config.groupName}"`);
    
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
      console.log(`✓ Group message sent successfully!`);
      console.log(`Message ID: ${result.id.id}`);
      console.log(`Message sent to chat ID: ${targetChat.id._serialized}`);
      
      // Send personal messages to teachers with duties
      console.log('\n📤 Sending personal messages to teachers...');
      await sendPersonalMessages(client, tomorrowDuties);
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
