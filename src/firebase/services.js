import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, or,
  serverTimestamp, setDoc, limit, startAfter,
  getCountFromServer
} from 'firebase/firestore';
import { db, auth } from './config';

const PAGE_SIZE = 50;

// ── Access scoping helpers (Phase 1 security remediation) ───────
// A "scope" is { role, uid, email }. Staff queries MUST carry the
// where() clause that proves the rules condition — Firestore rules
// reject unprovable queries outright, they don't filter results.
export const isCeoScope = (scope) => scope?.role === 'ceo';

// staffIds on a student = batch staff + mentor (denormalized so
// rules can check membership without a join).
export const computeBatchStaffIds = (batch) =>
  [...new Set([...(batch?.staffIds || []), batch?.mentorId].filter(Boolean))];

export const getBatchStaffIds = async (batchId) => {
  if (!batchId) return [];
  const snap = await getDoc(doc(db, 'batches', batchId));
  return snap.exists() ? computeBatchStaffIds(snap.data()) : [];
};

// Fan-out: keep every student in a batch in sync with the batch's
// staff assignment. Call whenever batch staff/mentor changes.
export const syncBatchStaffToStudents = async (batchId, batchData) => {
  const staffIds = computeBatchStaffIds(batchData);
  const snap = await getDocs(query(collection(db, 'students'), where('batchId', '==', batchId)));
  await Promise.all(snap.docs.map(d => updateDoc(d.ref, { staffIds })));
  return { updated: snap.docs.length, staffIds };
};

// ── Students ───────────────────────────────────────────────────
export const studentsRef = () => collection(db, 'students');

export const getStudentCount = async (scope) => {
  // Staff: count only their own students (aggregate over a provable query).
  if (scope && !isCeoScope(scope)) {
    const snap = await getCountFromServer(
      query(studentsRef(), where('staffIds', 'array-contains', scope.uid)));
    return snap.data().count;
  }
  const snap = await getCountFromServer(collection(db, 'students'));
  return snap.data().count;
};

export const getStudentsPaged = async (filters = {}, lastDoc = null, scope = null) => {
  // Staff path: must include the staffIds membership clause the rules
  // check. No orderBy (avoids composite index); sorted client-side.
  if (scope && !isCeoScope(scope)) {
    let constraints = [where('staffIds', 'array-contains', scope.uid), limit(500)];
    if (filters.batchId) constraints.push(where('batchId', '==', filters.batchId));
    if (filters.status)  constraints.push(where('status', '==', filters.status));
    const snap = await getDocs(query(studentsRef(), ...constraints));
    const students = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return { students, lastDoc: null, hasMore: false };
  }
  let constraints = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)];
  if (filters.batchId)       constraints = [where('batchId','==',filters.batchId), orderBy('createdAt','desc'), limit(PAGE_SIZE)];
  if (filters.status)        constraints = [where('status','==',filters.status), orderBy('createdAt','desc'), limit(PAGE_SIZE)];
  if (filters.staffAssigned) constraints = [where('staffAssigned','==',filters.staffAssigned), orderBy('createdAt','desc'), limit(PAGE_SIZE)];
  if (lastDoc) constraints.push(startAfter(lastDoc));
  const snap = await getDocs(query(studentsRef(), ...constraints));
  return {
    students: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc:  snap.docs[snap.docs.length - 1] || null,
    hasMore:  snap.docs.length === PAGE_SIZE,
  };
};

export const searchStudents = async (searchTerm, scope = null) => {
  if (!searchTerm) return [];
  const base = (scope && !isCeoScope(scope))
    ? query(studentsRef(), where('staffIds', 'array-contains', scope.uid), limit(500))
    : query(studentsRef(), orderBy('name'), limit(200));
  const snap = await getDocs(base);
  const term = searchTerm.toLowerCase();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s =>
      s.name?.toLowerCase().includes(term) ||
      s.phone?.includes(term) ||
      s.classplusId?.toLowerCase().includes(term) ||
      s.email?.toLowerCase().includes(term) ||
      s.parentName?.toLowerCase().includes(term) ||
      s.parentPhone?.includes(term)
    );
};

