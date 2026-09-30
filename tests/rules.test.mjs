// ─────────────────────────────────────────────────────────────────
// Firestore security-rules tests (Phase 1).
// Run with:  npm run test:rules
// (wraps `firebase emulators:exec` so the Firestore emulator is up)
// ─────────────────────────────────────────────────────────────────
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where } from 'firebase/firestore';

const PROJECT = 'demo-isc-rules-test';
let env;
let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message?.split('\n')[0]}`); }
}

// ── seed data (rules bypassed) ───────────────────────────────────
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // roles: authorization source of truth
    await setDoc(doc(db, 'roles/ceo1'),    { role: 'ceo',   active: true });
    await setDoc(doc(db, 'roles/staff1'),  { role: 'staff', active: true });
    await setDoc(doc(db, 'roles/staff2'),  { role: 'staff', active: true });
    await setDoc(doc(db, 'roles/revoked1'),{ role: 'staff', active: false });
    // staff profiles
    await setDoc(doc(db, 'staff/staff1'), { name: 'S1', email: 's1@isc.test', role: 'staff', active: true });
    // students: A in staff1's batch, B not
    await setDoc(doc(db, 'students/stuA'), { name: 'A', batchId: 'b1', staffIds: ['staff1'] });
    await setDoc(doc(db, 'students/stuB'), { name: 'B', batchId: 'b2', staffIds: ['staff2'] });
    // leads (CEO-only)
    await setDoc(doc(db, 'leads/lead1'), { name: 'Lead', phone: '000' });
    // tasks
    await setDoc(doc(db, 'tasks/t1'), { title: 'mine',  assignedToEmail: 's1@isc.test', status: 'pending' });
    await setDoc(doc(db, 'tasks/t2'), { title: 'other', assignedToEmail: 's2@isc.test', status: 'pending' });
    // courses
    await setDoc(doc(db, 'courses/c1'), { name: 'ISC Level 1', status: 'active', features: { assessments: true } });
  });
}

const asStaff1  = () => env.authenticatedContext('staff1',  { email: 's1@isc.test' }).firestore();
const asStaff2  = () => env.authenticatedContext('staff2',  { email: 's2@isc.test' }).firestore();
const asRevoked = () => env.authenticatedContext('revoked1',{ email: 'r1@isc.test' }).firestore();
const asCEO     = () => env.authenticatedContext('ceo1',    { email: 'ceo@isc.test' }).firestore();
const asAnon    = () => env.unauthenticatedContext().firestore();

// ── tests ────────────────────────────────────────────────────────
env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
await seed();
console.log('\nFirestore rules tests:');

// students — batch scoping
await test('staff CAN read a student in their batch', () =>
  assertSucceeds(getDoc(doc(asStaff1(), 'students/stuA'))));
await test('staff CANNOT read a student outside their batches', () =>
  assertFails(getDoc(doc(asStaff1(), 'students/stuB'))));
await test('staff CANNOT list all students (unscoped query rejected)', () =>
  assertFails(getDocs(collection(asStaff1(), 'students'))));
await test('staff CAN run their scoped students query', () =>
  assertSucceeds(getDocs(query(collection(asStaff1(), 'students'),
    where('staffIds', 'array-contains', 'staff1')))));
await test('CEO can read any student', () =>
  assertSucceeds(getDoc(doc(asCEO(), 'students/stuB'))));
await test('staff CANNOT rewrite staffIds on their own student', () =>
  assertFails(updateDoc(doc(asStaff1(), 'students/stuA'), { staffIds: ['staff1', 'staff2'] })));
await test('revoked staff CANNOT read a student that was theirs', () =>
  assertFails(getDoc(doc(asRevoked(), 'students/stuA'))));
await test('unauthenticated user CANNOT read students', () =>
  assertFails(getDoc(doc(asAnon(), 'students/stuA'))));

// privilege escalation
await test('staff CANNOT write their own roles doc', () =>
  assertFails(setDoc(doc(asStaff1(), 'roles/staff1'), { role: 'ceo', active: true })));
await test('staff CANNOT set role on their own staff profile', () =>
  assertFails(updateDoc(doc(asStaff1(), 'staff/staff1'), { role: 'ceo' })));
await test('staff CAN update own fcmToken (allowed field)', () =>
  assertSucceeds(updateDoc(doc(asStaff1(), 'staff/staff1'), { fcmToken: 'tok' })));
await test('CEO CAN write a roles doc', () =>
  assertSucceeds(setDoc(doc(asCEO(), 'roles/staff2'), { role: 'staff', active: true })));

// leads — CEO only
await test('staff CANNOT read leads', () =>
  assertFails(getDoc(doc(asStaff1(), 'leads/lead1'))));
await test('CEO CAN read leads', () =>
  assertSucceeds(getDoc(doc(asCEO(), 'leads/lead1'))));

// tasks — assignee scoping
await test('staff CAN read their own task', () =>
  assertSucceeds(getDoc(doc(asStaff1(), 'tasks/t1'))));
await test('staff CANNOT read another staff\'s task', () =>
  assertFails(getDoc(doc(asStaff1(), 'tasks/t2'))));
await test('staff CANNOT create tasks (CEO-only)', () =>
  assertFails(setDoc(doc(asStaff1(), 'tasks/t3'), { title: 'x', assignedToEmail: 's1@isc.test' })));

// courses — readable by active staff, writable by CEO only
await test('staff CAN read courses', () =>
  assertSucceeds(getDoc(doc(asStaff1(), 'courses/c1'))));
await test('staff CANNOT update a course', () =>
  assertFails(updateDoc(doc(asStaff1(), 'courses/c1'), { name: 'Hacked' })));
await test('CEO CAN create a course', () =>
  assertSucceeds(setDoc(doc(asCEO(), 'courses/c2'), { name: 'Music', status: 'active', features: {} })));
await test('unauthenticated user CANNOT read courses', () =>
  assertFails(getDoc(doc(asAnon(), 'courses/c1'))));

// default deny
await test('unknown collection is denied even for CEO', () =>
  assertFails(getDoc(doc(asCEO(), 'randomCollection/x'))));

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
