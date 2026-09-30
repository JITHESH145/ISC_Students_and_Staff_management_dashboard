// Course helpers shared by Batches, Students, Schedule, Assessments and the
// student profile. A course sits above batches and switches features on/off
// for all of its batches.
//
// Rule everywhere: a feature is ON unless course.features[key] === false.
// A batch with no course (or a deleted one) has every feature ON, so data
// created before courses existed behaves exactly as before.

export const COURSE_FEATURES = [
  { key: 'onboardingFlow', label: 'Course flow & onboarding', hint: 'Onboarding steps per student, the Onboarding Analytics tab and progress tracking.' },
  { key: 'assignments',    label: 'Assignments',              hint: 'The Assignments tab — tasks given to students and their submissions.' },
  { key: 'assessments',    label: 'Assessments',              hint: 'Tests with marks — the Assessments tab and the batch in the Assessments page.' },
  { key: 'attendance',     label: 'Attendance',               hint: 'Marking attendance on scheduled classes.' },
  { key: 'classReports',   label: 'Class progress reports',   hint: 'Per-student progress notes written after each class.' },
];

export const ALL_FEATURES_ON = Object.fromEntries(COURSE_FEATURES.map(f => [f.key, true]));

export const hasFeature = (course, key) => course?.features?.[key] !== false;

export const COURSE_COLORS = ['#0F9E8E', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#475569'];

export const courseColor = (course) => course?.color || COURSE_COLORS[0];

// Group key for batches that aren't linked to any course.
export const NO_COURSE = '__none__';

export const courseOfBatch = (batch, courses) =>
  (batch?.courseId && courses.find(c => c.id === batch.courseId)) || null;

// CEO sees every batch; staff only those they mentor or are assigned to.
export const visibleBatches = (batches, profile) => {
  if (profile?.role === 'ceo') return batches;
  const uid = profile?.uid;
  return batches.filter(b => b.mentorId === uid || (b.staffIds || []).includes(uid));
};

// Batches belonging to a course filter value: '' = all, NO_COURSE = batches
// not linked to a known course, otherwise that course id.
export const batchesInCourse = (batches, courses, courseId) => {
  if (!courseId) return batches;
  if (courseId === NO_COURSE) return batches.filter(b => !courseOfBatch(b, courses));
  return batches.filter(b => b.courseId === courseId);
};

// [{ id, course, batches }] in course-name order. Courses with no batches are
// skipped unless includeEmpty (CEO) and the course isn't archived. Batches not
// linked to a known course go into a final NO_COURSE group (course: null).
export const groupBatchesByCourse = (batches, courses, { includeEmpty = false } = {}) => {
  const groups = [...courses]
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(course => ({ id: course.id, course, batches: batches.filter(b => b.courseId === course.id) }))
    .filter(g => g.batches.length > 0 || (includeEmpty && g.course.status !== 'archived'));
  const unlinked = batches.filter(b => !courseOfBatch(b, courses));
  if (unlinked.length) groups.push({ id: NO_COURSE, course: null, batches: unlinked });
  return groups;
};
