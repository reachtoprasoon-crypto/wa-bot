/**
 * Message template formatting shared by the scheduled duty/birthday sends.
 *
 * Note: the /send-personal and /send-personal-message routes do their own
 * (case-insensitive) template substitution rather than using
 * formatPersonalMessage here, which is case-sensitive on its placeholders —
 * that's a pre-existing inconsistency, preserved as-is rather than unified,
 * since unifying it would change those endpoints' behavior.
 */
const { getISTTimeString, getISTDateText } = require('./time');

/**
 * Format duty message for WhatsApp
 */
function formatDutyMessage(duties, config) {
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
function formatPersonalMessage(teacher, dutyDate, config, customData = {}) {
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

function formatBirthdayMessage(teacher, template) {
  const fullName = teacher.Teacher || teacher.name || 'Teacher';
  const teacherName = fullName.split(' ')[0];
  return (template || '')
    .replace(/\{\{fullName\}\}/gi, fullName)
    .replace(/\{\{teacherName\}\}/gi, teacherName)
    .replace(/\{\{time\}\}/gi, getISTTimeString())
    .replace(/\{\{date\}\}/gi, getISTDateText());
}

module.exports = { formatDutyMessage, formatPersonalMessage, formatBirthdayMessage };
