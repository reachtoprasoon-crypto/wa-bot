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
      teachers.phone AS Phone
    FROM duties
    INNER JOIN teachers ON teachers.id = duties.teacher_id
    ORDER BY duties.duty_date, duties.id
  `);

  return rows;
}

async function readTeachers() {
  const [rows] = await pool.query(`
    SELECT
      id,
      name,
      phone,
      DATE_FORMAT(dob, '%Y-%m-%d') AS dob,
      DATE_FORMAT(dob, '%d-%m-%Y') AS dobDisplay
    FROM teachers
    ORDER BY name
  `);

  return rows;
}

module.exports = { readDutyRoster, readTeachers };