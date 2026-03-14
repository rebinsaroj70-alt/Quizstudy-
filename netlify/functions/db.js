// netlify/functions/db.js
// Central API for all app data: classes, subjects, chapters, quizzes,
// plans, payment methods, payment requests, and user premium updates.

const { neon } = require('@neondatabase/serverless');

// ✅ FIX: Admin token check — environment variable se aata hai, hardcode nahi
function checkAdminToken(event) {
  const token = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token'])) || '';
  return token === process.env.ADMIN_SECRET_TOKEN;
}

async function getSQL() {
  const sql = neon(process.env.NETLIFY_DATABASE_URL);

  // Create app_data table — stores the entire DB as one JSON blob
  await sql`
    CREATE TABLE IF NOT EXISTS app_data (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `;

  // Create payment_requests table
  await sql`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      user_name    TEXT,
      user_phone   TEXT,
      plan_id      TEXT,
      plan_name    TEXT,
      price        INTEGER,
      days         INTEGER,
      method       TEXT,
      submitted_at TEXT,
      status       TEXT DEFAULT 'pending',
      approved_at  TEXT
    )
  `;

  // ✅ FIX: quiz_scores table bhi yahan banao — save-score mein baar baar nahi
  await sql`
    CREATE TABLE IF NOT EXISTS quiz_scores (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      user_name    TEXT,
      quiz_id      TEXT NOT NULL,
      quiz_name    TEXT,
      score        INTEGER NOT NULL,
      total        INTEGER NOT NULL,
      time_taken   INTEGER,
      percentage   INTEGER,
      submitted_at TEXT
    )
  `;

  return sql;
}

