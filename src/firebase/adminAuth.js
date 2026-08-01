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
      // The Auth account survives staff deletion. If a tombstone matches
      // this email, adopt the old uid and rebuild the Firestore docs —
      // this is the "delete then re-add" path.
      const orphan = await findDeletedStaffAccount(cleanEmail).catch(() => null);
      if (orphan?.uid) {
        await writeStaffDocs({ uid: orphan.uid, name, email: cleanEmail, role, subjects });
        await deleteDoc(doc(db, 'deletedStaff', orphan.id)).catch(() => {});
        const mainAuth = getAuth(getApp());
        await sendPasswordResetEmail(mainAuth, cleanEmail);
        return { success: true, uid: orphan.uid, restored: true };
      }
      throw new Error(
        'This email already has a login account from before. Ask the staff ' +
        'member to sign in to the app once with this email (their account ' +
        're-registers itself), then click Add again — it will reactivate ' +
        'their old account automatically.'
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