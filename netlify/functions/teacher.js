// netlify/functions/teacher.js
// Teacher signup, login, dashboard — School Mode ke liye

const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

function checkAdminToken(event) {
  const token = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token'])) || '';
  return token === process.env.ADMIN_SECRET_TOKEN;
}

async function getSQL() {
  const sql = neon(process.env.NETLIFY_DATABASE_URL);

  // Teachers table
  await sql`
    CREATE TABLE IF NOT EXISTS teachers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      phone       TEXT UNIQUE NOT NULL,
      pass        TEXT NOT NULL,
      school_id   TEXT NOT NULL,
      school_name TEXT NOT NULL,
      class_ids   TEXT[],
      created_at  TEXT
    )
  `;

  // Schools table
  await sql`
    CREATE TABLE IF NOT EXISTS schools (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      address     TEXT,
      principal   TEXT,
      phone       TEXT,
      created_at  TEXT,
      active      BOOLEAN DEFAULT true
    )
  `;

  return sql;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const sql = await getSQL();
    const { action } = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // ── ADD SCHOOL (Admin only) ───────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'add-school') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { name, address, principal, phone } = body;
      if (!name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'School name required' }) };

      const id = 'sch' + Date.now() + Math.random().toString(36).slice(2, 6);
      const createdAt = new Date().toISOString();

      await sql`
        INSERT INTO schools (id, name, address, principal, phone, created_at, active)
        VALUES (${id}, ${name}, ${address||''}, ${principal||''}, ${phone||''}, ${createdAt}, true)
      `;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id }) };
    }

    // ── GET ALL SCHOOLS (Admin) ───────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'schools') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const rows = await sql`SELECT * FROM schools ORDER BY created_at DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ schools: rows }) };
    }

    // ── GET SCHOOLS PUBLIC (for dropdown) ────────────────────────
    if (event.httpMethod === 'GET' && action === 'schools-list') {
      const rows = await sql`SELECT id, name FROM schools WHERE active = true ORDER BY name`;
      return { statusCode: 200, headers, body: JSON.stringify({ schools: rows }) };
    }

    // ── DELETE SCHOOL (Admin) ─────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'delete-school') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { schoolId } = body;
      await sql`DELETE FROM teachers WHERE school_id = ${schoolId}`;
      await sql`DELETE FROM schools WHERE id = ${schoolId}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── ADD TEACHER (Admin only) ──────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'add-teacher') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { name, phone, pass, schoolId, schoolName, classIds } = body;
      if (!name || !phone || !pass || !schoolId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      }

      // Check duplicate phone
      const existing = await sql`SELECT id FROM teachers WHERE phone = ${phone}`;
      if (existing.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'Phone already registered' }) };
      }

      const hashedPass = await bcrypt.hash(pass, 10);
      const id = 'tch' + Date.now() + Math.random().toString(36).slice(2, 6);
      const createdAt = new Date().toISOString();

      await sql`
        INSERT INTO teachers (id, name, phone, pass, school_id, school_name, class_ids, created_at)
        VALUES (${id}, ${name}, ${phone}, ${hashedPass}, ${schoolId}, ${schoolName}, ${classIds||[]}, ${createdAt})
      `;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id }) };
    }

    // ── TEACHER LOGIN ─────────────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'login') {
      const { phone, pass } = body;
      if (!phone || !pass) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone aur password daalen' }) };
      }

      const rows = await sql`SELECT * FROM teachers WHERE phone = ${phone}`;
      if (!rows.length) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'गलत Phone या Password' }) };
      }

      const teacher = rows[0];
      const passMatch = await bcrypt.compare(pass, teacher.pass);
      if (!passMatch) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'गलत Phone या Password' }) };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          teacher: {
            id: teacher.id,
            name: teacher.name,
            phone: teacher.phone,
            schoolId: teacher.school_id,
            schoolName: teacher.school_name,
            classIds: teacher.class_ids || [],
          }
        })
      };
    }

    // ── GET TEACHER (by id) ───────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'get-teacher') {
      const { id } = event.queryStringParameters || {};
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };

      const rows = await sql`SELECT * FROM teachers WHERE id = ${id}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Teacher not found' }) };

      const t = rows[0];
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          teacher: {
            id: t.id, name: t.name, phone: t.phone,
            schoolId: t.school_id, schoolName: t.school_name,
            classIds: t.class_ids || [],
          }
        })
      };
    }

    // ── GET ALL TEACHERS (Admin) ──────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'teachers') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const rows = await sql`SELECT * FROM teachers ORDER BY created_at DESC`;
      const teachers = rows.map(t => ({
        id: t.id, name: t.name, phone: t.phone,
        schoolId: t.school_id, schoolName: t.school_name,
        classIds: t.class_ids || [], createdAt: t.created_at,
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ teachers }) };
    }

    // ── DELETE TEACHER (Admin) ────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'delete-teacher') {
      if (!checkAdminToken(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      const { teacherId } = body;
      await sql`DELETE FROM teachers WHERE id = ${teacherId}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── GET CLASS STUDENTS (Teacher dashboard) ───────────────────
    if (event.httpMethod === 'GET' && action === 'class-students') {
      const { schoolId, classId } = event.queryStringParameters || {};
      if (!schoolId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing schoolId' }) };

      // Users jo is school mein hain (school_id match kare)
      let rows;
      if (classId) {
        rows = await sql`
          SELECT id, name, phone, plan, pending_plan, created_at, school_id, class_id
          FROM users
          WHERE school_id = ${schoolId} AND class_id = ${classId}
          ORDER BY name
        `;
      } else {
        rows = await sql`
          SELECT id, name, phone, plan, pending_plan, created_at, school_id, class_id
          FROM users
          WHERE school_id = ${schoolId}
          ORDER BY class_id, name
        `;
      }

      const students = rows.map(r => ({
        id: r.id, name: r.name, phone: r.phone,
        plan: r.plan || null, pendingPlan: r.pending_plan || null,
        createdAt: r.created_at, classId: r.class_id,
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ students }) };
    }

    // ── GET CLASS SCORES (Teacher dashboard) ─────────────────────
    if (event.httpMethod === 'GET' && action === 'class-scores') {
      const { schoolId, classId } = event.queryStringParameters || {};
      if (!schoolId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing schoolId' }) };

      let rows;
      if (classId) {
        rows = await sql`
          SELECT qs.* FROM quiz_scores qs
          JOIN users u ON u.id = qs.user_id
          WHERE u.school_id = ${schoolId} AND u.class_id = ${classId}
          ORDER BY qs.submitted_at DESC
          LIMIT 200
        `;
      } else {
        rows = await sql`
          SELECT qs.* FROM quiz_scores qs
          JOIN users u ON u.id = qs.user_id
          WHERE u.school_id = ${schoolId}
          ORDER BY qs.submitted_at DESC
          LIMIT 200
        `;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ scores: rows }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('teacher function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
