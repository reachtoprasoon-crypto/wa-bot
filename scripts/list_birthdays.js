#!/usr/bin/env node
require('dotenv').config();
const { readTeachers } = require('../database');

function pad(n){ return String(n).padStart(2,'0'); }

async function main(){
  const teachers = await readTeachers();
  const now = new Date();
  const cur = now.getMonth() + 1;
  const next = (now.getMonth() + 1) % 12 + 1;
  const months = [cur, next];

  const results = [];
  for (const t of teachers){
    if (!t.dob) continue;
    const parts = String(t.dob).split('-');
    if (parts.length < 3) continue;
    let dd, mm;
    if (parts[0].length === 4){ // YYYY-MM-DD
      mm = Number(parts[1]);
      dd = Number(parts[2]);
    } else { // assume DD-MM-YYYY
      dd = Number(parts[0]);
      mm = Number(parts[1]);
    }
    if (months.includes(mm)){
      results.push({ name: t.name || t.Teacher || 'N/A', mm, dd });
    }
  }

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
