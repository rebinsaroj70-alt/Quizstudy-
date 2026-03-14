// netlify/functions/get-user.js
// Fetches fresh user data from Neon DB by user ID.
// Call this on page load to sync plan/pendingPlan from any device.

const { neon } = require('@neondatabase/serverless');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const { id } = event.queryStringParameters || {};

  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing user id' }) };
  }

  try {
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    const rows = await sql`SELECT * FROM users WHERE id = ${id}`;

    if (rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
    }

    const row = rows[0];
    // ✅ FIX: Password kabhi response mein mat bhejo
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
    console.error('get-user error', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};

