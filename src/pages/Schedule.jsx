import { useEffect, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getBatches, getStaffBatches, getBatchSchedules, getAllSchedules, addBatchSchedule,
  deleteBatchSchedule, updateScheduleStatus, updateBatchSchedule, saveAttendance,
  getSessionAttendance, deleteSessionAttendance, getBatchStudents, getStaffProfiles,
  saveClassReport, updateClassReport, getSessionReports, deleteSessionReports, getStudentReports,
  getAllAssessments, notifyStaff,
} from '../firebase/services';
import { Modal, Toast, Loading, Confirm } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  Plus, Calendar, ChevronLeft, ChevronRight, Users, Download,
  CheckCircle, XCircle, Trash2, X, Search, MessageSquare, FileText, ChevronDown, AlertTriangle,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────
const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name = '') { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACCENTS[h % ACCENTS.length]; }
function initials(name = '') { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }

function getWeekDates(anchor) {
  const d = new Date(anchor);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return x; });
}

function getMonthDates(anchor) {
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    const d = new Date(year, month, 1 - (startOffset - i));
    cells.push({ date: d, inMonth: false });
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) cells.push({ date: new Date(year, month, i), inMonth: true });
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month + 1, cells.length - daysInMonth - startOffset + 1);
    cells.push({ date: d, inMonth: false });
  }
  return cells;
}

function getSlotsForDate(date, calendarSlots = []) {
  const dateStr = localDateStr(date); // local, not UTC — avoids month-view off-by-one in ahead-of-UTC timezones
  const dayName = date.toLocaleDateString('default', { weekday: 'long' });
  return calendarSlots.filter(s => {
    if (s.scheduledDate) return s.scheduledDate === dateStr;
    return s.day === dayName;
  });
}

const HOUR_PX   = 56;   // px per hour in time grid
const GRID_START = 8;   // 8 AM
const HOURS = Array.from({ length: 13 }, (_, i) => i + GRID_START); // 8..20

function slotPos(slot) {
  const [hStr = '8', mStr = '0'] = (slot.time || '08:00').split(':');
  const startH = parseInt(hStr) + parseInt(mStr) / 60;
  const durH   = (parseInt(slot.duration) || 60) / 60;
  const top    = Math.max(0, (startH - GRID_START) * HOUR_PX) + 2;
  const height = Math.max(24, durH * HOUR_PX - 6);
  return { top, height };
}

const TYPE_COLORS = {
  'live-class':  { bg:'var(--pos-50)',     bar:'var(--pos)',     col:'var(--pos)',     label:'Live Class' },
  'recorded':    { bg:'var(--purple-50)',  bar:'var(--purple)',  col:'var(--purple)',  label:'Recorded' },
  'meeting':     { bg:'var(--info-50)',    bar:'var(--info)',    col:'var(--info)',    label:'Meeting' },
  'assessment':  { bg:'var(--neg-50)',     bar:'var(--neg)',     col:'var(--neg)',     label:'Assessment' },
  'doubt':       { bg:'var(--warn-50)',    bar:'var(--warn)',    col:'var(--warn)',    label:'Doubt Session' },
  'revision':    { bg:'var(--accent-50)', bar:'var(--accent)',  col:'var(--accent)',  label:'Revision' },
  'event':       { bg:'var(--pos-50)',     bar:'var(--pos)',     col:'var(--pos)',     label:'Event' },
  'other':       { bg:'var(--surface-2)', bar:'var(--muted)',   col:'var(--muted)',   label:'Other' },
};
const typeColor = (t) => TYPE_COLORS[t] || TYPE_COLORS.other;

// Visual treatment per lifecycle status so completed/cancelled/rescheduled are obvious.
const STATUS_META = {
  completed:   { label: 'Completed',   bg: 'var(--pos-50)',  bar: 'var(--pos)',  ink: 'var(--green-ink)' },
  cancelled:   { label: 'Cancelled',   bg: 'var(--neg-50)',  bar: 'var(--neg)',  ink: 'var(--red-ink)' },
  rescheduled: { label: 'Rescheduled', bg: 'var(--warn-50)', bar: 'var(--warn)', ink: 'var(--amber-ink)' },
  pending:     { label: 'Scheduled',   bg: null,             bar: null,          ink: 'var(--sub)' },
};
const statusMeta = (s) => STATUS_META[s] || STATUS_META.pending;

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const ALL = '__all__';

