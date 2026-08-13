// ─────────────────────────────────────────────────────────────
// Creates staff Firebase Auth accounts WITHOUT logging out CEO.
// Uses a secondary Firebase app instance — free plan compatible.
// ─────────────────────────────────────────────────────────────
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import {
  doc, setDoc, deleteDoc, getDocs, query, where, collection, limit
} from 'firebase/firestore';
import { db } from './config';

// Company-domain rule (mirrors AuthContext — kept literal here to avoid
// a context import inside the firebase layer).
const ALLOWED_EMAIL_DOMAIN = 'internationalskillsclub.com';

const SECONDARY_APP_NAME = 'isc-staff-creator';

// Base URL for the privileged /api/staff-admin serverless function.
// Same origin in production; VITE_NOTIFY_API_BASE overrides for local dev.
const ADMIN_API = import.meta.env.VITE_NOTIFY_API_BASE ?? '';

// Call the Admin-SDK-backed staff-admin function with the caller's ID token.
// Returns { status } — 'disabled' when the service account isn't configured,
// so callers must treat it as best-effort and fall back gracefully.
const callStaffAdmin = async (payload) => {
  try {
    const current = getAuth(getApp()).currentUser;
    if (!current) return { status: 'no-auth' };
    const token = await current.getIdToken();
    const res = await fetch(`${ADMIN_API}/api/staff-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({ status: 'error' }));
  } catch {
    return { status: 'error' };
  }
};

// Look up the Auth uid for an email via the server (Admin SDK). This is the
// authoritative way to recover an orphaned account regardless of HOW it was
// deleted (app or Firebase console). Returns a uid or null.
const resolveAuthUidByEmail = async (email) => {
  const r = await callStaffAdmin({ action: 'resolve', email });
  return r?.status === 'ok' && r.uid ? r.uid : null;
};

// Permanently delete a person's Firebase Auth account (server-side, Admin
// SDK). Best-effort: returns the server status. 'disabled' when the service
// account isn't set — in that case the Auth account survives and the
// tombstone path keeps re-adds working.
export const deleteStaffAuthAccount = ({ uid, email }) =>
  callStaffAdmin({ action: 'delete', uid, email: (email || '').toLowerCase() });

// Re-send the password-setup / login link. Same email Firebase sends at
// account creation — used by the "Resend setup email" button.
export const resendStaffSetupEmail = async (email) => {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} addresses are supported.`);
  }
  await sendPasswordResetEmail(getAuth(getApp()), cleanEmail);
  return { success: true };
};

const getSecondaryApp = () => {
  // Check if secondary app already exists
  const existing = getApps().find(app => app.name === SECONDARY_APP_NAME);
  if (existing) return existing;

  // Create secondary app using same config as main app
  const mainApp = getApp();
  return initializeApp(mainApp.options, SECONDARY_APP_NAME);
};

// Writes the three Firestore docs every staff member needs.
const writeStaffDocs = async ({ uid, name, email, role, subjects }) => {
  await setDoc(doc(db, 'staff', uid), {
    uid,
    name,
    email,
    role,
    subjects:       subjects || [],
    active:         true,
    needsAuthSetup: false, // no Firebase Console needed!
    createdAt:      new Date().toISOString(),
  });

  // Authorization source of truth — rules check /roles/{uid}, not the
  // staff profile (which the user could otherwise self-edit).
  await setDoc(doc(db, 'roles', uid), { role, active: true });

  // Safe directory mirror for staff-facing pickers (no fcmToken).
  await setDoc(doc(db, 'staffDirectory', uid), {
    name, email, role, subjects: subjects || [], active: true,
  });
};

