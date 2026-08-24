/**
 * IST (Indian Standard Time) date/time helpers shared across the bot,
 * the scheduler, and the standalone send-* scripts.
 */

function getISTTime() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function getISTTimeString() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function getISTNow() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
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
 * Get tomorrow's date in IST (DD-MM-YYYY format)
 */
function getTomorrowDateIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(istNow.getDate() + 1);

  return `${String(istNow.getDate()).padStart(2, '0')}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${istNow.getFullYear()}`;
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

module.exports = {
  getISTTime,
  getISTTimeString,
  getISTNow,
  getISTDateText,
  getTomorrowDateIST,
  getNextSendDate,
};
