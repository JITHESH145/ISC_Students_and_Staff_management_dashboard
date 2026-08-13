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
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const ALLOWED_EMAIL_DOMAIN = 'internationalskillsclub.com';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  try {
    // Accept either raw JSON or a base64-encoded blob (Vercel-friendly).
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Init the Admin app once per warm instance. Returns false when no
// service account is configured (feature flag off).
function ensureAdmin() {
  if (getApps().length) return true;
  const sa = getServiceAccount();
  if (!sa) return false;
  initializeApp({ credential: cert(sa) });
  return true;
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

  // Feature flag: no service account → do nothing, succeed quietly so the
  // client's fallback path is never blocked.
  if (!ensureAdmin()) return res.status(200).json({ status: 'disabled' });

  // ── Authn: valid Firebase ID token ──
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'unauthorized' });

  let caller;
  try {
    caller = await getAuth().verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: 'invalid-token' });
  }

  // ── Authz: caller must be an active CEO (roles/{uid}) ──
  try {
    const snap = await getFirestore().doc(`roles/${caller.uid}`).get();
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
        const user = await getAuth().getUserByEmail(email);
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
          uid = (await getAuth().getUserByEmail(email)).uid;
        } catch (e) {
          if (e.code === 'auth/user-not-found') return res.status(200).json({ status: 'already-gone' });
          throw e;
        }
      }
      if (!uid) return res.status(400).json({ status: 'bad-request' });
      // Never let a CEO delete their own login through this endpoint.
      if (uid === caller.uid) return res.status(400).json({ status: 'self-delete-forbidden' });
      try {
        await getAuth().deleteUser(uid);
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
