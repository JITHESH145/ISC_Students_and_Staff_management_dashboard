import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  getStudent, updateStudent, getBatches,
  getFollowUps, addFollowUp, getAssessments, addAssessment,
  getStaffProfiles, updateWeakSubjects, updateCourseFlowStep, addNotification,
  getStudentReports, getStudentAttendanceSummary, getBatchTasks,
  getStudentBatchAssessments,
  saveClassReport, updateClassReport, deleteClassReport
} from '../firebase/services';
import { Modal, Toast, Avatar, StatusBadge, Loading, FormRow, Confirm } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Plus, Phone, Mail, MapPin, BookOpen,
  User, Calendar, Edit, CheckCircle, Circle, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Trash2
} from 'lucide-react';

// ── Default Course Flow (fallback if batch has no custom flow) ──
const DEFAULT_batchCourseFlow = [
  { key: 'admission',         label: 'Student Admission',                    phase: 'onboarding', fieldType: 'none' },
  { key: 'parent_onboarding', label: 'Parent Onboarding',                    phase: 'onboarding', fieldType: 'none' },
  { key: 'group_admission',   label: 'Group Admission',                      phase: 'onboarding', fieldType: 'none' },
  { key: 'initial_assess',    label: 'Primary Assessment',                   phase: 'onboarding', fieldType: 'note', fieldLabel: 'Assessment Notes' },
  { key: 'vark_analysis',     label: 'VARK Analysis',                        phase: 'onboarding', fieldType: 'dropdown', fieldLabel: 'VARK Learning Style', fieldOptions: ['Visual','Auditory','Read/Write','Kinesthetic','Visual-Auditory','Visual-Kinesthetic','Auditory-Kinesthetic','Multimodal'], displayInTable: true },
  { key: 'kit_dispatch',      label: 'Kit Packing & Dispatch',               phase: 'onboarding', fieldType: 'none' },
  { key: 'instagram_setup',   label: 'Instagram Account Open',               phase: 'onboarding', fieldType: 'none' },
  { key: 'kit_activities',    label: 'Kit Activities',                       phase: 'course',     fieldType: 'none' },
  { key: 'kit_insta',         label: 'Kit Activity on Instagram',            phase: 'course',     fieldType: 'none' },
  { key: 'class_start',       label: 'Classes Started',                      phase: 'course',     fieldType: 'none' },
  { key: 'first_recheck',     label: 'First Recheck on Progress',            phase: 'course',     fieldType: 'note', fieldLabel: 'Notes' },
  { key: 'action_plan',       label: 'Action Plan on First Assessment',      phase: 'course',     fieldType: 'note', fieldLabel: 'Action Plan Details' },
  { key: 'followup_monitor',  label: 'Regular Follow-up & Progress Monitoring', phase: 'course', fieldType: 'none' },
];

const PHASE_LABELS = {
  onboarding: { label: 'Onboarding Phase', color: '#3B82F6', bg: '#DBEAFE' },
  course:     { label: 'Course Phase',      color: '#10B981', bg: '#D1FAE5' },
};

const ALL_SUBJECTS = [
  'Mathematics', 'Science', 'English', 'Hindi', 'Social Science',
  'Physics', 'Chemistry', 'Biology', 'Computer Science',
  'Python', 'Data Science', 'Web Development', 'Machine Learning',
  'Economics', 'Accountancy', 'Business Studies', 'Other'
];

// Keys already rendered in the curated contact grid above — skip these when
// listing extra/archived fields so nothing is shown twice.
const CURATED_PROFILE_KEYS = new Set([
  'name','phone','parentName','parentPhone','email','classStd','location',
  'staffAssigned','education','fatherName','motherName','schoolName',
  'whatsappNumber','address','occupation','gender','age','varkResult','syllabus',
]);
// Structural / system keys on a student doc that are never student-entered fields.
const SYSTEM_STUDENT_KEYS = new Set([
  'id','batchId','batchName','course','courseDurationMonths','courseFlow',
  'staffIds','status','createdAt','updatedAt','joinDate','joiningDate',
  'weakSubjects','fcmToken','subscription',
]);
const isDisplayableValue = (v) =>
  (typeof v === 'string' && v.trim() !== '') ||
  (typeof v === 'number' && !Number.isNaN(v)) ||
  typeof v === 'boolean';

