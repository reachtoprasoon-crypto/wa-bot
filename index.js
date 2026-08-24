const express = require('express');
require('dotenv').config();

const whatsappClient = require('./lib/whatsappClient');
const scheduler = require('./lib/scheduler');

const configRoutes = require('./routes/configRoutes');
const statusRoutes = require('./routes/statusRoutes');
const dataRoutes = require('./routes/dataRoutes');
const sendRoutes = require('./routes/sendRoutes');

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

app.use(configRoutes);
app.use(statusRoutes);
app.use(dataRoutes);
app.use(sendRoutes);

function startHttpServer() {
  app.listen(PORT, () => {
    console.log(`Configuration interface available at http://localhost:${PORT}`);
  });
}

// Kick off scheduling once the WhatsApp client is ready, and pause it while
// disconnected/reconnecting.
whatsappClient.on('ready', () => scheduler.start());
whatsappClient.on('disconnected', () => scheduler.stop());

// Start the web interface immediately, then initialize the client in the background.
startHttpServer();
whatsappClient.start();
