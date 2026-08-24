/**
 * Owns the whatsapp-web.js Client instance and its lifecycle (init, retry,
 * reconnect). The Client instance is replaced on retry/reconnect, so
 * consumers must always fetch it fresh via getClient() rather than holding
 * a reference.
 *
 * Emits 'ready' and 'disconnected' so unrelated concerns (like the message
 * scheduler) can react without this module needing to know about them.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const EventEmitter = require('events');
const { getISTTime } = require('./time');
const { config } = require('./config');

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

class WhatsAppClientManager extends EventEmitter {
  constructor() {
    super();
    this.client = new Client(createClientOptions());
    this.ready = false;
    this.reconnecting = false;
  }

  getClient() {
    return this.client;
  }

  isClientReady() {
    return this.ready;
  }

  /** Marks the client not-ready and kicks off a reconnect (fire-and-forget). */
  handleSessionLoss() {
    this.ready = false;
    this.reconnect().catch(e => console.error('Reconnect failed:', e.message));
  }

  attachClientListeners() {
    const client = this.client;

    client.on('qr', (qr) => {
      console.log('QR RECEIVED, scan this with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      this.ready = true;
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

      this.emit('ready');
    });

    client.on('authenticated', () => {
      console.log('Client authenticated!');
    });

    client.on('auth_failure', (msg) => {
      console.error('Authentication failed:', msg);
    });

    client.on('disconnected', async (reason) => {
      console.log(`[${getISTTime()}] Client disconnected: ${reason}. Scheduling reconnect...`);
      this.ready = false;
      this.emit('disconnected', reason);
      await this.reconnect();
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

  // Initialize WhatsApp client with error handling and retry logic
  async initializeClient(retryCount = 0, maxRetries = 3) {
    try {
      console.log(`[${getISTTime()}] Initializing WhatsApp client (attempt ${retryCount + 1}/${maxRetries + 1})...`);
      await this.client.initialize();
      console.log(`[${getISTTime()}] Client initialization successful!`);
    } catch (error) {
      console.error(`[${getISTTime()}] Client initialization failed:`, error.message);
      console.error('Error stack:', error.stack);

      // Cleanup current client instance
      try {
        console.log(`[${getISTTime()}] Cleaning up failed client instance...`);
        await this.client.destroy();
      } catch (destroyError) {
        console.warn(`[${getISTTime()}] Warning during cleanup:`, destroyError.message);
      }

      if (retryCount < maxRetries) {
        const delayMs = (retryCount + 1) * 5000; // 5s, 10s, 15s delays
        console.log(`[${getISTTime()}] Retrying in ${delayMs / 1000}s...`);

        this.client = new Client(createClientOptions());
        this.attachClientListeners();

        await new Promise(resolve => setTimeout(resolve, delayMs));
        return this.initializeClient(retryCount + 1, maxRetries);
      } else {
        console.error(`[${getISTTime()}] Failed to initialize after ${maxRetries + 1} attempts. Exiting.`);
        process.exit(1);
      }
    }
  }

  async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    console.log(`[${getISTTime()}] Reconnecting WhatsApp client...`);
    try {
      await this.client.destroy();
    } catch (err) {
      console.warn(`[${getISTTime()}] Warning during destroy:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    this.client = new Client(createClientOptions());
    this.attachClientListeners();
    this.reconnecting = false;
    await this.initializeClient();
  }

  start() {
    this.attachClientListeners();
    return this.initializeClient();
  }
}

module.exports = new WhatsAppClientManager();
