/**
 * Utility functions for birthday message formatting and filtering
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

function getBirthdayTeachersForDate(teachers, date = new Date()) {
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);

  return teachers.filter(t => {
    if (!t.dob) return false;
    // Expect dob in YYYY-MM-DD or similar ISO format
    const parts = String(t.dob).split('-');
    if (parts.length < 2) return false;
    const d = pad(Number(parts[2] || parts[0]));
    const m = pad(Number(parts[1] || parts[1]));

    // handle formats like YYYY-MM-DD or DD-MM-YYYY
    // normalize by checking which part is day
    if (parts[0].length === 4) { // YYYY-MM-DD
      return pad(parts[2]) === day && pad(parts[1]) === month;
    }

    // assume DD-MM-YYYY
    return pad(parts[0]) === day && pad(parts[1]) === month;
  });
}

function formatBirthdayGroupMessage(teachers, config = {}) {
  const format = config.birthdayMessageFormat || '🎉 Today\'s Birthday(s):\n\n{{teachers}}\n\n{{time}}';
  const teachersText = teachers.map((t, i) => `${i + 1}. ${t.name || t.Teacher || 'N/A'} (${t.dobDisplay || t.dob || ''})`).join('\n');
  return format.replace('{{teachers}}', teachersText).replace('{{time}}', (config.timeText || '') );
}

function formatBirthdayPersonalMessage(teacher, config = {}) {
  const format = config.birthdayPersonalMessageFormat || '🎂 Happy Birthday {{teacherName}}!\n\nWishing you a wonderful year ahead.\n\n{{time}}';
  const fullName = teacher.name || teacher.Teacher || 'Teacher';
  const teacherName = fullName.split(' ').filter(Boolean)[0];
  return format.replace(/\{\{teacherName\}\}/g, teacherName).replace(/\{\{fullName\}\}/g, fullName).replace(/\{\{time\}\}/g, config.timeText || '');
}

module.exports = {
  getBirthdayTeachersForDate,
  formatBirthdayGroupMessage,
  formatBirthdayPersonalMessage,
};