export default function StudentProfile() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const location     = useLocation();
  const { profile }  = useAuth();

  const [student,     setStudent]     = useState(null);
  const [batches,     setBatches]     = useState([]);
  const [batchCourseFlow, setBatchCourseFlow] = useState([]);
  const [batchFields, setBatchFields] = useState([]);
  const [followups,   setFollowups]   = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [classReports, setClassReports] = useState([]);
  const [attendance,  setAttendance]  = useState(null);
  const [batchTasks,  setBatchTasks]  = useState([]);
  const [perfFrom,    setPerfFrom]    = useState('');
  const [perfTo,      setPerfTo]      = useState('');
  const [asgStatus,   setAsgStatus]   = useState(''); // '', 'done', 'pending', 'overdue'
  const [asgStaff,    setAsgStaff]    = useState('');
  const [reportStaff, setReportStaff] = useState(''); // progress-report faculty filter
  const [reportModal, setReportModal] = useState(null); // null | 'add' | 'edit'
  const [reportForm,  setReportForm]  = useState({ id:'', sessionTitle:'', sessionDate:'', rating:'', note:'' });
  const [savingReport, setSavingReport] = useState(false);
  const [confirmBox,  setConfirmBox]  = useState(null); // { message, onConfirm, confirmLabel }
  const [staffList,   setStaffList]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('overview');
  const [toast,       setToast]       = useState(null);

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [editForm,  setEditForm]  = useState({});
  const [savingEdit,setSavingEdit]= useState(false);

  // Assessment modal
  const [assessModal, setAssessModal] = useState(false);
  const [assessForm,  setAssessForm]  = useState({ testName:'', subject:'', date:'', marks:'', totalMarks:'', conductingStaffIds:[] });

  // Follow-up note
  const [newNote,    setNewNote]    = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Weak subjects
  const [weakModal,   setWeakModal]   = useState(false);
  const [weakSubjects,setWeakSubjects]= useState([]);
  const [savingWeak,  setSavingWeak]  = useState(false);

  // Course flow
  const [flowExpanded, setFlowExpanded] = useState({ onboarding: true, course: false });
  const [flowNoteModal, setFlowNoteModal] = useState(null); // step object
  const [flowNote,      setFlowNote]      = useState('');
  const [flowValue,     setFlowValue]     = useState('');
  const [savingFlow,    setSavingFlow]    = useState(false);

  const isCEOorAdmin = profile?.role === 'ceo';

  const load = async () => {
    try {
      const s  = await getStudent(id).catch(() => null);
      const b  = await getBatches().catch(() => []);
      const f  = await getFollowUps(id, { role: profile?.role, uid: profile?.uid, email: profile?.email }).catch(() => []);
      const a  = await getAssessments(id).catch(() => []);       // student-level results added on this page
      const ba = s?.batchId ? await getStudentBatchAssessments(id, s.batchId).catch(() => []) : []; // batch/main-page assessments
      const st = await getStaffProfiles().catch(() => []);
      setStudent(s);
      setBatches(b);
      setFollowups(f);
      // merge, de-dupe by id, newest first
      const merged = [...a, ...ba].filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
      setAssessments(merged);
      getStudentReports(id).then(setClassReports).catch(() => setClassReports([]));
      getStudentAttendanceSummary(id, s?.batchId).then(setAttendance).catch(() => setAttendance(null));
      if (s?.batchId) {
        getBatchTasks(s.batchId)
          .then(tasks => setBatchTasks(tasks.filter(t =>
            t.assignedType !== 'specific' || (t.assignedStudentIds || []).includes(id))))
          .catch(() => setBatchTasks([]));
      }
      setStaffList(st.filter(x => x.active !== false));
      setEditForm(s || {});
      setWeakSubjects(s?.weakSubjects || []);
      const batchDoc = b.find(batch => batch.id === s?.batchId);
      const flow = batchDoc?.courseFlow || DEFAULT_batchCourseFlow;
      setBatchCourseFlow(flow);
      setBatchFields(batchDoc?.studentFields || []);
    } catch (err) {
      import.meta.env.DEV && console.error('StudentProfile load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const batchName = (bid) => batches.find(b => b.id === bid)?.name || '—';

  const fmt = (ts) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  };

  // Join date is stored as `joinDate` (added via Batches) or `joiningDate`
  // (added via Students page). Read both so the profile works either way.
  const joinedOn = student?.joinDate || student?.joiningDate || '';

  // Subscription validity
  const subInfo = () => {
    if (!joinedOn || !student?.courseDurationMonths) return null;
    const exp = new Date(joinedOn);
    exp.setMonth(exp.getMonth() + Number(student.courseDurationMonths));
    const days = Math.ceil((exp - Date.now()) / 86400000);
    return { exp, days, expired: days < 0, expiringSoon: days >= 0 && days <= 30 };
  };

  // Course flow helpers
  const flowStep = (key) => student?.courseFlow?.[key];
  const flowDoneCount = () => batchCourseFlow.filter(s => flowStep(s.key)?.done).length;

  const handleMarkFlow = async (step, done) => {
    if (done) {
      const existing = flowStep(step.key);
      setFlowNote(existing?.note || '');
      setFlowValue(existing?.value || '');
      setFlowNoteModal(step);
    } else {
      await updateCourseFlowStep(id, step.key, { done: false, date: '', note: '', value: '' });
      setToast({ message: `"${step.label}" unmarked`, type: 'info' });
      load();
    }
  };

  const handleSaveFlowNote = async () => {
    if (!flowNoteModal) return;
    const ft = flowNoteModal.fieldType || 'none';
    if (ft === 'dropdown' && !flowValue) {
      setToast({ message: 'Please select a value before saving.', type: 'error' });
      return;
    }
    setSavingFlow(true);
    const update = {
      done: true,
      date: new Date().toLocaleDateString('en-IN'),
      note: flowNote,
      value: flowValue,
    };
    await updateCourseFlowStep(id, flowNoteModal.key, update);
    // Also persist displayInTable field to student top-level (e.g. varkResult)
    if (flowNoteModal.displayInTable && flowNoteModal.key === 'vark_analysis' && flowValue) {
      await updateStudent(id, { varkResult: flowValue });
    }
    setFlowNoteModal(null);
    setFlowNote('');
    setFlowValue('');
    setSavingFlow(false);
    setToast({ message: `"${flowNoteModal.label}" marked complete!`, type: 'success' });
    load();
  };

  // Save follow-up
  const handleSaveNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    await addFollowUp({ studentId: id, studentName: student.name, note: newNote, addedBy: profile?.name || 'Staff' });
    setNewNote('');
    setToast({ message: 'Follow-up saved!', type: 'success' });
    const upd = await getFollowUps(id, { role: profile?.role, uid: profile?.uid, email: profile?.email });
    setFollowups(upd);
    setSavingNote(false);
  };

  // Save edit
  const handleEdit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    await updateStudent(id, editForm);
    setToast({ message: 'Student updated!', type: 'success' });
    setEditModal(false);
    load();
    setSavingEdit(false);
  };

  // Save assessment
  const handleAddAssessment = async (e) => {
    e.preventDefault();
    const pct = Math.round(Number(assessForm.marks) / Number(assessForm.totalMarks) * 100);
    const conductingStaff = staffList.filter(s => assessForm.conductingStaffIds.includes(s.id))
      .map(s => ({ uid: s.id, name: s.name, email: s.email || '' }));
    await addAssessment({
      studentId: id, studentName: student.name,
      testName: assessForm.testName, subject: assessForm.subject,
      date: assessForm.date, marks: assessForm.marks, totalMarks: assessForm.totalMarks,
      percentage: pct, conductingStaff,
      createdBy: profile?.uid, createdByName: profile?.name,
    });
    // Notify each conducting staff member
    for (const s of conductingStaff) {
      if (s.uid !== profile?.uid && s.email) {
        addNotification({
          toEmail: s.email,
          title: 'Assessment Assigned',
          message: `${profile?.name} assigned you to conduct "${assessForm.testName}" for student ${student.name}`,
          type: 'task',
          fromName: profile?.name,
        }).catch(() => {});
      }
    }
    setToast({ message: 'Assessment added!', type: 'success' });
    setAssessModal(false);
    setAssessForm({ testName:'', subject:'', date:'', marks:'', totalMarks:'', conductingStaffIds:[] });
    const upd = await getAssessments(id);
    setAssessments(upd);
  };

  // Save weak subjects
  const handleSaveWeak = async () => {
    setSavingWeak(true);
    await updateWeakSubjects(id, weakSubjects);
    setStudent(prev => ({ ...prev, weakSubjects }));
    setToast({ message: 'Weak subjects updated!', type: 'success' });
    setWeakModal(false);
    setSavingWeak(false);
  };

  const toggleWeak = (sub) => {
    setWeakSubjects(prev => prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]);
  };

  // ── Progress reports (add / edit / delete, independent of the calendar) ──
  const openAddReport = () => {
    setReportForm({ id:'', sessionTitle:'', sessionDate: new Date().toISOString().slice(0,10), rating:'', note:'' });
    setReportModal('add');
  };
  const openEditReport = (r) => {
    setReportForm({ id:r.id, sessionTitle:r.sessionTitle || '', sessionDate:r.sessionDate || '', rating:r.rating || '', note:r.note || '' });
    setReportModal('edit');
  };
  const handleSaveReport = async () => {
    if (!reportForm.sessionTitle.trim() || !reportForm.note.trim()) {
      setToast({ message:'Class title and progress report are required.', type:'error' });
      return;
    }
    setSavingReport(true);
    try {
      if (reportModal === 'edit') {
        await updateClassReport(reportForm.id, {
          sessionTitle: reportForm.sessionTitle.trim(), sessionDate: reportForm.sessionDate,
          rating: reportForm.rating, note: reportForm.note.trim(),
        });
      } else {
        await saveClassReport({
          studentId: id, scheduleId: '', source: 'manual',
          batchId: student?.batchId || '', batchName: batchName(student?.batchId),
          facultyUid: profile?.uid || '', facultyName: profile?.name || 'Staff',
          sessionTitle: reportForm.sessionTitle.trim(), sessionDate: reportForm.sessionDate,
          rating: reportForm.rating, note: reportForm.note.trim(),
        });
      }
      const reports = await getStudentReports(id).catch(() => []);
      setClassReports(reports);
      setToast({ message: reportModal === 'edit' ? 'Progress report updated!' : 'Progress report added!', type:'success' });
      setReportModal(null);
    } catch {
      setToast({ message:'Could not save the report.', type:'error' });
    }
    setSavingReport(false);
  };
  const handleDeleteReport = (r) => {
    setConfirmBox({
      message: `Delete this progress report for "${r.sessionTitle || 'Class'}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmBox(null);
        try {
          await deleteClassReport(r.id);
          setClassReports(prev => prev.filter(x => x.id !== r.id));
          setToast({ message:'Progress report deleted.', type:'info' });
        } catch {
          setToast({ message:'Could not delete the report.', type:'error' });
        }
      },
    });
  };

  const toggleConductingStaff = (staffId) => {
    setAssessForm(prev => ({
      ...prev,
      conductingStaffIds: prev.conductingStaffIds.includes(staffId)
        ? prev.conductingStaffIds.filter(id => id !== staffId)
        : [...prev.conductingStaffIds, staffId],
    }));
  };

  if (loading) return <Loading />;
  if (!student) return (
    <div style={{ textAlign:'center', padding:60, color:'#6B7280' }}>
      <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Student not found</div>
      <div style={{ fontSize:13 }}>This student may have been deleted or the link is invalid.</div>
    </div>
  );

  const sub        = subInfo();
  const latestPct  = assessments.length ? assessments[assessments.length - 1].percentage : null;
  const firstPct   = assessments.length ? assessments[0].percentage : null;
  const trend      = (latestPct !== null && firstPct !== null && assessments.length > 1) ? latestPct - firstPct : null;
  const flowDone   = flowDoneCount();
  const flowTotal  = batchCourseFlow.length;

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => {
            // If we came from a batch's student list, return to that batch (its
            // detail is state-based, so navigate(-1) alone lands on the batch list).
            if (location.state?.fromBatchId) navigate('/batches', { state: { batchId: location.state.fromBatchId, tab: 'students' } });
            else navigate(-1);
          }}>
            <ArrowLeft size={16}/>
          </button>
          <div>
            <h2 style={{ fontSize:20 }}>{student.name}</h2>
            <div style={{ fontSize:12, color:'#6B7280' }}>
              {batchName(student.batchId)} · {student.course}
              {student.classplusId && ` · ${student.classplusId}`}
            </div>
          </div>
          <StatusBadge status={student.status}/>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" onClick={() => setAssessModal(true)}>
            <Plus size={14}/> Assessment
          </button>
          <button className="btn btn-primary" onClick={() => setEditModal(true)}>
            <Edit size={14}/> Edit
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar" style={{ marginBottom:20 }}>
        {[
          { key:'overview',   label:'Overview'                              },
          { key:'courseflow', label:`Course Flow (${flowDone}/${flowTotal})`},
          { key:'assessments',label:`Assessments (${assessments.length})`   },
          { key:'performance',label:`Performance (${classReports.length})`  },
          { key:'followups',  label:`Follow-Ups (${followups.length})`      },
        ].map(t => (
          <div key={t.key} className={`tab ${activeTab===t.key?'active':''}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab === 'overview' && (
        <div className="grid-2" style={{ alignItems:'start' }}>
          {/* Left — profile card */}
          <div>
            <div className="card" style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18 }}>
                <Avatar name={student.name} size="lg"/>
                <div>
                  <div style={{ fontSize:17, fontWeight:700 }}>{student.name}</div>
                  {student.classStd && <div style={{ fontSize:12, color:'#6B7280' }}>{student.classStd}</div>}
                  <div style={{ fontSize:12, color:'#6B7280' }}>{student.course} · {batchName(student.batchId)}</div>
                </div>
              </div>

              <div className="mobile-1col" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, fontSize:13 }}>
                {[
                  { icon:Phone,    label:'Child Phone',  val:student.phone       },
                  { icon:User,     label:'Parent Name',  val:student.parentName  },
                  { icon:Phone,    label:'Parent Phone', val:student.parentPhone },
                  { icon:Mail,     label:'Email',        val:student.email       },
                  { icon:BookOpen, label:'Class/Std',    val:student.classStd    },
                  { icon:MapPin,   label:'Location',     val:student.location    },
                  { icon:User,     label:'Staff',        val:student.staffAssigned},
                  { icon:Calendar, label:'Joined',       val:joinedOn            },
                  { icon:Calendar, label:'Education',    val:student.education   },
                  { icon:User,     label:'Father',       val:student.fatherName     },
                  { icon:User,     label:'Mother',       val:student.motherName     },
                  { icon:BookOpen, label:'School',       val:student.schoolName     },
                  { icon:Phone,    label:'WhatsApp',     val:student.whatsappNumber },
                  { icon:MapPin,   label:'Address',      val:student.address        },
                  { icon:User,     label:'Occupation',   val:student.occupation     },
                  { icon:User,     label:'Gender',       val:student.gender         },
                  { icon:Calendar, label:'Age',          val:student.age ? `${student.age} years` : null },
                  { icon:BookOpen, label:'VARK Style',   val:student.varkResult     },
                  { icon:BookOpen, label:'Syllabus',     val:student.syllabus       },
                ].filter(r => r.val).map(row => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label}>
                      <div style={{ color:'#9CA3AF', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{row.label}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, color:'var(--text)' }}>
                        <Icon size={12} style={{ color:'#9CA3AF' }}/> {row.val}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Additional / custom / archived fields.
                  Driven by the batch's live studentFields config (stable keys),
                  so custom fields the CEO added show up here automatically, and
                  reordering/renaming labels never mislabels a value. Any value
                  still stored under a key that was later removed from the config
                  is surfaced under "Archived" so historical data is never lost. */}
              {(() => {
                const configured = (batchFields || [])
                  .filter(f => f.key !== 'name'
                    && !CURATED_PROFILE_KEYS.has(f.key)
                    && isDisplayableValue(student[f.key]))
                  .map(f => ({ key: f.key, label: f.label || f.key, val: student[f.key], archived: false }));
                const knownKeys = new Set([...(batchFields || []).map(f => f.key)]);
                const archived = Object.keys(student)
                  .filter(k => !knownKeys.has(k)
                    && !CURATED_PROFILE_KEYS.has(k)
                    && !SYSTEM_STUDENT_KEYS.has(k)
                    && isDisplayableValue(student[k]))
                  .map(k => ({ key: k, label: k, val: student[k], archived: true }));
                const rows = [...configured, ...archived];
                if (rows.length === 0) return null;
                return (
                  <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #F0F0F0' }}>
                    <div style={{ color:'#9CA3AF', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
                      Additional Details
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, fontSize:13 }}>
                      {rows.map(row => (
                        <div key={row.key}>
                          <div style={{ color:'#9CA3AF', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3, display:'flex', alignItems:'center', gap:5 }}>
                            {row.label}
                            {row.archived && (
                              <span title="This field was removed from the batch's student-field config; the saved value is kept."
                                style={{ fontSize:8.5, fontWeight:700, color:'#92400E', background:'#FEF3C7', borderRadius:4, padding:'1px 4px', letterSpacing:0 }}>
                                ARCHIVED
                              </span>
                            )}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5, color:'var(--text)' }}>
                            <BookOpen size={12} style={{ color:'#9CA3AF' }}/> {typeof row.val === 'boolean' ? (row.val ? 'Yes' : 'No') : String(row.val)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Subscription */}
              {sub && (
                <div style={{
                  marginTop:14, padding:'10px 14px', borderRadius:8,
                  background: sub.expired?'#FEE2E2':sub.expiringSoon?'#FEF3C7':'#F0FDF4',
                  border:`1px solid ${sub.expired?'#FECACA':sub.expiringSoon?'#FDE68A':'#BBF7D0'}`,
                  fontSize:13,
                }}>
                  <div style={{ fontWeight:600, marginBottom:3, color: sub.expired?'#991B1B':sub.expiringSoon?'#92400E':'#065F46' }}>
                    Subscription {sub.expired?'EXPIRED':sub.expiringSoon?'Expiring Soon':'Active'}
                  </div>
                  <div style={{ fontSize:12, color:'#6B7280' }}>
                    {student.courseDurationMonths}mo course · Joined {joinedOn} · Expires {sub.exp.toLocaleDateString('en-IN')} · {sub.expired?`Expired ${Math.abs(sub.days)} days ago`:`${sub.days} days left`}
                  </div>
                </div>
              )}

              {student.notes && (
                <div style={{ marginTop:12, padding:'10px 14px', background:'#FFFBEB', borderRadius:8, fontSize:13, color:'#92400E' }}>
                  {student.notes}
                </div>
              )}
            </div>

            {/* Weak subjects */}
            <div className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <h3 style={{ fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                  <AlertTriangle size={15} style={{ color:'#EF4444' }}/> Weak Subjects
                </h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setWeakModal(true)}>
                  <Edit size={13}/> Edit
                </button>
              </div>
              {(!student.weakSubjects || student.weakSubjects.length === 0) ? (
                <div style={{ fontSize:13, color:'#9CA3AF' }}>
                  No weak subjects marked.
                  <span style={{ color:'#E53935', cursor:'pointer', marginLeft:6 }} onClick={() => setWeakModal(true)}>Add now </span>
                </div>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {student.weakSubjects.map(s => (
                    <span key={s} style={{ padding:'5px 12px', borderRadius:20, background:'#FEE2E2', color:'#991B1B', fontSize:12, fontWeight:600 }}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — quick stats + latest activity */}
          <div>
            {/* Course flow progress card */}
            <div className="card" style={{ marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <h3 style={{ fontSize:14, fontWeight:600 }}>Course Flow Progress</h3>
                <span style={{ fontSize:13, fontWeight:700, color:'#E53935' }}>{flowDone}/{flowTotal}</span>
              </div>
              <div className="progress-bar" style={{ height:8, marginBottom:10 }}>
                <div className="progress-fill" style={{ width:`${Math.round(flowDone/flowTotal*100)}%`, background:'#E53935' }}/>
              </div>
              <div style={{ fontSize:12, color:'#6B7280' }}>
                {batchCourseFlow.filter(s => !flowStep(s.key)?.done).slice(0,3).map(s => (
                  <div key={s.key} style={{ marginBottom:3 }}>{s.label}</div>
                ))}
                <span style={{ color:'#E53935', cursor:'pointer' }} onClick={() => setActiveTab('courseflow')}>
                  View all steps                 </span>
              </div>
            </div>

            {/* Assessment summary */}
            {assessments.length > 0 && (
              <div className="card" style={{ marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <h3 style={{ fontSize:14, fontWeight:600 }}>Assessment Progress</h3>
                  {trend !== null && (
                    <span style={{ fontSize:12, fontWeight:600, color: trend>0?'#10B981':'#EF4444', display:'flex', alignItems:'center', gap:3 }}>
                      {trend>0?<TrendingUp size={13}/>:trend<0?<TrendingDown size={13}/>:<Minus size={13}/>}
                      {trend>0?'+':''}{trend}%
                    </span>
                  )}
                </div>
                {assessments.map((a, i) => (
                  <div key={a.id} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                      <span>{a.testName} {a.subject && `(${a.subject})`}</span>
                      <span style={{ fontWeight:700, color:a.percentage>=60?'#10B981':a.percentage>=40?'#F59E0B':'#EF4444' }}>{a.percentage}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width:`${a.percentage}%`, background:a.percentage>=60?'#10B981':a.percentage>=40?'#F59E0B':'#EF4444' }}/>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent follow-ups */}
            <div className="card">
              <h3 style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Recent Follow-Ups</h3>
              {followups.slice(0,3).map(f => (
                <div key={f.id} style={{ padding:'8px 0', borderBottom:'1px solid #F3F4F6' }}>
                  <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:2 }}>{fmt(f.createdAt)} · {f.addedBy}</div>
                  <div style={{ fontSize:13 }}>{f.note}</div>
                </div>
              ))}
              {followups.length === 0 && <div style={{ fontSize:13, color:'#9CA3AF' }}>No follow-ups yet.</div>}
              <span style={{ fontSize:12, color:'#E53935', cursor:'pointer', marginTop:6, display:'block' }} onClick={() => setActiveTab('followups')}>
                {followups.length > 3 && `View all ${followups.length} `}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ══ COURSE FLOW TAB ══ */}
      {activeTab === 'courseflow' && (
        <div>
          <div style={{ padding:'10px 14px', background:'#EFF6FF', borderRadius:8, fontSize:12, color:'#1E40AF', marginBottom:16 }}>
            Track each step of the student's journey from admission to course completion. Click to mark a step done, add a note for context.
          </div>

          {/* Progress summary */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:20 }}>
            {[
              { label:'Completed',  value:flowDone,          color:'#10B981', bg:'#D1FAE5' },
              { label:'Pending',    value:flowTotal-flowDone, color:'#F59E0B', bg:'#FEF3C7' },
              { label:'Progress',   value:`${Math.round(flowDone/flowTotal*100)}%`, color:'#E53935', bg:'#FEE2E2' },
            ].map(c => (
              <div key={c.label} style={{ background:'#fff', borderRadius:10, border:'1px solid #E5E7EB', padding:'12px 16px', textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:700, color:c.color }}>{c.value}</div>
                <div style={{ fontSize:11, color:'#6B7280' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {/* Phases */}
          {Object.entries(PHASE_LABELS).map(([phase, phaseInfo]) => {
            const steps    = batchCourseFlow.filter(s => s.phase === phase);
            const doneHere = steps.filter(s => flowStep(s.key)?.done).length;
            const expanded = flowExpanded[phase];
            return (
              <div key={phase} className="card" style={{ marginBottom:12 }}>
                <div
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}
                  onClick={() => setFlowExpanded(prev => ({ ...prev, [phase]: !prev[phase] }))}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ padding:'4px 12px', borderRadius:20, background:phaseInfo.bg, color:phaseInfo.color, fontSize:12, fontWeight:600 }}>
                      {phaseInfo.label}
                    </span>
                    <span style={{ fontSize:13, color:'#6B7280' }}>{doneHere}/{steps.length} done</span>
                  </div>
                  {expanded ? <ChevronUp size={16} style={{ color:'#6B7280' }}/> : <ChevronDown size={16} style={{ color:'#6B7280' }}/>}
                </div>

                {/* Mini progress bar */}
                <div className="progress-bar" style={{ marginTop:10, marginBottom: expanded?14:0 }}>
                  <div className="progress-fill" style={{ width:`${Math.round(doneHere/steps.length*100)}%`, background:phaseInfo.color }}/>
                </div>

                {expanded && steps.map(step => {
                  const fs = flowStep(step.key);
                  return (
                    <div key={step.key} style={{
                      display:'flex', alignItems:'flex-start', gap:12, padding:'10px 0',
                      borderBottom:'1px solid #F9FAFB',
                    }}>
                      <button
                        onClick={() => handleMarkFlow(step, !fs?.done)}
                        style={{ background:'none', border:'none', cursor:'pointer', padding:0, marginTop:1, flexShrink:0 }}
                      >
                        {fs?.done
                          ? <CheckCircle size={20} style={{ color:'#10B981' }}/>
                          : <Circle      size={20} style={{ color:'#D1D5DB' }}/>
                        }
                      </button>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight: fs?.done?500:400, color: fs?.done?'var(--text)':'#6B7280', textDecoration: fs?.done?'none':'none' }}>
                          {step.label}
                        </div>
                        {fs?.done && (
                          <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>
                            Done{fs.date && ` on ${fs.date}`}
                            {(fs.value || fs.note) && (
                              <span style={{ display:'block', marginTop:3, color:'#374151', fontStyle:'italic' }}>
                                {fs.value || fs.note}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                        {!fs?.done && (
                          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={() => handleMarkFlow(step, true)}>
                            Mark Done
                          </button>
                        )}
                        {fs?.done && (
                          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={() => handleMarkFlow(step, true)}>
                            Edit Note
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ ASSESSMENTS TAB ══ */}
      {activeTab === 'assessments' && (
        <div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
            <button className="btn btn-primary" onClick={() => setAssessModal(true)}>
              <Plus size={14}/> Add Assessment
            </button>
          </div>
          {assessments.length === 0 && (
            <div className="card" style={{ textAlign:'center', color:'#6B7280', padding:40 }}>
              No assessments yet.
            </div>
          )}
          <div className="table-container">
            <table>
              <thead><tr><th>#</th><th>Test Name</th><th>Subject</th><th>Date</th><th>Score</th><th>Percentage</th></tr></thead>
              <tbody>
                {assessments.map((a, i) => {
                  const graded = a.marks != null && a.percentage != null;
                  return (
                    <tr key={a.id}>
                      <td style={{ color:'#9CA3AF' }}>{i+1}</td>
                      <td style={{ fontWeight:500 }}>{a.testName}</td>
                      <td>{a.subject||'—'}</td>
                      <td style={{ fontSize:12, color:'#6B7280' }}>{a.date||'—'}</td>
                      <td>{graded ? `${a.marks}/${a.totalMarks}` : <span style={{ color:'#9CA3AF' }}>— / {a.totalMarks}</span>}</td>
                      <td>
                        {graded ? (
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div className="progress-bar" style={{ width:80 }}>
                              <div className="progress-fill" style={{ width:`${a.percentage}%`, background:a.percentage>=60?'#10B981':a.percentage>=40?'#F59E0B':'#EF4444' }}/>
                            </div>
                            <span style={{ fontSize:13, fontWeight:600, color:a.percentage>=60?'#10B981':a.percentage>=40?'#F59E0B':'#EF4444' }}>{a.percentage}%</span>
                          </div>
                        ) : (
                          <span className="badge badge-amber">{a.status === 'completed' ? 'Not marked' : 'Upcoming'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Subject-wise breakdown */}
          {assessments.length > 0 && (
            <div className="card" style={{ marginTop:14 }}>
              <h3 style={{ fontSize:14, fontWeight:600, marginBottom:14 }}>Subject-wise Average</h3>
              {(() => {
                const bySubject = {};
                assessments.filter(a => a.percentage != null).forEach(a => {
                  const sub = a.subject || 'General';
                  if (!bySubject[sub]) bySubject[sub] = [];
                  bySubject[sub].push(a.percentage);
                });
                return Object.entries(bySubject).map(([sub, pcts]) => {
                  const avg = Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length);
                  const isWeak = student.weakSubjects?.includes(sub);
                  return (
                    <div key={sub} style={{ marginBottom:12 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, alignItems:'center' }}>
                        <span style={{ fontSize:13, fontWeight:500 }}>
                          {sub}
                          {isWeak && <span style={{ marginLeft:6, fontSize:10, padding:'1px 7px', borderRadius:10, background:'#FEE2E2', color:'#991B1B', fontWeight:600 }}>Weak</span>}
                        </span>
                        <span style={{ fontSize:13, fontWeight:700, color:avg>=60?'#10B981':avg>=40?'#F59E0B':'#EF4444' }}>{avg}% avg</span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width:`${avg}%`, background:avg>=60?'#10B981':avg>=40?'#F59E0B':'#EF4444' }}/>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* ══ PERFORMANCE TAB ══ */}
      {activeTab === 'performance' && (() => {
        const inRange = (dateStr) => {
          if (!perfFrom && !perfTo) return true;
          if (!dateStr) return false;
          if (perfFrom && dateStr < perfFrom) return false;
          if (perfTo && dateStr > perfTo) return false;
          return true;
        };
        const shownReports = classReports.filter(r => inRange(r.sessionDate)).filter(r => !reportStaff || r.facultyName === reportStaff);
        const reportStaffNames = [...new Set(classReports.map(r => r.facultyName).filter(Boolean))];
        const taskState = (t) => {
          if (t.submittedBy?.some(x => x.studentId === id)) return 'done';
          if (t.dueDate && new Date(t.dueDate) < new Date()) return 'overdue';
          return 'pending';
        };
        // Assignments this student is actually accountable for. A batch-wide
        // assignment created before the student joined was never meant for them,
        // so it must not count as "not done" in their report. Assignments
        // targeted specifically at this student always count.
        const joinTs = student?.joinDate ? new Date(student.joinDate).getTime()
          : student?.joiningDate ? new Date(student.joiningDate).getTime() : null;
        const relevantTasks = batchTasks.filter(t => {
          const targeted = Array.isArray(t.assignedStudentIds) && t.assignedStudentIds.length > 0;
          if (targeted) return t.assignedStudentIds.includes(id);
          if (!joinTs) return true;
          const createdTs = t.createdAt?.seconds ? t.createdAt.seconds * 1000
            : t.createdAt ? new Date(t.createdAt).getTime() : null;
          const dueTs = t.dueDate ? new Date(t.dueDate).getTime() : null;
          const whenTs = createdTs ?? dueTs;
          return whenTs == null || whenTs >= joinTs;
        });
        const shownTasks = relevantTasks
          .filter(t => inRange(t.dueDate) || (!t.dueDate && !perfFrom && !perfTo))
          .filter(t => !asgStatus || taskState(t) === asgStatus)
          .filter(t => !asgStaff || t.assignedFaculty === asgStaff);
        const asgStaffNames = [...new Set(relevantTasks.map(t => t.assignedFaculty).filter(Boolean))];
        const absent = attendance ? attendance.total - attendance.present : 0;
        return (
        <div>
          {/* Summary tiles */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:18 }}>
            <div className="card" style={{ padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Attendance</div>
              <div style={{ fontSize:26, fontWeight:700, fontFamily:'var(--font-display)', color: attendance?.pct == null ? 'var(--text-muted)' : attendance.pct >= 75 ? 'var(--green-ink)' : attendance.pct >= 50 ? 'var(--amber-ink)' : 'var(--red-ink)' }}>
                {attendance?.pct == null ? '—' : `${attendance.pct}%`}
              </div>
              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <span className="badge badge-green">{attendance?.present || 0} present</span>
                <span className="badge badge-red">{absent} absent</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{attendance ? `across ${attendance.total} classes` : 'No attendance recorded'}</div>
            </div>
            <div className="card" style={{ padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Class Reports</div>
              <div style={{ fontSize:26, fontWeight:700, fontFamily:'var(--font-display)', color:'var(--brand)' }}>{classReports.length}</div>
              <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>from faculty across classes</div>
            </div>
            <div className="card" style={{ padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Assignments Done</div>
              <div style={{ fontSize:26, fontWeight:700, fontFamily:'var(--font-display)', color:'var(--pos)' }}>
                {relevantTasks.filter(t => t.submittedBy?.some(x => x.studentId === id)).length}/{relevantTasks.length}
              </div>
              <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>submitted</div>
            </div>
            <div className="card" style={{ padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Avg Assessment</div>
              <div style={{ fontSize:26, fontWeight:700, fontFamily:'var(--font-display)', color:'var(--violet-ink)' }}>
                {assessments.filter(a=>a.percentage!=null).length ? `${Math.round(assessments.filter(a=>a.percentage!=null).reduce((s,a)=>s+a.percentage,0)/assessments.filter(a=>a.percentage!=null).length)}%` : '—'}
              </div>
              <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>{assessments.length} assessments</div>
            </div>
          </div>

          {/* Date filter — applies to reports & assignments below */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600 }}>Filter by date</span>
            <input type="date" className="form-input" style={{ width:'auto', height:34 }} value={perfFrom} onChange={e => setPerfFrom(e.target.value)}/>
            <span style={{ color:'var(--text-muted)' }}>→</span>
            <input type="date" className="form-input" style={{ width:'auto', height:34 }} value={perfTo} onChange={e => setPerfTo(e.target.value)}/>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const now = new Date(); const from = new Date(now); from.setDate(now.getDate() - 7);
              const f = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
              setPerfFrom(f(from)); setPerfTo(f(now));
            }}>Last 7 days</button>
            {(perfFrom || perfTo) && <button className="btn btn-ghost btn-sm" onClick={() => { setPerfFrom(''); setPerfTo(''); }}>Clear</button>}
          </div>

          {/* Class progress reports timeline — ABOVE assignments, capped-scroll so the assignments below stay reachable */}
          <div className="card" style={{ padding:'16px 20px', marginBottom:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Progress Reports ({shownReports.length})</div>
              <div style={{ flex:1 }}/>
              <select className="form-input" style={{ width:'auto', height:32, fontSize:12 }} value={reportStaff} onChange={e => setReportStaff(e.target.value)}>
                <option value="">All faculty</option>
                {reportStaffNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={openAddReport}><Plus size={13}/> Add Report</button>
            </div>
            {shownReports.length === 0 ? (
              <div style={{ fontSize:13, color:'var(--text-muted)', padding:'20px 0', textAlign:'center' }}>
                {classReports.length === 0 ? 'No progress reports yet. Add one here, or faculty can add them from Schedule → Progress Reports after a class.' : 'No reports for the selected filters.'}
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:360, overflowY:'auto', paddingRight:4 }}>
                {shownReports.map(r => (
                  <div key={r.id} style={{ borderLeft:'3px solid var(--brand)', paddingLeft:12, display:'flex', gap:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:2 }}>
                        <span style={{ fontSize:13, fontWeight:600 }}>{r.sessionTitle || 'Class'}</span>
                        {r.rating && <span className="badge badge-blue" style={{ textTransform:'capitalize' }}>{r.rating.replace('-',' ')}</span>}
                        {r.source === 'manual' && <span className="badge badge-amber">Manual</span>}
                        <span style={{ fontSize:11.5, color:'var(--text-muted)' }}>{[r.batchName, r.sessionDate].filter(Boolean).join(' · ')}</span>
                      </div>
                      {r.note && <div style={{ fontSize:12.5, color:'var(--text-sub)', marginBottom:2 }}>{r.note}</div>}
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>— {r.facultyName || 'Staff'}</div>
                    </div>
                    {(isCEOorAdmin || r.facultyUid === profile?.uid) && (
                      <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openEditReport(r)}><Edit size={13}/></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color:'var(--red-ink)' }} onClick={() => handleDeleteReport(r)}><Trash2 size={13}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Assignments / activity submission tracker */}
          <div className="card" style={{ padding:'16px 20px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Assignments &amp; Activities ({shownTasks.filter(t => t.submittedBy?.some(x => x.studentId === id)).length}/{shownTasks.length} done)</div>
              <div style={{ flex:1 }}/>
              <select className="form-input" style={{ width:'auto', height:32, fontSize:12 }} value={asgStatus} onChange={e => setAsgStatus(e.target.value)}>
                <option value="">All status</option>
                <option value="done">Done</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
              </select>
              <select className="form-input" style={{ width:'auto', height:32, fontSize:12 }} value={asgStaff} onChange={e => setAsgStaff(e.target.value)}>
                <option value="">All staff</option>
                {asgStaffNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {shownTasks.length === 0 ? (
              <div style={{ fontSize:13, color:'var(--text-muted)', padding:'16px 0', textAlign:'center' }}>{batchTasks.length === 0 ? 'No assignments for this student yet.' : 'No assignments in the selected date range.'}</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:400, overflowY:'auto', paddingRight:4 }}>
                {shownTasks.map(t => {
                  const sub = t.submittedBy?.find(x => x.studentId === id);
                  const overdue = !sub && t.dueDate && new Date(t.dueDate) < new Date();
                  return (
                    <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:9, border:'1px solid var(--border)' }}>
                      {sub
                        ? <CheckCircle size={16} style={{ color:'var(--green-ink)', flexShrink:0 }}/>
                        : <Circle size={16} style={{ color: overdue ? 'var(--red-ink)' : 'var(--text-muted)', flexShrink:0 }}/>}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>{t.title}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {t.subject ? `${t.subject} · ` : ''}{t.dueDate ? `Due ${t.dueDate}` : 'No due date'}
                          {t.assignedType === 'specific' ? ' · Individually assigned' : ''}
                          {t.assignedFaculty ? ` · by ${t.assignedFaculty}` : ''}
                        </div>
                      </div>
                      <span className={`badge ${sub ? 'badge-green' : overdue ? 'badge-red' : 'badge-amber'}`}>
                        {sub ? 'Submitted' : overdue ? 'Overdue' : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ══ FOLLOW-UPS TAB ══ */}
      {activeTab === 'followups' && (
        <div className="grid-2" style={{ alignItems:'start' }}>
          {/* Timeline */}
          <div className="card">
            <h3 style={{ fontSize:14, fontWeight:600, marginBottom:16 }}>Follow-Up History ({followups.length})</h3>
            <div style={{ maxHeight:440, overflowY:'auto', marginBottom:16 }}>
              {followups.length === 0 && <p style={{ color:'#6B7280', fontSize:13 }}>No follow-ups yet.</p>}
              {followups.map((f, i) => (
                <div key={f.id} style={{ display:'flex', gap:10, marginBottom:14 }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                    <div style={{ width:10, height:10, borderRadius:'50%', background:'#E53935', flexShrink:0, marginTop:4 }}/>
                    {i < followups.length-1 && <div style={{ width:1, flex:1, background:'#E5E7EB', margin:'4px 0' }}/>}
                  </div>
                  <div style={{ flex:1, paddingBottom:4 }}>
                    <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:3 }}>{fmt(f.createdAt)} · {f.addedBy}</div>
                    <div style={{ fontSize:13 }}>{f.note}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Add note */}
            <div style={{ borderTop:'1px solid #E5E7EB', paddingTop:14 }}>
              <label className="form-label" style={{ marginBottom:6, display:'block' }}>Add Follow-Up Note</label>
              <textarea className="form-input" rows={2} placeholder="Called student, visited, parent contacted..."
                value={newNote} onChange={e => setNewNote(e.target.value)}/>
              <button className="btn btn-primary" style={{ marginTop:8, width:'100%' }}
                onClick={handleSaveNote} disabled={savingNote || !newNote.trim()}>
                {savingNote ? 'Saving...' : <><Plus size={13}/> Save Note</>}
              </button>
            </div>
          </div>
          {/* Weak subjects reminder */}
          <div className="card">
            <h3 style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>
              <AlertTriangle size={14} style={{ color:'#EF4444', marginRight:6 }}/>
              Areas Needing Attention
            </h3>
            {student.weakSubjects?.length > 0 ? (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
                {student.weakSubjects.map(s => (
                  <span key={s} style={{ padding:'6px 14px', borderRadius:20, background:'#FEE2E2', color:'#991B1B', fontSize:13, fontWeight:600 }}>{s}</span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize:13, color:'#9CA3AF', marginBottom:14 }}>No weak subjects marked.</p>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setWeakModal(true)}>
              <Edit size={13} /> Update Weak Subjects
            </button>
          </div>
        </div>
      )}

      {/* ══ MODALS ══ */}

      {/* Edit student */}
      {editModal && (
        <Modal title="Edit Student Profile" onClose={() => setEditModal(false)} wide persistent>
          <form onSubmit={handleEdit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <FormRow>
              <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={editForm.name||''} onChange={e=>setEditForm({...editForm,name:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={editForm.phone||''} onChange={e=>setEditForm({...editForm,phone:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={editForm.email||''} onChange={e=>setEditForm({...editForm,email:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">WhatsApp Number</label><input className="form-input" value={editForm.whatsappNumber||''} onChange={e=>setEditForm({...editForm,whatsappNumber:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Father's Name</label><input className="form-input" value={editForm.fatherName||''} onChange={e=>setEditForm({...editForm,fatherName:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Mother's Name</label><input className="form-input" value={editForm.motherName||''} onChange={e=>setEditForm({...editForm,motherName:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Parent Name</label><input className="form-input" value={editForm.parentName||''} onChange={e=>setEditForm({...editForm,parentName:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Parent Phone</label><input className="form-input" value={editForm.parentPhone||''} onChange={e=>setEditForm({...editForm,parentPhone:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">School Name</label><input className="form-input" value={editForm.schoolName||''} onChange={e=>setEditForm({...editForm,schoolName:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Occupation</label><input className="form-input" value={editForm.occupation||''} onChange={e=>setEditForm({...editForm,occupation:e.target.value})}/></div>
            </FormRow>
            <div className="form-group"><label className="form-label">Address</label><textarea className="form-input" rows={2} value={editForm.address||''} onChange={e=>setEditForm({...editForm,address:e.target.value})}/></div>
            <FormRow>
              <div className="form-group"><label className="form-label">Gender</label>
                <select className="form-input" value={editForm.gender||''} onChange={e=>setEditForm({...editForm,gender:e.target.value})}>
                  <option value="">Select</option>{['Girl','Boy','Other'].map(g=><option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Age</label><input className="form-input" type="number" value={editForm.age||''} onChange={e=>setEditForm({...editForm,age:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Syllabus</label><input className="form-input" value={editForm.syllabus||''} onChange={e=>setEditForm({...editForm,syllabus:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Class / Std</label><input className="form-input" value={editForm.classStd||''} onChange={e=>setEditForm({...editForm,classStd:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Status</label>
                <select className="form-input" value={editForm.status||'active'} onChange={e=>setEditForm({...editForm,status:e.target.value})}>
                  {['active','moderate','at-risk','dropped'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Join Date</label><input className="form-input" type="date" value={editForm.joinDate||''} onChange={e=>setEditForm({...editForm,joinDate:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Course Duration (months)</label><input className="form-input" type="number" value={editForm.courseDurationMonths||''} onChange={e=>setEditForm({...editForm,courseDurationMonths:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Staff Assigned</label>
                <select className="form-input" value={editForm.staffAssigned||''} onChange={e=>setEditForm({...editForm,staffAssigned:e.target.value})}>
                  <option value="">Select</option>{staffList.filter(s=>s.active!==false).map(s=><option key={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">ClassPlus ID</label><input className="form-input" value={editForm.classplusId||''} onChange={e=>setEditForm({...editForm,classplusId:e.target.value})}/></div>
            </FormRow>
            <div className="form-group"><label className="form-label">Notes</label><textarea className="form-input" rows={2} value={editForm.notes||''} onChange={e=>setEditForm({...editForm,notes:e.target.value})}/></div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingEdit}>{savingEdit?'Saving...':'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add assessment */}
      {assessModal && (
        <Modal title="Add Assessment Result" onClose={() => setAssessModal(false)} persistent>
          <form onSubmit={handleAddAssessment} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="form-group"><label className="form-label">Test Name *</label><input className="form-input" required value={assessForm.testName} onChange={e=>setAssessForm({...assessForm,testName:e.target.value})}/></div>
            <FormRow>
              <div className="form-group"><label className="form-label">Subject</label>
                <select className="form-input" value={assessForm.subject} onChange={e=>setAssessForm({...assessForm,subject:e.target.value})}>
                  <option value="">Select</option>{ALL_SUBJECTS.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={assessForm.date} onChange={e=>setAssessForm({...assessForm,date:e.target.value})}/></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Marks Scored *</label><input className="form-input" type="number" required value={assessForm.marks} onChange={e=>setAssessForm({...assessForm,marks:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Total Marks *</label><input className="form-input" type="number" required value={assessForm.totalMarks} onChange={e=>setAssessForm({...assessForm,totalMarks:e.target.value})}/></div>
            </FormRow>
            <div className="form-group">
              <label className="form-label">Conducting Staff <span style={{ fontWeight: 400, color: '#6B7280' }}>(optional — select all involved)</span></label>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {staffList.filter(s => s.active !== false).map(s => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox"
                      checked={assessForm.conductingStaffIds.includes(s.id)}
                      onChange={() => toggleConductingStaff(s.id)} />
                    <span style={{ flex: 1 }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>{s.role}</span>
                  </label>
                ))}
                {staffList.filter(s => s.active !== false).length === 0 && (
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>No staff found</div>
                )}
              </div>
            </div>
            {assessForm.marks && assessForm.totalMarks && (
              <div style={{ padding:'8px 12px', background:'#F0FDF4', borderRadius:8, fontSize:13, color:'#065F46' }}>
                Percentage: <strong>{Math.round(Number(assessForm.marks)/Number(assessForm.totalMarks)*100)}%</strong>
              </div>
            )}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setAssessModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Result</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Weak subjects */}
      {weakModal && (
        <Modal title="Manage Weak Subjects" onClose={() => setWeakModal(false)} persistent>
          <div style={{ marginBottom:14, fontSize:13, color:'#6B7280' }}>
            Select subjects this student is struggling with. This helps faculty prioritise attention.
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:20 }}>
            {ALL_SUBJECTS.map(sub => (
              <div key={sub} onClick={() => toggleWeak(sub)} style={{
                padding:'6px 14px', borderRadius:20, fontSize:12, cursor:'pointer', fontWeight:500,
                background: weakSubjects.includes(sub)?'#FEE2E2':'var(--bg)',
                color:      weakSubjects.includes(sub)?'#991B1B':'var(--muted)',
                border:     `1px solid ${weakSubjects.includes(sub)?'#FECACA':'var(--border)'}`,
                transition:'all .15s',
              }}>
                {weakSubjects.includes(sub)?'':''}{sub}
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setWeakModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveWeak} disabled={savingWeak}>
              {savingWeak?'Saving...':'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* Add / edit progress report (independent of the calendar) */}
      {reportModal && (
        <Modal title={reportModal === 'edit' ? 'Edit Progress Report' : 'Add Progress Report'} onClose={() => setReportModal(null)} persistent>
          <FormRow>
            <div className="form-group">
              <label className="form-label">Class Title *</label>
              <input className="form-input" placeholder="e.g. Algebra — Chapter 3" value={reportForm.sessionTitle}
                onChange={e => setReportForm(f => ({ ...f, sessionTitle: e.target.value }))}/>
            </div>
            <div className="form-group">
              <label className="form-label">Date of Class</label>
              <input className="form-input" type="date" value={reportForm.sessionDate}
                onChange={e => setReportForm(f => ({ ...f, sessionDate: e.target.value }))}/>
            </div>
          </FormRow>
          <div className="form-group">
            <label className="form-label">Rating</label>
            <select className="form-input" value={reportForm.rating} onChange={e => setReportForm(f => ({ ...f, rating: e.target.value }))}>
              <option value="">No rating</option>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="average">Average</option>
              <option value="needs-improvement">Needs improvement</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Progress Report *</label>
            <textarea className="form-input" rows={5} placeholder="How did the student do in this class?"
              value={reportForm.note} onChange={e => setReportForm(f => ({ ...f, note: e.target.value }))}/>
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:6 }}>
            <button className="btn btn-ghost" onClick={() => setReportModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveReport} disabled={savingReport}>
              {savingReport ? 'Saving…' : reportModal === 'edit' ? 'Save Changes' : 'Add Report'}
            </button>
          </div>
        </Modal>
      )}

      {/* Course flow note */}
      {flowNoteModal && (() => {
        const ft = flowNoteModal.fieldType || 'none';
        const opts = flowNoteModal.fieldOptions || [];
        const fieldLabel = flowNoteModal.fieldLabel || flowNoteModal.label;
        return (
          <Modal title={`Mark Complete: ${flowNoteModal.label}`} onClose={() => { setFlowNoteModal(null); setFlowNote(''); setFlowValue(''); }} persistent>
            {ft === 'dropdown' && (
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label">{fieldLabel} *</label>
                <select className="form-input" required value={flowValue} onChange={e => setFlowValue(e.target.value)}>
                  <option value="">Select…</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}
            {(ft === 'note' || ft === 'text') && (
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label">{fieldLabel}</label>
                <textarea className="form-input" rows={3} placeholder={`Enter ${fieldLabel.toLowerCase()}...`}
                  value={flowValue} onChange={e => setFlowValue(e.target.value)}/>
              </div>
            )}
            <div className="form-group" style={{ marginBottom:14 }}>
              <label className="form-label">Additional Note (optional)</label>
              <textarea className="form-input" rows={3} placeholder="Any observations or remarks about this step..."
                value={flowNote} onChange={e => setFlowNote(e.target.value)}/>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setFlowNoteModal(null); setFlowNote(''); setFlowValue(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveFlowNote} disabled={savingFlow}>
                {savingFlow ? 'Saving...' : 'Mark Complete'}
              </button>
            </div>
          </Modal>
        );
      })()}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}
      {confirmBox && <Confirm message={confirmBox.message} confirmLabel={confirmBox.confirmLabel} onConfirm={confirmBox.onConfirm} onCancel={() => setConfirmBox(null)}/>}
    </div>
  );
}