// ─────────────────────────────────────────────────────────────────
// Vercel serverless function — privileged staff-account admin.
//
// WHY THIS EXISTS
// Firebase splits every person into TWO independent records:
//   1. an Authentication account (the login: email + password + uid)
//   2. Firestore documents (staff/, roles/, staffDirectory/ — the app data)
// The browser/client SDK can create an Auth account and can only delete
// *its own* signed-in account — it can neither look up nor delete another
// user's Auth account by email. So when a staff member is removed (whether
// from the app or straight from the Firebase console) their Firestore docs
// go but the Auth account lingers, and re-adding the same email fails with
// `auth/email-already-in-use` with no way for the client to recover the uid.
//
// This function closes that gap using the service account to call Google's
// REST APIs directly (no firebase-admin SDK — it pulls in a jose/jwks-rsa
// ESM conflict that crashes on Vercel). Only `jsonwebtoken` + `fetch` are
// used, the same proven stack as api/send-email.js.
//   • action:'resolve' → return the existing Auth uid for an email, so a
//     re-add can adopt it and rebuild the Firestore docs (heals orphans).
//   • action:'delete'  → delete the Auth account, so permanent delete
//     removes BOTH halves and no orphan is ever created again.
//
// FEATURE FLAG: if FIREBASE_SERVICE_ACCOUNT is not set (or unparseable),
// this returns { status:'disabled' } and the client falls back to its
// tombstone path.
//
// Required Vercel env var:
//   FIREBASE_SERVICE_ACCOUNT  the service-account JSON (raw or base64).
//     Firebase console → Project settings → Service accounts →
//     "Generate new private key". Paste the whole JSON as the value.
// ─────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';

const ALLOWED_EMAIL_DOMAIN = 'internationalskillsclub.com';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'isc-sms-test';

// Google's public x509 certs for verifying Firebase ID tokens.
const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let _certs = null, _certsAt = 0;
async function getGoogleCerts() {
  if (_certs && Date.now() - _certsAt < 60 * 60 * 1000) return _certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('cert fetch failed');
  _certs = await res.json();
  _certsAt = Date.now();
  return _certs;
}

// Verify a caller's Firebase ID token (no service account needed).
async function verifyIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('no kid');
  const certs = await getGoogleCerts();
  const cert = certs[decoded.header.kid];
  if (!cert) throw new Error('unknown kid');
  return jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: PROJECT_ID,
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
  });
}

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  // Pasted JSON keeps the private key's newlines as literal "\n".
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

// Mint a Google OAuth2 access token from the service account (JWT-bearer
// grant). Cached until shortly before expiry.
let _accessToken = null, _accessExp = 0;
async function getAccessToken(sa) {
  if (_accessToken && Date.now() < _accessExp - 60_000) return _accessToken;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' },
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`oauth token exchange failed: ${JSON.stringify(j)}`);
  }
  _accessToken = j.access_token;
  _accessExp = Date.now() + (j.expires_in || 3600) * 1000;
  return _accessToken;
}

// Read roles/{uid} via the Firestore REST API (admin — bypasses rules).
async function getRoleDoc(accessToken, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/roles/${encodeURIComponent(uid)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore read failed: ${res.status}`);
  const doc = await res.json();
  const f = doc.fields || {};
  return { role: f.role?.stringValue, active: f.active?.booleanValue };
}

// Identity Toolkit admin: look up an account by email → uid (or null).
async function lookupUidByEmail(accessToken, email) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    },
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`lookup failed: ${JSON.stringify(j)}`);
  return j.users && j.users[0] ? j.users[0].localId : null;
}

// Identity Toolkit admin: delete an account by uid.
async function deleteAuthUser(accessToken, uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
    },
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`delete failed: ${JSON.stringify(j)}`);
}

const isCompanyEmail = (s) =>
  typeof s === 'string' && s.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);

export default async function handler(req, res) {
  // CORS (same-origin in production; permissive for local `vercel dev`)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'method-not-allowed' });

  // Feature flag: no/invalid service account → 'disabled' so the client's
  // fallback path is never blocked.
  let sa;
  try {
    sa = getServiceAccount();
  } catch (e) {
    return res.status(200).json({ status: 'disabled', reason: `service-account parse failed: ${String(e.message || e)}` });
  }
  if (!sa) return res.status(200).json({ status: 'disabled' });

  // ── Authn: valid Firebase ID token ──
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'unauthorized' });

  let caller;
  try {
    caller = await verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: 'invalid-token' });
  }
  const callerUid = caller.sub || caller.user_id;

  // Mint the admin access token once for this request.
  let accessToken;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    return res.status(200).json({ status: 'disabled', reason: String(e.message || e) });
  }

  // ── Authz: caller must be an active CEO (roles/{uid}) ──
  try {
    const role = await getRoleDoc(accessToken, callerUid);
    if (!role || role.active !== true || role.role !== 'ceo') {
      return res.status(403).json({ status: 'forbidden' });
    }
  } catch {
    return res.status(500).json({ status: 'role-check-failed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const action = body.action;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const uidIn = typeof body.uid === 'string' ? body.uid : '';

  // Every operation is scoped to company-domain emails only.
  if (email && !isCompanyEmail(email)) {
    return res.status(400).json({ status: 'bad-domain' });
  }

  try {
    if (action === 'resolve') {
      if (!email) return res.status(400).json({ status: 'bad-request' });
      const uid = await lookupUidByEmail(accessToken, email);
      return res.status(200).json(uid ? { status: 'ok', uid } : { status: 'not-found' });
    }

    if (action === 'delete') {
      let uid = uidIn;
      if (!uid && email) uid = await lookupUidByEmail(accessToken, email);
      if (!uid) return res.status(200).json({ status: 'already-gone' });
      // Never let a CEO delete their own login through this endpoint.
      if (uid === callerUid) return res.status(400).json({ status: 'self-delete-forbidden' });
      await deleteAuthUser(accessToken, uid);
      return res.status(200).json({ status: 'ok', uid });
    }

    return res.status(400).json({ status: 'unknown-action' });
  } catch (err) {
    return res.status(502).json({ status: 'error', error: String(err.message || err) });
  }
}
