const express = require("express");
const wrapAsync = require("../lib/wrapAsync");
const { SESSION_COOKIE, verifyCredentials, createSession, destroySession, getSession } = require("../lib/auth");

const router = wrapAsync(express.Router());

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await verifyCredentials(email, password);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = createSession(user);
  res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS);
  res.json({ ok: true, role: user.role, client_id: user.client_id, clipper_id: user.clipper_id });
});

router.post("/logout", async (req, res) => {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  destroySession(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const session = getSession(req.cookies && req.cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  res.json({ email: session.email, role: session.role, client_id: session.client_id, clipper_id: session.clipper_id });
});

module.exports = router;
