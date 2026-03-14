// netlify/functions/login.js
// Verifies credentials and returns the user object from Neon DB

const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { phone, pass } = JSON.parse(event.body || '{}');

    if (!phone || !pass) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    const rows = await sql`SELECT * FROM users WHERE phone = ${phone}`;

    // ✅ FIX: Sirf ek generic message — attacker ko pata nahi chalega ki phone hai ya nahi
    if (rows.length === 0) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'गलत Phone number या Password।' }) };
    }

    const row = rows[0];

    // ✅ FIX: bcrypt se compare karo (plain text compare nahi)
    const passMatch = await bcrypt.compare(pass, row.pass);
    if (!passMatch) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'गलत Phone number या Password।' }) };
    }

    // ✅ FIX: Response mein hashed password kabhi mat bhejo
    const user = {
      id:          row.id,
      name:        row.name,
      phone:       row.phone,
      plan:        row.plan        || null,
      pendingPlan: row.pending_plan || null,
      createdAt:   row.created_at,
    };

    return { statusCode: 200, headers, body: JSON.stringify({ user }) };

  } catch (err) {
    console.error('login error', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};

