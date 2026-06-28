const { SESSION_COOKIE, getSession } = require("../lib/auth");

function sessionFromRequest(req) {
  return getSession(req.cookies && req.cookies[SESSION_COOKIE]);
}

// Protects API routes: returns 401 JSON instead of redirecting.
function requireAuth(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.authUser = session;
  next();
}

// Admin-only API routes. Must run after requireAuth.
function requireAdmin(req, res, next) {
  if (!req.authUser || req.authUser.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
  next();
}

// Protects page/static routes: redirects to the login page.
// Non-admins are kept off the main dashboard and bounced to their own client page.
function requireAuthPage(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.redirect("/login.html");
  }
  req.authUser = session;

  const isDashboardPage = req.path === "/" || req.path === "/index.html";
  if (isDashboardPage && session.role === "client") {
    return res.redirect(`/client.html?id=${session.client_id}`);
  }
  if (isDashboardPage && session.role === "clipper") {
    return res.redirect(`/clipper.html?id=${session.clipper_id}`);
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireAuthPage };
