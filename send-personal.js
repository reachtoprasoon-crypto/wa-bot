const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { readDutyRoster } = require('./database');
require('dotenv').config();

const { config } = require('./lib/config');
const { getISTTimeString } = require('./lib/time');
const { resolveChatId } = require('./lib/chatLookup');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/home/codespace/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

function formatMessage(teacherName, dutyDate, customMessage) {
  const name = teacherName || 'Teacher';
  const template = customMessage || config.personalMessageFormat;
  return template
    .replace(/\{\{fullName\}\}/gi, name)
    .replace(/\{\{teacherName\}\}/gi, name.split(' ')[0])
    .replace(/\{\{dutyDate\}\}/gi, dutyDate || new Date().toLocaleDateString('en-IN'))
    .replace(/\{\{time\}\}/gi, getISTTimeString());
}

async function sendMessage(phone, message) {
  const chatId = await resolveChatId(client, phone);
  console.log(`Sending to ${phone}: ${message.substring(0, 50)}...`);
  return await client.sendMessage(chatId, message);
}

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('Client is ready!');

  const args = process.argv.slice(2);
  const phoneArg = args.find(arg => arg.startsWith('--phone='));
  const messageArg = args.find(arg => arg.startsWith('--message='));
  const nameArg = args.find(arg => arg.startsWith('--name='));
  const dateArg = args.find(arg => arg.startsWith('--date='));
  const fromCsvArg = args.find(arg => arg.startsWith('--from-date='));
  const multiPhoneArg = args.find(arg => arg.startsWith('--phones='));

  // Multi-phone mode
  if (multiPhoneArg) {
    const phones = multiPhoneArg.split('=')[1].split(',');
    const message = messageArg ? messageArg.split('=')[1] : null;
    let name = nameArg ? nameArg.split('=')[1] : null;

    let successCount = 0, failCount = 0;
    for (const phone of phones) {
      try {
        const msg = formatMessage(name, null, message);
        await sendMessage(phone.trim(), msg);
        console.log(`✓ Sent to ${phone}`);
        successCount++;
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`✗ Failed to ${phone}: ${e.message}`);
        failCount++;
      }
    }
    console.log(`\nSummary: ${successCount} sent, ${failCount} failed`);
    await client.destroy();
    process.exit(0);
  }

  // CSV by date mode
    if (fromCsvArg) {
      const targetDate = fromCsvArg.split('=')[1];
      try {
        const duties = await readDutyRoster();
        const filtered = duties.filter(d => d.Duty === targetDate);
        if (filtered.length === 0) {
          console.log(`No duties found for date ${targetDate}`);
          await client.destroy();
          process.exit(0);
        }
        const message = messageArg ? messageArg.split('=')[1] : null;
        let successCount = 0, failCount = 0;
        for (const duty of filtered) {
          try {
            const msg = formatMessage(duty.Teacher, duty.Duty, message);
            await sendMessage(duty.Phone, msg);
            console.log(`✓ Sent to ${duty.Teacher}`);
            successCount++;
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.error(`✗ Failed to ${duty.Teacher}: ${e.message}`);
            failCount++;
          }
        }
        console.log(`\nSummary: ${successCount} sent, ${failCount} failed`);
        await client.destroy();
        process.exit(0);
      } catch (error) {
        console.error('Failed to read duties from database:', error.message);
        await client.destroy();
        process.exit(1);
      }
    return;
  }

  // Single phone mode
  const phone = phoneArg ? phoneArg.split('=')[1] : null;
  const customMessage = messageArg ? messageArg.split('=')[1] : null;
  const teacherName = nameArg ? nameArg.split('=')[1] : null;

  if (!phone) {
    console.log('Usage:');
    console.log('  Single: node send-personal.js --phone=<number> [--message=<msg>] [--name=<name>]');
    console.log('  Multi:  node send-personal.js --phones=9839607855,9829000000 [--message=<msg>]');
    console.log('  CSV:    node send-personal.js --from-date=DD-MM-YYYY [--message=<msg>]');
    console.log('\nExample: node send-personal.js --phone=9839607855 --name="Mr. John" --message="Hello!"');
    await client.destroy();
    process.exit(1);
  }

  try {
    const message = formatMessage(teacherName, dateArg ? dateArg.split('=')[1] : null, customMessage);
    console.log(`Sending message to ${phone}:`);
    console.log(message);
    const result = await sendMessage(phone, message);
    const messageId = result?.id?._serialized || result?.id?.id || result?.id || 'N/A';
    console.log(`\n✓ Message sent successfully!`);
    console.log(`Message ID: ${messageId}`);
    await client.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Failed to send message:', error.message);
    await client.destroy();
    process.exit(1);
  }
});

client.on('authenticated', () => {
  console.log('Client authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failed:', msg);
  process.exit(1);
});

client.initialize();