const DEFAULT_DATA = {
  classes: [
    { id: 'cls1', name: 'Class 10', emoji: '🏫', sub: 'CBSE · All Subjects' },
    { id: 'cls2', name: 'Class 12', emoji: '🎓', sub: 'Science & Arts · CBSE' },
  ],
  subjects: [],
  chapters: [],
  quizzes: [],
  premiumClasses: [],
  premiumSubjects: [],
  premiumChapters: [],
  premiumQuizzes: [],
  plans: [
    { id: 'pl1', name: 'Weekly Plan', price: 10, days: 7, emoji: '⚡', desc: '7 दिनों के लिए Full Access' },
    { id: 'pl2', name: 'Monthly Plan', price: 30, days: 30, emoji: '👑', desc: '30 दिनों के लिए Full Access' },
  ],
  paymentMethods: [
    { id: 'pm3', name: 'QR Code', icon: '📷', upi: '8429415544@fam', desc: 'Scan & Pay · Any UPI App' },
  ],
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const sql = await getSQL();
    const { action } = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // ── GET ALL APP DATA ──────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'get') {
      const rows = await sql`SELECT value FROM app_data WHERE key = 'main'`;
      const data = rows.length > 0 ? rows[0].value : DEFAULT_DATA;
      return { statusCode: 200, headers, body: JSON.stringify({ data }) };
    }

    // ── SAVE ALL APP DATA (Admin) ─────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'save') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { data } = body;
      if (!data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No data' }) };

      await sql`
        INSERT INTO app_data (key, value)
        VALUES ('main', ${JSON.stringify(data)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SUBMIT PAYMENT REQUEST ────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'pay-request') {
      const { req } = body;
      if (!req) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No request' }) };

      await sql`
        INSERT INTO payment_requests
          (id, user_id, user_name, user_phone, plan_id, plan_name, price, days, method, submitted_at, status)
        VALUES
          (${req.id}, ${req.userId}, ${req.userName}, ${req.userPhone},
           ${req.planId}, ${req.planName}, ${req.price}, ${req.days},
           ${req.method}, ${req.submittedAt}, 'pending')
        ON CONFLICT (id) DO NOTHING
      `;

      // Mark user as pending in users table
      await sql`
        UPDATE users SET pending_plan = ${req.id} WHERE id = ${req.userId}
      `;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── GET ALL PAYMENT REQUESTS (Admin) ──────────────────────────
    if (event.httpMethod === 'GET' && action === 'pay-requests') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const rows = await sql`SELECT * FROM payment_requests ORDER BY submitted_at DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ requests: rows }) };
    }

    // ── APPROVE PAYMENT ───────────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'approve') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { reqId } = body;
      const rows = await sql`SELECT * FROM payment_requests WHERE id = ${reqId}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

      const req = rows[0];
      const now = new Date().toISOString();
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + req.days);

      // Update payment request status
      await sql`
        UPDATE payment_requests
        SET status = 'approved', approved_at = ${now}
        WHERE id = ${reqId}
      `;

      // Update user plan in users table
      const plan = {
        planId: req.plan_id,
        planName: req.plan_name,
        price: req.price,
        days: req.days,
        activatedAt: now,
        expiry: expiry.toISOString(),
      };

      await sql`
        UPDATE users
        SET plan = ${JSON.stringify(plan)}::jsonb, pending_plan = NULL
        WHERE id = ${req.user_id}
      `;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, plan }) };
    }

    // ── REJECT PAYMENT ────────────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'reject') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { reqId } = body;

      // ✅ FIX: Pehle user_id fetch karo, phir status update karo
      const rows = await sql`SELECT user_id FROM payment_requests WHERE id = ${reqId}`;
      if (rows.length) {
        await sql`UPDATE users SET pending_plan = NULL WHERE id = ${rows[0].user_id}`;
      }
      await sql`UPDATE payment_requests SET status = 'rejected' WHERE id = ${reqId}`;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE USER (Admin) ───────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'delete-user') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { userId } = body;
      await sql`DELETE FROM payment_requests WHERE user_id = ${userId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── GET ALL USERS (Admin) ─────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'users') {
      // ✅ FIX: Admin token check
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const rows = await sql`SELECT * FROM users ORDER BY created_at DESC`;
      const users = rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        // ✅ FIX: pass field kabhi return mat karo
        plan: r.plan || null,
        pendingPlan: r.pending_plan || null,
        createdAt: r.created_at,
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ users }) };
    }

    // ── SAVE QUIZ SCORE (Student) ─────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'save-score') {
      const { userId, userName, quizId, quizName, score, total, timeTaken } = body;
      if (!userId || !quizId || score === undefined || !total) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      }
      // ✅ FIX: CREATE TABLE ab getSQL() mein hai, yahan dobara nahi
      const id = 'sc' + Date.now() + Math.random().toString(36).slice(2,6);
      const percentage = Math.round((score / total) * 100);
      const submittedAt = new Date().toISOString();
      await sql`
        INSERT INTO quiz_scores (id, user_id, user_name, quiz_id, quiz_name, score, total, time_taken, percentage, submitted_at)
        VALUES (${id}, ${userId}, ${userName||'Unknown'}, ${quizId}, ${quizName||'Quiz'}, ${score}, ${total}, ${timeTaken||0}, ${percentage}, ${submittedAt})
      `;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, percentage }) };
    }

    // ── GET LEADERBOARD ─────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'leaderboard') {
      const { quizId } = event.queryStringParameters || {};
      // ✅ FIX: CREATE TABLE ab getSQL() mein hai, yahan dobara nahi
      let rows;
      if (quizId) {
        rows = await sql`
          SELECT DISTINCT ON (user_id) user_id, user_name, quiz_id, quiz_name,
            score, total, time_taken, percentage, submitted_at
          FROM quiz_scores
          WHERE quiz_id = ${quizId}
          ORDER BY user_id, percentage DESC, time_taken ASC
        `;
      } else {
        // Global — best score overall per user
        rows = await sql`
          SELECT DISTINCT ON (user_id) user_id, user_name, quiz_id, quiz_name,
            score, total, time_taken, percentage, submitted_at
          FROM quiz_scores
          ORDER BY user_id, percentage DESC, time_taken ASC
        `;
      }
      // Sort by percentage desc, time asc
      const sorted = rows.sort((a,b) => b.percentage - a.percentage || a.time_taken - b.time_taken);
      return { statusCode: 200, headers, body: JSON.stringify({ leaderboard: sorted }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('db function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

