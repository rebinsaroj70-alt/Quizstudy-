// netlify/functions/get-quiz-url.js
// Secure quiz URL delivery — URL sirf server se milta hai
// Premium quiz ke liye user ka premium plan check karta hai

const { neon } = require('@neondatabase/serverless');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // Only GET allowed
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { quizId, type, userId } = event.queryStringParameters || {};

  if (!quizId || !type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parameters' }) };
  }

  try {
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // Premium quiz ke liye user ka plan check karo
    if (type === 'premium') {
      if (!userId) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'LOGIN_REQUIRED' }),
        };
      }

      // User DB se fetch karo
      const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
      if (users.length === 0) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'USER_NOT_FOUND' }),
        };
      }

      const user = users[0];
      const plan = user.plan;

      // Plan active hai ya nahi check karo
      const now = Date.now();
      const isActive = plan &&
        (plan.expiry || plan.expiresAt) &&
        new Date(plan.expiry || plan.expiresAt).getTime() > now;

      if (!isActive) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'PREMIUM_REQUIRED' }),
        };
      }
    }

    // App data se quiz URL fetch karo
    const rows = await sql`SELECT value FROM app_data WHERE key = 'main'`;
    if (rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Data not found' }) };
    }

    const appData = rows[0].value;
    const quizArr = type === 'premium'
      ? (appData.premiumQuizzes || [])
      : (appData.quizzes || []);

    const quiz = quizArr.find(q => q.id === quizId);

    if (!quiz) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Quiz not found' }) };
    }

    // htmlContent hai to woh do, warna url do (backward compatibility)
    if (quiz.htmlContent) {
      return { statusCode: 200, headers, body: JSON.stringify({ htmlContent: quiz.htmlContent }) };
    } else if (quiz.url) {
      return { statusCode: 200, headers, body: JSON.stringify({ url: quiz.url }) };
    } else {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Quiz content not found' }) };
    }

  } catch (err) {
    console.error('get-quiz-url error', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};

