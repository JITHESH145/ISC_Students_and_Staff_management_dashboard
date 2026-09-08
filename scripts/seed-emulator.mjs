// ─────────────────────────────────────────────────────────────────
// Seed the local Firebase Emulator Suite with a COPY of real production
// data, so you can test against real data without ever touching the live
// project. Reads production (read-only) and writes ONLY to the emulator.
//
// What it does:
//   1. Reads every app collection from the LIVE Firestore (read-only).
//   2. Writes those docs into the local Firestore emulator (same doc IDs).
//   3. Creates matching Auth users in the local Auth emulator (from the
//      `staff` docs) with a shared dev password, so you can log in locally
//      as the real CEO / staff.
//
// It NEVER writes to production. Safe to re-run any time.
//
// Requirements:
//   - Emulators running:  npm run emulators   (in another terminal)
//   - A service-account key (read access to prod):
//       Firebase console → Project settings → Service accounts
//       → Generate new private key.  KEEP IT OUT OF GIT.
//
// Usage (from the project root):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
//     npm run seed:emulator
//   (Windows PowerShell:
//     $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\serviceAccount.json"; npm run seed:emulator)
// ─────────────────────────────────────────────────────────────────
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID       = 'isc-sms-test';         // must match src/firebase/config.js
const FIRESTORE_EMU    = 'localhost:8080';       // must match firebase.json
const AUTH_EMU         = 'localhost:9099';
const DEV_PASSWORD     = 'Test@12345';           // password for every seeded local login

// All top-level collections used by the app (see CLAUDE.md schema).
const COLLECTIONS = [
  'roles', 'staff', 'staffDirectory', 'students', 'batches', 'schedules',
  'attendance', 'classReports', 'assessments', 'assessmentResults',
  'batchTasks', 'tasks', 'followups', 'concerns', 'reports', 'leads',
  'notifications', 'requests', 'trash', 'deletedStaff',
];

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('\n✖ GOOGLE_APPLICATION_CREDENTIALS is not set.');
  console.error('  Download a service-account key (Firebase console → Project settings →');
  console.error('  Service accounts → Generate new private key), then set the env var to its path.\n');
  process.exit(1);
}

// Guard: make sure the emulator env vars are NOT set while we read production.
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

// ── 1. Read production (read-only) ─────────────────────────────
const prodApp = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'prod');
const prodDb  = getFirestore(prodApp);

console.log(`\nReading production project "${PROJECT_ID}" (read-only)…`);
const buffer = {};
let totalDocs = 0;
for (const col of COLLECTIONS) {
  try {
    const snap = await prodDb.collection(col).get();
    buffer[col] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    totalDocs += buffer[col].length;
    console.log(`  ${col.padEnd(18)} ${buffer[col].length} docs`);
  } catch (err) {
    console.warn(`  ${col.padEnd(18)} skipped (${err.message})`);
    buffer[col] = [];
  }
}
console.log(`Read ${totalDocs} docs from production.\n`);

// ── 2. Switch to the emulator for all writes ───────────────────
process.env.FIRESTORE_EMULATOR_HOST     = FIRESTORE_EMU;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMU;

const emuApp = initializeApp({ projectId: PROJECT_ID }, 'emu');
const emuDb  = getFirestore(emuApp);
const emuAuth = getAuth(emuApp);

console.log(`Writing into the local emulator (Firestore ${FIRESTORE_EMU})…`);
for (const col of COLLECTIONS) {
  const docs = buffer[col];
  if (!docs.length) continue;
  // Firestore batches cap at 500 writes.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = emuDb.batch();
    for (const { id, data } of docs.slice(i, i + 400)) {
      batch.set(emuDb.collection(col).doc(id), data);
    }
    await batch.commit();
  }
  console.log(`  ${col.padEnd(18)} ${docs.length} docs written`);
}

// ── 3. Create Auth logins in the emulator (from staff docs) ────
console.log(`\nCreating Auth users in the local Auth emulator (password: ${DEV_PASSWORD})…`);
let created = 0, skipped = 0;
for (const { id, data } of buffer['staff'] || []) {
  const email = data.email;
  if (!email) { skipped++; continue; }
  try {
    await emuAuth.createUser({ uid: id, email, password: DEV_PASSWORD, displayName: data.name || email });
    created++;
  } catch (err) {
    if (err.code === 'auth/uid-already-exists' || err.code === 'auth/email-already-exists') {
      // Refresh the password on re-run so login always works.
      try { await emuAuth.updateUser(id, { password: DEV_PASSWORD }); } catch { /* ignore */ }
      skipped++;
    } else {
      console.warn(`  ${email}: ${err.message}`);
    }
  }
}
console.log(`  ${created} users created, ${skipped} already existed (password reset).`);

console.log('\n✓ Emulator seeded with real data.');
console.log('  1. Keep `npm run emulators` running.');
console.log('  2. Start the app with:  npm run dev:emulator');
console.log(`  3. Log in with any real staff email + password:  ${DEV_PASSWORD}\n`);
process.exit(0);