// Deleting a staff member can only remove their Firestore docs — the
// browser cannot delete another user's Firebase Auth account. A
// tombstone in /deletedStaff (CEO-only) records the orphaned Auth
// account's uid + email so a later re-add can adopt it instead of
// failing with auth/email-already-in-use.
export const recordDeletedStaffAccount = async ({ uid, email, name, role }) =>
  setDoc(doc(db, 'deletedStaff', uid), {
    uid,
    email:     (email || '').toLowerCase(),
    name:      name || '',
    role:      role || 'staff',
    deletedAt: new Date().toISOString(),
  });

const findDeletedStaffAccount = async (email) => {
  const q = query(
    collection(db, 'deletedStaff'),
    where('email', '==', (email || '').toLowerCase()),
    limit(1),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// Call this from StaffManagement to create a staff account
// CEO stays logged in — secondary app is completely isolated
export const createStaffAccount = async ({ name, email, role, subjects }) => {
  if (!email?.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new Error(`Staff accounts must use a @${ALLOWED_EMAIL_DOMAIN} email address.`);
  }
  const cleanEmail = email.trim().toLowerCase();

  // Generate a secure temporary password
  const tempPassword = generatePassword();

  try {
    // Get secondary auth instance
    const secondaryApp  = getSecondaryApp();
    const secondaryAuth = getAuth(secondaryApp);

    // Create Auth account using secondary instance — CEO NOT affected
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth, cleanEmail, tempPassword
    );
    const uid = credential.user.uid;

    // Sign out from secondary instance immediately
    await signOut(secondaryAuth);

    await writeStaffDocs({ uid, name, email: cleanEmail, role, subjects });

    // Send password reset email — staff clicks link and sets own password
    const mainAuth = getAuth(getApp());
    await sendPasswordResetEmail(mainAuth, cleanEmail);

    return { success: true, uid, tempPassword };
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      // The Auth account survives staff deletion. Recover its uid so we can
      // rebuild the Firestore docs and reactivate the person in one click.
      // Two recovery routes, in order of reliability:
      //   1. Server resolve (Admin SDK) — authoritative, works no matter how
      //      the staff member was deleted (app OR Firebase console).
      //   2. Client tombstone — free fallback, only exists when the deletion
      //      went through the app's Delete button.
      let uid = await resolveAuthUidByEmail(cleanEmail).catch(() => null);
      if (!uid) {
        const orphan = await findDeletedStaffAccount(cleanEmail).catch(() => null);
        uid = orphan?.uid || null;
      }

      if (uid) {
        await writeStaffDocs({ uid, name, email: cleanEmail, role, subjects });
        await deleteDoc(doc(db, 'deletedStaff', uid)).catch(() => {});
        const mainAuth = getAuth(getApp());
        await sendPasswordResetEmail(mainAuth, cleanEmail);
        return { success: true, uid, restored: true };
      }

      // Neither route worked — the server function isn't configured and no
      // tombstone exists. Fall back to the sign-in-once recovery.
      throw new Error(
        'This email still has a leftover login account that could not be ' +
        're-linked automatically. Ask the person to open the app and sign in ' +
        'once (use "Forgot password" to set a new password), then click Add ' +
        'again — it will reactivate their account. (Set FIREBASE_SERVICE_ACCOUNT ' +
        'in Vercel to make re-adds heal instantly.)'
      );
    }
    if (err.code === 'auth/invalid-email') {
      throw new Error('Invalid email address format.');
    }
    if (err.code === 'auth/weak-password') {
      throw new Error('Password too weak. Try again.');
    }
    throw new Error(err.message || 'Failed to create staff account.');
  }
};

// Cryptographically-secure random index in [0, max).
function randInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  const syms  = '@#$!';
  const all   = upper + lower + nums + syms;
  const chars = [
    upper[randInt(upper.length)],
    lower[randInt(lower.length)],
    nums[randInt(nums.length)],
    syms[randInt(syms.length)],
  ];
  for (let i = 0; i < 8; i++) chars.push(all[randInt(all.length)]);
  // Fisher–Yates shuffle with CSPRNG (no Math.random anywhere).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}