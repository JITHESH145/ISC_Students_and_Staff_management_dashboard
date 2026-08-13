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
// This function closes that gap with the Firebase Admin SDK (a service
// account), which CAN manage Auth accounts by email:
//   • action:'resolve' → return the existing Auth uid for an email, so a
//     re-add can adopt it and rebuild the Firestore docs (heals orphans).
//   • action:'delete'  → actually delete the Auth account, so permanent
//     delete removes BOTH halves and no orphan is ever created again.
//
// Admin Auth operations (getUserByEmail / deleteUser / verifyIdToken) are
// free on the Spark plan — no Blaze upgrade needed.
//
// FEATURE FLAG: if FIREBASE_SERVICE_ACCOUNT is not set, this returns
// { status: 'disabled' } and the client falls back to its tombstone path.
//
// Required Vercel env var:
//   FIREBASE_SERVICE_ACCOUNT  the service-account JSON (raw or base64).
//     Firebase console → Project settings → Service accounts →
//     "Generate new private key". Paste the whole JSON as the value.
// ─────────────────────────────────────────────────────────────────
const ALLOWED_EMAIL_DOMAIN = 'internationalskillsclub.com';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  // Accept either raw JSON or a base64-encoded blob (Vercel-friendly).
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  // Pasted JSON keeps the private key's newlines as literal "\n"; some
  // paste paths double-escape them. Normalise so cert() accepts the key.
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

// Dynamically load + init the Admin SDK inside a try/catch so a bundling
// failure or a malformed service account returns a readable JSON status
// instead of crashing the whole function (FUNCTION_INVOCATION_FAILED).
// Returns { auth, firestore } on success, or { error } / { disabled }.
let _cached = null;
async function loadAdmin() {
  if (_cached) return _cached;
  const sa = (() => { try { return getServiceAccount(); } catch (e) { return { __parseError: String(e.message || e) }; } })();
  if (!sa) return { disabled: true };
  if (sa.__parseError) return { error: `service-account parse failed: ${sa.__parseError}` };
  try {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) initializeApp({ credential: cert(sa) });
    _cached = { auth: getAuth(), firestore: getFirestore() };
    return _cached;
  } catch (e) {
    return { error: `admin init failed: ${String(e.message || e)}` };
  }
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

  // Load Admin SDK. Feature flag: no service account → 'disabled' so the
  // client's fallback path is never blocked. Init error → 200 disabled too
  // (so re-adds still fall back gracefully) but with a diagnostic string.
  const admin = await loadAdmin();
  if (admin.disabled) return res.status(200).json({ status: 'disabled' });
  if (admin.error)    return res.status(200).json({ status: 'disabled', reason: admin.error });
  const { auth, firestore } = admin;

  // ── Authn: valid Firebase ID token ──
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'unauthorized' });

  let caller;
  try {
    caller = await auth.verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: 'invalid-token' });
  }

  // ── Authz: caller must be an active CEO (roles/{uid}) ──
  try {
    const snap = await firestore.doc(`roles/${caller.uid}`).get();
    const role = snap.exists ? snap.data() : null;
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
      try {
        const user = await auth.getUserByEmail(email);
        return res.status(200).json({ status: 'ok', uid: user.uid });
      } catch (e) {
        if (e.code === 'auth/user-not-found') return res.status(200).json({ status: 'not-found' });
        throw e;
      }
    }

    if (action === 'delete') {
      let uid = uidIn;
      if (!uid && email) {
        try {
          uid = (await auth.getUserByEmail(email)).uid;
        } catch (e) {
          if (e.code === 'auth/user-not-found') return res.status(200).json({ status: 'already-gone' });
          throw e;
        }
      }
      if (!uid) return res.status(400).json({ status: 'bad-request' });
      // Never let a CEO delete their own login through this endpoint.
      if (uid === caller.uid) return res.status(400).json({ status: 'self-delete-forbidden' });
      try {
        await auth.deleteUser(uid);
      } catch (e) {
        if (e.code === 'auth/user-not-found') return res.status(200).json({ status: 'already-gone' });
        throw e;
      }
      return res.status(200).json({ status: 'ok', uid });
    }

    return res.status(400).json({ status: 'unknown-action' });
  } catch (err) {
    return res.status(502).json({ status: 'error', error: String(err.message || err) });
  }
}