const pad2 = (n) => String(n).padStart(2, '0');
const localDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Lay out overlapping slots side-by-side so same-time classes don't hide each other.
// Returns { [slotId]: { col, cols } }.
function computeDayLayout(slots) {
  const items = slots.map(s => {
    const [h = '8', m = '0'] = (s.time || '08:00').split(':');
    const start = parseInt(h) * 60 + parseInt(m || '0');
    const end = start + (parseInt(s.duration) || 60);
    return { id: s.id, start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const layout = {};
  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    let clusterEnd = items[i].end;
    const cluster = [items[i]];
    while (j < items.length && items[j].start < clusterEnd) {
      cluster.push(items[j]);
      clusterEnd = Math.max(clusterEnd, items[j].end);
      j++;
    }
    const colEnds = [];
    cluster.forEach(it => {
      let col = colEnds.findIndex(e => e <= it.start);
      if (col === -1) { col = colEnds.length; colEnds.push(it.end); }
      else colEnds[col] = it.end;
      it.col = col;
    });
    const cols = colEnds.length;
    cluster.forEach(it => { layout[it.id] = { col: it.col, cols }; });
    i = j;
  }
  return layout;
}

// ── Component ───────────────────────────────────────────────────
export default function Schedule() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isCEO = profile?.role === 'ceo';

  const [batches,       setBatches]       = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(ALL); // default: show everything
  const [schedules,     setSchedules]     = useState([]);
  const [assessments,   setAssessments]   = useState([]);
  const [staffList,     setStaffList]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [toast,         setToast]         = useState(null);
  const [saving,        setSaving]        = useState(false);
  // In-app confirm dialog (replaces native window.confirm)
  const [confirmBox,    setConfirmBox]    = useState(null); // { message, onConfirm, confirmLabel }
  const askConfirm = (message, onConfirm, confirmLabel = 'Delete') => setConfirmBox({ message, onConfirm, confirmLabel });

  // students cache per batch (for attendance / participant lists)
  const [studentsCache, setStudentsCache] = useState({}); // batchId -> [{id,name}]

  // Calendar
  const [view,          setView]          = useState('week'); // 'week' | 'month'
  const [myOnly,        setMyOnly]        = useState(false);   // staff: show only my classes
  const [calDate,       setCalDate]       = useState(new Date());
  const [slotDetail,    setSlotDetail]    = useState(null);
  const [reschedule,    setReschedule]    = useState(null); // { slot, date, time }
  const [reportOnlyUnmarked, setReportOnlyUnmarked] = useState(false);
  const [activeTab,     setActiveTab]     = useState('calendar'); // 'calendar' | 'attendance'

  // Add class modal
  const [showAdd,       setShowAdd]       = useState(false);
  const [form,          setForm]          = useState(blankForm());
  const [modalStudents, setModalStudents] = useState([]); // students of the batch chosen in the add form
  const [studentSearch, setStudentSearch] = useState(''); // filter in the specific-students picker
  const [detailSearch,  setDetailSearch]  = useState(''); // filter students inside the slot-detail popup

  // Attendance modal
  const [attSession,    setAttSession]    = useState(null);
  const [attData,       setAttData]       = useState({}); // studentId → { name, present }
  const [attSearch,     setAttSearch]     = useState('');
  const [savedAtt,      setSavedAtt]      = useState({});  // sessionId → true
  const [attLoading,    setAttLoading]    = useState(false);
  const [attParticipants, setAttParticipants] = useState([]);

  // Progress reports modal
  const [reportSession, setReportSession] = useState(null);
  const [reportParts,   setReportParts]   = useState([]);      // participants of the session
  const [reportNotes,   setReportNotes]   = useState({});      // studentId -> { text, rating, existingId }
  const [prevReports,   setPrevReports]   = useState({});      // studentId -> [reports by all faculty]
  const [expanded,      setExpanded]      = useState({});      // studentId -> bool (history open)
  const [reportModalLoading, setReportModalLoading] = useState(false);

  // Attendance report (tab)
  const [attReport,     setAttReport]     = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [attDateFilter, setAttDateFilter] = useState(localDateStr(new Date())); // default: today
  const [attStaffFilter, setAttStaffFilter] = useState('');
  const [attView,        setAttView]        = useState('session'); // 'session' | 'student'
  const [attStudentSearch, setAttStudentSearch] = useState('');
  const [attBatchFilter, setAttBatchFilter] = useState('');
  const [attExpanded,    setAttExpanded]    = useState({});   // row id → open
  const [attStudentInfo, setAttStudentInfo] = useState({});   // studentId → { phone, batch }

  // Schedule Coverage (tab) — which students got a class scheduled vs missed
  const [covBatch,     setCovBatch]     = useState('');
  const [covWindow,    setCovWindow]    = useState('7');   // 'today' | '7' | '30'
  const [covStudents,  setCovStudents]  = useState([]);
  const [covSchedules, setCovSchedules] = useState([]);
  const [covLoading,   setCovLoading]   = useState(false);

  function blankForm() {
    return { title: '', batchId: '', day: 'Monday', scheduledDate: '', recurring: false, time: '', duration: '60', type: 'live-class', facultyName: '', meetLink: '', notes: '', participantType: 'all', participantIds: [] };
  }

  const batchName = (id) => batches.find(b => b.id === id)?.name || '';
  const visibleBatchIds = () => new Set(batches.map(b => b.id));

  // fetch + cache students for a batch
  const loadStudents = async (batchId) => {
    if (!batchId) return [];
    if (studentsCache[batchId]) return studentsCache[batchId];
    try {
      const res = await getBatchStudents(batchId, { role: profile?.role, uid: profile?.uid, email: profile?.email });
      const list = (res.students || []).map(s => ({ id: s.id, name: s.name, phone: s.phone || '', course: s.course || '', education: s.education || '', std: s.classStd || s.std || s.class || '' }));
      setStudentsCache(prev => ({ ...prev, [batchId]: list }));
      return list;
    } catch { return []; }
  };

  // ── Coverage tab: load students + schedules for the chosen batch ──
  useEffect(() => {
    if (activeTab !== 'coverage' || !covBatch) { setCovStudents([]); setCovSchedules([]); return; }
    let cancelled = false;
    (async () => {
      setCovLoading(true);
      const [studs, scheds] = await Promise.all([
        loadStudents(covBatch),
        getBatchSchedules(covBatch).catch(() => []),
      ]);
      if (!cancelled) { setCovStudents(studs); setCovSchedules(scheds); setCovLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeTab, covBatch]);

  // ── Load batches + all schedules ──────────────────────────────
  const reloadSchedules = async (batchList) => {
    try {
      if (selectedBatch === ALL) {
        setSchedules(await getAllSchedules());
      } else {
        setSchedules(await getBatchSchedules(selectedBatch));
      }
    } catch (err) {
      import.meta.env.DEV && console.error('Schedule load failed:', err);
      setSchedules([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [bList, sList, asmts, sch] = await Promise.all([
          getBatches().catch(() => []),
          getStaffProfiles().catch(() => []),
          getAllAssessments().catch(() => []),
          getAllSchedules().catch(() => []),
        ]);
        setBatches(bList);
        setStaffList(sList);
        setAssessments(asmts);
        setSchedules(sch);
      } catch (err) {
        import.meta.env.DEV && console.error('Schedule initial load failed:', err);
      } finally {
        setLoading(false);   // always render, never hang on a blank spinner
      }
    };
    load();
  }, []);  // eslint-disable-line

  useEffect(() => {
    if (loading) return;
    reloadSchedules();
  }, [selectedBatch]); // eslint-disable-line

  // preload students for the batch chosen in the Add modal
  useEffect(() => {
    const bid = selectedBatch === ALL ? form.batchId : selectedBatch;
    if (!bid) { setModalStudents([]); return; }
    loadStudents(bid).then(setModalStudents);
  }, [form.batchId, selectedBatch]); // eslint-disable-line

  // ── Load attendance report ────────────────────────────────────
  const loadAttReport = async () => {
    setReportLoading(true);
    const results = await Promise.all(
      schedules.map(async s => {
        try {
          const att = await getSessionAttendance(s.id);
          return { session: s, attendance: att[0] || null };
        } catch { return { session: s, attendance: null }; }
      })
    );
    const withAtt = results.filter(r => r.attendance?.attendance || r.attendance?.records);
    setAttReport(withAtt);
    // Build a studentId → { phone, batch } map from the batches that have
    // attendance, so the By-Student report can show phone numbers.
    const scope = { role: profile?.role, uid: profile?.uid, email: profile?.email };
    const batchIds = [...new Set(withAtt.map(r => r.session?.batchId).filter(Boolean))];
    const info = {};
    await Promise.all(batchIds.map(async bid => {
      try {
        const { students } = await getBatchStudents(bid, scope);
        const bName = batchName(bid);
        (students || []).forEach(st => { info[st.id] = { phone: st.phone || st.whatsappNumber || '', batch: st.batchName || bName }; });
      } catch { /* ignore batch load failures */ }
    }));
    setAttStudentInfo(info);
    setReportLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'attendance') loadAttReport();
  }, [activeTab, schedules]); // eslint-disable-line

  // Notify a schedule's assigned faculty (in-app + email). Resolves the
  // recipient from the stored facultyEmail, falling back to a name match
  // for older schedule docs created before facultyEmail was persisted.
  const notifyFacultyOfSchedule = (slot, title, body) => {
    const email = slot.facultyEmail || staffList.find(s => s.name === slot.facultyName)?.email;
    if (!email) return;
    const when = slot.recurring
      ? `Every ${slot.day} at ${slot.time}`
      : [slot.scheduledDate, slot.time].filter(Boolean).join(' at ');
    notifyStaff({
      toEmail: email, fromName: profile?.name || 'ISC SMS',
      title, body, type: 'schedule', route: '/schedule',
      intro: `Hi ${slot.facultyName || ''}, there is an update to your schedule on ISC SMS.`.replace('Hi ,', 'Hi,'),
      details: [
        { label: 'Class',      value: slot.title },
        { label: 'Batch',      value: slot.batchName || batchName(slot.batchId) },
        { label: 'When',       value: when },
        { label: 'Duration',   value: slot.duration ? `${slot.duration} minutes` : '' },
        { label: 'Type',       value: slot.type },
        { label: 'Meet link',  value: slot.meetLink },
        { label: 'Notes',      value: slot.notes },
        { label: 'Updated by', value: profile?.name },
      ].filter(d => d.value),
    }).catch(() => {});
  };

  // ── Add class ─────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    const targetBatch = selectedBatch === ALL ? form.batchId : selectedBatch;
    if (!targetBatch) { setToast({ message: 'Please choose a batch for this entry.', type: 'error' }); return; }
    setSaving(true);
    try {
      const faculty = form.facultyName
        ? staffList.find(s => s.name === form.facultyName)
        : null;
      await addBatchSchedule({
        ...form,
        facultyEmail: faculty?.email || '',
        facultyUid:   faculty?.uid || '',
        batchId: targetBatch,
        batchName: batchName(targetBatch),
        participantStudents: form.type === 'meeting'
          ? []   // meetings are staff-only, no students
          : form.participantType === 'all'
            ? modalStudents.map(s => ({ id: s.id, name: s.name }))
            : modalStudents.filter(s => form.participantIds.includes(s.id)).map(s => ({ id: s.id, name: s.name })),
      });
      // Notify the assigned faculty (in-app + email together)
      if (faculty?.email) {
        const when = form.recurring
          ? `Every ${form.day} at ${form.time}`
          : `${form.scheduledDate} at ${form.time}`;
        notifyStaff({
          toEmail: faculty.email, fromName: profile?.name || 'ISC SMS',
          title: 'Class Scheduled', type: 'schedule', route: '/schedule',
          body: `You have been assigned to "${form.title}" — ${when} (${batchName(targetBatch)})`,
          intro: `Hi ${faculty.name}, a class has been scheduled for you on ISC SMS.`,
          details: [
            { label: 'Class',        value: form.title },
            { label: 'Batch',        value: batchName(targetBatch) },
            { label: 'When',         value: when },
            { label: 'Duration',     value: form.duration ? `${form.duration} minutes` : '' },
            { label: 'Type',         value: form.type },
            { label: 'Meet link',    value: form.meetLink },
            { label: 'Notes',        value: form.notes },
            { label: 'Scheduled by', value: profile?.name },
          ].filter(d => d.value),
        }).catch(()=>{});
      }
      setToast({ message: 'Added to schedule!', type: 'success' });
      setShowAdd(false);
      setForm(blankForm()); setStudentSearch('');
      await reloadSchedules();
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setSaving(false);
  };

  // ── Attendance modal ──────────────────────────────────────────
  const sessionParticipants = async (slot) => {
    if (slot.participantStudents?.length) return slot.participantStudents;
    return await loadStudents(slot.batchId);
  };

  const openAttendance = async (slot) => {
    setAttSession(slot);
    setAttSearch('');
    setAttLoading(true);
    const participants = await sessionParticipants(slot);
    setAttParticipants(participants);
    try {
      const existing = await getSessionAttendance(slot.id);
      const rec = existing[0];
      const stored = rec?.attendance || rec?.records;
      if (stored) {
        setAttData(stored);
      } else {
        const blank = {};
        participants.forEach(s => { blank[s.id] = { name: s.name, present: false }; });
        setAttData(blank);
      }
    } catch {
      const blank = {};
      participants.forEach(s => { blank[s.id] = { name: s.name, present: false }; });
      setAttData(blank);
    }
    setAttLoading(false);
  };

  const handleSaveAttendance = async () => {
    if (!attSession) return;
    setSaving(true);
    try {
      await saveAttendance(attSession.id, attSession.batchId, attData);
      setSavedAtt(prev => ({ ...prev, [attSession.id]: true }));
      setToast({ message: 'Attendance saved!', type: 'success' });
      setAttSession(null);
      if (activeTab === 'attendance') loadAttReport();
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setSaving(false);
  };

  const handleClearAttendance = () => {
    if (!attSession) return;
    askConfirm('Clear all saved attendance for this class? This cannot be undone.', doClearAttendance, 'Clear');
  };

  const doClearAttendance = async () => {
    if (!attSession) return;
    setSaving(true);
    try {
      await deleteSessionAttendance(attSession.id);
      const blank = {};
      attParticipants.forEach(s => { blank[s.id] = { name: s.name, present: false }; });
      setAttData(blank);
      setSavedAtt(prev => { const n = { ...prev }; delete n[attSession.id]; return n; });
      setToast({ message: 'Attendance cleared.', type: 'info' });
      setAttSession(null);
      if (activeTab === 'attendance') loadAttReport();
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setSaving(false);
  };

  // ── Progress reports modal ────────────────────────────────────
  const openReports = async (slot) => {
    setReportSession(slot);
    setReportModalLoading(true);
    setExpanded({});
    const participants = await sessionParticipants(slot);
    setReportParts(participants);
    try {
      // existing reports for THIS session (to prefill / edit my own note)
      const sessionReports = await getSessionReports(slot.id);
      const myUid = profile?.uid;
      const notes = {};
      participants.forEach(s => {
        const mine = sessionReports.find(r => r.studentId === s.id && r.facultyUid === myUid);
        notes[s.id] = { text: mine?.note || '', rating: mine?.rating || '', existingId: mine?.id || null };
      });
      setReportNotes(notes);
      // all previous reports per student (across every faculty & class)
      const histories = await Promise.all(
        participants.map(async s => [s.id, await getStudentReports(s.id)])
      );
      setPrevReports(Object.fromEntries(histories));
    } catch {
      setReportNotes({});
      setPrevReports({});
    }
    setReportModalLoading(false);
  };

  const handleSaveReports = async () => {
    if (!reportSession) return;
    setSaving(true);
    try {
      const jobs = [];
      for (const s of reportParts) {
        const n = reportNotes[s.id];
        if (!n || (!n.text.trim() && !n.rating)) continue;
        if (n.existingId) {
          jobs.push(updateClassReport(n.existingId, { note: n.text.trim(), rating: n.rating }));
        } else {
          jobs.push(saveClassReport({
            scheduleId: reportSession.id,
            batchId: reportSession.batchId,
            batchName: reportSession.batchName || batchName(reportSession.batchId),
            sessionTitle: reportSession.title,
            sessionDate: reportSession.scheduledDate || reportSession.day || '',
            studentId: s.id,
            studentName: s.name,
            facultyUid: profile?.uid || '',
            facultyName: profile?.name || 'Staff',
            note: n.text.trim(),
            rating: n.rating,
          }));
        }
      }
      await Promise.all(jobs);
      setToast({ message: 'Progress reports saved!', type: 'success' });
      setReportSession(null);
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setSaving(false);
  };

  // ── Bulk export attendance ─────────────────────────────────────
  const exportAttendance = async () => {
    const rows = [['Batch', 'Session', 'Date/Day', 'Student', 'Present']];
    for (const { session, attendance } of attReport) {
      const stored = attendance?.attendance || attendance?.records;
      if (stored) {
        Object.entries(stored).forEach(([, v]) => {
          rows.push([ session.batchName || batchName(session.batchId), session.title, session.scheduledDate || session.day, v.name, v.present ? 'Yes' : 'No' ]);
        });
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `attendance-${selectedBatch === ALL ? 'all-batches' : batchName(selectedBatch)}.csv`;
    a.click();
  };

  // ── Calendar helpers ───────────────────────────────────────────
  const weekDates = getWeekDates(calDate);
  const monthCells = getMonthDates(calDate);
  const today = new Date(); today.setHours(0,0,0,0);
  const monthLabel = calDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const weekLabel = `${weekDates[0].toLocaleDateString('default',{month:'short',day:'numeric'})} – ${weekDates[6].toLocaleDateString('default',{month:'short',day:'numeric',year:'numeric'})}`;
  const dayLabel  = calDate.toLocaleDateString('default', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const curLabel  = view === 'week' ? weekLabel : view === 'month' ? monthLabel : dayLabel;

  const navPrev = () => { const d = new Date(calDate); if (view === 'week') d.setDate(d.getDate() - 7); else if (view === 'month') d.setMonth(d.getMonth() - 1); else d.setDate(d.getDate() - 1); setCalDate(d); };
  const navNext = () => { const d = new Date(calDate); if (view === 'week') d.setDate(d.getDate() + 7); else if (view === 'month') d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + 1); setCalDate(d); };

  const SlotPill = ({ slot, compact }) => {
    const pc = typeColor(slot.type);
    const sm = statusMeta(slot.status);
    const cancelled = slot.status === 'cancelled';
    const bg  = sm.bg || pc.bg;
    const col = sm.bar || pc.col;
    const faculty = slot.facultyName || batchName(slot.batchId);
    return (
      <div onClick={() => setSlotDetail(slot)}
        style={{ padding: compact ? '3px 6px' : '4px 8px', borderRadius: 5, marginBottom: 3, cursor: 'pointer', background: bg, color: col, fontSize: compact ? 10 : 11, fontWeight: 600, overflow: 'hidden', border: `1px solid ${col}30`, borderLeft: `3px solid ${col}` }}
        title={`${slot.title} · ${slot.batchName || batchName(slot.batchId)}${faculty ? ` · ${faculty}` : ''} · ${sm.label}`}>
        <div style={{ display:'flex', alignItems:'center', gap:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textDecoration: cancelled ? 'line-through' : 'none' }}>
          {slot.status === 'completed' && <CheckCircle size={9} style={{ flexShrink:0 }} />}
          {slot.time && `${slot.time} `}{slot.title}
        </div>
        {faculty && <div style={{ fontSize:9, fontWeight:500, opacity:.8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{faculty}</div>}
        {slot.status && <div style={{ fontSize:8.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.03em', marginTop:1 }}>{sm.label}</div>}
      </div>
    );
  };

  if (loading) return <Loading />;

  // Planned assessments become read-only calendar entries so staff can see them.
  const assessmentSlots = assessments
    .filter(a => a.date && (selectedBatch === ALL || a.batchId === selectedBatch))
    .map(a => ({
      id: 'assess-' + a.id, _assessment: true, type: 'assessment',
      title: a.title || a.testName || 'Assessment',
      batchId: a.batchId, batchName: a.batchName || batchName(a.batchId),
      scheduledDate: a.date, time: a.time || '09:00', duration: 60,
      facultyName: (a.conductingStaff || []).map(s => s.name).join(', '),
      totalMarks: a.totalMarks, status: a.status,
    }));
  // "My Schedule" filter — staff can hide other faculties' classes so they
  // don't miss their own. Matches on uid / email / name for older docs.
  const isMine = (s) => s.facultyUid === profile?.uid || (profile?.email && s.facultyEmail === profile?.email) || (profile?.name && s.facultyName === profile?.name);
  const visibleSchedules = myOnly ? schedules.filter(isMine) : schedules;
  const calendarSlots = [...visibleSchedules, ...(myOnly ? [] : assessmentSlots)];

  const filteredParticipants = attParticipants.filter(s => !attSearch || s.name?.toLowerCase().includes(attSearch.toLowerCase()));
  const presentCount = Object.values(attData).filter(v => v.present).length;
  const absentCount = Object.values(attData).filter(v => !v.present).length;

  return (
    <div>
      {/* ── Page Header ── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, letterSpacing:'-0.03em', color:'var(--ink)', margin:0, fontFamily:'var(--font-display)' }}>Schedule</h1>
          <p style={{ fontSize:14, color:'var(--muted)', margin:'6px 0 0' }}>Classes, meetings &amp; events across all live batches.</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          style={{ display:'flex', alignItems:'center', gap:7, height:40, padding:'0 16px', border:'none', borderRadius:9, background:'var(--accent)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font-body)', boxShadow:'0 8px 18px -8px rgba(15,158,142,.6)', flexShrink:0 }}>
          <Plus size={15}/> Add to Schedule
        </button>
      </div>

      {/* ── Batch filter (optional — defaults to All) ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, padding:'14px 16px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 }}>
        <Calendar size={18} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Viewing</div>
          <select className="form-input" style={{ maxWidth:380 }} value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}>
            <option value={ALL}>All batches &amp; meetings</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:12 }}>
          {[
            { label: selectedBatch === ALL ? 'Batches' : 'Classes', value: selectedBatch === ALL ? batches.length : schedules.length, color:'var(--blue-ink)', bg:'var(--blue-soft)' },
            { label:'Entries', value:schedules.length, color:'var(--green-ink)', bg:'var(--pos-50)' },
          ].map(k => (
            <div key={k.label} style={{ padding:'8px 14px', borderRadius:10, background:k.bg, textAlign:'center', minWidth:72 }}>
              <div style={{ fontSize:20, fontWeight:700, color:k.color, fontFamily:'var(--font-display)' }}>{k.value}</div>
              <div style={{ fontSize:10, color:k.color, fontWeight:500 }}>{k.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="tab-bar" style={{ marginBottom:16 }}>
        {[{ key:'calendar', label:'Calendar View' }, { key:'attendance', label:'Attendance Report' }, { key:'coverage', label:'Schedule Coverage' }].map(t => (
          <div key={t.key} className={`tab ${activeTab===t.key?'active':''}`} onClick={() => setActiveTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {/* ── CALENDAR TAB ── */}
      {activeTab === 'calendar' && (
        <div>
          {/* Toolbar */}
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:3 }}>
              {['day','week','month'].map(v => (
                <span key={v} onClick={() => setView(v)} style={{ padding:'6px 14px', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer', background: view===v ? 'var(--accent-50)' : 'transparent', color: view===v ? 'var(--accent-ink)' : 'var(--muted)', transition:'all .14s' }}>
                  {v.charAt(0).toUpperCase()+v.slice(1)}
                </span>
              ))}
            </div>
            {/* Staff: show only my classes so I don't miss my own across batches */}
            {!isCEO && (
              <button onClick={() => setMyOnly(v => !v)}
                style={{ padding:'6px 14px', borderRadius:9, border:'1px solid var(--border)', cursor:'pointer', fontSize:12.5, fontWeight:600,
                  background: myOnly ? 'var(--accent)' : 'var(--surface)', color: myOnly ? '#fff' : 'var(--sub)' }}>
                {myOnly ? '✓ My classes' : 'My classes'}
              </button>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span onClick={navPrev} style={{ width:32, height:32, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--sub)' }}><ChevronLeft size={15}/></span>
              <span style={{ fontSize:14, fontWeight:600, color:'var(--ink)', fontFamily:'var(--font-display)' }}>{curLabel}</span>
              <span onClick={navNext} style={{ width:32, height:32, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--sub)' }}><ChevronRight size={15}/></span>
            </div>
            <div style={{ flex:1 }}/>
            <div style={{ display:'flex', alignItems:'center', gap:14, fontSize:12, color:'var(--sub)' }}>
              <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:9, height:9, borderRadius:3, background:'var(--pos)', display:'inline-block' }}/> Live class</span>
              <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:9, height:9, borderRadius:3, background:'var(--info)', display:'inline-block' }}/> Meeting</span>
              <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:9, height:9, borderRadius:3, background:'var(--neg)', display:'inline-block' }}/> Assessment</span>
              <span style={{ width:1, height:14, background:'var(--border)' }}/>
              <span style={{ color:'var(--green-ink)', fontWeight:600 }}>✓ Completed</span>
              <span style={{ color:'var(--amber-ink)', fontWeight:600 }}>Rescheduled</span>
              <span style={{ color:'var(--red-ink)', fontWeight:600, textDecoration:'line-through' }}>Cancelled</span>
            </div>
          </div>

          {/* Week view — time grid */}
          {view === 'week' && (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', boxShadow:'var(--sh-sm)', overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'58px repeat(7,1fr)', borderBottom:'1px solid var(--border)' }}>
                <div style={{ borderRight:'1px solid var(--border-soft)' }}/>
                {weekDates.map((date, idx) => {
                  const isToday = date.toDateString() === today.toDateString();
                  return (
                    <div key={idx} style={{ padding:'11px 0', textAlign:'center', borderRight:'1px solid var(--border-soft)', background: isToday ? 'rgba(15,158,142,.04)' : 'transparent' }}>
                      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.08em', color:'var(--muted)' }}>{date.toLocaleDateString('default',{weekday:'short'}).toUpperCase()}</div>
                      <div style={{ margin:'5px auto 0', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, fontFamily:'var(--font-display)', background: isToday ? 'var(--accent)' : 'transparent', color: isToday ? '#fff' : 'var(--ink)' }}>{date.getDate()}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'58px repeat(7,1fr)' }}>
                <div>
                  {HOURS.map(h => (
                    <div key={h} style={{ height:HOUR_PX, borderRight:'1px solid var(--border-soft)', borderBottom:'1px solid var(--border-soft)', fontSize:10.5, color:'var(--faint)', textAlign:'right', padding:'4px 8px 0 0' }}>{h}:00</div>
                  ))}
                </div>
                {weekDates.map((date, idx) => {
                  const isToday = date.toDateString() === today.toDateString();
                  const slots = getSlotsForDate(date, calendarSlots);
                  const layout = computeDayLayout(slots);
                  return (
                    <div key={idx} style={{ position:'relative', height: HOURS.length * HOUR_PX, borderRight:'1px solid var(--border-soft)', background: isToday ? 'rgba(15,158,142,.04)' : 'transparent', backgroundImage:`repeating-linear-gradient(var(--border-soft) 0 1px, transparent 1px ${HOUR_PX}px)` }}>
                      {slots.map(slot => {
                        const pc = typeColor(slot.type);
                        const sm = statusMeta(slot.status);
                        const { top, height } = slotPos(slot);
                        const slotBg  = sm.bg || pc.bg;
                        const slotBar = sm.bar || pc.bar;
                        const { col = 0, cols = 1 } = layout[slot.id] || {};
                        return (
                          <div key={slot.id} onClick={() => setSlotDetail(slot)}
                            style={{ position:'absolute', left:`calc(${(col/cols)*100}% + 2px)`, width:`calc(${(1/cols)*100}% - 4px)`, top, height, background:slotBg, borderLeft:`3px solid ${slotBar}`, borderRadius:7, padding:'4px 6px', overflow:'hidden', cursor:'pointer' }}>
                            <div style={{ fontSize: cols>1?10.5:11.5, fontWeight:700, color:'var(--ink)', lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textDecoration: slot.status==='cancelled'?'line-through':'none' }}>{slot.status==='completed' && '✓ '}{slot.title}</div>
                            <div style={{ fontSize:9, color:slotBar, fontWeight:700, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{slot.facultyName || slot.batchName || batchName(slot.batchId)}</div>
                            {slot.status
                              ? <div style={{ fontSize:8.5, fontWeight:700, color:sm.ink, textTransform:'uppercase', letterSpacing:'.03em', marginTop:1 }}>{sm.label}</div>
                              : (cols === 1 && <div style={{ fontSize:9.5, color:'var(--sub)', marginTop:1 }}>{slot.time ? `${slot.time} ` : ''}{slot.batchName || batchName(slot.batchId)}</div>)}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Day view — single day time grid */}
          {view === 'day' && (() => {
            const isToday = calDate.toDateString() === today.toDateString();
            const slots = getSlotsForDate(calDate, calendarSlots);
            const layout = computeDayLayout(slots);
            return (
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', boxShadow:'var(--sh-sm)', overflow:'hidden' }}>
                <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, fontFamily:'var(--font-display)', background: isToday ? 'var(--accent)' : 'var(--surface-2)', color: isToday ? '#fff' : 'var(--ink)' }}>{calDate.getDate()}</div>
                  <div>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'var(--ink)' }}>{calDate.toLocaleDateString('default',{weekday:'long'})}</div>
                    <div style={{ fontSize:11.5, color:'var(--muted)' }}>{slots.length} scheduled</div>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'58px 1fr' }}>
                  <div>
                    {HOURS.map(h => (
                      <div key={h} style={{ height:HOUR_PX, borderRight:'1px solid var(--border-soft)', borderBottom:'1px solid var(--border-soft)', fontSize:10.5, color:'var(--faint)', textAlign:'right', padding:'4px 8px 0 0' }}>{h}:00</div>
                    ))}
                  </div>
                  <div style={{ position:'relative', height: HOURS.length * HOUR_PX, background: isToday ? 'rgba(15,158,142,.04)' : 'transparent', backgroundImage:`repeating-linear-gradient(var(--border-soft) 0 1px, transparent 1px ${HOUR_PX}px)` }}>
                    {slots.map(slot => {
                      const pc = typeColor(slot.type);
                      const { top, height } = slotPos(slot);
                      const sm = statusMeta(slot.status);
                      const slotBg  = sm.bg || pc.bg;
                      const slotBar = sm.bar || pc.bar;
                      const { col = 0, cols = 1 } = layout[slot.id] || {};
                      return (
                        <div key={slot.id} onClick={() => setSlotDetail(slot)}
                          style={{ position:'absolute', left:`calc(${(col/cols)*100}% + 6px)`, width:`calc(${(1/cols)*100}% - 10px)`, top, height, background:slotBg, borderLeft:`3px solid ${slotBar}`, borderRadius:7, padding:'6px 10px', overflow:'hidden', cursor:'pointer' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span style={{ fontSize:12.5, fontWeight:700, color:'var(--ink)', textDecoration: slot.status==='cancelled'?'line-through':'none' }}>{slot.status==='completed' && '✓ '}{slot.title}</span>
                            {slot.status && <span style={{ fontSize:9, fontWeight:700, color:sm.ink, background:'#fff', borderRadius:20, padding:'1px 7px' }}>{sm.label}</span>}
                          </div>
                          <div style={{ fontSize:10.5, color:slotBar, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{slot.facultyName || slot.batchName || batchName(slot.batchId)}{slot._assessment ? ' · Assessment' : ''}</div>
                          <div style={{ fontSize:10.5, color:'var(--sub)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{slot.time ? `${slot.time} ` : ''}{slot.batchName || batchName(slot.batchId)}</div>
                        </div>
                      );
                    })}
                    {slots.length === 0 && (
                      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--muted)', fontSize:13 }}>Nothing scheduled this day.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Month view — scrolls sideways on phones instead of crushing cells */}
          {view === 'month' && (
            <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
            <div style={{ minWidth:560 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1, marginBottom:4 }}>
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                  <div key={d} style={{ textAlign:'center', fontSize:11, fontWeight:700, color:'var(--muted)', padding:'6px 0' }}>{d}</div>
                ))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
                {monthCells.map(({ date, inMonth }, idx) => {
                  const isToday = date.toDateString() === today.toDateString();
                  const slots = inMonth ? getSlotsForDate(date, calendarSlots) : [];
                  return (
                    <div key={idx} style={{ background:inMonth?'var(--surface)':'var(--surface-2)', borderRadius:8, minHeight:80, padding:6, border:`1px solid ${isToday?'var(--accent)':'var(--border)'}`, opacity:inMonth?1:0.4 }}>
                      <div style={{ width:22, height:22, borderRadius:'50%', background:isToday?'var(--accent)':'transparent', color:isToday?'#fff':inMonth?'var(--text)':'var(--muted)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:isToday?700:500, fontSize:12, marginBottom:4 }}>{date.getDate()}</div>
                      {slots.slice(0,3).map(slot => <SlotPill key={slot.id} slot={slot} compact/>)}
                      {slots.length > 3 && <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>+{slots.length-3} more</div>}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          )}

          {calendarSlots.length === 0 && (
            <div className="card" style={{ textAlign:'center', color:'var(--muted)', padding:40, marginTop:16 }}>
              <Calendar size={32} style={{ color:'var(--border)', marginBottom:8 }}/>
              <div>Nothing scheduled yet — add classes, meetings or events.</div>
              <button className="btn btn-primary" style={{ marginTop:12 }} onClick={() => setShowAdd(true)}><Plus size={14}/> Add First Entry</button>
            </div>
          )}

        </div>
      )}

      {/* ── Slot detail popup ── */}
      {slotDetail && (() => {
        const pc = typeColor(slotDetail.type);
        const participants = slotDetail.participantStudents?.length ? slotDetail.participantStudents : null;
        const shown = participants
          ? participants.filter(p => !detailSearch || p.name?.toLowerCase().includes(detailSearch.toLowerCase()) || (p.phone||'').includes(detailSearch))
          : [];
        return (
          <Modal title={slotDetail.title} onClose={() => { setSlotDetail(null); setDetailSearch(''); }} wide>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, alignItems:'center' }}>
              <span style={{ padding:'2px 10px', borderRadius:10, background:pc.bg, color:pc.col, fontWeight:600, fontSize:11 }}>{pc.label}</span>
              <span style={{ padding:'2px 10px', borderRadius:10, background:'var(--surface-2)', color:'var(--sub)', fontWeight:600, fontSize:11 }}>{slotDetail.batchName || batchName(slotDetail.batchId)}</span>
              {slotDetail.status && <span className={`badge ${slotDetail.status==='completed'?'badge-green':slotDetail.status==='cancelled'?'badge-red':'badge-amber'}`}>{slotDetail.status}</span>}
            </div>
            <div style={{ fontSize:13, color:'var(--sub)', display:'flex', flexDirection:'column', gap:4, marginBottom:14 }}>
              <div><strong>When:</strong> {slotDetail.scheduledDate || slotDetail.day} {slotDetail.scheduledDate ? '(one-time)' : '(recurring)'} {slotDetail.time && `at ${slotDetail.time}`} · {slotDetail.duration} min</div>
              {slotDetail.facultyName && <div><strong>Faculty / Organizer:</strong> {slotDetail.facultyName}</div>}
              {slotDetail.meetLink
                ? <div><strong>Meet link:</strong> <a href={slotDetail.meetLink} target="_blank" rel="noreferrer" style={{ color:'var(--accent)' }}>{slotDetail.meetLink}</a></div>
                : <div style={{ color:'var(--muted)' }}><strong style={{ color:'var(--sub)' }}>Meet link:</strong> none</div>}
              {slotDetail.notes && <div style={{ fontStyle:'italic' }}>“{slotDetail.notes}”</div>}
            </div>

            {/* Students — scales to thousands: count + search + capped scroll list */}
            <div style={{ marginBottom:16 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                <strong style={{ fontSize:13 }}>Students</strong>
                {participants
                  ? <span className="badge badge-blue">{participants.length} selected</span>
                  : <span className="badge badge-green">All batch students</span>}
              </div>
              {participants && participants.length > 0 && (
                <>
                  {participants.length > 12 && (
                    <div style={{ position:'relative', marginBottom:8 }}>
                      <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--muted)' }}/>
                      <input className="form-input" style={{ paddingLeft:30 }} placeholder={`Search ${participants.length} students…`}
                        value={detailSearch} onChange={e => setDetailSearch(e.target.value)}/>
                    </div>
                  )}
                  <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:280, overflowY:'auto', padding:2, border:'1px solid var(--border)', borderRadius:10 }}>
                    {shown.slice(0, 300).map((p, i) => (
                      <div key={p.id}
                        onClick={() => { setSlotDetail(null); setDetailSearch(''); navigate(`/students/${p.id}`); }}
                        style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, cursor:'pointer', transition:'background .12s' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface-2)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <span style={{ fontSize:11, color:'var(--muted)', width:22, textAlign:'right', flexShrink:0 }}>{i + 1}.</span>
                        <span style={{ width:26, height:26, borderRadius:'50%', background:avatarColor(p.name), display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(p.name)}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</div>
                          {p.phone && <div style={{ fontSize:11, color:'var(--muted)' }}>{p.phone}</div>}
                        </div>
                        <ChevronRight size={14} style={{ color:'var(--muted)', flexShrink:0 }}/>
                      </div>
                    ))}
                    {shown.length === 0 && <span style={{ fontSize:12, color:'var(--muted)', padding:8 }}>No match.</span>}
                    {shown.length > 300 && <span style={{ fontSize:11.5, color:'var(--muted)', padding:8 }}>+{shown.length - 300} more — refine search to see them</span>}
                  </div>
                </>
              )}
            </div>

            {slotDetail._assessment ? (
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span className="badge badge-red">Assessment</span>
                <span style={{ fontSize:12.5, color:'var(--sub)' }}>Total marks: {slotDetail.totalMarks ?? '—'} · Manage marks &amp; results from the Assessments page.</span>
              </div>
            ) : (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', borderTop:'1px solid var(--border)', paddingTop:14 }}>
                <button className="btn btn-primary btn-sm" onClick={() => openAttendance(slotDetail)}>
                  <Users size={13}/> {savedAtt[slotDetail.id] ? 'Edit Attendance' : 'Mark Attendance'}
                </button>
                <button className="btn btn-sm" style={{ border:'1px solid var(--accent)', background:'var(--accent-50)', color:'var(--accent-ink)' }} onClick={() => openReports(slotDetail)}>
                  <MessageSquare size={13}/> Progress Reports
                </button>
                <select className="form-input" style={{ height:32, fontSize:12, flex:'0 0 auto', width:'auto' }} value={slotDetail.status || ''}
                  onChange={async e => {
                    const ns = e.target.value; if (!ns) return;
                    if (ns === 'rescheduled') { setReschedule({ slot: slotDetail, date: slotDetail.scheduledDate || '', time: slotDetail.time || '' }); return; }
                    await updateScheduleStatus(slotDetail.id, ns); await reloadSchedules(); setSlotDetail({ ...slotDetail, status: ns });
                    if (ns === 'cancelled') {
                      notifyFacultyOfSchedule(slotDetail, 'Class Cancelled',
                        `"${slotDetail.title}"${slotDetail.batchName ? ` (${slotDetail.batchName})` : ''} has been cancelled.`);
                    }
                  }}>
                  <option value="">Update status…</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="rescheduled">Rescheduled</option>
                </select>
                <div style={{ flex:1 }}/>
                <button className="btn btn-sm" style={{ background:'var(--neg-50)', color:'var(--red-ink)', border:'none' }}
                  onClick={async () => {
                    // Warn if the class has attendance and/or progress reports —
                    // deleting the class removes those permanently too.
                    const [att, reps] = await Promise.all([
                      getSessionAttendance(slotDetail.id).catch(() => []),
                      getSessionReports(slotDetail.id).catch(() => []),
                    ]);
                    const hasAtt = att.some(a => a.attendance || a.records);
                    const nReps = reps.length;
                    const parts = [hasAtt && 'its attendance record', nReps && `${nReps} progress report${nReps > 1 ? 's' : ''}`].filter(Boolean);
                    const message = parts.length
                      ? `This class has ${parts.join(' and ')}. Deleting the class will permanently delete ${parts.join(' and ')} as well. This cannot be undone.`
                      : 'Delete this entry? This cannot be undone.';
                    askConfirm(message, async () => {
                      await deleteSessionAttendance(slotDetail.id).catch(() => {});
                      await deleteSessionReports(slotDetail.id).catch(() => {});
                      await deleteBatchSchedule(slotDetail.id);
                      await reloadSchedules();
                      setSlotDetail(null);
                    });
                  }}>
                  <Trash2 size={12}/> Delete
                </button>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ── ATTENDANCE REPORT TAB ── */}
      {activeTab === 'attendance' && (() => {
        const dateOf = (r) => {
          // The class's own date is the truth: a one-time class carries
          // scheduledDate, so attendance belongs to THAT day even if it was
          // marked later. Only recurring classes (no scheduledDate) fall back
          // to the date attendance was actually recorded.
          if (r.session?.scheduledDate) return r.session.scheduledDate;
          const ts = r.attendance?.createdAt || r.attendance?.savedAt;
          if (ts?.seconds) return localDateStr(new Date(ts.seconds * 1000));
          return '';
        };
        const facultyNames = [...new Set(attReport.map(r => r.session?.facultyName).filter(Boolean))];
        // Batches that have attendance (for the batch filter dropdown).
        const batchOptions = [...new Map(
          attReport.map(r => [r.session?.batchId, r.session?.batchName || batchName(r.session?.batchId)])
            .filter(([id]) => id)
        ).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.name||'').localeCompare(b.name||''));

        // Sessions passing staff + batch + cancelled filters; then the date
        // filter. Both views (session & student) derive from the same `shown`.
        const baseFiltered = attReport.filter(r => {
          if (r.session?.status === 'cancelled') return false;
          if (attStaffFilter && r.session?.facultyName !== attStaffFilter) return false;
          if (attBatchFilter && r.session?.batchId !== attBatchFilter) return false;
          return true;
        });
        const shown = baseFiltered.filter(r => !attDateFilter || dateOf(r) === attDateFilter);

        const pctColor = (p) => p >= 85 ? 'var(--green-ink)' : p >= 60 ? 'var(--amber-ink)' : 'var(--red-ink)';
        const RateBar = ({ p }) => (
          <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:90 }}>
            <div style={{ flex:1, height:6, borderRadius:4, background:'var(--neg-50)', overflow:'hidden', minWidth:44 }}>
              <div style={{ width:`${p}%`, height:'100%', background:pctColor(p), borderRadius:4 }}/>
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:pctColor(p), width:34, textAlign:'right' }}>{p}%</span>
          </div>
        );

        // Overall stats across the currently-shown sessions.
        let totPresent = 0, totMarks = 0;
        const studentIds = new Set();
        shown.forEach(({ attendance }) => {
          const stored = attendance?.attendance || attendance?.records;
          if (!stored) return;
          Object.entries(stored).forEach(([sid, v]) => { totMarks++; studentIds.add(sid); if (v.present) totPresent++; });
        });
        const overallPct = totMarks ? Math.round((totPresent / totMarks) * 100) : 0;

        // Per-student aggregation (by-student view) — respects all filters.
        const perStudent = {};
        shown.forEach(({ session, attendance }) => {
          const stored = attendance?.attendance || attendance?.records;
          if (!stored) return;
          const d = dateOf({ session, attendance });
          const sBatch = session.batchName || batchName(session.batchId);
          Object.entries(stored).forEach(([sid, v]) => {
            if (!perStudent[sid]) perStudent[sid] = { id: sid, name: v.name || sid, phone: attStudentInfo[sid]?.phone || '', batch: attStudentInfo[sid]?.batch || sBatch, present: 0, total: 0, sessions: [] };
            perStudent[sid].total++;
            if (v.present) perStudent[sid].present++;
            perStudent[sid].sessions.push({ key: session.id, title: session.title, batch: sBatch, date: d, present: !!v.present });
          });
        });
        const sq = attStudentSearch.toLowerCase();
        const students = Object.values(perStudent)
          .map(s => ({ ...s, pct: s.total ? Math.round((s.present / s.total) * 100) : 0, sessions: s.sessions.sort((a, b) => (b.date || '').localeCompare(a.date || '')) }))
          .filter(s => !sq || s.name.toLowerCase().includes(sq) || (s.phone || '').includes(attStudentSearch))
          .sort((a, b) => a.name.localeCompare(b.name));
        const toggleRow = (id) => setAttExpanded(m => ({ ...m, [id]: !m[id] }));

        return (
          <div>
            {/* Toolbar: view toggle + export */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              <div style={{ display:'flex', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:3 }}>
                {[{ key:'session', label:'By Session' }, { key:'student', label:'By Student' }].map(v => (
                  <span key={v.key} onClick={() => setAttView(v.key)}
                    style={{ padding:'6px 16px', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer',
                      background: attView===v.key ? 'var(--accent-50)' : 'transparent',
                      color: attView===v.key ? 'var(--accent-ink)' : 'var(--muted)' }}>{v.label}</span>
                ))}
              </div>
              <div style={{ flex:1 }}/>
              <button className="btn btn-secondary btn-sm" onClick={exportAttendance} disabled={attReport.length === 0}><Download size={13}/> Export CSV</button>
            </div>

            {/* Summary stat tiles */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:14 }}>
              <div className="card" style={{ padding:'14px 16px' }}>
                <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Attendance Rate</div>
                <div style={{ fontSize:26, fontWeight:700, color:pctColor(overallPct), marginTop:2 }}>{overallPct}%</div>
                <div style={{ height:6, borderRadius:4, background:'var(--neg-50)', marginTop:8, overflow:'hidden' }}>
                  <div style={{ width:`${overallPct}%`, height:'100%', background:pctColor(overallPct), borderRadius:4, transition:'width .4s' }}/>
                </div>
              </div>
              <div className="card" style={{ padding:'14px 16px' }}>
                <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Present / Marked</div>
                <div style={{ fontSize:26, fontWeight:700, marginTop:2 }}>{totPresent}<span style={{ fontSize:15, color:'var(--muted)', fontWeight:500 }}> / {totMarks}</span></div>
              </div>
              <div className="card" style={{ padding:'14px 16px' }}>
                <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{attView==='student' ? 'Students Tracked' : 'Sessions Shown'}</div>
                <div style={{ fontSize:26, fontWeight:700, marginTop:2 }}>{attView==='student' ? studentIds.size : shown.length}</div>
              </div>
            </div>

            {/* Filters — search (student), date, batch, staff (both views) */}
            <div className="mobile-stack" style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              {attView === 'student' && (
                <div style={{ position:'relative', minWidth:200, flex:'1 1 220px', maxWidth:320 }}>
                  <Search size={15} style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--muted)' }}/>
                  <input className="form-input" style={{ height:36, paddingLeft:34, width:'100%' }} placeholder="Search student by name or phone…"
                    value={attStudentSearch} onChange={e => setAttStudentSearch(e.target.value)}/>
                </div>
              )}
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'var(--muted)', fontWeight:600 }}>Date</span>
                <input type="date" className="form-input" style={{ height:36, width:'auto' }} value={attDateFilter} onChange={e => setAttDateFilter(e.target.value)}/>
                <button className="btn btn-ghost btn-sm" onClick={() => setAttDateFilter(localDateStr(new Date()))}>Today</button>
                {attDateFilter && <button className="btn btn-ghost btn-sm" onClick={() => setAttDateFilter('')}>All dates</button>}
              </div>
              <select className="form-input" style={{ height:36, width:'auto' }} value={attBatchFilter} onChange={e => setAttBatchFilter(e.target.value)}>
                <option value="">All batches</option>
                {batchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="form-input" style={{ height:36, width:'auto' }} value={attStaffFilter} onChange={e => setAttStaffFilter(e.target.value)}>
                <option value="">All staff / faculty</option>
                {facultyNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {reportLoading && <Loading/>}

            {/* ── BY SESSION (table) ── */}
            {!reportLoading && attView === 'session' && (
              shown.length === 0 ? (
                <div className="card" style={{ textAlign:'center', padding:48, color:'var(--muted)' }}>
                  {attReport.length === 0 ? 'No attendance data yet. Mark attendance on sessions from the Calendar tab.'
                    : 'No attendance for the selected filters. Try “All dates”, another batch or staff.'}
                </div>
              ) : (
                <div className="table-container" style={{ overflowX:'auto' }}>
                  <table style={{ minWidth:720, width:'100%' }}>
                    <thead><tr>
                      <th style={{ width:34 }}></th>
                      <th>Date</th><th>Class</th><th>Batch</th><th>Faculty</th>
                      <th style={{ textAlign:'center' }}>Present</th><th style={{ textAlign:'center' }}>Absent</th><th>Rate</th>
                    </tr></thead>
                    <tbody>
                      {shown.map(({ session, attendance }) => {
                        const stored = attendance?.attendance || attendance?.records;
                        if (!stored) return null;
                        const entries = Object.entries(stored);
                        const presentN = entries.filter(([, v]) => v.present).length;
                        const absentN = entries.length - presentN;
                        const pct = entries.length ? Math.round((presentN / entries.length) * 100) : 0;
                        const open = !!attExpanded[session.id];
                        return (
                          <Fragment key={session.id}>
                            <tr style={{ cursor:'pointer' }} onClick={() => toggleRow(session.id)}>
                              <td style={{ color:'var(--muted)' }}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</td>
                              <td style={{ fontSize:12.5, whiteSpace:'nowrap' }}>{dateOf({ session, attendance }) || session.scheduledDate || session.day}{session.time ? ` · ${session.time}` : ''}</td>
                              <td style={{ fontSize:13, fontWeight:600 }}>{session.title}</td>
                              <td style={{ fontSize:12.5, color:'var(--muted)' }}>{session.batchName || batchName(session.batchId)}</td>
                              <td style={{ fontSize:12.5, color:'var(--muted)' }}>{session.facultyName || '—'}</td>
                              <td style={{ textAlign:'center', fontWeight:600, color:'var(--green-ink)' }}>{presentN}</td>
                              <td style={{ textAlign:'center', fontWeight:600, color:'var(--red-ink)' }}>{absentN}</td>
                              <td><RateBar p={pct}/></td>
                            </tr>
                            {open && (
                              <tr>
                                <td/><td colSpan={7} style={{ background:'var(--surface-sunken)', padding:'10px 14px' }}>
                                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                                    {entries.map(([sid, v]) => (
                                      <span key={sid} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:500, background: v.present ? 'var(--pos-50)' : 'var(--neg-50)', color: v.present ? 'var(--green-ink)' : 'var(--red-ink)' }}>
                                        {v.present ? <CheckCircle size={11}/> : <XCircle size={11}/>}{v.name}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* ── BY STUDENT (table) ── */}
            {!reportLoading && attView === 'student' && (
              students.length === 0 ? (
                <div className="card" style={{ textAlign:'center', padding:48, color:'var(--muted)' }}>
                  {attReport.length === 0 ? 'No attendance data yet. Mark attendance on sessions from the Calendar tab.'
                    : attStudentSearch ? `No student matches “${attStudentSearch}”.` : 'No attendance records for the selected filters.'}
                </div>
              ) : (
                <div className="table-container" style={{ overflowX:'auto' }}>
                  <table style={{ minWidth:640, width:'100%' }}>
                    <thead><tr>
                      <th style={{ width:34 }}></th>
                      <th>Student</th><th>Phone</th><th>Batch</th>
                      <th style={{ textAlign:'center' }}>Present / Total</th><th>Attendance</th>
                    </tr></thead>
                    <tbody>
                      {students.map(s => {
                        const open = !!attExpanded[s.id];
                        return (
                          <Fragment key={s.id}>
                            <tr style={{ cursor:'pointer' }} onClick={() => toggleRow(s.id)}>
                              <td style={{ color:'var(--muted)' }}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</td>
                              <td style={{ fontSize:13, fontWeight:600 }}>{s.name}</td>
                              <td style={{ fontSize:12.5, color:'var(--muted)', whiteSpace:'nowrap' }}>{s.phone || '—'}</td>
                              <td style={{ fontSize:12.5, color:'var(--muted)' }}>{s.batch || '—'}</td>
                              <td style={{ textAlign:'center', fontSize:12.5 }}><b style={{ color:'var(--green-ink)' }}>{s.present}</b> / {s.total}</td>
                              <td><RateBar p={s.pct}/></td>
                            </tr>
                            {open && (
                              <tr>
                                <td/><td colSpan={5} style={{ background:'var(--surface-sunken)', padding:'10px 14px' }}>
                                  <div style={{ maxHeight:220, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
                                    {s.sessions.map((se, i) => (
                                      <div key={se.key + i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, padding:'4px 8px', borderRadius:6, background:'var(--surface)' }}>
                                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontWeight:600, width:74, color: se.present ? 'var(--green-ink)' : 'var(--red-ink)' }}>
                                          {se.present ? <CheckCircle size={12}/> : <XCircle size={12}/>}{se.present ? 'Present' : 'Absent'}
                                        </span>
                                        <span style={{ color:'var(--muted)', width:96, whiteSpace:'nowrap' }}>{se.date || '—'}</span>
                                        <span style={{ flex:1 }}>{se.title}</span>
                                        <span style={{ color:'var(--muted)', fontSize:11 }}>{se.batch}</span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        );
      })()}

      {/* ── SCHEDULE COVERAGE TAB ── */}
      {activeTab === 'coverage' && (() => {
        const today   = new Date();
        const toStr   = localDateStr(today);
        const days    = covWindow === 'today' ? 1 : parseInt(covWindow, 10);
        const from    = new Date(today); from.setDate(today.getDate() - (days - 1));
        const fromStr = localDateStr(from);
        // Which weekdays occur inside the window (for recurring classes).
        const weekdaysInWindow = new Set();
        for (let d = new Date(from); localDateStr(d) <= toStr; d.setDate(d.getDate() + 1)) {
          weekdaysInWindow.add(d.toLocaleDateString('en-US', { weekday: 'long' }));
        }
        const active = covSchedules.filter(s => {
          if (s.status === 'cancelled') return false;
          if (s.type === 'meeting') return false; // meetings are staff-only, not student classes
          if (s.recurring) return weekdaysInWindow.has(s.day);
          return s.scheduledDate && s.scheduledDate >= fromStr && s.scheduledDate <= toStr;
        });
        const allIds = covStudents.map(s => s.id);
        const countBy = {};
        active.forEach(s => {
          // Source of truth is participantStudents — the roster snapshot taken
          // when the class was created. A student who joined later isn't in it,
          // so they are correctly counted as missed for that class. Only fall
          // back to "all current students" for legacy classes with no snapshot.
          let ids;
          if (Array.isArray(s.participantStudents) && s.participantStudents.length) {
            ids = s.participantStudents.map(p => p.id);
          } else if (s.participantType === 'specific' && Array.isArray(s.participantIds) && s.participantIds.length) {
            ids = s.participantIds;
          } else {
            ids = allIds;
          }
          ids.forEach(id => { countBy[id] = (countBy[id] || 0) + 1; });
        });
        const covered = covStudents.filter(s => countBy[s.id]);
        const missed  = covStudents.filter(s => !countBy[s.id]);
        const pct = covStudents.length ? Math.round((covered.length / covStudents.length) * 100) : 0;
        const windowLabel = covWindow === 'today' ? 'today' : `last ${days} days`;

        return (
          <div>
            {/* Controls */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              <select className="form-input" style={{ height:36, width:'auto' }} value={covBatch} onChange={e => setCovBatch(e.target.value)}>
                <option value="">Select a batch…</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div style={{ display:'flex', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:3 }}>
                {[{ key:'today', label:'Today' }, { key:'7', label:'Last 7 days' }, { key:'30', label:'Last 30 days' }].map(w => (
                  <span key={w.key} onClick={() => setCovWindow(w.key)}
                    style={{ padding:'6px 14px', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer',
                      background: covWindow===w.key ? 'var(--accent-50)' : 'transparent',
                      color: covWindow===w.key ? 'var(--accent-ink)' : 'var(--muted)' }}>{w.label}</span>
                ))}
              </div>
              <div style={{ flex:1 }}/>
              {covBatch && !covLoading && (
                <div style={{ fontSize:13, color:'var(--muted)' }}>{active.length} class{active.length!==1?'es':''} scheduled · {windowLabel}</div>
              )}
            </div>

            {!covBatch && (
              <div className="card" style={{ textAlign:'center', padding:48, color:'var(--muted)' }}>
                Select a batch to see which students were included in scheduled classes and who was missed.
              </div>
            )}
            {covBatch && covLoading && <Loading/>}
            {covBatch && !covLoading && covStudents.length === 0 && (
              <div className="card" style={{ textAlign:'center', padding:48, color:'var(--muted)' }}>No students in this batch.</div>
            )}

            {covBatch && !covLoading && covStudents.length > 0 && (
              <>
                {/* Summary tiles */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:16 }}>
                  {[
                    { label:'Coverage',      value:`${pct}%`,          col:pct>=90?'var(--green-ink)':pct>=60?'var(--amber-ink)':'var(--red-ink)', bg:pct>=90?'var(--pos-50)':pct>=60?'var(--warn-50)':'var(--neg-50)' },
                    { label:'Covered',       value:covered.length,     col:'var(--green-ink)', bg:'var(--pos-50)' },
                    { label:'Missed',        value:missed.length,      col:'var(--red-ink)',   bg:'var(--neg-50)' },
                    { label:'Classes',       value:active.length,      col:'var(--brand)',     bg:'var(--surface-sunken)' },
                  ].map(k => (
                    <div key={k.label} style={{ padding:'14px 16px', borderRadius:12, background:k.bg }}>
                      <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>{k.label}</div>
                      <div style={{ fontSize:26, fontWeight:700, fontFamily:'var(--font-display)', color:k.col }}>{k.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                  {/* Missed — the important list */}
                  <div className="card" style={{ padding:'16px 18px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                      <AlertTriangle size={16} style={{ color:'var(--red-ink)' }}/>
                      <h3 style={{ fontSize:14, fontWeight:700 }}>Missed — no class scheduled ({missed.length})</h3>
                    </div>
                    {missed.length === 0 ? (
                      <div style={{ color:'var(--green-ink)', fontSize:13, textAlign:'center', padding:'20px 0' }}>Everyone was scheduled at least once. 🎉</div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:360, overflowY:'auto', paddingRight:4 }}>
                        {missed.map(s => (
                          <div key={s.id} onClick={() => navigate(`/students/${s.id}`)}
                            style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, cursor:'pointer', background:'var(--neg-50)' }}>
                            <div style={{ width:28, height:28, borderRadius:'50%', background:'#FEE2E2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--red-ink)', flexShrink:0 }}>{(s.name||'?').charAt(0).toUpperCase()}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                              {s.phone && <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.phone}</div>}
                            </div>
                            <ChevronRight size={13} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Covered */}
                  <div className="card" style={{ padding:'16px 18px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                      <CheckCircle size={16} style={{ color:'var(--green-ink)' }}/>
                      <h3 style={{ fontSize:14, fontWeight:700 }}>Scheduled ({covered.length})</h3>
                    </div>
                    {covered.length === 0 ? (
                      <div style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', padding:'20px 0' }}>No student was scheduled in this window.</div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:360, overflowY:'auto', paddingRight:4 }}>
                        {covered.map(s => (
                          <div key={s.id} onClick={() => navigate(`/students/${s.id}`)}
                            style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, cursor:'pointer' }}>
                            <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--pos-50)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--green-ink)', flexShrink:0 }}>{(s.name||'?').charAt(0).toUpperCase()}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                            </div>
                            <span className="badge badge-green" style={{ fontSize:10.5 }}>{countBy[s.id]} class{countBy[s.id]!==1?'es':''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Add Modal ── */}
      {showAdd && (
        <Modal title="Add to Schedule" onClose={() => { setShowAdd(false); setForm(blankForm()); setStudentSearch(''); }} wide persistent>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {selectedBatch === ALL && (
              <div className="form-group">
                <label className="form-label">Batch *</label>
                <select className="form-input" required value={form.batchId} onChange={e => setForm({ ...form, batchId: e.target.value, participantType:'all', participantIds:[] })}>
                  <option value="">— Choose a batch —</option>
                  {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>Pick the batch this class/meeting belongs to.</div>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input className="form-input" required placeholder="e.g. Python Basics — Session 1, Parent Meeting…" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(TYPE_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Duration (minutes)</label>
                <input className="form-input" type="number" min="15" placeholder="60" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })}/>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Recurrence</label>
              <div className="segmented">
                <button type="button" className={!form.recurring?'active':''} onClick={() => setForm({ ...form, recurring: false })}>One-time</button>
                <button type="button" className={form.recurring?'active':''} onClick={() => setForm({ ...form, recurring: true })}>Recurring (weekly)</button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              {form.recurring ? (
                <div className="form-group">
                  <label className="form-label">Day of Week *</label>
                  <select className="form-input" required value={form.day} onChange={e => setForm({ ...form, day: e.target.value })}>{DAYS.map(d => <option key={d}>{d}</option>)}</select>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input className="form-input" type="date" required value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })}/>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Time *</label>
                <input className="form-input" type="time" required value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}/>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group">
                <label className="form-label">Faculty / Organizer</label>
                <select className="form-input" value={form.facultyName} onChange={e => setForm({ ...form, facultyName: e.target.value })}>
                  <option value="">— Select person —</option>
                  {staffList.filter(s=>s.active!==false).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Meet Link (optional)</label>
                <input className="form-input" placeholder="https://meet.google.com/..." value={form.meetLink} onChange={e => setForm({ ...form, meetLink: e.target.value })}/>
              </div>
            </div>
            {/* Participant selection — not shown for meetings (staff-only) */}
            {form.type === 'meeting' ? (
              <div style={{ fontSize:12.5, color:'var(--text-sub)', background:'var(--info-50)', color:'var(--info)', padding:'9px 12px', borderRadius:8 }}>
                This is a staff meeting — no student selection needed. Set the organizer above.
              </div>
            ) : (
            <div className="form-group">
              <label className="form-label">Participants</label>
              <div className="segmented" style={{ marginBottom:10 }}>
                <button type="button" className={form.participantType==='all'?'active':''} onClick={() => setForm({ ...form, participantType:'all', participantIds:[] })}>All {modalStudents.length} students</button>
                <button type="button" className={form.participantType==='specific'?'active':''} onClick={() => setForm({ ...form, participantType:'specific' })}>Select specific students</button>
              </div>
              {form.participantType === 'specific' && (
                <>
                  <input className="form-input" placeholder="Type to filter by name or phone…" style={{ marginBottom:8 }}
                    value={studentSearch} onChange={e => setStudentSearch(e.target.value)}/>
                  <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:10, maxHeight:220, overflowY:'auto' }}>
                    {modalStudents.length === 0 && <div style={{ fontSize:12, color:'var(--muted)' }}>{(selectedBatch===ALL && !form.batchId) ? 'Choose a batch first.' : 'No students in batch.'}</div>}
                    {modalStudents
                      .filter(s => !studentSearch || s.name?.toLowerCase().includes(studentSearch.toLowerCase()) || (s.phone||'').includes(studentSearch))
                      .map((s, i) => (
                        <label key={s.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', cursor:'pointer', fontSize:13 }}>
                          <input type="checkbox" checked={form.participantIds.includes(s.id)}
                            onChange={e => setForm(prev => ({ ...prev, participantIds: e.target.checked ? [...prev.participantIds, s.id] : prev.participantIds.filter(id => id !== s.id) }))}/>
                          <span style={{ fontSize:11, color:'var(--muted)', width:20, textAlign:'right', flexShrink:0 }}>{i + 1}.</span>
                          <div style={{ width:24, height:24, borderRadius:'50%', background:avatarColor(s.name), display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(s.name)}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div>{s.name}{s.std ? <span style={{ fontSize:10.5, color:'var(--brand)', fontWeight:600, marginLeft:6 }}>Std {s.std}</span> : null}</div>
                            <div style={{ fontSize:10.5, color:'var(--muted)' }}>{s.phone || 'no phone'}{s.course ? ` · ${s.course}` : ''}</div>
                          </div>
                        </label>
                      ))}
                  </div>
                </>
              )}
              {form.participantType === 'specific' && form.participantIds.length > 0 && (
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>{form.participantIds.length} student{form.participantIds.length !== 1 ? 's' : ''} selected</div>
              )}
            </div>
            )}
            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <textarea className="form-input" rows={2} placeholder="Any notes for this entry…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setForm(blankForm()); setStudentSearch(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add to Schedule'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Attendance Marking Modal ── */}
      {attSession && (
        <Modal title={`Attendance — ${attSession.title}`} onClose={() => setAttSession(null)} wide persistent>
          {attLoading ? <Loading/> : (
            <>
              <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>{attSession.batchName || batchName(attSession.batchId)} · {attSession.scheduledDate || attSession.day} {attSession.time && `· ${attSession.time}`}</div>
              <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ position:'relative', flex:1, minWidth:180 }}>
                  <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--muted)' }}/>
                  <input className="form-input" style={{ paddingLeft:30 }} placeholder="Search student…" value={attSearch} onChange={e => setAttSearch(e.target.value)}/>
                </div>
                <span className="badge badge-green"><CheckCircle size={11}/> {presentCount} present</span>
                <span className="badge badge-red"><XCircle size={11}/> {absentCount} absent</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { const all = {}; attParticipants.forEach(s => { all[s.id] = { name: s.name, present: true }; }); setAttData(all); }}>All Present</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { const all = {}; attParticipants.forEach(s => { all[s.id] = { name: s.name, present: false }; }); setAttData(all); }}>All Absent</button>
                <button className="btn btn-ghost btn-sm" style={{ color:'var(--red-ink)' }} onClick={handleClearAttendance}>Clear / Undo</button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:380, overflowY:'auto' }}>
                {filteredParticipants.map(s => {
                  const isPresent = attData[s.id]?.present;
                  return (
                    <div key={s.id} onClick={() => setAttData(prev => ({ ...prev, [s.id]: { name: s.name, present: !prev[s.id]?.present } }))}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:9, cursor:'pointer', transition:'background 0.12s', background: isPresent ? 'var(--pos-50)' : 'var(--neg-50)', border: `1px solid ${isPresent ? 'var(--pos-50)' : 'var(--neg-50)'}` }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', background:avatarColor(s.name), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(s.name)}</div>
                      <div style={{ flex:1, fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.name}</div>
                      {isPresent ? <CheckCircle size={18} style={{ color:'var(--green-ink)', flexShrink:0 }}/> : <XCircle size={18} style={{ color:'var(--red-ink)', flexShrink:0 }}/>}
                      <span style={{ fontSize:11, fontWeight:700, color: isPresent ? 'var(--green-ink)' : 'var(--red-ink)', minWidth:44 }}>{isPresent ? 'Present' : 'Absent'}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn btn-ghost" onClick={() => setAttSession(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={handleSaveAttendance}>{saving ? 'Saving…' : 'Save Attendance'}</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ── Progress Reports Modal ── */}
      {reportSession && (
        <Modal title={`Progress Reports — ${reportSession.title}`} onClose={() => setReportSession(null)} wide persistent>
          {reportModalLoading ? <Loading/> : (
            <>
              <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>{reportSession.batchName || batchName(reportSession.batchId)} · {reportSession.scheduledDate || reportSession.day} {reportSession.time && `· ${reportSession.time}`}</div>
              <div style={{ fontSize:12.5, color:'var(--sub)', marginBottom:12, background:'var(--accent-50)', color:'var(--accent-ink)', padding:'8px 12px', borderRadius:8 }}>
                Write a short progress note per student for this class. Notes from every faculty are kept together — expand a student to see previous reports.
              </div>
              {(() => {
                const isMarked = (s) => !!(reportNotes[s.id]?.existingId) || (prevReports[s.id] || []).some(r => r.scheduleId === reportSession.id);
                const missing = reportParts.filter(s => !isMarked(s)).length;
                return (
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
                    <span className={`badge ${missing ? 'badge-amber' : 'badge-green'}`}>{missing} not yet marked</span>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer' }}>
                      <input type="checkbox" checked={reportOnlyUnmarked} onChange={e => setReportOnlyUnmarked(e.target.checked)}/>
                      Show only unmarked students
                    </label>
                  </div>
                );
              })()}
              <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:420, overflowY:'auto' }}>
                {reportParts.length === 0 && <div style={{ fontSize:13, color:'var(--muted)', textAlign:'center', padding:20 }}>No participants found for this session.</div>}
                {reportParts.filter(s => {
                  if (!reportOnlyUnmarked) return true;
                  const marked = !!(reportNotes[s.id]?.existingId) || (prevReports[s.id] || []).some(r => r.scheduleId === reportSession.id);
                  return !marked;
                }).map(s => {
                  const n = reportNotes[s.id] || { text:'', rating:'', existingId:null };
                  const history = (prevReports[s.id] || []).filter(r => r.scheduleId !== reportSession.id || r.facultyUid !== profile?.uid);
                  const isOpen = expanded[s.id];
                  return (
                    <div key={s.id} style={{ border:'1px solid var(--border)', borderRadius:10, padding:12 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                        <div style={{ width:30, height:30, borderRadius:'50%', background:avatarColor(s.name), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(s.name)}</div>
                        <div style={{ flex:1, fontSize:13.5, fontWeight:600 }}>{s.name}</div>
                        <select className="form-input" style={{ width:130, height:30, fontSize:11.5 }} value={n.rating} onChange={e => setReportNotes(p => ({ ...p, [s.id]: { ...n, rating: e.target.value } }))}>
                          <option value="">Progress…</option>
                          <option value="excellent">Excellent</option>
                          <option value="good">Good</option>
                          <option value="average">Average</option>
                          <option value="needs-attention">Needs attention</option>
                        </select>
                      </div>
                      <textarea className="form-input" rows={2} style={{ fontSize:12.5 }} placeholder="How did this student do in this class? (optional)"
                        value={n.text} onChange={e => setReportNotes(p => ({ ...p, [s.id]: { ...n, text: e.target.value } }))}/>
                      {history.length > 0 && (
                        <button type="button" onClick={() => setExpanded(p => ({ ...p, [s.id]: !isOpen }))}
                          style={{ display:'flex', alignItems:'center', gap:5, marginTop:8, background:'none', border:'none', color:'var(--accent-ink)', fontSize:11.5, fontWeight:600, cursor:'pointer', padding:0 }}>
                          <FileText size={12}/> {isOpen ? 'Hide' : 'View'} previous reports ({history.length})
                          <ChevronDown size={12} style={{ transform:isOpen?'rotate(180deg)':'none', transition:'transform .15s' }}/>
                        </button>
                      )}
                      {isOpen && (
                        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                          {history.map(r => (
                            <div key={r.id} style={{ background:'var(--surface-2)', borderRadius:8, padding:'8px 10px' }}>
                              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:3, flexWrap:'wrap' }}>
                                <span style={{ fontSize:11.5, fontWeight:600, color:'var(--ink)' }}>{r.facultyName || 'Staff'}</span>
                                {r.rating && <span className="badge badge-blue" style={{ textTransform:'capitalize' }}>{r.rating.replace('-',' ')}</span>}
                                <span style={{ fontSize:10.5, color:'var(--muted)' }}>{r.sessionTitle} · {r.sessionDate}</span>
                              </div>
                              {r.note && <div style={{ fontSize:12, color:'var(--sub)' }}>{r.note}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn btn-ghost" onClick={() => setReportSession(null)}>Close</button>
                <button className="btn btn-primary" disabled={saving} onClick={handleSaveReports}>{saving ? 'Saving…' : 'Save Reports'}</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ── Reschedule modal ── */}
      {reschedule && (
        <Modal title={`Reschedule — ${reschedule.slot.title}`} onClose={() => setReschedule(null)} persistent>
          <div style={{ fontSize:12.5, color:'var(--text-sub)', marginBottom:14 }}>Pick the new date and time for this class.</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="form-group"><label className="form-label">New Date *</label>
              <input type="date" className="form-input" min={localDateStr()} value={reschedule.date} onChange={e => setReschedule(r => ({ ...r, date: e.target.value }))}/></div>
            <div className="form-group"><label className="form-label">New Time *</label>
              <input type="time" className="form-input" value={reschedule.time} onChange={e => setReschedule(r => ({ ...r, time: e.target.value }))}/></div>
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
            <button className="btn btn-ghost" onClick={() => setReschedule(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !reschedule.date || !reschedule.time}
              onClick={async () => {
                if (reschedule.date < localDateStr()) { setToast({ message:'Cannot reschedule to a past date.', type:'error' }); return; }
                setSaving(true);
                try {
                  await updateBatchSchedule(reschedule.slot.id, { status:'rescheduled', scheduledDate: reschedule.date, time: reschedule.time });
                  notifyFacultyOfSchedule(reschedule.slot, 'Class Rescheduled',
                    `"${reschedule.slot.title}"${reschedule.slot.batchName ? ` (${reschedule.slot.batchName})` : ''} moved to ${reschedule.date} at ${reschedule.time}.`);
                  setToast({ message:'Class rescheduled.', type:'success' });
                  const ns = { ...reschedule.slot, status:'rescheduled', scheduledDate: reschedule.date, time: reschedule.time };
                  setReschedule(null); setSlotDetail(ns); await reloadSchedules();
                } catch (err) { setToast({ message:'Error: ' + err.message, type:'error' }); }
                setSaving(false);
              }}>Save New Time</button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}
      {confirmBox && (
        <Confirm message={confirmBox.message} confirmLabel={confirmBox.confirmLabel}
          onCancel={() => setConfirmBox(null)}
          onConfirm={async () => { const fn = confirmBox.onConfirm; setConfirmBox(null); await fn(); }} />
      )}
    </div>
  );
}
