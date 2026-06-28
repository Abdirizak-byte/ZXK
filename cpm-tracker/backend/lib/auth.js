const crypto = require("crypto");
const pool = require("../db");

const SESSION_COOKIE = "cpm_session";

// token -> { id, email, role, client_id, clipper_id }
const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

async function verifyCredentials(email, password) {
  if (!email || !password) return null;

  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  if (rows.length === 0) return null;

  const user = rows[0];
  const candidate = hashPassword(password, user.password_salt);
  const candidateBuf = Buffer.from(candidate, "hex");
  const expectedBuf = Buffer.from(user.password_hash, "hex");
  if (candidateBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(candidateBuf, expectedBuf)) return null;

  return { id: user.id, email: user.email, role: user.role, client_id: user.client_id, clipper_id: user.clipper_id };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, user);
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function getSession(token) {
  return (token && sessions.get(token)) || null;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyCredentials,
  createSession,
  destroySession,
  getSession,
};
