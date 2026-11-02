// Employee sign-in: who may log in, password checks, and signed session cookies.
// Configured with Vercel environment variables (Settings → Environment Variables):
//   SESSION_SECRET  — any long random string (32+ characters). Required; sign-in is off without it.
//   JVM_USERS       — one entry per employee, separated by commas or new lines. Each entry is either
//                       email:password                      (typed straight into Vercel), or
//                       email:salt:hash                     (from node scripts/add-user.mjs, password not stored)
//   ALLOWED_DOMAIN  — optional, defaults to jvmlending.com. Only emails at this domain can sign in.
import crypto from "node:crypto";

export const COOKIE = "jvm_tour_session";
export const SESSION_HOURS = 12;
const DOMAIN = (process.env.ALLOWED_DOMAIN || "jvmlending.com").toLowerCase().trim();

function secret() {
  const s = process.env.SESSION_SECRET || "";
  return s.length >= 32 ? s : null;
}
export function authConfigured() { return !!secret() && users().size > 0; }

export function allowedEmail(email) {
  return typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email) && email.toLowerCase().endsWith("@" + DOMAIN);
}

// Forgiving about how the value was pasted into Vercel: quotes around the whole list or an entry,
// commas or new lines between entries. Entries that don't fit either form (e.g. examples) are skipped.
const unquote = v => String(v || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
let warned = false;
// Built-in account (password stored only as a salted scrypt hash). A JVM_USERS entry for the same
// email replaces it, which is how to change this password without editing code.
const BUILT_IN = [["jvmbt@jvmlending.com", { salt: "0f3048fced7ec277bbf48e9434046e33", hash: "05251ede6d8b998321b1bd6eb7913f1412f4929a8eecd36022159970b8fe1a7c" }]];
function users() {
  const map = new Map(BUILT_IN), dups = new Set();
  for (const raw of unquote(process.env.JVM_USERS).split(/[,\r\n]+/)) {
    const entry = unquote(raw);
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const email = entry.slice(0, i).trim(), rest = entry.slice(i + 1);
    if (!allowedEmail(email)) continue;
    let rec;
    const h = rest.match(/^([0-9a-f]{32}):([0-9a-f]{64})$/i);
    if (h) rec = { salt: h[1], hash: h[2] };                       // made by add-user.mjs
    else if (rest.length && !/REPLACE_WITH_/.test(rest)) rec = { plain: rest }; // typed straight into Vercel
    else continue;
    const k = email.toLowerCase();
    if (map.has(k) && !BUILT_IN.some(([e]) => e === k)) dups.add(k);
    map.set(k, rec); // if an email is listed twice, the LAST entry is the one that counts
  }
  if (dups.size && !warned) { warned = true; console.warn("[sign-in] JVM_USERS lists these emails more than once; the last entry for each is used: " + [...dups].join(", ")); }
  return map;
}
// Why a sign-in failed, for Vercel's logs only (never shown on the page).
export function whyFailed(email, password) {
  const list = users(), k = String(email || "").toLowerCase().trim();
  if (!list.size) return "JVM_USERS has no valid entries (check that it is set for Production and was redeployed)";
  if (!list.has(k)) return k + " is not in JVM_USERS (" + list.size + " account" + (list.size > 1 ? "s" : "") + " loaded: " + [...list.keys()].join(", ") + ")";
  return "password does not match the JVM_USERS entry for " + k;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return { salt, hash };
}

const DUMMY = hashPassword("not-a-real-password", "0".repeat(32));
export function checkPassword(email, password) {
  const u = users().get(String(email || "").toLowerCase().trim());
  if (u && u.plain != null) {
    // compare fixed-length digests so the check takes the same time whatever was typed
    const a = crypto.createHash("sha256").update(String(password)).digest();
    const b = crypto.createHash("sha256").update(u.plain).digest();
    return crypto.timingSafeEqual(a, b);
  }
  // Always run the hash so a wrong email takes as long as a wrong password.
  const ref = u || DUMMY;
  const got = Buffer.from(hashPassword(password, ref.salt).hash, "hex");
  const want = Buffer.from(ref.hash, "hex");
  return !!u && got.length === want.length && crypto.timingSafeEqual(got, want);
}

const b64u = buf => Buffer.from(buf).toString("base64url");
function sign(payload) { return b64u(crypto.createHmac("sha256", secret()).update(payload).digest()); }

export function makeSessionCookie(email) {
  const payload = b64u(JSON.stringify({ u: email.toLowerCase(), exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const value = payload + "." + sign(payload);
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}
export function clearSessionCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

// Returns the signed-in email, or null.
export function readSession(cookieHeader) {
  if (!secret()) return null;
  const m = String(cookieHeader || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!u || typeof exp !== "number" || exp < Date.now()) return null;
    if (!users().has(u)) return null; // removing someone from JVM_USERS signs them out
    return u;
  } catch { return null; }
}
