import jwt from "jsonwebtoken";

export function signToken(user) {
  return jwt.sign({ id: user.id, address: user.address }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

// Hard auth: 401 if no/invalid token
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// Soft auth: attaches req.user if present, never blocks
export function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {} }
  next();
}
