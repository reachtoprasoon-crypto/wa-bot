/**
 * Schedules the nightly duty message and the daily birthday check via
 * setTimeout (re-arming itself after each fire, since the target time is
 * the same clock time every day).
 */
const whatsappClient = require('./whatsappClient');
const { config } = require('./config');
const { getISTTime, getNextSendDate } = require('./time');
const { sendDutyMessage } = require('./dutySender');
const { sendBirthdayMessages } = require('./birthdaySender');

let scheduleTimeout = null;
let birthdayScheduleTimeout = null;

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
  if (!whatsappClient.isClientReady()) {
    console.log(`[${getISTTime()}] Config updated; schedule will start when the client becomes ready.`);
    return;
  }

  console.log(`[${getISTTime()}] Rescheduling daily send to ${config.sendTime}`);
  scheduleDailyMessage();
  scheduleBirthdayMessage();
}

/** Start both schedules — call once the WhatsApp client is ready. */
function start() {
  scheduleDailyMessage();
  scheduleBirthdayMessage();
}

/** Stop both schedules — call when the WhatsApp client disconnects. */
function stop() {
  clearDailySchedule();
  clearBirthdaySchedule();
}

module.exports = {
  scheduleDailyMessage,
  scheduleBirthdayMessage,
  clearDailySchedule,
  clearBirthdaySchedule,
  rescheduleDailyMessage,
  start,
  stop,
};
