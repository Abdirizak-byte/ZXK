const pool = require("../db");

async function getRate() {
  const { rows } = await pool.query("SELECT rate_views, rate_cents FROM settings LIMIT 1");
  const row = rows[0] || { rate_views: 100000, rate_cents: 500 };
  return { views: Number(row.rate_views), cents: Number(row.rate_cents) };
}

async function setRate(views, cents) {
  const { rows } = await pool.query(
    `UPDATE settings SET rate_views = $1, rate_cents = $2, updated_at = NOW()
     WHERE id = (SELECT id FROM settings LIMIT 1)
     RETURNING rate_views, rate_cents`,
    [views, cents]
  );
  const row = rows[0];
  return { views: Number(row.rate_views), cents: Number(row.rate_cents) };
}

module.exports = { getRate, setRate };
