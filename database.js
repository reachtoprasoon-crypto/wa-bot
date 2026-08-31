const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'duty_roster',
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: true,
});

async function readDutyRoster() {
  const [rows] = await pool.query(`
    SELECT
      duties.id AS id,
      teachers.name AS Teacher,
      DATE_FORMAT(duties.duty_date, '%d-%m-%Y') AS Duty,
      teachers.phone AS Phone,
      DATE_FORMAT(teachers.dob, '%Y-%m-%d') AS DOB
    FROM duties
    INNER JOIN teachers ON teachers.id = duties.teacher_id
    ORDER BY duties.duty_date, duties.id
  `);

  return rows;
}

async function readTeacherBirthdays(months) {
  const monthList = Array.isArray(months) && months.length ? months : [1, 2];
  const placeholders = monthList.map(() => '?').join(', ');
  const [rows] = await pool.query(`
    SELECT
      teachers.id AS id,
      teachers.name AS Teacher,
      teachers.phone AS Phone,
      DATE_FORMAT(teachers.dob, '%Y-%m-%d') AS DOB,
      teachers.wish AS Wish
    FROM teachers
    WHERE teachers.dob IS NOT NULL
      AND MONTH(teachers.dob) IN (${placeholders})
    ORDER BY MONTH(teachers.dob), DAY(teachers.dob), teachers.name
  `, monthList);

  return rows;
}

module.exports = { readDutyRoster, readTeacherBirthdays };