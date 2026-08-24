/**
 * Endpoints that trigger an actual WhatsApp send: ad-hoc tests, the
 * scheduled duty/birthday jobs run on demand, and bulk/personal messages
 * to arbitrary recipients.
 */
const express = require('express');
const router = express.Router();

const whatsappClient = require('../lib/whatsappClient');
const { config } = require('../lib/config');
const { getISTTime, getISTTimeString, getTomorrowDateIST } = require('../lib/time');
const { resolveChatId } = require('../lib/chatLookup');
const { sendDutyMessage } = require('../lib/dutySender');
const { sendBirthdayMessages } = require('../lib/birthdaySender');

router.post('/send-test', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const testMessage = `[TEST] WhatsApp Bot is working! Sent at ${getISTTime()}`;
    const client = whatsappClient.getClient();
    const chatId = await resolveChatId(client, phone);

    await client.sendMessage(chatId, testMessage);
    res.json({ success: true, message: `Test message sent to ${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/send-to-group', async (req, res) => {
  try {
    const testMessage = `[TEST] Sending to group at ${getISTTime()}`;
    const client = whatsappClient.getClient();

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

router.post('/send-duty', async (req, res) => {
  try {
    console.log('Received request to send duty message');
    await sendDutyMessage();
    res.json({ success: true, message: 'Duty message sent successfully' });
  } catch (error) {
    console.error('Error sending duty message:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/send-birthday', async (req, res) => {
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
router.post('/send-personal', async (req, res) => {
  try {
    const { recipients, messageFormat } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients array is required' });
    }

    const client = whatsappClient.getClient();
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

        const chatId = await resolveChatId(client, phoneFormatted);

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
router.post('/send-bulk', async (req, res) => {
  try {
    const { message, recipients } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients array is required' });
    }

    const client = whatsappClient.getClient();
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

        const chatId = await resolveChatId(client, phoneFormatted);

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

/**
 * Send a personalized message to a single recipient
 * POST /send-personal-message
 * Body: { phone, name, date, message }
 */
router.post('/send-personal-message', async (req, res) => {
  try {
    const { phone, name, date, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    let phoneFormatted = phone.replace(/\D/g, '');
    if (phoneFormatted.length === 10) {
      phoneFormatted = '91' + phoneFormatted;
    }

    const client = whatsappClient.getClient();
    const chatId = await resolveChatId(client, phoneFormatted);

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

module.exports = router;
