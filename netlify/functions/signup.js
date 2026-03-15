// netlify/functions/signup.js
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { name, phone, pass, schoolId, classId } = JSON.parse(event.body || '{}');

    if (!name || !phone || !pass) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    }
    if (!/^\d{10}$/.test(phone)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone number 10 digits ka hona chahiye' }) };
    }
    if (pass.length < 6) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password kam se kam 6 characters ka hona chahiye' }) };
    }

    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        phone       TEXT UNIQUE NOT NULL,
        pass        TEXT NOT NULL,
        plan        JSONB,
        pending_plan TEXT,
        school_id   TEXT,
        class_id    TEXT,
        created_at  TEXT
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_id TEXT`;

    const existing = await sql`SELECT id FROM users WHERE phone = ${phone}`;
    if (existing.length > 0) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'यह phone number पहले से registered है।' }) };
    }

    const hashedPass = await bcrypt.hash(pass, 10);
    const id = 'id' + Date.now() + Math.random().toString(36).slice(2, 7);
    const createdAt = new Date().toISOString();

    await sql`
      INSERT INTO users (id, name, phone, pass, plan, pending_plan, school_id, class_id, created_at)
      VALUES (${id}, ${name}, ${phone}, ${hashedPass}, ${null}, ${null}, ${schoolId||null}, ${classId||null}, ${createdAt})
    `;

    const user = { id, name, phone, plan: null, pendingPlan: null, schoolId: schoolId||null, classId: classId||null, createdAt };
    return { statusCode: 200, headers, body: JSON.stringify({ user }) };

  } catch (err) {
    console.error('signup error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};