export const getMyStudents = async (staffName, staffUid) => {
  if (!staffUid) return [];
  try {
    const q = query(studentsRef(), where('staffIds', 'array-contains', staffUid), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch {
    return [];
  }
};

export const getStudent = async (id) => {
  const snap = await getDoc(doc(db, 'students', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Creates a student with staffIds denormalized from its batch, so the
// batch's staff (and mentor) can access the record under the rules.
export const addStudent = async (data) => {
  const staffIds = await getBatchStaffIds(data.batchId);
  // Join date has historically been written as `joinDate` (Batches page) or
  // `joiningDate` (Students page). Keep both in sync on create so every reader
  // works regardless of which field it looks at.
  const joined = data.joinDate || data.joiningDate;
  const dates = joined ? { joinDate: joined, joiningDate: joined } : {};
  return addDoc(studentsRef(), { ...data, ...dates, staffIds, createdAt: serverTimestamp() });
};

export const updateStudent = async (id, data) => {
  const payload = { ...data, updatedAt: serverTimestamp() };
  delete payload.staffIds; // never client-set directly
  // Batch move → recompute scope (CEO-only per rules).
  if ('batchId' in data) {
    const current = await getDoc(doc(db, 'students', id));
    if (current.exists() && current.data().batchId !== data.batchId) {
      payload.staffIds = await getBatchStaffIds(data.batchId);
    }
  }
  return updateDoc(doc(db, 'students', id), payload);
};

export const deleteStudent = async (id) => deleteDoc(doc(db, 'students', id));

export const bulkAddStudents = async (arr) => {
  const results = { success: 0, failed: 0, errors: [] };
  const staffIdsCache = {};
  for (const s of arr) {
    try {
      if (s.batchId && !(s.batchId in staffIdsCache)) {
        staffIdsCache[s.batchId] = await getBatchStaffIds(s.batchId);
      }
      const staffIds = s.batchId ? staffIdsCache[s.batchId] : [];
      await addDoc(studentsRef(), { ...s, staffIds, createdAt: serverTimestamp() });
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(`${s.name}: ${err.message}`);
    }
  }
  return results;
};

// ── Unassigned / self-assign ───────────────────────────────────
// CEO-only under the batch-scoped access model: staff cannot query
// students outside their batches, so "unassigned across all batches"
// is not answerable for them (returns []).
export const getUnassignedStudents = async (batchId, scope = null) => {
  if (scope && !isCeoScope(scope)) return [];
  try {
    let q = batchId
      ? query(studentsRef(), where('batchId','==',batchId), where('staffAssigned','==',''), limit(100))
      : query(studentsRef(), where('staffAssigned','==',''), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
};

export const selfAssignStudents = async (staffName, studentIds) => {
  await Promise.all(studentIds.map(id =>
    updateDoc(doc(db, 'students', id), { staffAssigned: staffName })
  ));
};

// ── Weak subjects ──────────────────────────────────────────────
export const updateWeakSubjects = async (studentId, weakSubjects) =>
  updateDoc(doc(db, 'students', studentId), { weakSubjects, updatedAt: serverTimestamp() });

// ── Course flow tracking ───────────────────────────────────────
export const updateCourseFlowStep = async (studentId, stepKey, data) =>
  updateDoc(doc(db, 'students', studentId), {
    [`courseFlow.${stepKey}`]: { ...data, updatedAt: new Date().toISOString() }
  });

// ── Student activity ───────────────────────────────────────────
export const updateStudentActivity = async (id, data) =>
  updateDoc(doc(db, 'students', id), { ...data, lastActivityUpdate: serverTimestamp() });

// ── Alias for backward compat ──────────────────────────────────
export const getStudents = async (scope = null) => {
  const result = await getStudentsPaged({}, null, scope);
  return result.students;
};

// ── Follow-ups ─────────────────────────────────────────────────
// Staff may only read follow-ups assigned to them, so the per-student
// history query must include their email clause to be provable.
export const getFollowUps = async (studentId, scope = null) => {
  const q = (scope && !isCeoScope(scope))
    ? query(collection(db,'followups'), where('studentId','==',studentId), where('assignedToEmail','==',scope.email))
    : query(collection(db,'followups'), where('studentId','==',studentId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
};

export const getMyFollowUps = async (staffEmail) => {
  if (!staffEmail) return [];
  try {
    const q = query(collection(db,'followups'), where('assignedToEmail','==',staffEmail), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(f => !f.completed)
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  } catch {
    return [];
  }
};

export const getAllFollowUps = async (scope = null) => {
  // Staff see follow-ups assigned TO them or assigned BY them.
  const q = (scope && !isCeoScope(scope))
    ? query(collection(db,'followups'),
        or(where('assignedToEmail','==',scope.email), where('assignedByEmail','==',scope.email)),
        limit(300))
    : query(collection(db,'followups'), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
};

export const addFollowUp = async (data) =>
  addDoc(collection(db,'followups'), { ...data, completed: false, createdAt: serverTimestamp() });

export const completeFollowUp = async (id, note) =>
  updateDoc(doc(db,'followups', id), { completed: true, completionNote: note, completedAt: serverTimestamp() });

// ── Batches ────────────────────────────────────────────────────
export const getBatches = async () => {
  const snap = await getDocs(collection(db,'batches'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
};

export const getBatch = async (id) => {
  const snap = await getDoc(doc(db,'batches', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const getBatchStudents = async (batchId, scope = null) => {
  // Staff must include the membership clause the rules check.
  const q = (scope && !isCeoScope(scope))
    ? query(studentsRef(), where('batchId','==',batchId), where('staffIds','array-contains',scope.uid), limit(500))
    : query(studentsRef(), where('batchId','==',batchId), limit(500));
  const snap = await getDocs(q);
  const students = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  return { students, lastDoc: snap.docs[snap.docs.length-1]||null, hasMore: false };
};

export const getBatchStudentCount = async (batchId, scope = null) => {
  const q = (scope && !isCeoScope(scope))
    ? query(studentsRef(), where('batchId','==',batchId), where('staffIds','array-contains',scope.uid))
    : query(studentsRef(), where('batchId','==',batchId));
  const snap = await getCountFromServer(q);
  return snap.data().count;
};

export const addBatch = async (data) =>
  addDoc(collection(db,'batches'), { ...data, createdAt: serverTimestamp() });

export const updateBatch = async (id, data) =>
  updateDoc(doc(db,'batches', id), data);

// ── Batch Schedules ────────────────────────────────────────────
export const getBatchSchedules = async (batchId) => {
  const q = query(collection(db,'schedules'), where('batchId','==',batchId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (a.day||'').localeCompare(b.day||'') || (a.time||'').localeCompare(b.time||''));
};

// All schedules across every batch (for the global Schedule page "All" view)
export const getAllSchedules = async () => {
  const snap = await getDocs(collection(db,'schedules'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (a.day||'').localeCompare(b.day||'') || (a.time||'').localeCompare(b.time||''));
};

export const addBatchSchedule = async (data) =>
  addDoc(collection(db,'schedules'), { ...data, createdAt: serverTimestamp() });

export const updateBatchSchedule = async (id, data) =>
  updateDoc(doc(db,'schedules', id), data);

export const deleteBatchSchedule = async (id) =>
  deleteDoc(doc(db,'schedules', id));

// ── Batch Tasks ────────────────────────────────────────────────
export const getBatchTasks = async (batchId) => {
  const q = query(collection(db,'batchTasks'), where('batchId','==',batchId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
};

export const addBatchTask = async (data) =>
  addDoc(collection(db,'batchTasks'), { ...data, submittedBy: [], createdAt: serverTimestamp() });

export const markTaskSubmitted = async (taskId, studentId, studentName) => {
  const ref  = doc(db,'batchTasks', taskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const current = snap.data().submittedBy || [];
  if (current.find(s => s.studentId === studentId)) return;
  await updateDoc(ref, {
    submittedBy: [...current, { studentId, studentName, submittedAt: new Date().toISOString() }]
  });
};

export const updateBatchTask = async (id, data) =>
  updateDoc(doc(db,'batchTasks', id), data);

export const deleteBatchTask = async (id) =>
  deleteDoc(doc(db,'batchTasks', id));

// ── Assessments ────────────────────────────────────────────────
export const getAssessments = async (batchId) => {
  const q = batchId
    ? query(collection(db,'assessments'), where('batchId','==',batchId))
    : collection(db,'assessments');
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.date||'').localeCompare(a.date||''));
};

export const getAllAssessments = async () => {
  const snap = await getDocs(query(collection(db,'assessments'), limit(500)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getBatchAssessments = async (batchId, testName) => {
  const q = query(collection(db,'assessments'), where('batchId','==',batchId), where('testName','==',testName));
  const snap = await getDocs(q);
  return snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data() }))
    .sort((a,b) => (b.percentage||0) - (a.percentage||0));
};

export const addAssessment = async (data) =>
  addDoc(collection(db,'assessments'), { ...data, createdAt: serverTimestamp() });

export const deleteAssessment = async (id) => deleteDoc(doc(db,'assessments',id));

export const getAssessmentResults = async (assessmentId) => {
  const q = query(collection(db,'assessmentResults'), where('assessmentId','==',assessmentId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.percentage||0) - (a.percentage||0));
};

export const saveAssessmentResults = async (results) =>
  Promise.all(results.map(r => addDoc(collection(db,'assessmentResults'), { ...r, savedAt: serverTimestamp() })));

// ── Tasks ──────────────────────────────────────────────────────
export const getTasks = async (scope = null) => {
  // Staff: only their own tasks are readable — query must prove it.
  if (scope && !isCeoScope(scope)) {
    const q = query(collection(db,'tasks'), where('assignedToEmail','==',scope.email), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  }
  const q = query(collection(db,'tasks'), orderBy('createdAt','desc'), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getMyTasks = async (staffEmail) => {
  if (!staffEmail) return [];
  try {
    const q = query(collection(db,'tasks'), where('assignedToEmail','==',staffEmail), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.status !== 'completed')
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  } catch {
    return [];
  }
};

export const addTask = async (data) =>
  addDoc(collection(db,'tasks'), { ...data, status: 'pending', createdAt: serverTimestamp() });

export const updateTask = async (id, data) =>
  updateDoc(doc(db,'tasks', id), data);

// ── Notifications (in-app) ─────────────────────────────────────
export const addNotification = async (data) =>
  addDoc(collection(db,'notifications'), { ...data, read: false, createdAt: serverTimestamp() });

// ── Email channel (server-side, free) ──────────────────────────
// Sends an email via the Vercel serverless function at /api/send-email.
// The mail credentials live ONLY in Vercel env vars (never in the
// browser bundle). We authenticate the caller with their Firebase ID
// token so only signed-in staff can trigger a send. Best-effort: any
// failure (offline, function absent in local dev, mail creds unset) is
// swallowed so the in-app notification is never blocked. When the
// endpoint is missing or mail env is unset, email is simply a no-op —
// this is the feature flag (email "turns on" once Vercel env is set).
const NOTIFY_API = import.meta.env.VITE_NOTIFY_API_BASE ?? '';
export const sendNotificationEmail = async ({
  toEmail, subject, text, fromName, heading, intro, details, ctaUrl, ctaLabel,
}) => {
  if (!toEmail) return { status: 'skipped' };
  try {
    const current = auth.currentUser;
    if (!current) return { status: 'no-auth' };
    const token = await current.getIdToken();
    const res = await fetch(`${NOTIFY_API}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        toEmail, subject, text, fromName, heading, intro, details, ctaUrl, ctaLabel,
      }),
    });
    if (!res.ok) return { status: 'failed', code: res.status };
    return await res.json().catch(() => ({ status: 'sent' }));
  } catch {
    return { status: 'error' };
  }
};

// notifyStaff — the single entry point for BOTH channels. Writes the
// in-app notification (always) and fires the email (best-effort, unless
// sendEmail:false). All task/schedule trigger sites call this so the two
// channels stay in lock-step. `body` is the canonical message field;
// `message` is accepted for back-compat with older call sites.
// `details` ([{label, value}, …]) renders as a structured table in the
// email — pass who assigned it, due date, timing, meet link, etc.
export const notifyStaff = async ({
  toEmail, type, title, body, message, route, fromName, sendEmail = true,
  details, intro,
}) => {
  if (!toEmail) return;
  const text = body ?? message ?? '';
  const inApp = addNotification({ toEmail, type, title, body: text, route, fromName });
  if (sendEmail) {
    // Deep link back into the app for the email's action button.
    const ctaUrl = route && typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}${route}`
      : undefined;
    sendNotificationEmail({
      toEmail, subject: title || 'ISC SMS Notification', text, fromName,
      heading: title, intro, details, ctaUrl,
    }).catch(() => {});
  }
  return inApp;
};

export const getMyNotifications = async (email) => {
  const q = query(collection(db,'notifications'), where('toEmail','==',email), limit(20));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
};

export const markNotificationRead = async (id) =>
  updateDoc(doc(db,'notifications', id), { read: true });

export const saveFCMToken = async (userId, token) => {
  try {
    await updateDoc(doc(db, 'staff', userId), { fcmToken: token });
  } catch {}
};

// ── Daily Reports ──────────────────────────────────────────────
export const getDailyReports = async (scope = null) => {
  const q = (scope && !isCeoScope(scope))
    ? query(collection(db,'reports'), where('staffEmail','==',scope.email), limit(200))
    : query(collection(db,'reports'), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addReport = async (data) =>
  addDoc(collection(db,'reports'), { ...data, createdAt: serverTimestamp() });

// ── Concerns ──────────────────────────────────────────────────
export const getConcerns = async (filters = {}, scope = null) => {
  // Staff: raised-by-me OR assigned-to-me (matches the rules exactly).
  if (scope && !isCeoScope(scope)) {
    const q = query(collection(db,'concerns'),
      or(where('raisedByEmail','==',scope.email), where('assignedToEmail','==',scope.email)),
      limit(200));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  }
  let q = query(collection(db,'concerns'), orderBy('createdAt','desc'), limit(100));
  if (filters.batchId)    q = query(collection(db,'concerns'), where('batchId','==',filters.batchId), orderBy('createdAt','desc'));
  if (filters.assignedTo) q = query(collection(db,'concerns'), where('assignedTo','==',filters.assignedTo), orderBy('createdAt','desc'));
  if (filters.status)     q = query(collection(db,'concerns'), where('status','==',filters.status), orderBy('createdAt','desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addConcern = async (data) =>
  addDoc(collection(db,'concerns'), { ...data, status: 'open', createdAt: serverTimestamp() });

export const updateConcern = async (id, data) =>
  updateDoc(doc(db,'concerns', id), data);

// ── Leads ──────────────────────────────────────────────────────
export const getLeads = async () => {
  const q = query(collection(db,'leads'), orderBy('createdAt','desc'), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addLead = async (data) =>
  addDoc(collection(db,'leads'), { ...data, stage: 'lead', createdAt: serverTimestamp() });

export const updateLead = async (id, data) =>
  updateDoc(doc(db,'leads', id), data);

// ── Staff profiles ─────────────────────────────────────────────
// Pickers/dropdowns now read the safe staffDirectory mirror
// (name, role, subjects, active, email — no fcmToken). Full /staff
// docs are readable only by their owner and the CEO.
export const getStaffProfiles = async () => {
  const snap = await getDocs(collection(db,'staffDirectory'));
  return snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
};

// CEO-only: full staff docs (Staff Management page).
export const getStaffFull = async () => {
  const snap = await getDocs(collection(db,'staff'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ── Roles (authorization source of truth) + directory mirror ────
// Written only by the CEO; rules enforce this.
export const setRoleDoc = (uid, { role, active }) =>
  setDoc(doc(db,'roles', uid), { role, active }, { merge: true });

export const deleteRoleDoc = (uid) => deleteDoc(doc(db,'roles', uid));

export const setDirectoryDoc = (uid, { name, role, subjects, active, email }) =>
  setDoc(doc(db,'staffDirectory', uid),
    { name: name || '', role: role || 'staff', subjects: subjects || [], active: active !== false, email: email || '' },
    { merge: true });

export const deleteDirectoryDoc = (uid) => deleteDoc(doc(db,'staffDirectory', uid));

export const setStaffProfile = async (uid, data) =>
  setDoc(doc(db,'staff', uid), data, { merge: true });

export const getStaffProfile = async (uid) => {
  const snap = await getDoc(doc(db,'staff', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const updateStaffSubjects = async (staffId, subjects) =>
  updateDoc(doc(db,'staff', staffId), { subjects, updatedAt: serverTimestamp() });

export const getStaffBySubject = async (subject) => {
  const snap = await getDocs(collection(db,'staffDirectory'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.subjects?.includes(subject) && s.active !== false);
};
// ── Schedule status & Attendance ───────────────────────────────
export const updateScheduleStatus = async (scheduleId, status, note = '') =>
  updateDoc(doc(db,'schedules', scheduleId), { status, statusNote: note, statusUpdatedAt: new Date().toISOString() });

// Upsert attendance for a session: overwrite the existing record instead of
// stacking duplicate docs on every save.
export const saveAttendance = async (scheduleId, batchId, attendanceData) => {
  const q = query(collection(db,'attendance'), where('scheduleId','==',scheduleId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const [first, ...rest] = snap.docs;
    await updateDoc(doc(db,'attendance', first.id), { batchId, records: attendanceData, updatedAt: serverTimestamp() });
    await Promise.all(rest.map(d => deleteDoc(doc(db,'attendance', d.id)))); // clean up any old duplicates
    return;
  }
  await addDoc(collection(db,'attendance'), { scheduleId, batchId, records: attendanceData, createdAt: serverTimestamp() });
};

// Remove all attendance for a session (used to undo / clear).
export const deleteSessionAttendance = async (scheduleId) => {
  const q = query(collection(db,'attendance'), where('scheduleId','==',scheduleId));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map(d => deleteDoc(doc(db,'attendance', d.id))));
};

export const getSessionAttendance = async (scheduleId) => {
  const q = query(collection(db,'attendance'), where('scheduleId','==',scheduleId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Save attendance record (new signature for CSV upload modal)
export const saveAttendanceRecord = async (data) =>
  addDoc(collection(db,'attendance'), { ...data, savedAt: serverTimestamp() });

// ── Class progress reports (per-student notes after a class) ────
// A report is written by a faculty for a student about a specific class session.
// Any staff can later view all previous reports for a student (across faculty).
export const saveClassReport = async (data) =>
  addDoc(collection(db,'classReports'), { ...data, createdAt: serverTimestamp() });

export const updateClassReport = async (id, data) =>
  updateDoc(doc(db,'classReports', id), { ...data, updatedAt: serverTimestamp() });

export const deleteClassReport = async (id) =>
  deleteDoc(doc(db,'classReports', id));

// All reports written for one class session (keyed by scheduleId)
export const getSessionReports = async (scheduleId) => {
  const q = query(collection(db,'classReports'), where('scheduleId','==',scheduleId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
};

// Remove every progress report tied to a class session. Used when a schedule
// is deleted so its progress reports don't linger orphaned on student profiles.
export const deleteSessionReports = async (scheduleId) => {
  const q = query(collection(db,'classReports'), where('scheduleId','==',scheduleId));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map(d => deleteDoc(doc(db,'classReports', d.id))));
};

// All reports for a single student across every class & faculty
export const getStudentReports = async (studentId) => {
  const q = query(collection(db,'classReports'), where('studentId','==',studentId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
};

// Batch/main-page assessments a student took, merged with their marks.
// Assessments live in `assessments` (with participantStudents) and marks in
// `assessmentResults`; this joins them for a single student.
export const getStudentBatchAssessments = async (studentId, batchId) => {
  if (!batchId) return [];
  const snap = await getDocs(query(collection(db,'assessments'), where('batchId','==',batchId)));
  const assessments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.participantType !== 'specific'
      || (a.participantStudents || []).some(p => p.id === studentId));
  const out = [];
  for (const a of assessments) {
    let marks, percentage, pass;
    try {
      const res = await getAssessmentResults(a.id);
      const mine = res.find(r => r.studentId === studentId);
      if (mine) {
        marks = mine.marks ?? mine.marksScored;
        percentage = mine.percentage;
        pass = mine.pass ?? mine.passed;
      }
    } catch {}
    out.push({
      id: a.id,
      testName: a.title || a.testName || 'Assessment',
      subject: a.subject || '',
      date: a.date || '',
      totalMarks: a.totalMarks,
      marks: marks ?? null,
      percentage: percentage ?? null,
      pass,
      status: a.status,
      graded: marks != null,
    });
  }
  return out.sort((x,y) => (y.date||'').localeCompare(x.date||''));
};

// Attendance summary for one student (present/total across all their sessions)
export const getStudentAttendanceSummary = async (studentId, batchId) => {
  const q = batchId
    ? query(collection(db,'attendance'), where('batchId','==',batchId))
    : collection(db,'attendance');
  const snap = await getDocs(q);
  let present = 0, total = 0;
  const sessions = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const recs = data.attendance || data.records || {};
    const rec = recs[studentId];
    if (rec) {
      total += 1;
      if (rec.present) present += 1;
      sessions.push({ scheduleId: data.scheduleId, present: !!rec.present });
    }
  });
  return { present, total, pct: total ? Math.round((present / total) * 100) : null, sessions };
};

// All reports for a batch (for batch-level progress overview)
export const getBatchReports = async (batchId) => {
  const q = query(collection(db,'classReports'), where('batchId','==',batchId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
};

// Mark schedule status (update)
export const markScheduleStatus = async (scheduleId, status) =>
  updateDoc(doc(db,'schedules', scheduleId), { status, updatedAt: serverTimestamp() });

// ── Trash ──────────────────────────────────────────────────────
export const getTrashItems = async (type) => {
  const q = query(collection(db,'trash'), where('type','==',type));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.deletedAt?.seconds||0)-(a.deletedAt?.seconds||0));
};

export const restoreFromTrash = async (trashId, type, originalId, data) => {
  const colName = type === 'student' ? 'students' : 'batches';
  // Restored students get their scope recomputed — batch staffing may
  // have changed while the record sat in trash.
  const payload = (type === 'student')
    ? { ...data, staffIds: await getBatchStaffIds(data.batchId) }
    : data;
  await setDoc(doc(db, colName, originalId), payload);
  await deleteDoc(doc(db,'trash', trashId));
};

export const permanentDelete = async (trashId) => {
  await deleteDoc(doc(db,'trash', trashId));
};

// ── Staff Requests ─────────────────────────────────────────────
export const createRequest = async (data) => addDoc(collection(db,'requests'), { ...data, createdAt: serverTimestamp() });

export const getMyRequests = async (uid) => {
  const q = query(collection(db,'requests'), where('requestedBy','==',uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
};

export const getRequests = async (status) => {
  const q = status ? query(collection(db,'requests'), where('status','==',status)) : collection(db,'requests');
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
};

export const updateRequest = async (id, data) =>
  updateDoc(doc(db,'requests', id), data);

// ── Top-level Assessments (legacy aliases kept for compatibility) ──
export const getTopLevelAssessments = getAssessments;
export const addTopLevelAssessment = addAssessment;
export const updateTopLevelAssessment = async (id, data) =>
  updateDoc(doc(db,'assessments', id), data);
export const saveAssessmentResult = async (data) =>
  addDoc(collection(db,'assessmentResults'), { ...data, savedAt: serverTimestamp() });

// ── Batch staff (for assigned batches by staffIds) ─────────────
export const getStaffBatches = async (uid) => {
  try {
    const [byStaffIds, byMentor] = await Promise.all([
      getDocs(query(collection(db,'batches'), where('staffIds','array-contains', uid))),
      getDocs(query(collection(db,'batches'), where('mentorId','==', uid))),
    ]);
    const map = {};
    [...byStaffIds.docs, ...byMentor.docs].forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
    return Object.values(map).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  } catch {
    return [];
  }
};

// ── Fees / payments ────────────────────────────────────────────
// One doc per student (doc id = studentId) holding a payments[] array and the
// agreed totalFee. Financial data — CEO-managed (see firestore.rules `fees`).
const feesRef = () => collection(db, 'fees');

export const getFeesByBatch = async (batchId, scope = null) => {
  if (scope && !isCeoScope(scope)) return [];
  if (!batchId) return [];
  try {
    const snap = await getDocs(query(feesRef(), where('batchId', '==', batchId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
};

export const getAllFees = async (scope = null) => {
  if (scope && !isCeoScope(scope)) return [];
  try {
    const snap = await getDocs(feesRef());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
};

// Upsert a student's fee record (doc id = studentId), merging fields. The page
// passes the full recomputed `payments` array and `totalFee` on every change.
export const saveFee = async (studentId, data) =>
  setDoc(doc(db, 'fees', studentId), { ...data, studentId, updatedAt: serverTimestamp() }, { merge: true });
