#!/usr/bin/env node
require('dotenv').config();
const { readTeacherBirthdays } = require('../database');

function pad(n){ return String(n).padStart(2,'0'); }

async function main(){
  const now = new Date();
  const cur = now.getMonth() + 1;
  const next = (cur % 12) + 1;

  const teachers = await readTeacherBirthdays([cur, next]);

  // DOB comes back as YYYY-MM-DD (see database.js)
  const results = teachers
    .filter(t => t.DOB)
    .map(t => {
      const [, mm, dd] = t.DOB.split('-').map(Number);
      return { name: t.Teacher || 'N/A', mm, dd };
    });

  results.sort((a,b) => (a.mm - b.mm) || (a.dd - b.dd));

  if (!results.length){
    console.log('No birthdays found in current or next month.');
    return;
  }

  for (const r of results){
    console.log(`${pad(r.mm)}-${pad(r.dd)}  ${r.name}`);
  }
}

main().catch(err => { console.error('Error:', err.message || err); process.exit(1); });
