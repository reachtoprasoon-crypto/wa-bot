const assert = require('assert');
const { formatBirthdayGroupMessage, formatBirthdayPersonalMessage, getBirthdayTeachersForDate } = require('../birthdayUtils');

const today = new Date();
const todayStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;

const teachers = [
  { name: 'Aisha Khan', phone: '9876543210', dob: '1990-08-22', dobDisplay: todayStr },
  { name: 'Rahul Verma', phone: '9123456789', dob: '1995-02-11', dobDisplay: '11-02-1995' },
];

const groupConfig = {
  birthdayMessageFormat: '🎉 Today\'s Birthday(s):\n\n{{teachers}}\n\n{{time}}',
  birthdayPersonalMessageFormat: '🎂 Happy Birthday {{teacherName}}!\n\nWishing you a wonderful year ahead.\n\n{{time}}'
};

assert.deepStrictEqual(getBirthdayTeachersForDate(teachers, new Date()), [teachers[0]]);
assert.match(formatBirthdayGroupMessage(teachers, groupConfig), /Aisha Khan/);
assert.match(formatBirthdayPersonalMessage(teachers[0], groupConfig), /Happy Birthday Aisha/);

console.log('birthdayUtils tests passed');
