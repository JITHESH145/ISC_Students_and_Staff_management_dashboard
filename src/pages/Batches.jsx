import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getBatches, addBatch, updateBatch,
  getBatchStudents, addStudent, bulkAddStudents, getBatchStudentCount, updateStudent, syncBatchStaffToStudents,
  getStaffProfiles, getBatchSchedules, addBatchSchedule, deleteBatchSchedule,
  getBatchTasks, addBatchTask, markTaskSubmitted, updateBatchTask, deleteBatchTask,
  updateScheduleStatus, saveAttendance, getSessionAttendance,
  addNotification, notifyStaff, getTrashItems, permanentDelete,
  createRequest,
  getAssessments, addAssessment, deleteAssessment, getAssessmentResults, saveAssessmentResults,
} from '../firebase/services';
import {
  collection, addDoc, deleteDoc, doc, setDoc, serverTimestamp, getDocs, query, where, updateDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Modal, Toast, Loading, FormRow, Avatar, StatusBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { sendAssignmentEmail } from '../firebase/emailService';
import {
  Plus, Upload, UserPlus, ChevronRight, ArrowLeft,
  Download, CheckSquare, Users, Trash2, Settings,
  AlertTriangle, CheckCircle, X, Search, Pencil, Clock,
  ChevronUp, ChevronDown
} from 'lucide-react';

// Course dropdown: only "ISC Level 1" is a fixed option. Any other course is
// typed once via "Other" and then persists automatically, because it's saved on
// the batch and re-derived from existing batches next time (see courseOptions).
const BASE_COURSES = ['ISC Level 1'];
// Legacy hardcoded courses that were removed from the picker — filtered out so
// they don't reappear even if an old batch still uses one.
const LEGACY_COURSES = ['Python','Data Science','Web Development','Machine Learning','Digital Marketing','UI/UX Design','Cyber Security','ISC Level 2','AI Batch','Other'];
const OTHER_COURSE = '__other__';
const DAYS    = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const PHASES  = ['onboarding', 'course'];

// fieldType: 'none' | 'note' | 'dropdown' | 'text'
// displayInTable: show captured value in student list
const DEFAULT_COURSE_FLOW = [
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
  { key: 'malayalam_activity',label: 'Malayalam Activity',                   phase: 'course',     fieldType: 'none' },
  { key: 'english_activity',  label: 'English Activity',                     phase: 'course',     fieldType: 'none' },
  { key: 'maths_activity',    label: 'Maths Activity',                       phase: 'course',     fieldType: 'none' },
  { key: 'science_activity',  label: 'Science Activity',                     phase: 'course',     fieldType: 'none' },
  { key: 'followup_monitor',  label: 'Regular Follow-up & Progress Monitoring', phase: 'course', fieldType: 'none' },
];

// Fields match the Google Form CSV columns in order:
// Timestamp(joinDate), Name of Father, Name of Mother, Email, Address,
// Phone number, Whatsapp Number, Occupation, Kids Name(name), Gender, Age, Class, School Name
// Columns shown in the students table by default (when a field has no explicit showInList)
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
// End date = start date + N months. Clamps month-end overflow (e.g. Jan 31 + 1
// month lands on the last day of Feb, not spilling into March).
const addMonthsToDate = (startStr, months) => {
  const n = Number(months);
  if (!startStr || !n || Number.isNaN(n)) return '';
  const d = new Date(startStr);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const DEFAULT_LIST_KEYS = ['fatherName','motherName','phone','whatsappNumber','classStd','varkResult','syllabus'];

const DEFAULT_STUDENT_FIELDS = [
  { key: 'fatherName',    label: 'Name of Father',            required: false, type: 'text'  },
  { key: 'motherName',    label: 'Name of Mother',            required: false, type: 'text'  },
  { key: 'email',         label: 'Email',                     required: false, type: 'email' },
  { key: 'address',       label: 'Address',                   required: false, type: 'text'  },
  { key: 'phone',         label: 'Phone Number',              required: false, type: 'text'  },
  { key: 'whatsappNumber',label: 'Whatsapp Number',           required: false, type: 'text'  },
  { key: 'occupation',    label: 'Occupation',                required: false, type: 'text'  },
  { key: 'name',          label: "Kids Name",                 required: true,  type: 'text'  },
  { key: 'gender',        label: 'Gender',                    required: false, type: 'text'  },
  { key: 'age',           label: 'Age',                       required: false, type: 'number'},
  { key: 'classStd',      label: 'Class',                     required: false, type: 'text'  },
  { key: 'schoolName',    label: 'School Name',               required: false, type: 'text'  },
  { key: 'varkResult',    label: 'VARK Learning Style',       required: false, type: 'text'  },
  { key: 'syllabus',      label: 'Syllabus (CBSE/STATE/ICSE)',required: false, type: 'text'  },
];

function generateKey(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Math.random().toString(36).slice(2,5);
}

function normalize(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }

// Fuzzy-match a CSV header to a field key or label
function matchCsvHeader(csvHeader, fields) {
  const n = normalize(csvHeader);
  // Exact key match
  let f = fields.find(f => normalize(f.key) === n);
  if (f) return f.key;
  // Exact label match
  f = fields.find(f => normalize(f.label) === n);
  if (f) return f.key;
  // Partial key match
  f = fields.find(f => n.includes(normalize(f.key)) || normalize(f.key).includes(n));
  if (f) return f.key;
  // Partial label match
  f = fields.find(f => n.includes(normalize(f.label)) || normalize(f.label).includes(n));
  if (f) return f.key;
  return n; // fallback to normalized header
}

// Proper RFC-4180 CSV parser — handles quoted fields with commas and newlines inside
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSVText(text) {
  // Split into lines but respect quoted newlines
  const rows = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuote = !inQuote; cur += ch; }
    else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur.trim()) rows.push(cur);
      cur = '';
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else { cur += ch; }
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCSV(text, fields) {
  const lines = parseCSVText(text);
  if (lines.length === 0) return [];
  const rawHeaders = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g,'').trim());
  const colKeys = rawHeaders.map(h => fields ? matchCsvHeader(h, fields) : normalize(h));
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]).map(v => v.replace(/^"|"$/g,'').trim());
    if (vals.every(v => !v)) continue;
    const obj = {};
    colKeys.forEach((key, idx) => { obj[key] = vals[idx] || ''; });
    result.push(obj);
  }
  return result;
}

function downloadTemplate(batchName, fields) {
  const headers = fields.map(f => f.key);
  const example = fields.map(f => {
    if (f.key === 'name') return 'Fathima Aysha';
    if (f.key === 'phone') return '+91 98432 11234';
    if (f.key === 'email') return 'fathima@email.com';
    if (f.key === 'classStd') return 'Class 10';
    return '';
  });
  const blob = new Blob([headers.join(',')+'\n'+example.join(',')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${batchName||'batch'}_template.csv`;
  a.click();
}

// ─── Onboarding Step Side Panel (dynamic field types) ────────────────────────
function OnboardingStepPanel({ step, onClose, onMarkComplete, onRevoke, onToast }) {
  const [tab, setTab]                         = useState('not');
  const [search, setSearch]                   = useState('');
  const [fieldValues, setFieldValues]         = useState({}); // studentId captured value
  const [marking, setMarking]                 = useState({});
  const [localCompleted, setLocalCompleted]   = useState([]);
  const [localNotCompleted, setLocalNotCompleted] = useState([]);
  const [customFor, setCustomFor]             = useState({}); // studentId -> typing a custom dropdown value

  useEffect(() => {
    setLocalCompleted(step?.completedStudents || []);
    setLocalNotCompleted(step?.notCompletedStudents || []);
    setSearch('');
    setFieldValues({});
    setCustomFor({});
  }, [step?.key]);

  if (!step) return null;

  const ft       = step.fieldType || 'none';
  const opts     = step.fieldOptions || [];
  const needsVal = ft === 'dropdown'; // required before marking

  const filteredNot  = localNotCompleted.filter(s => !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search));
  const filteredDone = localCompleted.filter(s => !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search));

  const doMark = async (s) => {
    if (s.status === 'dropped') { onToast?.({ message: `${s.name} is a dropped student — cannot mark steps.`, type: 'error' }); return; }
    const val = fieldValues[s.id] || '';
    if (needsVal && !val) return;
    setMarking(prev => ({ ...prev, [s.id]: true }));
    setLocalNotCompleted(prev => prev.filter(x => x.id !== s.id));
    setLocalCompleted(prev => [...prev, { ...s, stepFieldValue: val }]);
    try {
      await onMarkComplete(s.id, step.key, val || undefined);
    } catch {
      setLocalCompleted(prev => prev.filter(x => x.id !== s.id));
      setLocalNotCompleted(prev => [...prev, s]);
    }
    setMarking(prev => ({ ...prev, [s.id]: false }));
  };

  const doRevoke = async (s) => {
    setMarking(prev => ({ ...prev, [s.id]: true }));
    setLocalCompleted(prev => prev.filter(x => x.id !== s.id));
    setLocalNotCompleted(prev => [...prev, s]);
    try {
      await onRevoke(s.id, step.key);
    } catch {
      setLocalCompleted(prev => [...prev, s]);
      setLocalNotCompleted(prev => prev.filter(x => x.id !== s.id));
    }
    setMarking(prev => ({ ...prev, [s.id]: false }));
  };

  const setVal = (sid, v) => setFieldValues(p => ({ ...p, [sid]: v }));

  return (
    <div style={{ position:'fixed', top:0, right:0, width:440, height:'100vh', background:'var(--white)', boxShadow:'-4px 0 24px rgba(0,0,0,0.12)', zIndex:1000, display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'18px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:'var(--text)' }}>{step.label}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', textTransform:'capitalize' }}>
            {step.phase} phase
            {ft !== 'none' && <span style={{ marginLeft:6, background:'var(--violet-soft)', color:'var(--violet-ink)', borderRadius:8, padding:'1px 7px', fontSize:10, fontWeight:600 }}>{ft}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4 }}><X size={18}/></button>
      </div>
      <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
        <input className="form-input" placeholder="Search by name or phone…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ fontSize:12 }}/>
      </div>
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
        {[
          { key:'not',       label:`Not Completed (${localNotCompleted.length})`, color:'var(--red-ink)' },
          { key:'completed', label:`Completed (${localCompleted.length})`,         color:'var(--green-ink)' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex:1, padding:'10px 0', fontSize:13, fontWeight:600, cursor:'pointer', background:'none', border:'none',
              borderBottom: tab===t.key ? `2px solid ${t.color}` : '2px solid transparent',
              color: tab===t.key ? t.color : 'var(--text-muted)', transition:'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
        {tab === 'not' && (
          <>
            {filteredNot.length === 0 && (
              <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', paddingTop:40 }}>
                {search ? 'No match.' : 'All students completed this step!'}
              </div>
            )}
            {filteredNot.map(s => {
              const isDropped = s.status === 'dropped';
              const val       = fieldValues[s.id] || '';
              const canMark   = !isDropped && (!needsVal || !!val);
              return (
                <div key={s.id} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:10, borderRadius:8, marginBottom:6, background: isDropped ? 'var(--surface-sunken)' : 'var(--red-soft)', border:`1px solid ${isDropped ? 'var(--border)' : 'var(--red-soft)'}` }}>
                  <div style={{ width:28, height:28, borderRadius:'50%', background: isDropped ? 'var(--border)' : 'var(--red-soft)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color: isDropped ? 'var(--text-muted)' : 'var(--red-ink)', flexShrink:0, marginTop:2 }}>
                    {(s.name||'?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
                      {s.name}
                      {isDropped && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:8, background:'var(--surface-sunken)', color:'var(--text-muted)', fontWeight:600 }}>Dropped</span>}
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom: ft !== 'none' ? 6 : 0 }}>{s.phone||'—'}</div>

                    {/* Dynamic field input */}
                    {!isDropped && ft === 'dropdown' && !customFor[s.id] && (
                      <select value={opts.includes(val) ? val : ''} onChange={e => {
                        if (e.target.value === '__add__') { setCustomFor(p => ({ ...p, [s.id]: true })); setVal(s.id, ''); }
                        else setVal(s.id, e.target.value);
                      }}
                        className="form-input" style={{ fontSize:11, marginBottom:6 }}>
                        <option value="">Select {step.fieldLabel || 'option'}…</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__add__">＋ Add new option…</option>
                      </select>
                    )}
                    {!isDropped && ft === 'dropdown' && customFor[s.id] && (
                      <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                        <input autoFocus value={val} onChange={e => setVal(s.id, e.target.value)}
                          placeholder={`New ${step.fieldLabel || 'option'}…`}
                          className="form-input" style={{ fontSize:11, flex:1 }}/>
                        <button type="button" title="Back to list"
                          onClick={() => { setCustomFor(p => ({ ...p, [s.id]: false })); setVal(s.id, ''); }}
                          style={{ background:'var(--surface-sunken)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:11, padding:'0 8px', color:'var(--text-muted)' }}>✕</button>
                      </div>
                    )}
                    {!isDropped && ft === 'note' && (
                      <textarea rows={2} value={val} onChange={e => setVal(s.id, e.target.value)}
                        placeholder={`${step.fieldLabel || 'Notes'} (optional)…`}
                        className="form-input" style={{ fontSize:11, marginBottom:6, resize:'vertical' }}/>
                    )}
                    {!isDropped && ft === 'text' && (
                      <input value={val} onChange={e => setVal(s.id, e.target.value)}
                        placeholder={step.fieldLabel || 'Enter value…'}
                        className="form-input" style={{ fontSize:11, marginBottom:6 }}/>
                    )}

                    {!isDropped && (
                      <button disabled={marking[s.id] || !canMark}
                        onClick={() => doMark(s)}
                        style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'none', cursor: canMark ? 'pointer' : 'default', fontWeight:600,
                          background: marking[s.id] ? 'var(--surface-sunken)' : 'var(--green-soft)', color: marking[s.id] ? 'var(--text-muted)' : 'var(--green-ink)',
                          opacity: canMark ? 1 : 0.5 }}>
                        {marking[s.id] ? 'Saving…' : ft === 'dropdown' ? `Mark Complete + Save ${step.fieldLabel||'Value'}` : 'Mark Complete'}
                      </button>
                    )}
                    {isDropped && <div style={{ fontSize:11, color:'var(--text-muted)', fontStyle:'italic' }}>Cannot mark — student is dropped</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {tab === 'completed' && (
          <>
            {filteredDone.length === 0 && (
              <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', paddingTop:40 }}>
                {search ? 'No match.' : 'No students completed yet.'}
              </div>
            )}
            {filteredDone.map(s => {
              const savedVal = s.stepFieldValue || s.courseFlow?.[step.key]?.value || '';
              return (
                <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 10px', borderRadius:8, marginBottom:4, background:'var(--green-soft)', border:'1px solid var(--green-soft)' }}>
                  <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--green-soft)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--green-ink)', flexShrink:0 }}>
                    {(s.name||'?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500 }}>{s.name}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.phone||'—'}</div>
                    {savedVal && (
                      <div style={{ fontSize:11, marginTop:2, color: ft === 'note' ? 'var(--text-sub)' : 'var(--violet-ink)', fontStyle: ft === 'note' ? 'italic' : 'normal', fontWeight: ft !== 'note' ? 600 : 400 }}>
                        {step.fieldLabel ? `${step.fieldLabel}: ` : ''}{savedVal}
                      </div>
                    )}
                  </div>
                  <CheckCircle size={14} style={{ color:'var(--green-ink)', flexShrink:0 }}/>
                  <button disabled={marking[s.id]} onClick={() => doRevoke(s)}
                    style={{ fontSize:10, padding:'2px 8px', borderRadius:8, border:'1px solid #E5E7EB', background:'#fff', color:'#9CA3AF', cursor:'pointer', flexShrink:0 }}>
                    {marking[s.id] ? '…' : 'Undo'}
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default function Batches() {
  const { profile } = useAuth();
  const navigate    = useNavigate();
  const location    = useLocation();
  const isCEOorAdmin = profile?.role === 'ceo';
  // Access scope for rules-compliant queries (staff must carry staffIds clause)
  const scope = { role: profile?.role, uid: profile?.uid, email: profile?.email };

  const [batches, setBatches]           = useState([]);
  const [staffList, setStaffList]       = useState([]);
  const [batchCounts, setBatchCounts]   = useState({});
  const [loading, setLoading]           = useState(true);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchStudents, setBatchStudents] = useState([]);
  const [schedules, setSchedules]       = useState([]);
  const [batchTasks, setBatchTasks]     = useState([]);
  const [activeTab, setActiveTab]       = useState('students');
  const [toast, setToast]               = useState(null);
  const [saving, setSaving]             = useState(false);
  const [csvPreview, setCsvPreview]     = useState(null);
  const [importing, setImporting]       = useState(false);
  const fileRef = useRef();

  // Modals
  const [showCreate,      setShowCreate]      = useState(false);
  const [showAddStudent,  setShowAddStudent]  = useState(false);
  const [showBulk,        setShowBulk]        = useState(false);
  const [showSchedule,    setShowSchedule]    = useState(false);
  const [showTask,        setShowTask]        = useState(false);
  const [showFlowConfig,  setShowFlowConfig]  = useState(false);
  const [showFieldConfig, setShowFieldConfig] = useState(false);
  const [showDates,       setShowDates]       = useState(false);
  const [datesForm,       setDatesForm]       = useState({ startDate:'', endDate:'', courseDurationMonths:'' });
  const [showSubjectConfig, setShowSubjectConfig] = useState(false);
  const [showAttendance,  setShowAttendance]  = useState(null);
  const [confirmDialog,   setConfirmDialog]   = useState(null); // { message, onConfirm }
  const [attendanceCsv,   setAttendanceCsv]   = useState(null);
  const [attendancePreview, setAttendancePreview] = useState(null);
  const [attendanceSaved, setAttendanceSaved] = useState({});
  const attendanceFileRef = useRef();

  // Staff tab state
  const [showAddStaff,    setShowAddStaff]    = useState(false);
  const [staffSearch,     setStaffSearch]     = useState('');
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [removalReason,   setRemovalReason]   = useState('');
  const [showRemovalModal, setShowRemovalModal] = useState(null); // { uid, name, targetType, targetId, targetName }

  // Delete batch / student confirmation
  const [deleteStudentConfirm, setDeleteStudentConfirm] = useState(null); // student object
  const [bulkStaffAssign, setBulkStaffAssign] = useState(''); // staff name for bulk import

  // Onboarding analytics side panel
  const [selectedStep, setSelectedStep]     = useState(null);

  // Task split panel
  const [selectedTask, setSelectedTask]     = useState(null);
  const [taskFilter, setTaskFilter]         = useState('all');
  const [editingTask, setEditingTask]       = useState(null); // { id, title }
  const [taskKpiFilter, setTaskKpiFilter]   = useState('all'); // 'all'|'pending'|'submitted'
  const [taskSearch, setTaskSearch]         = useState('');
  const [taskListSearch, setTaskListSearch] = useState('');   // filter assignments by title/subject
  const [taskStaffFilter, setTaskStaffFilter] = useState(''); // CEO: filter assignments by assigned faculty

  // Overdue class confirmation dialog
  const [overdueConfirm, setOverdueConfirm] = useState(null);

  // Calendar schedule view state
  const [calendarView, setCalendarView] = useState('week'); // 'week' | 'month'
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarSlotDetail, setCalendarSlotDetail] = useState(null); // slot shown in popover

  // Share schedule modal
  const [showShareSchedule, setShowShareSchedule] = useState(false);

  // Assessments tab
  const [batchAssessments, setBatchAssessments]     = useState([]);
  const [showCreateAssessment, setShowCreateAssessment] = useState(false);
  const [assessmentForm, setAssessmentForm]         = useState({ title:'', date:'', totalMarks:'', conductingStaff:[], participantType:'all', participantIds:[] });
  const [assessStudentSearch, setAssessStudentSearch] = useState('');
  const [assessmentResults, setAssessmentResults]   = useState({}); // assessmentId results[]
  const [showViewResults, setShowViewResults]       = useState(null); // assessment object
  const [showImportMarks, setShowImportMarks]       = useState(null); // assessment object
  const [marksPreview, setMarksPreview]             = useState(null);
  const [importingMarks, setImportingMarks]         = useState(false);
  const marksFileRef = useRef();

  // Batch create form
  const [createForm, setCreateForm] = useState({
    name:'', course:'', courseIsOther:false, mentorId:'', mentorName:'', faculties:[], startDate:'', endDate:'',
    status:'upcoming', maxSeats:'', courseDurationMonths:'',
    courseFlow: DEFAULT_COURSE_FLOW,
    studentFields: DEFAULT_STUDENT_FIELDS,
    subjects: [], staffIds: [], staffDetails: [],
  });

  const [studentForm, setStudentForm] = useState({});

  const [scheduleForm, setScheduleForm] = useState({
    title:'', day:'Monday', scheduledDate:'', recurring:false, time:'', duration:'60', type:'live-class',
    facultyName:'', meetLink:'', notes:''
  });
  const [facultySearch, setFacultySearch] = useState('');
  const [taskForm, setTaskForm] = useState({
    title:'', subject:'', description:'', dueDate:'', assignedFaculty:'',
    assignedType:'all', assignedStudentIds:[]
  });
  const [taskStudentSearch, setTaskStudentSearch] = useState('');

  const [studentSearch, setStudentSearch] = useState('');
  const [studentStatusFilter, setStudentStatusFilter] = useState('');
  const [studentJoinFrom, setStudentJoinFrom] = useState('');
  const [studentJoinTo,   setStudentJoinTo]   = useState('');
  const [studentPage, setStudentPage] = useState(0);
  const [batchFilter, setBatchFilter] = useState('all');
  const [batchListSearch, setBatchListSearch] = useState('');

  const [editFlow, setEditFlow]         = useState([]);
  const [editFields, setEditFields]     = useState([]);
  const [editSubjects, setEditSubjects] = useState([]);

  const loadBatches = async () => {
    const [b, s] = await Promise.all([getBatches(), getStaffProfiles()]);
    // Staff only see batches they are assigned to (as mentor or staff member)
    const uid = profile?.uid;
    const isStaff = !isCEOorAdmin;
    const filtered = isStaff
      ? b.filter(batch => batch.mentorId === uid || (batch.staffIds || []).includes(uid))
      : b;
    setBatches(filtered);
    setStaffList(s.filter(x => x.active !== false));
    const counts = {};
    await Promise.all(filtered.map(async batch => { counts[batch.id] = await getBatchStudentCount(batch.id, scope); }));
    setBatchCounts(counts);
    setLoading(false);
  };

  const loadBatchDetail = async (batch) => {
    try {
      const [res, sch, tasks, asmts] = await Promise.all([
        getBatchStudents(batch.id, scope).catch(() => ({ students: [] })),
        getBatchSchedules(batch.id).catch(() => []),
        getBatchTasks(batch.id).catch(() => []),
        getAssessments(batch.id).catch(() => []),
      ]);
      setBatchStudents(res.students || []);
      setSchedules(sch || []);
      setBatchTasks(tasks || []);
      setBatchAssessments(asmts || []);
    } catch (err) {
      import.meta.env.DEV && console.error('loadBatchDetail error:', err);
      setBatchStudents([]); setSchedules([]); setBatchTasks([]); setBatchAssessments([]);
    }
  };

  useEffect(() => {
    loadBatches().then(() => {
      if (location.state?.batchId) {
        getBatches().then(allBatches => {
          const target = allBatches.find(b => b.id === location.state.batchId);
          if (target) {
            loadBatchDetail(target).then(() => {
              setSelectedBatch(target);
              if (location.state?.tab) setActiveTab(location.state.tab);
            });
          }
        }).catch(() => {});
      }
    });
  }, []);

  const openBatch = async (batch) => {
    setSelectedBatch(batch);
    setActiveTab('students');
    setStudentSearch('');
    setStudentStatusFilter('');
    setStudentPage(0);
    setSelectedTask(null);
    const fields = batch.studentFields || DEFAULT_STUDENT_FIELDS;
    const initForm = {};
    fields.forEach(f => { initForm[f.key] = ''; });
    initForm.staffAssigned = '';
    initForm.joinDate = todayStr();
    initForm.status = 'active';
    setStudentForm(initForm);
    await loadBatchDetail(batch);
  };

  // ── CRUD handlers ─────────────────────────────────────────────
  const handleCreateBatch = async (e) => {
    e.preventDefault();
    // Course may be typed via "Other"; require a non-empty value either way.
    if (!createForm.course.trim()) { setToast({ message:'Please choose or type a course.', type:'error' }); return; }
    setSaving(true);
    // The faculty chips only stored names in createForm.faculties, so the batch
    // was saved with empty staffIds/staffDetails — meaning no staff were actually
    // assigned (rules + staff dashboards key off staffIds). Resolve the selected
    // names into ids/details here so the assignment sticks.
    const facultyStaff = staffList.filter(s => createForm.faculties.includes(s.name) && s.role !== 'ceo');
    const staffDetails = facultyStaff.map(s => ({ uid: s.id, name: s.name, phone: s.phone || '', email: s.email || '', subjects: s.subjects || [] }));
    // staffIds drives access + "my batches"; include the mentor so they are
    // covered even without the separate mentorId query.
    const staffIds = [...new Set([...facultyStaff.map(s => s.id), createForm.mentorId].filter(Boolean))];
    // courseIsOther is a UI-only flag — don't persist it on the batch doc.
    const batchData = { ...createForm, course: createForm.course.trim() };
    delete batchData.courseIsOther;
    await addBatch({ ...batchData, staffIds, staffDetails });
    // Notify every faculty + mentor assigned at creation (in-app + email).
    // This path previously assigned staff silently — no notification fired.
    const mentorStaff = createForm.mentorId ? staffList.find(s => s.id === createForm.mentorId) : null;
    const assignees = [...facultyStaff];
    if (mentorStaff && !assignees.some(a => a.id === mentorStaff.id)) assignees.push(mentorStaff);
    for (const s of assignees) {
      if (s.email) {
        notifyStaff({
          toEmail: s.email, fromName: profile?.name || 'ISC SMS',
          title: 'New Batch Assignment', type: 'batch_assignment', route: '/batches',
          body: `You have been assigned to batch ${createForm.name}${s.id === createForm.mentorId ? ' as mentor' : ''}`,
          intro: `Hi ${s.name}, you have been assigned to a new batch on ISC SMS.`,
          details: [
            { label: 'Batch',       value: createForm.name },
            { label: 'Course',      value: createForm.course },
            { label: 'Your role',   value: s.id === createForm.mentorId ? 'Mentor' : 'Faculty' },
            { label: 'Start date',  value: createForm.startDate },
            { label: 'End date',    value: createForm.endDate },
            { label: 'Assigned by', value: profile?.name },
          ].filter(d => d.value),
        }).catch(() => {});
      }
    }
    setToast({ message:`Batch "${createForm.name}" created!`, type:'success' });
    setShowCreate(false);
    setCreateForm({ name:'', course:'', courseIsOther:false, mentorId:'', mentorName:'', faculties:[], startDate:'', endDate:'', status:'upcoming', maxSeats:'', courseDurationMonths:'', courseFlow:DEFAULT_COURSE_FLOW, studentFields:DEFAULT_STUDENT_FIELDS, subjects:[], staffIds:[], staffDetails:[] });
    await loadBatches(); setSaving(false);
  };

  const toggleFaculty = (name) => {
    setCreateForm(prev => ({
      ...prev,
      faculties: prev.faculties.includes(name)
        ? prev.faculties.filter(f => f !== name)
        : [...prev.faculties, name]
    }));
  };

  const handleAddStudent = async (e) => {
    e.preventDefault(); setSaving(true);
    await addStudent({ ...studentForm, batchId:selectedBatch.id, batchName:selectedBatch.name, course:selectedBatch.course, courseDurationMonths:selectedBatch.courseDurationMonths||'' });
    setToast({ message:'Student added!', type:'success' });
    setShowAddStudent(false);
    const fields = selectedBatch.studentFields || DEFAULT_STUDENT_FIELDS;
    const initForm = {};
    fields.forEach(f => { initForm[f.key] = ''; });
    initForm.staffAssigned = ''; initForm.joinDate = todayStr(); initForm.status = 'active';
    setStudentForm(initForm);
    await loadBatchDetail(selectedBatch);
    const c = await getBatchStudentCount(selectedBatch.id, scope);
    setBatchCounts(prev => ({ ...prev, [selectedBatch.id]: c }));
    setSaving(false);
  };

  const handleBulkImport = async () => {
    if (!csvPreview) return; setImporting(true);
    const fields = selectedBatch.studentFields || DEFAULT_STUDENT_FIELDS;
    const students = csvPreview.map(row => {
      const obj = { batchId:selectedBatch.id, batchName:selectedBatch.name, course:selectedBatch.course, courseDurationMonths:selectedBatch.courseDurationMonths||'', status:row.status||'active', ...(bulkStaffAssign ? { staffAssigned: bulkStaffAssign } : {}) };
      // Extract join date from Timestamp column if present
      const ts = row['timestamp'] || row['Timestamp'] || row['timestamp'];
      if (ts) {
        try {
          const d = new Date(ts);
          if (!isNaN(d)) obj.joinDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        } catch {}
      }
      fields.forEach(f => { obj[f.key] = row[f.key] || ''; });
      return obj;
    });
    const res = await bulkAddStudents(students);
    setToast({ message:`Imported ${res.success} students!`, type:'success' });
    setShowBulk(false); setCsvPreview(null); setImporting(false);
    await loadBatchDetail(selectedBatch);
    const c = await getBatchStudentCount(selectedBatch.id, scope);
    setBatchCounts(prev => ({ ...prev, [selectedBatch.id]: c }));
  };

  const handleSaveFlowConfig = async () => {
    setSaving(true);
    // Clean dropdown options (trim + drop blank lines) only at save time,
    // so typing new lines works while editing.
    const cleanFlow = editFlow.map(s => s.fieldOptions
      ? { ...s, fieldOptions: s.fieldOptions.map(o => o.trim()).filter(Boolean) } : s);
    await updateBatch(selectedBatch.id, { courseFlow:cleanFlow });
    const updated = { ...selectedBatch, courseFlow:cleanFlow };
    setSelectedBatch(updated); setBatches(prev => prev.map(b => b.id===selectedBatch.id?updated:b));
    setShowFlowConfig(false); setToast({ message:'Course flow updated!', type:'success' }); setSaving(false);
  };

  // Reorder a field row without touching its label/key. Reordering is a
  // first-class action so users never rename labels to rearrange columns —
  // doing that would desync a field's display label from its permanent `key`
  // (the key is what actually stores/reads the value: s[f.key]).
  const moveEditField = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= editFields.length) return;
    const u = [...editFields];
    [u[idx], u[j]] = [u[j], u[idx]];
    setEditFields(u);
  };

  // Removing a field only drops the column from the config — it never deletes
  // the values already saved on student docs (those stay under the field's key
  // and remain viewable on each student's profile). Confirm so it's deliberate.
  const removeEditField = (idx) => {
    const f = editFields[idx];
    if (f.key === 'name') { setToast({ message:'The Kids Name field is required and cannot be removed.', type:'error' }); return; }
    setConfirmDialog({
      message: `Remove the "${f.label}" field? The column disappears from the table and add-student form, but any data already captured for existing students is kept and stays visible on each student's profile under "Additional Details".`,
      onConfirm: () => setEditFields(prev => prev.filter(x => x.key !== f.key)),
    });
  };

  const handleSaveFieldConfig = async () => {
    setSaving(true);
    // Guard the invariant every reader depends on: each field has a stable,
    // unique, non-empty key. Backfill any legacy field missing a key and
    // de-dupe collisions so a value is never written to the wrong field.
    const seen = new Set();
    const cleanFields = editFields.map(f => {
      let key = f.key && String(f.key).trim();
      if (!key || seen.has(key)) key = generateKey(f.label || 'field');
      seen.add(key);
      const next = { ...f, key };
      return next.options ? { ...next, options: next.options.map(o => o.trim()).filter(Boolean) } : next;
    });
    await updateBatch(selectedBatch.id, { studentFields:cleanFields });
    const updated = { ...selectedBatch, studentFields:cleanFields };
    setSelectedBatch(updated); setBatches(prev => prev.map(b => b.id===selectedBatch.id?updated:b));
    setShowFieldConfig(false); setToast({ message:'Student fields updated!', type:'success' }); setSaving(false);
  };

  const handleSaveDates = async () => {
    setSaving(true);
    const patch = {
      startDate: datesForm.startDate || '',
      endDate: datesForm.endDate || '',
      courseDurationMonths: datesForm.courseDurationMonths ? Number(datesForm.courseDurationMonths) : '',
    };
    await updateBatch(selectedBatch.id, patch);
    const updated = { ...selectedBatch, ...patch };
    setSelectedBatch(updated); setBatches(prev => prev.map(b => b.id===selectedBatch.id?updated:b));
    setShowDates(false); setToast({ message:'Course duration updated!', type:'success' }); setSaving(false);
  };

  const handleSaveSubjectConfig = async () => {
    setSaving(true);
    await updateBatch(selectedBatch.id, { subjects:editSubjects });
    const updated = { ...selectedBatch, subjects:editSubjects };
    setSelectedBatch(updated); setBatches(prev => prev.map(b => b.id===selectedBatch.id?updated:b));
    setShowSubjectConfig(false); setToast({ message:'Subjects updated!', type:'success' }); setSaving(false);
  };

  const handleDeleteBatch = async () => {
    if (!selectedBatch) return;
    setSaving(true);
    try {
      // Move to trash
      await addDoc(collection(db,'trash'), {
        type: 'batch', originalId: selectedBatch.id, data: selectedBatch,
        deletedAt: serverTimestamp(), deletedBy: profile?.uid || profile?.email || 'unknown',
      });
      // Mark all students as deleted
      const studentsSnap = await getDocs(query(collection(db,'students'), where('batchId','==',selectedBatch.id)));
      await Promise.all(studentsSnap.docs.map(d =>
        updateDoc(doc(db, 'students', d.id), { deleted: true, deletedAt: serverTimestamp(), batchId: selectedBatch.id })
      ));
      // Delete batch
      await deleteDoc(doc(db,'batches', selectedBatch.id));
      setToast({ message:'Batch deleted and archived to trash.', type:'success' });
      setSelectedBatch(null);
      await loadBatches();
    } catch (err) {
      setToast({ message:'Error deleting batch: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleDeleteStudent = async (student) => {
    setSaving(true);
    try {
      await addDoc(collection(db,'trash'), {
        type: 'student', originalId: student.id, data: student,
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db,'students', student.id));
      setToast({ message:`${student.name} moved to trash.`, type:'success' });
      setDeleteStudentConfirm(null);
      await loadBatchDetail(selectedBatch);
      const c = await getBatchStudentCount(selectedBatch.id, scope);
      setBatchCounts(prev => ({ ...prev, [selectedBatch.id]: c }));
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleAddStaffToBatch = async () => {
    if (!selectedStaffIds.length) return;
    setSaving(true);
    try {
      const currentStaffIds = selectedBatch.staffIds || [];
      const currentStaffDetails = selectedBatch.staffDetails || [];
      const newStaffToAdd = staffList.filter(s => selectedStaffIds.includes(s.id) && !currentStaffIds.includes(s.id));
      const updatedStaffIds = [...currentStaffIds, ...newStaffToAdd.map(s => s.id)];
      const updatedStaffDetails = [...currentStaffDetails, ...newStaffToAdd.map(s => ({
        uid: s.id, name: s.name, phone: s.phone || '', email: s.email || '', subjects: s.subjects || [],
      }))];
      await updateBatch(selectedBatch.id, { staffIds: updatedStaffIds, staffDetails: updatedStaffDetails });
      // Denormalization sync: students carry staffIds for access rules —
      // keep every student in this batch aligned with the new staffing.
      await syncBatchStaffToStudents(selectedBatch.id, { ...selectedBatch, staffIds: updatedStaffIds });
      // Send notifications (in-app + email together)
      for (const staff of newStaffToAdd) {
        if (staff.email) {
          await notifyStaff({
            toEmail: staff.email, fromName: profile?.name || 'ISC SMS',
            title: 'New Batch Assignment', type: 'batch_assignment', route: '/batches',
            body: `You have been added to batch ${selectedBatch.name}`,
            intro: `Hi ${staff.name}, you have been added to a batch on ISC SMS.`,
            details: [
              { label: 'Batch',       value: selectedBatch.name },
              { label: 'Course',      value: selectedBatch.course },
              { label: 'Start date',  value: selectedBatch.startDate },
              { label: 'End date',    value: selectedBatch.endDate },
              { label: 'Added by',    value: profile?.name },
            ].filter(d => d.value),
          });
        }
      }
      const updated = { ...selectedBatch, staffIds: updatedStaffIds, staffDetails: updatedStaffDetails };
      setSelectedBatch(updated);
      setBatches(prev => prev.map(b => b.id === selectedBatch.id ? updated : b));
      setShowAddStaff(false);
      setSelectedStaffIds([]);
      setToast({ message:'Staff added to batch!', type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleRemoveStaffFromBatch = async (staffUid) => {
    setSaving(true);
    try {
      const updatedStaffIds = (selectedBatch.staffIds || []).filter(id => id !== staffUid);
      const updatedStaffDetails = (selectedBatch.staffDetails || []).filter(s => s.uid !== staffUid);
      const patch = { staffIds: updatedStaffIds, staffDetails: updatedStaffDetails };
      // If the removed staff was this batch's mentor, clear it too — otherwise the
      // batch keeps showing in their assigned list (getStaffBatches matches mentorId).
      if (selectedBatch.mentorId === staffUid) { patch.mentorId = ''; patch.mentorName = ''; }
      await updateBatch(selectedBatch.id, patch);
      // Denormalization sync: revoke this staff's access to the batch's students.
      await syncBatchStaffToStudents(selectedBatch.id, { ...selectedBatch, ...patch });
      const updated = { ...selectedBatch, ...patch };
      setSelectedBatch(updated);
      setBatches(prev => prev.map(b => b.id === selectedBatch.id ? updated : b));
      setToast({ message:'Staff removed from batch.', type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleSubmitRemovalRequest = async () => {
    if (!showRemovalModal || !removalReason.trim()) return;
    setSaving(true);
    try {
      await createRequest({
        type: 'removal',
        requestedBy: profile?.uid, requestedByName: profile?.name,
        targetType: showRemovalModal.targetType,
        targetId: showRemovalModal.targetId,
        targetName: showRemovalModal.targetName,
        reason: removalReason, status: 'pending',
      });
      // Notify CEO
      const ceoSnap = await getDocs(query(collection(db,'staff'), where('role','==','ceo')));
      for (const ceoDoc of ceoSnap.docs) {
        const ceo = ceoDoc.data();
        if (ceo.email) {
          await addNotification({
            toEmail: ceo.email, title: 'Staff Removal Request',
            body: `${profile?.name} requested removal from ${showRemovalModal.targetName}`,
            type: 'removal_request', read: false,
          });
          sendAssignmentEmail({
            toEmail: ceo.email, toName: ceo.name || 'CEO',
            title: 'Staff Removal Request',
            detail: `${profile?.name} requested removal from ${showRemovalModal.targetName}. Reason: ${removalReason}`,
            assignedBy: profile?.name || 'Staff',
          }).catch(()=>{});
        }
      }
      setShowRemovalModal(null);
      setRemovalReason('');
      setToast({ message:'Removal request submitted.', type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleCreateAssessment = async () => {
    if (!assessmentForm.title || !assessmentForm.totalMarks) return;
    setSaving(true);
    try {
      await addAssessment({
        ...assessmentForm,
        batchId: selectedBatch.id, batchName: selectedBatch.name,
        createdBy: profile?.uid || profile?.email || 'unknown', createdByName: profile?.name || '',
        totalMarks: Number(assessmentForm.totalMarks),
        participantStudents: assessmentForm.participantType === 'all'
          ? batchStudents.map(s => ({ id: s.id, name: s.name, phone: s.phone || '' }))
          : batchStudents.filter(s => assessmentForm.participantIds.includes(s.id)).map(s => ({ id: s.id, name: s.name, phone: s.phone || '' })),
      });
      // Notify other conducting staff
      for (const staffDetail of (assessmentForm.conductingStaff || [])) {
        if (staffDetail.uid !== profile?.uid && staffDetail.email) {
          await addNotification({
            toEmail: staffDetail.email, title: 'New Assessment Added',
            body: `${profile?.name} created assessment "${assessmentForm.title}" for ${selectedBatch.name} — you are listed as conducting staff.`,
            type: 'assessment_added', read: false,
          });
          sendAssignmentEmail({
            toEmail: staffDetail.email, toName: staffDetail.name,
            title: `New Assessment: ${assessmentForm.title}`,
            detail: `${profile?.name} created assessment "${assessmentForm.title}" for ${selectedBatch.name} — you are listed as conducting staff.`,
            assignedBy: profile?.name || 'ISC SMS',
          }).catch(()=>{});
        }
      }
      const asmts = await getAssessments(selectedBatch.id);
      setBatchAssessments(asmts);
      setShowCreateAssessment(false);
      setAssessmentForm({ title:'', date:'', totalMarks:'', conductingStaff:[], participantType:'all', participantIds:[] });
      setAssessStudentSearch('');
      setToast({ message:'Assessment created!', type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleImportMarks = async () => {
    if (!marksPreview || !showImportMarks) return;
    setImportingMarks(true);
    try {
      const results = marksPreview.map(row => {
        const scored = Number(row.marks || row.marksScored || row.score || row.marks_scored || 0);
        const total = showImportMarks.totalMarks || 100;
        const pct = Math.round(scored / total * 100);
        return {
          assessmentId: showImportMarks.id,
          assessmentTitle: showImportMarks.title,
          batchId: selectedBatch.id,
          studentName: row.name || row.studentName || row.student_name || '',
          phone: row.phone || row.number || row.phoneNumber || row.phone_number || '',
          marksScored: scored,
          totalMarks: total,
          percentage: pct,
          passed: pct >= 40,
        };
      }).filter(r => r.studentName);
      await saveAssessmentResults(results);
      setMarksPreview(null);
      setShowImportMarks(null);
      setToast({ message:`Imported marks for ${results.length} students!`, type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setImportingMarks(false);
  };

  const handleDeleteAssessment = async (asmt) => {
    setSaving(true);
    try {
      await deleteAssessment(asmt.id);
      const asmts = await getAssessments(selectedBatch.id);
      setBatchAssessments(asmts);
      setToast({ message:'Assessment deleted.', type:'success' });
    } catch (err) {
      setToast({ message:'Error: ' + err.message, type:'error' });
    }
    setSaving(false);
  };

  const handleMarkStepComplete = async (studentId, stepKey, fieldValue) => {
    const flow = selectedBatch?.courseFlow || DEFAULT_COURSE_FLOW;
    const step = flow.find(s => s.key === stepKey);
    const update = {
      [`courseFlow.${stepKey}.done`]:   true,
      [`courseFlow.${stepKey}.doneAt`]: new Date().toISOString(),
    };
    if (fieldValue !== undefined && fieldValue !== '') {
      update[`courseFlow.${stepKey}.value`] = fieldValue;
      // Mirror the captured value to a top-level field so it shows in the
      // student list. VARK keeps its legacy `varkResult` key; any other
      // dropdown step mirrors to a field named after its key.
      if (stepKey === 'vark_analysis') update.varkResult = fieldValue;
      else update[stepKey] = fieldValue;
    }
    await updateStudent(studentId, update);
    loadBatchDetail(selectedBatch);
  };

  const handleRevokeStep = async (studentId, stepKey) => {
    await updateStudent(studentId, { [`courseFlow.${stepKey}.done`]: false, [`courseFlow.${stepKey}.doneAt`]: null });
    loadBatchDetail(selectedBatch);
  };

  const handleAddSchedule = async (e) => {
    e.preventDefault(); setSaving(true);
    const faculty = scheduleForm.facultyName
      ? staffList.find(s => s.name === scheduleForm.facultyName)
      : null;
    // Persist faculty email/uid on the schedule so future notifications
    // don't have to match on the (fragile) name string.
    await addBatchSchedule({
      ...scheduleForm,
      facultyEmail: faculty?.email || '',
      facultyUid:   faculty?.uid || '',
      batchId:selectedBatch.id, batchName:selectedBatch.name,
    });
    // Notify assigned faculty (in-app + email together)
    if (faculty?.email) {
      const when = scheduleForm.recurring
        ? `Every ${scheduleForm.day} at ${scheduleForm.time}`
        : `${scheduleForm.scheduledDate} at ${scheduleForm.time}`;
      notifyStaff({
        toEmail: faculty.email, fromName: profile?.name || 'ISC SMS',
        title: 'Class Scheduled', type: 'schedule', route: '/schedule',
        body: `You have been assigned to "${scheduleForm.title}" — ${when} (${selectedBatch.name})`,
        intro: `Hi ${faculty.name}, a class has been scheduled for you on ISC SMS.`,
        details: [
          { label: 'Class',        value: scheduleForm.title },
          { label: 'Batch',        value: selectedBatch.name },
          { label: 'When',         value: when },
          { label: 'Duration',     value: scheduleForm.duration ? `${scheduleForm.duration} minutes` : '' },
          { label: 'Type',         value: scheduleForm.type },
          { label: 'Meet link',    value: scheduleForm.meetLink },
          { label: 'Notes',        value: scheduleForm.notes },
          { label: 'Scheduled by', value: profile?.name },
        ].filter(d => d.value),
      }).catch(()=>{});
    }
    setToast({ message:'Schedule added!', type:'success' });
    setShowSchedule(false);
    setScheduleForm({ title:'', day:'Monday', scheduledDate:'', recurring:false, time:'', duration:'60', type:'live-class', facultyName:'', meetLink:'', notes:'' });
    const sch = await getBatchSchedules(selectedBatch.id);
    setSchedules(sch); setSaving(false);
  };

  const handleAddTask = async (e) => {
    e.preventDefault(); setSaving(true);
    await addBatchTask({
      ...taskForm,
      assignedStudentIds: taskForm.assignedType === 'specific' ? taskForm.assignedStudentIds : [],
      batchId:selectedBatch.id, batchName:selectedBatch.name, createdBy:profile?.name,
    });
    // Notify the assigned faculty (in-app + email together)
    if (taskForm.assignedFaculty) {
      const staff = staffList.find(s => s.name === taskForm.assignedFaculty);
      if (staff?.email) {
        await notifyStaff({
          toEmail: staff.email, fromName: profile?.name || 'ISC SMS',
          title: 'New Task Assigned', type: 'task_assigned', route: '/batches',
          body: `${profile?.name} assigned you "${taskForm.title}" in batch ${selectedBatch.name}${taskForm.dueDate ? ` (due ${taskForm.dueDate})` : ''}`,
          intro: `Hi ${staff.name}, a new assignment has been created for you on ISC SMS.`,
          details: [
            { label: 'Assignment',  value: taskForm.title },
            { label: 'Batch',       value: selectedBatch.name },
            { label: 'Subject',     value: taskForm.subject },
            { label: 'Description', value: taskForm.description },
            { label: 'Due date',    value: taskForm.dueDate },
            { label: 'Assigned by', value: profile?.name },
          ].filter(d => d.value),
        }).catch(()=>{});
      }
    }
    setToast({ message:'Task created!', type:'success' });
    setShowTask(false);
    setTaskForm({ title:'', subject:'', description:'', dueDate:'', assignedFaculty:'', assignedType:'all', assignedStudentIds:[] });
    setTaskStudentSearch('');
    const tasks = await getBatchTasks(selectedBatch.id);
    setBatchTasks(tasks); setSaving(false);
  };

  const handleSaveTaskEdit = async () => {
    if (!editingTask?.title?.trim()) return;
    await updateBatchTask(editingTask.id, { title: editingTask.title });
    setBatchTasks(prev => prev.map(t => t.id === editingTask.id ? { ...t, title: editingTask.title } : t));
    setEditingTask(null);
    setToast({ message: 'Assignment renamed!', type: 'success' });
  };

  const handleDeleteTask = (task) => {
    setConfirmDialog({
      message: `Delete assignment "${task.title}"? This cannot be undone.`,
      onConfirm: async () => {
        await deleteBatchTask(task.id);
        setBatchTasks(prev => prev.filter(t => t.id !== task.id));
        if (selectedTask === task.id) setSelectedTask(null);
        setToast({ message: 'Assignment deleted.', type: 'success' });
      },
    });
  };

  // ── Helpers ───────────────────────────────────────────────────
  const progress = (batch) => {
    const s = batch.startDate ? new Date(batch.startDate) : null;
    const e = batch.endDate   ? new Date(batch.endDate)   : null;
    if (!s || !e) return 0;
    return Math.min(100, Math.max(0, Math.round((Date.now()-s)/(e-s)*100)));
  };

  const typeColor = (t) => {
    if (t==='live-class') return { bg:'#DBEAFE', col:'#1E40AF', label:'Live Class' };
    if (t==='recorded')   return { bg:'#D1FAE5', col:'#065F46', label:'Recorded' };
    if (t==='assignment') return { bg:'#FEF3C7', col:'#92400E', label:'Assignment' };
    return { bg:'#F3F4F6', col:'#374151', label: t };
  };

  const getFlowAnalytics = () => {
    const flow = selectedBatch?.courseFlow || DEFAULT_COURSE_FLOW;
    return flow.map(step => {
      const completed = batchStudents.filter(s => s.courseFlow?.[step.key]?.done)
        .map(s => ({ ...s, stepFieldValue: s.courseFlow?.[step.key]?.value || '' }));
      const notCompleted = batchStudents.filter(s => !s.courseFlow?.[step.key]?.done);
      return {
        ...step,
        completed: completed.length,
        notCompleted: notCompleted.length,
        total: batchStudents.length,
        pct: batchStudents.length > 0 ? Math.round(completed.length / batchStudents.length * 100) : 0,
        completedStudents: completed,
        notCompletedStudents: notCompleted,
      };
    });
  };

  // detect overdue sessions (scheduled but date/time passed — using schedules with no date we check time vs now)
  const getOverdueSessions = () => {
    const now = new Date();
    return schedules.filter(slot => {
      if (slot.status && slot.status !== 'scheduled') return false; // already marked
      if (!slot.scheduledDate && !slot.date) return false; // no date set, can't determine
      const d = new Date(slot.scheduledDate || slot.date);
      return d < now;
    });
  };

  // Calendar helpers
  const ALL_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const getSlotsForDate = (date, scheds) => {
    // Use local date to avoid UTC shift (toISOString shifts timezone)
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    const dateStr = `${y}-${m}-${d}`;
    const dayName = ALL_DAYS[date.getDay()];
    return scheds.filter(s => {
      if (s.scheduledDate) return s.scheduledDate === dateStr;
      return s.day === dayName;
    }).sort((a,b) => (a.time||'').localeCompare(b.time||''));
  };

  const getWeekDates = (refDate) => {
    const d = new Date(refDate);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(monday);
      dd.setDate(monday.getDate() + i);
      return dd;
    });
  };

  const getMonthDates = (refDate) => {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mon=0
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      cells.push({ date: d, inMonth: false });
    }
    for (let i = 1; i <= totalDays; i++) {
      cells.push({ date: new Date(year, month, i), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last);
      d.setDate(last.getDate() + 1);
      cells.push({ date: d, inMonth: false });
    }
    return cells;
  };

  const slotPillColor = (slot) => {
    if (slot.status === 'completed')   return { bg:'var(--green-soft)', col:'var(--green-ink)' };
    if (slot.status === 'cancelled')   return { bg:'var(--red-soft)',   col:'var(--red-ink)' };
    if (slot.status === 'rescheduled') return { bg:'var(--amber-soft)', col:'var(--amber-ink)' };
    return { bg:'var(--teal-soft)', col:'var(--teal-ink)' };
  };

  if (loading) return <Loading/>;

  // ══════════════════════════════════════════════════════════════
  // BATCH DETAIL VIEW
  // ══════════════════════════════════════════════════════════════
  if (selectedBatch) {
    const count = batchCounts[selectedBatch.id] || batchStudents.length;
    const pct   = progress(selectedBatch);
    const schedByDay = {};
    DAYS.forEach(d => { schedByDay[d] = schedules.filter(s => s.day === d); });
    const batchFlow = selectedBatch.courseFlow || DEFAULT_COURSE_FLOW;
    const batchFields = selectedBatch.studentFields || DEFAULT_STUDENT_FIELDS;
    const batchSubjects = selectedBatch.subjects || [];
    const batchStaffDetails = selectedBatch.staffDetails || [];
    const flowAnalytics = getFlowAnalytics();
    const fullyOnboarded = batchStudents.filter(s => batchFlow.every(step => s.courseFlow?.[step.key]?.done)).length;
    const overdueSessions = getOverdueSessions();
    const datePassed = selectedBatch.endDate && new Date(selectedBatch.endDate) < new Date();
    // The CEO controls active/expired via the status dropdown. A batch is
    // "active" (editable — can add students/tasks/assessments) only when its
    // status is 'active'; the date-passed flag only shows an "Expired" hint.
    const isActive = selectedBatch.status === 'active';
    const isExpired = datePassed && !isActive;
    const isMentorOrCEOAdmin = isCEOorAdmin || selectedBatch.mentorId === profile?.uid;

    // Task split panel data
    // Students actually assigned to a given task (all, or a specific subset).
    const assignedStudentsFor = (task) =>
      (task?.assignedType === 'specific' && task?.assignedStudentIds?.length)
        ? batchStudents.filter(s => task.assignedStudentIds.includes(s.id))
        : batchStudents;
    const currentTask = selectedTask ? batchTasks.find(t => t.id === selectedTask) : null;
    const currentTaskStudents = assignedStudentsFor(currentTask);
    const taskStudents = currentTaskStudents.filter(s => {
      if (!currentTask) return false;
      const submitted = currentTask.submittedBy?.find(x => x.studentId === s.id);
      if (taskFilter === 'submitted') return !!submitted;
      if (taskFilter === 'pending')   return !submitted;
      return true;
    }).filter(s => !taskSearch || s.name?.toLowerCase().includes(taskSearch.toLowerCase()) || s.phone?.includes(taskSearch));

    return (
      <div style={{ position: 'relative' }}>
        {/* Backdrop for step panel */}
        {selectedStep && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 999 }} onClick={() => setSelectedStep(null)} />
        )}
        <OnboardingStepPanel step={selectedStep} onClose={() => setSelectedStep(null)} onMarkComplete={handleMarkStepComplete} onRevoke={handleRevokeStep} onToast={setToast} />

        {/* Header */}
        <div className="page-header">
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { if (location.state?.batchId) { navigate(-1); } else { setSelectedBatch(null); } setConfirmDialog(null); }}><ArrowLeft size={16}/></button>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>{selectedBatch.name}</h2>
                {isCEOorAdmin ? (
                  <select
                    value={selectedBatch.status || 'upcoming'}
                    onChange={async e => {
                      const newStatus = e.target.value;
                      await updateBatch(selectedBatch.id, { status: newStatus });
                      const updated = { ...selectedBatch, status: newStatus };
                      setSelectedBatch(updated);
                      setBatches(prev => prev.map(b => b.id === updated.id ? updated : b));
                      setToast({ message: `Batch marked as ${newStatus}`, type: 'success' });
                    }}
                    style={{
                      fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600,
                      border:'1px solid #E5E7EB', cursor:'pointer',
                      background: selectedBatch.status==='active' ? '#D1FAE5' : selectedBatch.status==='completed' ? '#E5E7EB' : '#DBEAFE',
                      color: selectedBatch.status==='active' ? '#065F46' : selectedBatch.status==='completed' ? '#6B7280' : '#1E40AF',
                    }}
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                  </select>
                ) : (
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background: selectedBatch.status==='active'?'#D1FAE5':'#DBEAFE', color: selectedBatch.status==='active'?'#065F46':'#1E40AF', fontWeight:600 }}>
                    {selectedBatch.status || 'upcoming'}
                  </span>
                )}
                {isExpired && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'#E5E7EB', color:'#6B7280', fontWeight:600 }}>Expired</span>}
                {isCEOorAdmin && (
                  <button onClick={() => { setDatesForm({ startDate: selectedBatch.startDate || '', endDate: selectedBatch.endDate || '', courseDurationMonths: selectedBatch.courseDurationMonths || '' }); setShowDates(true); }}
                    title="Edit course duration"
                    style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'var(--brand-50)', color:'var(--brand)', fontWeight:600, border:'none', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4 }}>
                    <Settings size={11}/> Duration
                  </button>
                )}
              </div>
              <div style={{ fontSize:13, color:'#6B7280' }}>
                {selectedBatch.course}
                {selectedBatch.courseDurationMonths ? ` · ${selectedBatch.courseDurationMonths} months` : ''}
                {selectedBatch.startDate ? ` · ${new Date(selectedBatch.startDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} ` : ''}
                {selectedBatch.endDate   ? ` ${new Date(selectedBatch.endDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}` : ''}
                {' · '}{count} students
                {selectedBatch.mentorName ? ` · Mentor: ${selectedBatch.mentorName}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {isCEOorAdmin && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditFlow([...batchFlow]); setShowFlowConfig(true); }}><Settings size={13}/> Course Flow</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditFields([...batchFields]); setShowFieldConfig(true); }}><Settings size={13}/> Student Fields</button>
              </>
            )}
            {activeTab === 'assessments' && isActive && (
              <button className="btn btn-primary" onClick={() => setShowCreateAssessment(true)}><Plus size={14}/> Add Assessment</button>
            )}
            {activeTab === 'students' && isActive && (
              <>
                <button className="btn btn-ghost" onClick={() => setShowBulk(true)}><Upload size={14}/> Bulk CSV</button>
                <button className="btn btn-primary" onClick={() => setShowAddStudent(true)}><UserPlus size={14}/> Add Student</button>
                {profile?.role === 'ceo' && batchStudents.length > 0 && (
                  <button
                    className="btn btn-sm"
                    style={{ background:'#FEF3C7', color:'#92400E', border:'1px solid #FDE68A' }}
                    onClick={() => setConfirmDialog({ message: `Delete ALL ${batchStudents.length} students from this batch? They will be moved to Trash and can be restored.`, onConfirm: async () => {
                      setSaving(true);
                      try {
                        for (const s of batchStudents) {
                          await addDoc(collection(db,'trash'), { type:'student', originalId:s.id, data:s, deletedAt:serverTimestamp(), deletedBy:profile?.uid||profile?.email||'unknown' });
                          await deleteDoc(doc(db,'students', s.id));
                        }
                        setToast({ message:`${batchStudents.length} students moved to trash.`, type:'success' });
                        await loadBatchDetail(selectedBatch);
                        const c = await getBatchStudentCount(selectedBatch.id, scope);
                        setBatchCounts(prev => ({ ...prev, [selectedBatch.id]: c }));
                      } catch (err) {
                        setToast({ message:'Error: ' + err.message, type:'error' });
                      }
                      setSaving(false);
                    }})}
                  >
                    <Trash2 size={13}/> Delete All
                  </button>
                )}
              </>
            )}
            {activeTab === 'tasks' && isActive && (
              <button className="btn btn-primary" onClick={() => setShowTask(true)}><Plus size={14}/> Add Task</button>
            )}
            {profile?.role === 'ceo' && (
              <button
                className="btn btn-sm"
                style={{ background:'#EF4444', color:'#fff', border:'none' }}
                onClick={() => setConfirmDialog({ message: 'Delete this batch? All student data will be archived and can be restored from Trash.', onConfirm: handleDeleteBatch })}
              >
                <Trash2 size={13}/> Delete Batch
              </button>
            )}
          </div>
        </div>

        {/* Batch info strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:16 }}>
          {[
            { label:'Total Students',  value:count,                                                              color:'var(--blue-ink)',    bg:'var(--blue-soft)' },
            { label:'Active',          value:batchStudents.filter(s=>s.status==='active').length,                color:'var(--green-ink)',   bg:'var(--green-soft)' },
            { label:'At Risk',         value:batchStudents.filter(s=>s.status==='at-risk').length,               color:'var(--red-ink)',     bg:'var(--red-soft)' },
            { label:'Onboarding Done', value:fullyOnboarded,                                                     color:'var(--violet-ink)', bg:'var(--violet-soft)' },
            { label:'Course Progress', value:`${pct}%`,                                                          color:'var(--brand)',       bg:'var(--brand-50)' },
          ].map(c => (
            <div key={c.label} style={{ background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', padding:'12px 16px', boxShadow:'var(--shadow-xs)' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4, fontWeight:500 }}>{c.label}</div>
              <div style={{ fontSize:22, fontWeight:700, color:c.color, fontFamily:'var(--font-display)' }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="tab-bar" style={{ marginBottom:16 }}>
          {[
            { key:'students',    label:`Students (${count})`               },
            { key:'onboarding',  label:'Onboarding Analytics'              },
            { key:'tasks',       label:`Assignments (${batchTasks.length})` },
            { key:'assessments', label:`Assessments (${batchAssessments.length})` },
            { key:'staff',       label:`Staff (${batchStaffDetails.filter(s => s.uid !== selectedBatch.mentorId).length + (selectedBatch.mentorId ? 1 : 0)})` },
          ].map(t => (
            <div key={t.key} className={`tab ${activeTab===t.key?'active':''}`} onClick={() => { setActiveTab(t.key); setSelectedTask(null); }}>
              {t.label}
            </div>
          ))}
        </div>

        {/* ── STUDENTS TAB ── */}
        {activeTab === 'students' && (() => {
          const PAGE = 20;
          // Columns to show (configurable via "Show in list"); Name/Status/Onboarding/View are permanent.
          const listFields = batchFields.filter(f => f.key !== 'name' &&
            (f.showInList !== undefined ? f.showInList : DEFAULT_LIST_KEYS.includes(f.key)));
          // Course-flow steps flagged "Show selected value in student table".
          // Rendered as read-only columns that pull the captured onboarding
          // value straight from courseFlow — works for custom steps and shows
          // already-marked values retroactively. The default VARK step is
          // skipped here because it already mirrors to the varkResult field.
          const flowCols = batchFlow.filter(step => step.displayInTable && step.key !== 'vark_analysis');
          const joinDateOf = (s) => { if (s.joiningDate) return s.joiningDate; if (s.joinDate) return s.joinDate; if (!s.createdAt?.seconds) return ''; const d = new Date(s.createdAt.seconds*1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
          const filtered = batchStudents.filter(s => {
            if (studentStatusFilter && s.status !== studentStatusFilter) return false;
            if (studentJoinFrom && joinDateOf(s) < studentJoinFrom) return false;
            if (studentJoinTo   && joinDateOf(s) > studentJoinTo)   return false;
            if (!studentSearch) return true;
            const q = studentSearch.toLowerCase();
            return (
              s.name?.toLowerCase().includes(q) ||
              s.phone?.includes(studentSearch) ||
              s.whatsappNumber?.includes(studentSearch) ||
              s.fatherName?.toLowerCase().includes(q) ||
              s.motherName?.toLowerCase().includes(q) ||
              s.email?.toLowerCase().includes(q) ||
              s.address?.toLowerCase().includes(q) ||
              s.occupation?.toLowerCase().includes(q) ||
              s.classStd?.toLowerCase().includes(q) ||
              s.schoolName?.toLowerCase().includes(q) ||
              s.varkResult?.toLowerCase().includes(q) ||
              s.syllabus?.toLowerCase().includes(q) ||
              s.gender?.toLowerCase().includes(q) ||
              String(s.age||'').includes(studentSearch)
            );
          });
          const pages = Math.ceil(filtered.length / PAGE);
          const paginated = filtered.slice(studentPage * PAGE, (studentPage + 1) * PAGE);

          return (
            <div>
              <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                <input className="form-input" style={{ flex:2, minWidth:200 }} placeholder="Search by name, phone, parent, VARK, class, school..."
                  value={studentSearch} onChange={e => { setStudentSearch(e.target.value); setStudentPage(0); }}/>
                <select className="form-input" style={{ flex:1, minWidth:140 }}
                  value={studentStatusFilter} onChange={e => { setStudentStatusFilter(e.target.value); setStudentPage(0); }}>
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="moderate">Moderate</option>
                  <option value="at-risk">At Risk</option>
                  <option value="dropped">Dropped</option>
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:6 }} title="Filter by joining date">
                  <span style={{ fontSize:11.5, color:'#6B7280' }}>Joined</span>
                  <input type="date" className="form-input" style={{ width:'auto' }} value={studentJoinFrom} onChange={e => { setStudentJoinFrom(e.target.value); setStudentPage(0); }}/>
                  <span style={{ fontSize:11.5, color:'#6B7280' }}>→</span>
                  <input type="date" className="form-input" style={{ width:'auto' }} value={studentJoinTo} onChange={e => { setStudentJoinTo(e.target.value); setStudentPage(0); }}/>
                  {(studentJoinFrom || studentJoinTo) && <button className="btn btn-ghost btn-sm" onClick={() => { setStudentJoinFrom(''); setStudentJoinTo(''); }}>Clear</button>}
                </div>
                <div style={{ display:'flex', alignItems:'center', fontSize:12, color:'#6B7280', whiteSpace:'nowrap' }}>
                  {filtered.length} of {batchStudents.length} students
                </div>
                <button className="btn btn-secondary" style={{ whiteSpace:'nowrap' }} onClick={() => {
                  const cols = ['name','fatherName','motherName','phone','whatsappNumber','email','classStd','schoolName','varkResult','syllabus','gender','age','status'];
                  const esc = (v) => {
                    const s = v == null ? '' : String(v);
                    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
                  };
                  const csv = [cols.join(','), ...filtered.map(s => cols.map(c => esc(s[c])).join(','))].join('\r\n');
                  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `students-${selectedBatch.name}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}>
                  <Download size={14}/> Export CSV
                </button>
              </div>

              <div className="table-container" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Kids Name</th>
                      {listFields.map(f => <th key={f.key}>{f.label}</th>)}
                      {flowCols.map(step => <th key={step.key}>{step.fieldLabel || step.label}</th>)}
                      <th>Status</th>
                      <th>Onboarding</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr><td colSpan={listFields.length + flowCols.length + 4} style={{ textAlign:'center', padding:40, color:'#6B7280' }}>
                        {studentSearch || studentStatusFilter ? 'No students match your filter.' : 'No students yet.'}
                        {!studentSearch && !studentStatusFilter && (
                          <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12 }}>
                            <button className="btn btn-ghost" onClick={() => setShowBulk(true)}><Upload size={13}/> Import CSV</button>
                            <button className="btn btn-primary" onClick={() => setShowAddStudent(true)}><UserPlus size={13}/> Add Manually</button>
                          </div>
                        )}
                      </td></tr>
                    )}
                    {paginated.map(s => {
                      const flowDone = batchFlow.filter(step => s.courseFlow?.[step.key]?.done).length;
                      const onboardDone = batchFlow.length > 0 && flowDone === batchFlow.length;
                      return (
                        <tr key={s.id}>
                          <td style={{ fontSize:13 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <Avatar name={s.name||'?'} size="sm"/>
                              <div style={{ fontWeight:500 }}>{s.name||'—'}</div>
                            </div>
                          </td>
                          {listFields.map(f => (
                            <td key={f.key} style={{ fontSize:12.5 }}>
                              {f.type === 'select' ? (
                                <select
                                  value={s[f.key] ?? ''}
                                  onChange={async e => { await updateStudent(s.id, { [f.key]: e.target.value }); }}
                                  className="form-input" style={{ fontSize:12, height:30, padding:'0 6px', minWidth:110 }}>
                                  <option value="">—</option>
                                  {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <input
                                  defaultValue={s[f.key] ?? ''}
                                  onBlur={async e => {
                                    const val = e.target.value.trim();
                                    if (val !== (s[f.key] ?? '')) await updateStudent(s.id, { [f.key]: val });
                                  }}
                                  style={{ border:'1px solid transparent', borderRadius:6, padding:'2px 6px', fontSize:12.5, width:'100%', minWidth:80, background:'transparent', cursor:'text' }}
                                  onFocus={e => { e.target.style.borderColor='#E5E7EB'; e.target.style.background='#fff'; }}
                                  onBlurCapture={e => { e.target.style.borderColor='transparent'; e.target.style.background='transparent'; }}
                                  placeholder="—"
                                />
                              )}
                            </td>
                          ))}
                          {flowCols.map(step => (
                            <td key={step.key} style={{ fontSize:12.5, color:'var(--text-sub)' }}>
                              {s.courseFlow?.[step.key]?.value || '—'}
                            </td>
                          ))}
                          <td>
                            <select
                              value={s.status||'active'}
                              onChange={async e => {
                                await updateStudent(s.id, { status: e.target.value });
                                await loadBatchDetail(selectedBatch);
                              }}
                              style={{ fontSize:11, padding:'2px 6px', borderRadius:8, border:'1px solid #E5E7EB', fontWeight:600, cursor:'pointer',
                                background: s.status==='active'?'#D1FAE5':s.status==='at-risk'?'#FEE2E2':s.status==='dropped'?'#F3F4F6':'#FEF3C7',
                                color: s.status==='active'?'#065F46':s.status==='at-risk'?'#991B1B':s.status==='dropped'?'#6B7280':'#92400E' }}>
                              <option value="active">Active</option>
                              <option value="moderate">Moderate</option>
                              <option value="at-risk">At Risk</option>
                              <option value="dropped">Dropped</option>
                            </select>
                          </td>
                          <td>
                            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background:onboardDone?'#D1FAE5':'#FEF3C7', color:onboardDone?'#065F46':'#92400E' }}>
                              {flowDone}/{batchFlow.length} {onboardDone ? '' : ''}
                            </span>
                          </td>
                          <td style={{ display:'flex', gap:4, alignItems:'center' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/students/${s.id}`, { state: { fromBatchId: selectedBatch.id } })}>View <ChevronRight size={12}/></button>
                            {profile?.role === 'ceo' && (
                              <button className="btn btn-sm" style={{ background:'#FEE2E2', color:'#EF4444', border:'none', padding:'4px 8px' }}
                                onClick={() => setDeleteStudentConfirm(s)}><Trash2 size={12}/></button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pages > 1 && (
                <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:14 }}>
                  <button className="btn btn-ghost btn-sm" disabled={studentPage===0} onClick={() => setStudentPage(p => p-1)}>Prev</button>
                  {Array.from({length:Math.min(pages, 7)}, (_,i) => (
                    <button key={i} className={`btn btn-sm ${studentPage===i?'btn-primary':'btn-ghost'}`} onClick={() => setStudentPage(i)}>{i+1}</button>
                  ))}
                  {pages > 7 && <span style={{ alignSelf:'center', fontSize:12, color:'#9CA3AF' }}>...{pages} total</span>}
                  <button className="btn btn-ghost btn-sm" disabled={studentPage===pages-1} onClick={() => setStudentPage(p => p+1)}>Next </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ONBOARDING ANALYTICS TAB ── */}
        {activeTab === 'onboarding' && (() => {
          const onboardingSteps = flowAnalytics.filter(s => s.phase === 'onboarding');
          const courseSteps = flowAnalytics.filter(s => s.phase === 'course');
          const overallPct = flowAnalytics.length > 0
            ? Math.round(flowAnalytics.reduce((sum, s) => sum + s.pct, 0) / flowAnalytics.length)
            : 0;
          const stillOnboarding = batchStudents.filter(s => !batchFlow.every(step => s.courseFlow?.[step.key]?.done)).length;
          const avgSteps = batchStudents.length > 0
            ? (flowAnalytics.reduce((sum, s) => sum + s.completed, 0) / batchStudents.length).toFixed(1)
            : '0.0';
          const barColor = (pct) => pct >= 66 ? 'var(--green)' : pct >= 33 ? 'var(--amber)' : pct > 0 ? 'var(--brand)' : 'var(--n-300)';

          const StepRow = ({ step, globalIdx }) => (
            <div
              onClick={() => setSelectedStep(step)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px', cursor:'pointer', transition:'background 0.12s', position:'relative', zIndex:1 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <div style={{ flexShrink:0, width:30, height:30, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700,
                background: step.completed > 0 ? 'var(--brand)' : 'var(--surface-sunken)',
                color: step.completed > 0 ? '#fff' : 'var(--text-muted)',
                border: `2px solid ${step.completed > 0 ? 'var(--brand)' : 'var(--border)'}`,
              }}>
                {globalIdx + 1}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:600, color:'var(--text)', marginBottom:5 }}>{step.label}</div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ flex:1, height:6, background:'var(--n-150)', borderRadius:3, maxWidth:320, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${step.pct}%`, background:barColor(step.pct), borderRadius:3, transition:'width 0.4s' }} />
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:'var(--text-sub)', whiteSpace:'nowrap' }}>{step.pct}%</span>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text-sub)', whiteSpace:'nowrap' }}>{step.completed}/{step.total}</span>
                {step.notCompleted > 0 && (
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'var(--red-soft)', color:'var(--red-ink)', fontWeight:600, whiteSpace:'nowrap' }}>
                    {step.notCompleted} pending
                  </span>
                )}
                <span style={{ fontSize:12, color:'var(--brand)', fontWeight:600 }}>View ›</span>
              </div>
            </div>
          );

          const PhaseGroup = ({ label, steps }) => (
            <div style={{ marginBottom:0 }}>
              <div style={{ padding:'8px 20px', fontSize:11, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', textTransform:'uppercase', background:'var(--n-50)', borderTop:'1px solid var(--border)' }}>
                {label}
              </div>
              <div style={{ position:'relative' }}>
                <div style={{ position:'absolute', left:34, top:0, bottom:0, width:2, background:'var(--border)', zIndex:0 }} />
                {steps.map((step) => <StepRow key={step.key} step={step} globalIdx={flowAnalytics.indexOf(step)} />)}
              </div>
            </div>
          );

          return (
            <div>
              {/* Hero row */}
              <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:12, marginBottom:16 }}>
                <div style={{ background:'var(--grad-mesh)', borderRadius:18, padding:'24px 28px', color:'#fff', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:-60, right:-40, width:200, height:200, borderRadius:'50%', background:'rgba(255,255,255,0.06)', pointerEvents:'none' }} />
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.07em', color:'rgba(255,255,255,0.7)', textTransform:'uppercase', marginBottom:10 }}>
                    OVERALL ONBOARDING
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:12, marginBottom:16 }}>
                    <span style={{ fontSize:46, fontWeight:700, fontFamily:'var(--font-display)', lineHeight:1 }}>{overallPct}%</span>
                    <span style={{ fontSize:14, color:'rgba(255,255,255,0.75)', paddingBottom:4 }}>
                      {fullyOnboarded} of {count} fully onboarded
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:3, marginBottom:12 }}>
                    {flowAnalytics.map((step) => (
                      <div key={step.key} style={{ flex:1, height:8, borderRadius:4, background: step.completed > 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.22)' }} />
                    ))}
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.65)' }}>
                    {batchFlow.length} steps · {avgSteps} avg steps completed per student
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <div style={{ flex:1, background:'var(--surface)', borderRadius:14, border:'1px solid var(--border)', padding:'18px 20px', boxShadow:'var(--shadow-xs)', display:'flex', alignItems:'center', gap:14 }}>
                    <div style={{ width:40, height:40, borderRadius:12, background:'var(--green-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <CheckCircle size={20} style={{ color:'var(--green)' }} />
                    </div>
                    <div>
                      <div style={{ fontSize:24, fontWeight:700, fontFamily:'var(--font-display)', color:'var(--text)' }}>{fullyOnboarded}/{count}</div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Fully onboarded</div>
                    </div>
                  </div>
                  <div style={{ flex:1, background:'var(--surface)', borderRadius:14, border:'1px solid var(--border)', padding:'18px 20px', boxShadow:'var(--shadow-xs)', display:'flex', alignItems:'center', gap:14 }}>
                    <div style={{ width:40, height:40, borderRadius:12, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Clock size={20} style={{ color:'var(--amber)' }} />
                    </div>
                    <div>
                      <div style={{ fontSize:24, fontWeight:700, fontFamily:'var(--font-display)', color:'var(--text)' }}>{stillOnboarding}</div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Still in onboarding</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Funnel list */}
              <div style={{ background:'var(--surface)', borderRadius:16, border:'1px solid var(--border)', overflow:'hidden', boxShadow:'var(--shadow-sm)' }}>
                <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ fontWeight:700, fontSize:15, color:'var(--text)' }}>Onboarding funnel</div>
                  <div style={{ display:'flex', gap:14, fontSize:12, color:'var(--text-muted)' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--brand)', display:'inline-block' }} />
                      Onboarding
                    </span>
                    <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--teal)', display:'inline-block' }} />
                      Course
                    </span>
                  </div>
                </div>
                {onboardingSteps.length > 0 && <PhaseGroup label="Onboarding Phase" steps={onboardingSteps} />}
                {courseSteps.length > 0 && <PhaseGroup label="Course Phase" steps={courseSteps} />}
                {flowAnalytics.length === 0 && (
                  <div style={{ padding:48, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
                    No course flow steps configured. Click "Course Flow" to add steps.
                  </div>
                )}
              </div>
            </div>
          );
        })()}


        {/* ── TASKS / ASSIGNMENTS TAB ── Split Panel ── */}
        {activeTab === 'tasks' && (
          <div style={{ display: 'flex', gap: 14, minHeight: 500 }}>
            {/* Left: KPI + Task list */}
            <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* KPI boxes — clickable filters */}
              {batchTasks.length > 0 && (() => {
                const taskTotal = (t) => assignedStudentsFor(t).length || 1;
                const completedTasks = batchTasks.filter(t => (t.submittedBy?.length||0) >= taskTotal(t)).length;
                const pendingTasks   = batchTasks.length - completedTasks;
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:4 }}>
                    {[
                      { key:'all',       label:'All Assignments', value:batchTasks.length,  bg:'var(--blue-soft)',   col:'var(--blue-ink)' },
                      { key:'completed', label:'Fully Done',      value:completedTasks,      bg:'var(--green-soft)', col:'var(--green-ink)' },
                      { key:'pending',   label:'In Progress',     value:pendingTasks,        bg:'var(--amber-soft)', col:'var(--amber-ink)' },
                      { key:'overdue',   label:'Overdue',         value:batchTasks.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date()&&(t.submittedBy?.length||0)<taskTotal(t)).length, bg:'var(--red-soft)', col:'var(--red-ink)' },
                    ].map(k => (
                      <div key={k.key} onClick={() => setTaskKpiFilter(k.key)}
                        style={{ background:k.bg, borderRadius:10, padding:'10px 12px', cursor:'pointer', border:`2px solid ${taskKpiFilter===k.key?k.col:'transparent'}`, transition:'all 0.15s' }}>
                        <div style={{ fontSize:20, fontWeight:700, color:k.col, fontFamily:'var(--font-display)' }}>{k.value}</div>
                        <div style={{ fontSize:11, color:k.col, fontWeight:500 }}>{k.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Search + staff filter */}
              {batchTasks.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:2 }}>
                  <input className="form-input" style={{ fontSize:12.5, height:34 }} placeholder="Search assignments…"
                    value={taskListSearch} onChange={e => setTaskListSearch(e.target.value)}/>
                  {isCEOorAdmin && (
                    <select className="form-input" style={{ fontSize:12.5, height:34 }} value={taskStaffFilter} onChange={e => setTaskStaffFilter(e.target.value)}>
                      <option value="">All staff</option>
                      {[...new Set(batchTasks.map(t => t.assignedFaculty).filter(Boolean))].map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {batchTasks.length === 0 && (
                <div style={{ background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', padding:32, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
                  No assignments yet. Click "Add Task".
                </div>
              )}
              {batchTasks.filter(task => {
                // Staff see only assignments assigned to them; CEO/admin see all.
                if (!isCEOorAdmin && task.assignedFaculty && task.assignedFaculty !== profile?.name) return false;
                // CEO staff filter
                if (taskStaffFilter && task.assignedFaculty !== taskStaffFilter) return false;
                // text search
                if (taskListSearch) {
                  const q = taskListSearch.toLowerCase();
                  if (!task.title?.toLowerCase().includes(q) && !task.subject?.toLowerCase().includes(q) && !task.assignedFaculty?.toLowerCase().includes(q)) return false;
                }
                if (taskKpiFilter === 'all') return true;
                if (taskKpiFilter === 'completed') return (task.submittedBy?.length||0) >= assignedStudentsFor(task).length;
                if (taskKpiFilter === 'pending')   return (task.submittedBy?.length||0) < assignedStudentsFor(task).length;
                if (taskKpiFilter === 'overdue')   return task.dueDate && new Date(task.dueDate)<new Date() && (task.submittedBy?.length||0)<assignedStudentsFor(task).length;
                return true;
              }).map(task => {
                const submitted = task.submittedBy?.length || 0;
                const total = assignedStudentsFor(task).length || 1;
                const pctDone = Math.round(submitted / total * 100);
                const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && submitted < total;
                const isSelected = selectedTask === task.id;
                return (
                  <div key={task.id} style={{ position:'relative' }}>
                    {/* Edit inline */}
                    {editingTask?.id === task.id ? (
                      <div style={{ background:'var(--surface)', borderRadius:10, border:'2px solid var(--brand)', padding:'10px 12px', display:'flex', gap:6 }}>
                        <input
                          className="form-input"
                          style={{ flex:1, fontSize:12, height:32 }}
                          value={editingTask.title}
                          onChange={e => setEditingTask({ ...editingTask, title: e.target.value })}
                          onKeyDown={e => { if(e.key==='Enter') handleSaveTaskEdit(); if(e.key==='Escape') setEditingTask(null); }}
                          autoFocus
                        />
                        <button className="btn btn-primary btn-sm" onClick={handleSaveTaskEdit}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingTask(null)}></button>
                      </div>
                    ) : (
                      <div
                        onClick={() => { setSelectedTask(task.id); setTaskFilter('all'); setTaskSearch(''); }}
                        style={{
                          background: isSelected ? 'var(--n-800)' : 'var(--surface)',
                          borderRadius:10, border:`2px solid ${isSelected?'var(--brand)':isOverdue?'var(--red-soft)':'var(--border)'}`,
                          padding:'11px 12px', cursor:'pointer', transition:'all 0.15s',
                        }}
                      >
                        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:4 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:isSelected?'#fff':'var(--text)', marginBottom:4, flex:1 }}>{task.title}</div>
                          <div style={{ display:'flex', gap:3, flexShrink:0 }} onClick={e => e.stopPropagation()}>
                            <button title="Rename" onClick={() => setEditingTask({ id:task.id, title:task.title })}
                              style={{ background:'transparent', border:'none', cursor:'pointer', color:isSelected?'rgba(255,255,255,0.5)':'var(--text-muted)', padding:2, borderRadius:4, lineHeight:1 }}>
                              <Pencil size={12}/>
                            </button>
                            <button title="Delete" onClick={() => handleDeleteTask(task)}
                              style={{ background:'transparent', border:'none', cursor:'pointer', color:isSelected?'#FCA5A5':'var(--red)', padding:2, borderRadius:4, lineHeight:1 }}>
                              <Trash2 size={12}/>
                            </button>
                          </div>
                        </div>
                        {task.subject && (
                          <span style={{ fontSize:10, padding:'1px 7px', borderRadius:10, background:isSelected?'rgba(255,255,255,0.15)':'var(--indigo-soft)', color:isSelected?'#fff':'var(--indigo-ink)', fontWeight:600, marginBottom:4, display:'inline-block' }}>
                            {task.subject}
                          </span>
                        )}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:6 }}>
                          <div style={{ height:4, flex:1, background:isSelected?'rgba(255,255,255,0.15)':'var(--n-150)', borderRadius:2, overflow:'hidden', marginRight:8 }}>
                            <div style={{ height:'100%', width:`${pctDone}%`, background:pctDone===100?'var(--green)':'var(--amber)', transition:'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize:11, fontWeight:700, color:isSelected?'#fff':(pctDone===100?'var(--green-ink)':'var(--amber-ink)'), whiteSpace:'nowrap' }}>
                            {pctDone===100?'All done':`${submitted}/${total}`}
                          </span>
                        </div>
                        {isOverdue && <div style={{ fontSize:10, color:isSelected?'#FCA5A5':'var(--red)', marginTop:4, fontWeight:600 }}>Overdue</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right: Task detail */}
            <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px', boxShadow: 'var(--shadow-xs)' }}>
              {!currentTask ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 12 }}>
                  <CheckSquare size={40} style={{ color: 'var(--border)' }} />
                  <div style={{ fontSize: 14 }}>Select an assignment to view details</div>
                </div>
              ) : (
                <>
                  {/* Task header */}
                  <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 4 }}>{currentTask.title}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {currentTask.subject && <span className="badge badge-violet">{currentTask.subject}</span>}
                      {currentTask.assignedFaculty && <span className="badge badge-blue">{currentTask.assignedFaculty}</span>}
                      {currentTask.dueDate && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Due: {currentTask.dueDate}</span>}
                    </div>
                    {currentTask.description && <div style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.6 }}>{currentTask.description}</div>}
                    {currentTask.assignedType === 'specific' && (
                      <div style={{ marginTop: 8 }}>
                        <span className="badge badge-amber">Assigned to {currentTaskStudents.length} specific student{currentTaskStudents.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {/* All done banner */}
                    {(currentTask.submittedBy?.length || 0) >= currentTaskStudents.length && currentTaskStudents.length > 0 && (
                      <div style={{ marginTop: 12, padding: '10px 16px', background: 'var(--green-soft)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CheckCircle size={16} style={{ color: 'var(--green-ink)', flexShrink:0 }} />
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--green-ink)', fontSize: 14 }}>All assigned students completed this!</div>
                          <div style={{ fontSize: 12, color: 'var(--green-ink)' }}>Everyone assigned has submitted.</div>
                        </div>
                      </div>
                    )}
                    {/* Submission stats */}
                    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                      {[
                        { label: 'Submitted', value: currentTask.submittedBy?.length || 0, color: 'var(--green-ink)', bg: 'var(--green-soft)' },
                        { label: 'Pending',   value: currentTaskStudents.length - (currentTask.submittedBy?.length || 0), color: 'var(--amber-ink)', bg: 'var(--amber-soft)' },
                        { label: 'Assigned',  value: currentTaskStudents.length, color: 'var(--blue-ink)', bg: 'var(--blue-soft)' },
                      ].map(s => (
                        <div key={s.label} style={{ padding: '10px 16px', borderRadius: 10, background: s.bg, textAlign: 'center', flex:1 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily:'var(--font-display)' }}>{s.value}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop:2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Filters + search + bulk */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {['all', 'pending', 'submitted'].map(f => (
                      <button
                        key={f}
                        onClick={() => setTaskFilter(f)}
                        style={{
                          padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                          background: taskFilter === f ? 'var(--brand)' : 'var(--n-100)',
                          color: taskFilter === f ? '#fff' : 'var(--text-muted)',
                          textTransform: 'capitalize',
                        }}
                      >{f === 'all' ? 'Show All' : f}</button>
                    ))}
                    <div style={{ flex: 1, position: 'relative', minWidth: 160 }}>
                      <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                      <input
                        className="form-input"
                        style={{ paddingLeft: 28, fontSize: 12 }}
                        placeholder="Search student..."
                        value={taskSearch}
                        onChange={e => setTaskSearch(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-sm"
                      style={{ background: '#E53935', color: '#fff', border: 'none', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={async () => {
                        const pending = batchStudents.filter(s => !currentTask.submittedBy?.find(x => x.studentId === s.id));
                        for (const s of pending) {
                          await markTaskSubmitted(currentTask.id, s.id, s.name);
                        }
                        const tasks = await getBatchTasks(selectedBatch.id);
                        setBatchTasks(tasks);
                        setSelectedTask(currentTask.id);
                        setToast({ message: 'All students marked!', type: 'success' });
                      }}
                    >
                      Mark All Submitted
                    </button>
                  </div>

                  {/* Student table */}
                  <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
                          {['Student', 'Phone', 'Status', ''].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {taskStudents.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF' }}>No students match.</td></tr>
                        )}
                        {taskStudents.map((s, idx) => {
                          const submittedEntry = currentTask.submittedBy?.find(x => x.studentId === s.id);
                          return (
                            <tr key={s.id} style={{ background: idx % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                              <td style={{ padding: '9px 10px', fontWeight: 500 }}>{s.name}</td>
                              <td style={{ padding: '9px 10px', color: '#6B7280' }}>{s.phone || '—'}</td>
                              <td style={{ padding: '9px 10px' }}>
                                <span style={{
                                  fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600,
                                  background: submittedEntry ? '#D1FAE5' : '#FEF3C7',
                                  color: submittedEntry ? '#065F46' : '#92400E',
                                }}>
                                  {submittedEntry ? 'Submitted' : 'Pending'}
                                </span>
                              </td>
                              <td style={{ padding: '9px 10px' }}>
                                {s.status === 'dropped' ? (
                                  <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' }}>Dropped</span>
                                ) : !submittedEntry ? (
                                  <button
                                    className="btn btn-sm"
                                    style={{ fontSize: 11, background: '#D1FAE5', color: '#065F46', border: 'none' }}
                                    onClick={async () => {
                                      await markTaskSubmitted(currentTask.id, s.id, s.name);
                                      const tasks = await getBatchTasks(selectedBatch.id);
                                      setBatchTasks(tasks);
                                    }}
                                  >Mark Done</button>
                                ) : (
                                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{submittedEntry.submittedAt?.slice(0, 10)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── STAFF TAB ── */}
        {activeTab === 'staff' && (() => {
          // Build staff rows: mentor first, then staffDetails
          const mentorEntry = selectedBatch.mentorId ? {
            uid: selectedBatch.mentorId, name: selectedBatch.mentorName || '—',
            phone: '', email: '', subjects: [], isMentor: true,
          } : null;
          const staffRows = [
            ...(mentorEntry ? [mentorEntry] : []),
            ...(batchStaffDetails.filter(s => s.uid !== selectedBatch.mentorId).map(s => ({ ...s, isMentor: false }))),
          ];

          return (
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <h3 style={{ fontSize:15, fontWeight:700 }}>Staff & Mentor</h3>
                {isMentorOrCEOAdmin && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowAddStaff(true)}><Plus size={13}/> Add Staff</button>
                )}
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th>Phone</th><th>Email</th><th>Subjects</th><th>Role</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffRows.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign:'center', color:'#9CA3AF', padding:32 }}>No staff assigned yet.</td></tr>
                    )}
                    {staffRows.map(s => (
                      <tr key={s.uid}>
                        <td style={{ fontWeight:600 }}>{s.name}</td>
                        <td style={{ color:'#6B7280' }}>{s.phone||'—'}</td>
                        <td style={{ color:'#6B7280' }}>{s.email||'—'}</td>
                        <td style={{ color:'#6B7280' }}>{(s.subjects||[]).length ? (s.subjects||[]).map(x => (typeof x === 'object' ? (x.name || '') : x)).filter(Boolean).join(', ') || '—' : '—'}</td>
                        <td>
                          {s.isMentor
                            ? <span style={{ fontSize:11, padding:'2px 9px', borderRadius:10, background:'#FEF3C7', color:'#92400E', fontWeight:700 }}>Mentor</span>
                            : <span style={{ fontSize:11, padding:'2px 9px', borderRadius:10, background:'#DBEAFE', color:'#1E40AF', fontWeight:600 }}>Staff</span>
                          }
                        </td>
                        <td style={{ display:'flex', gap:6 }}>
                          {profile?.role === 'ceo' && !s.isMentor && (
                            <button className="btn btn-sm" style={{ background:'#FEE2E2', color:'#EF4444', border:'none' }}
                              onClick={() => setConfirmDialog({ message: `Remove ${s.name} from this batch?`, onConfirm: () => handleRemoveStaffFromBatch(s.uid) })}>
                              Remove
                            </button>
                          )}
                          {s.uid === profile?.uid && !s.isMentor && (
                            <button className="btn btn-sm btn-ghost"
                              onClick={() => setShowRemovalModal({ uid: s.uid, name: s.name, targetType: 'batch', targetId: selectedBatch.id, targetName: selectedBatch.name })}>
                              Request Removal
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── ASSESSMENTS TAB ── */}
        {activeTab === 'assessments' && (
          <div>
            {batchAssessments.length === 0 && (
              <div style={{ background:'#fff', borderRadius:14, border:'1px solid #E5E7EB', padding:48, textAlign:'center', color:'#9CA3AF' }}>
                <div style={{ fontSize:32, marginBottom:8 }}></div>
                <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>No assessments yet</div>
                <div style={{ fontSize:13, marginBottom:16 }}>Create an exam or test for this batch</div>
                <button className="btn btn-primary" onClick={() => setShowCreateAssessment(true)}><Plus size={14}/> Add Assessment</button>
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {batchAssessments.map(asmt => {
                const staffNames = (asmt.conductingStaff||[]).map(s => s.name||s).join(', ');
                return (
                  <div key={asmt.id} style={{ background:'#fff', borderRadius:12, border:'1px solid #E5E7EB', padding:'16px 20px', display:'flex', alignItems:'center', gap:16, boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:'#1A1A2E', marginBottom:4 }}>{asmt.title}</div>
                      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                        {asmt.date && <span style={{ fontSize:12, color:'#6B7280' }}>{asmt.date}</span>}
                        <span style={{ fontSize:12, color:'#6B7280' }}>Total Marks: <strong>{asmt.totalMarks}</strong></span>
                        {staffNames && <span style={{ fontSize:12, color:'#6B7280' }}>Staff: {staffNames}</span>}
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'#EDE9FE', color:'#6D28D9', fontWeight:600 }}>Exam</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      {/* Status toggle */}
                      <select value={asmt.status||'upcoming'}
                        onChange={async e => {
                          const ns = e.target.value;
                          await updateDoc(doc(db,'assessments',asmt.id), { status: ns });
                          const asmts = await getAssessments(selectedBatch.id);
                          setBatchAssessments(asmts);
                        }}
                        style={{ fontSize:11, padding:'2px 8px', borderRadius:8, border:'1px solid #E5E7EB', cursor:'pointer', fontWeight:600,
                          background: asmt.status==='completed' ? '#D1FAE5' : '#DBEAFE',
                          color: asmt.status==='completed' ? '#065F46' : '#1E40AF' }}>
                        <option value="upcoming">Upcoming</option>
                        <option value="completed">Completed</option>
                      </select>
                      <button className="btn btn-ghost btn-sm" onClick={async () => {
                        const results = await getAssessmentResults(asmt.id);
                        setAssessmentResults(prev => ({ ...prev, [asmt.id]: results }));
                        setShowViewResults(asmt);
                      }}>View Results</button>
                      <button className="btn btn-sm" style={{ background:'#EFF6FF', color:'#1E40AF', border:'none' }}
                        onClick={() => { setShowImportMarks(asmt); setMarksPreview(null); }}>
                        <Upload size={12}/> Import Marks
                      </button>
                      {profile?.role === 'ceo' && (
                        <button className="btn btn-sm" style={{ background:'#FEE2E2', color:'#EF4444', border:'none' }}
                          onClick={() => setConfirmDialog({ message:`Delete assessment "${asmt.title}"?`, onConfirm: () => handleDeleteAssessment(asmt) })}>
                          <Trash2 size={12}/>
                        </button>
                      )}
                      {/* Staff request removal — only when assessment not yet completed */}
                      {(asmt.conductingStaff||[]).some(s => s.uid === profile?.uid) && profile?.role !== 'ceo' && asmt.status !== 'completed' && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setShowRemovalModal({ uid: profile?.uid, name: profile?.name, targetType:'assessment', targetId:asmt.id, targetName:asmt.title })}>
                          Request Removal
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MODALS ── */}

        {/* Create Assessment Modal */}
        {showCreateAssessment && (
          <Modal title={`Add Assessment — ${selectedBatch.name}`} onClose={() => setShowCreateAssessment(false)} wide persistent>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div className="form-group">
                <label className="form-label">Assessment Title *</label>
                <input className="form-input" placeholder="e.g. Mid-Term Exam, Unit Test 1..." value={assessmentForm.title}
                  onChange={e => setAssessmentForm(f => ({ ...f, title:e.target.value }))}/>
              </div>
              <FormRow>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" value={assessmentForm.date}
                    onChange={e => setAssessmentForm(f => ({ ...f, date:e.target.value }))}/>
                </div>
                <div className="form-group">
                  <label className="form-label">Total Marks *</label>
                  <input className="form-input" type="number" placeholder="e.g. 100" value={assessmentForm.totalMarks}
                    onChange={e => setAssessmentForm(f => ({ ...f, totalMarks:e.target.value }))}/>
                </div>
              </FormRow>
              <div className="form-group">
                <label className="form-label">Conducting Staff (select all involved)</label>
                <div style={{ border:'1px solid #E5E7EB', borderRadius:8, maxHeight:180, overflowY:'auto', padding:4 }}>
                  {[...(selectedBatch.staffDetails||[]), ...(selectedBatch.mentorId ? [{ uid:selectedBatch.mentorId, name:selectedBatch.mentorName, email:'' }] : [])].map(s => {
                    const isSelected = (assessmentForm.conductingStaff||[]).some(x => x.uid === s.uid);
                    return (
                      <div key={s.uid} onClick={() => setAssessmentForm(f => ({
                        ...f, conductingStaff: isSelected
                          ? (f.conductingStaff||[]).filter(x => x.uid !== s.uid)
                          : [...(f.conductingStaff||[]), { uid:s.uid, name:s.name, email:s.email||'' }]
                      }))} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:6, cursor:'pointer', background: isSelected ? '#EFF6FF' : 'transparent', marginBottom:2 }}>
                        <input type="checkbox" readOnly checked={isSelected}/>
                        <div style={{ fontSize:13, fontWeight: isSelected ? 600 : 400 }}>{s.name}</div>
                      </div>
                    );
                  })}
                  {(selectedBatch.staffDetails||[]).length === 0 && !selectedBatch.mentorId && (
                    <div style={{ fontSize:12, color:'#9CA3AF', padding:8 }}>No staff assigned to this batch yet.</div>
                  )}
                </div>
              </div>

              {/* Participants — all students or a specific selection */}
              <div className="form-group">
                <label className="form-label">Students</label>
                <div className="segmented" style={{ marginBottom:10 }}>
                  <button type="button" className={assessmentForm.participantType==='all'?'active':''}
                    onClick={() => setAssessmentForm(f => ({ ...f, participantType:'all', participantIds:[] }))}>
                    All {batchStudents.length} students
                  </button>
                  <button type="button" className={assessmentForm.participantType==='specific'?'active':''}
                    onClick={() => setAssessmentForm(f => ({ ...f, participantType:'specific' }))}>
                    Select specific students
                  </button>
                </div>
                {assessmentForm.participantType === 'specific' && (
                  <>
                    <input className="form-input" placeholder="Type to filter by name or phone…" style={{ marginBottom:8 }}
                      value={assessStudentSearch} onChange={e => setAssessStudentSearch(e.target.value)}/>
                    <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:6, maxHeight:220, overflowY:'auto' }}>
                      {batchStudents
                        .filter(s => !assessStudentSearch || s.name?.toLowerCase().includes(assessStudentSearch.toLowerCase()) || (s.phone||'').includes(assessStudentSearch))
                        .map(s => {
                          const checked = assessmentForm.participantIds.includes(s.id);
                          return (
                            <label key={s.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'6px 8px', cursor:'pointer', borderRadius:6, background: checked ? 'var(--brand-50)' : 'transparent' }}>
                              <input type="checkbox" checked={checked}
                                onChange={e => setAssessmentForm(f => ({ ...f, participantIds: e.target.checked ? [...f.participantIds, s.id] : f.participantIds.filter(id => id !== s.id) }))}/>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:500 }}>{s.name}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.phone || 'no phone'}{s.course ? ` · ${s.course}` : ''}{s.education ? ` · ${s.education}` : ''}</div>
                              </div>
                            </label>
                          );
                        })}
                      {batchStudents.length === 0 && <div style={{ fontSize:12, color:'var(--text-muted)', padding:8 }}>No students in this batch.</div>}
                    </div>
                    {assessmentForm.participantIds.length > 0 && (
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:6 }}>{assessmentForm.participantIds.length} selected</div>
                    )}
                  </>
                )}
              </div>

              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowCreateAssessment(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!assessmentForm.title || !assessmentForm.totalMarks || saving} onClick={handleCreateAssessment}>
                  {saving ? 'Creating...' : 'Create Assessment'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* View Results Modal */}
        {showViewResults && (
          <Modal title={`Results — ${showViewResults.title}`} onClose={() => setShowViewResults(null)} wide>
            <div style={{ marginBottom:12, fontSize:13, color:'#6B7280' }}>
              Total Marks: <strong>{showViewResults.totalMarks}</strong> · Date: {showViewResults.date||'—'}
            </div>
            {(() => {
              const results = assessmentResults[showViewResults.id] || [];
              if (results.length === 0) return <div style={{ color:'#9CA3AF', textAlign:'center', padding:32 }}>No marks imported yet.</div>;
              return (
                <div className="table-container" style={{ maxHeight:360, overflowY:'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Student Name</th><th>Phone</th><th>Marks</th><th>%</th><th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr key={r.id||i}>
                          <td style={{ color:'#9CA3AF' }}>{i+1}</td>
                          <td style={{ fontWeight:600 }}>{r.studentName}</td>
                          <td style={{ color:'#6B7280' }}>{r.phone||'—'}</td>
                          <td style={{ fontWeight:700 }}>{r.marksScored} / {r.totalMarks}</td>
                          <td>{r.percentage}%</td>
                          <td>
                            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600,
                              background: r.passed ? '#D1FAE5' : '#FEE2E2',
                              color: r.passed ? '#065F46' : '#991B1B' }}>
                              {r.passed ? 'Pass' : 'Fail'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:16 }}>
              <button className="btn btn-ghost" onClick={() => setShowViewResults(null)}>Close</button>
            </div>
          </Modal>
        )}

        {/* Import Marks Modal */}
        {showImportMarks && (
          <Modal title={`Import Marks — ${showImportMarks.title}`} onClose={() => { setShowImportMarks(null); setMarksPreview(null); }} wide>
            <div style={{ padding:'10px 14px', background:'#DBEAFE', borderRadius:8, fontSize:12, color:'#1E40AF', marginBottom:14, lineHeight:1.6 }}>
              ℹUpload a CSV with columns: <strong>name</strong> (student name), <strong>phone</strong> (number), <strong>marks</strong> (marks scored).<br/>
              Pass mark is 40% of total marks ({Math.round((showImportMarks.totalMarks||100)*0.4)} out of {showImportMarks.totalMarks}).
            </div>
            <input ref={marksFileRef} type="file" accept=".csv" style={{ display:'none' }}
              onChange={async e => {
                const t = await e.target.files[0]?.text();
                if (t) setMarksPreview(parseCSV(t, null));
              }}/>
            <div onClick={() => marksFileRef.current.click()} style={{ border:'2px dashed #E5E7EB', borderRadius:10, padding:'24px', textAlign:'center', cursor:'pointer', background:'#FAFAFA', marginBottom:14 }}>
              <Upload size={22} style={{ color:'#9CA3AF', marginBottom:6 }}/>
              <div style={{ fontSize:13, fontWeight:500 }}>{marksPreview ? `${marksPreview.length} rows loaded` : 'Click to upload CSV'}</div>
            </div>
            {marksPreview && (
              <div className="table-container" style={{ maxHeight:200, overflowY:'auto', marginBottom:12 }}>
                <table>
                  <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Marks Scored</th><th>Result</th></tr></thead>
                  <tbody>
                    {marksPreview.slice(0,10).map((r, i) => {
                      const scored = Number(r.marks || r.marksScored || r.score || 0);
                      const pct = Math.round(scored / (showImportMarks.totalMarks||100) * 100);
                      return (
                        <tr key={i}>
                          <td style={{ color:'#9CA3AF' }}>{i+1}</td>
                          <td style={{ fontWeight:500 }}>{r.name||r.studentName||'—'}</td>
                          <td style={{ color:'#6B7280' }}>{r.phone||r.number||'—'}</td>
                          <td style={{ fontWeight:700 }}>{scored} / {showImportMarks.totalMarks}</td>
                          <td><span style={{ fontSize:11, padding:'2px 6px', borderRadius:8, fontWeight:600,
                            background: pct>=40?'#D1FAE5':'#FEE2E2', color: pct>=40?'#065F46':'#991B1B' }}>{pct>=40?'Pass':'Fail'}</span></td>
                        </tr>
                      );
                    })}
                    {marksPreview.length > 10 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#6B7280', padding:8 }}>...{marksPreview.length-10} more</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowImportMarks(null); setMarksPreview(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={!marksPreview || importingMarks} onClick={handleImportMarks}>
                {importingMarks ? 'Importing...' : `Import ${marksPreview?.length||0} Results`}
              </button>
            </div>
          </Modal>
        )}

        {/* Delete Student Confirm */}
        {deleteStudentConfirm && (
          <Modal title="Delete Student" onClose={() => setDeleteStudentConfirm(null)}>
            <p style={{ fontSize:14, color:'#374151', marginBottom:20 }}>
              Are you sure you want to delete <strong>{deleteStudentConfirm.name}</strong>?
              They will be moved to Trash and can be restored.
            </p>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteStudentConfirm(null)}>Cancel</button>
              <button className="btn btn-sm" style={{ background:'#EF4444', color:'#fff', border:'none' }}
                disabled={saving} onClick={() => handleDeleteStudent(deleteStudentConfirm)}>
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </Modal>
        )}

        {/* Add Staff Modal */}
        {showAddStaff && (
          <Modal title={`Add Staff to ${selectedBatch.name}`} onClose={() => { setShowAddStaff(false); setSelectedStaffIds([]); setStaffSearch(''); }} persistent>
            <input className="form-input" placeholder="Search staff..." style={{ marginBottom:12 }}
              value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
            <div style={{ maxHeight:280, overflowY:'auto', display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
              {staffList.filter(s => s.active !== false && (!staffSearch || s.name?.toLowerCase().includes(staffSearch.toLowerCase()) || s.phone?.includes(staffSearch))).map(s => (
                <div key={s.id} onClick={() => setSelectedStaffIds(prev => prev.includes(s.id) ? prev.filter(x=>x!==s.id) : [...prev, s.id])}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:8, cursor:'pointer',
                    background: selectedStaffIds.includes(s.id) ? '#EFF6FF' : '#F9FAFB',
                    border: `1px solid ${selectedStaffIds.includes(s.id) ? '#3B82F6' : '#E5E7EB'}` }}>
                  <input type="checkbox" readOnly checked={selectedStaffIds.includes(s.id)} style={{ marginRight:4 }}/>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13 }}>{s.name} ({s.phone || 'no phone'})</div>
                    <div style={{ fontSize:11, color:'#9CA3AF' }}>{s.role}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowAddStaff(false); setSelectedStaffIds([]); }}>Cancel</button>
              <button className="btn btn-primary" disabled={!selectedStaffIds.length || saving} onClick={handleAddStaffToBatch}>
                {saving ? 'Saving...' : `Add ${selectedStaffIds.length} Staff`}
              </button>
            </div>
          </Modal>
        )}

        {/* Removal Request Modal */}
        {showRemovalModal && (
          <Modal title="Request Removal" onClose={() => { setShowRemovalModal(null); setRemovalReason(''); }} persistent>
            <p style={{ fontSize:14, color:'#374151', marginBottom:12 }}>
              Request removal from <strong>{showRemovalModal.targetName}</strong>. Reason:
            </p>
            <textarea className="form-input" rows={3} placeholder="Explain reason..."
              value={removalReason} onChange={e => setRemovalReason(e.target.value)} style={{ marginBottom:16 }}/>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowRemovalModal(null); setRemovalReason(''); }}>Cancel</button>
              <button className="btn btn-primary" disabled={!removalReason.trim() || saving} onClick={handleSubmitRemovalRequest}>
                {saving ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </Modal>
        )}

        {/* Add Student */}
        {showAddStudent && (
          <Modal title={`Add Student to ${selectedBatch.name}`} onClose={() => setShowAddStudent(false)} wide persistent>
            <form onSubmit={handleAddStudent} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div className="form-grid-2">
                {batchFields.map(f => (
                  <div key={f.key} className="form-group">
                    <label className="form-label">{f.label}{f.required?' *':''}</label>
                    <input className="form-input" type={f.type||'text'} required={f.required}
                      value={studentForm[f.key]||''} onChange={e => setStudentForm({...studentForm,[f.key]:e.target.value})}/>
                  </div>
                ))}
                <div className="form-group">
                  <label className="form-label">Join Date</label>
                  <input className="form-input" type="date" value={studentForm.joinDate||''} onChange={e => setStudentForm({...studentForm,joinDate:e.target.value})}/>
                </div>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddStudent(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Adding...':'Add to Batch'}</button>
              </div>
            </form>
          </Modal>
        )}

        {/* Bulk Import */}
        {showBulk && (
          <Modal title={`Bulk Import into ${selectedBatch.name}`} onClose={() => { setShowBulk(false); setCsvPreview(null); }} wide>
            <div style={{ padding:'10px 14px', background:'#FEF3C7', borderRadius:8, fontSize:12, color:'#92400E', marginBottom:14, lineHeight:1.6 }}>
              <strong>Important:</strong> The CSV column order must match the app field order exactly, OR use the downloaded template.<br/>
              Column names are matched by name (case-insensitive), but the order should match to avoid mismatches.<br/>
              If your CSV has a <strong>Timestamp</strong> column, the date will be auto-captured as the joining date.<br/>
              Expected columns: <strong>{batchFields.map(f=>f.label).join(', ')}</strong>
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate(selectedBatch.name, batchFields)}>
                <Download size={13}/> Download CSV Template
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }}
              onChange={async e => { const t = await e.target.files[0]?.text(); if(t) setCsvPreview(parseCSV(t, selectedBatch.studentFields || DEFAULT_STUDENT_FIELDS)); }}/>
            <div onClick={() => fileRef.current.click()} style={{ border:'2px dashed #E5E7EB', borderRadius:10, padding:'24px', textAlign:'center', cursor:'pointer', background:'#FAFAFA', marginBottom:14 }}>
              <Upload size={22} style={{ color:'#9CA3AF', marginBottom:6 }}/>
              <div style={{ fontSize:13, fontWeight:500 }}>{csvPreview?`${csvPreview.length} rows loaded`:'Click to upload CSV'}</div>
            </div>
            {csvPreview && (
              <div className="table-container" style={{ maxHeight:180, overflow:'auto', marginBottom:12 }}>
                <table>
                  <thead><tr><th>#</th>{batchFields.slice(0,4).map(f=><th key={f.key}>{f.label}</th>)}</tr></thead>
                  <tbody>
                    {csvPreview.slice(0,6).map((r,i)=>(
                      <tr key={i}><td style={{ color:'#9CA3AF' }}>{i+1}</td>{batchFields.slice(0,4).map(f=><td key={f.key} style={{ fontSize:12 }}>{r[f.key]||'—'}</td>)}</tr>
                    ))}
                    {csvPreview.length>6&&<tr><td colSpan={5} style={{ textAlign:'center', color:'#6B7280', padding:8 }}>...{csvPreview.length-6} more</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowBulk(false); setCsvPreview(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleBulkImport} disabled={!csvPreview||importing}>
                {importing?'Importing...':`Import ${csvPreview?.length||0} Students`}
              </button>
            </div>
          </Modal>
        )}

        {/* Course Flow Config */}
        {showFlowConfig && (
          <Modal title={`Configure Course Flow — ${selectedBatch.name}`} onClose={() => setShowFlowConfig(false)} wide persistent>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
              {editFlow.map((step, idx) => {
                const upd = (patch) => { const u=[...editFlow]; u[idx]={...u[idx],...patch}; setEditFlow(u); };
                return (
                  <div key={idx} style={{ background:'#F9FAFB', borderRadius:10, border:'1px solid #E5E7EB', padding:'10px 12px' }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom: (step.fieldType && step.fieldType !== 'none') ? 8 : 0 }}>
                      <span style={{ width:22, height:22, borderRadius:'50%', background:'#E53935', color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{idx+1}</span>
                      <input className="form-input" style={{ flex:2 }} placeholder="Step name" value={step.label}
                        onChange={e => upd({ label: e.target.value })}/>
                      <select className="form-input" style={{ flex:1 }} value={step.phase} onChange={e => upd({ phase: e.target.value })}>
                        {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select className="form-input" style={{ flex:1 }} value={step.fieldType||'none'}
                        onChange={e => upd({ fieldType: e.target.value, fieldOptions: e.target.value === 'dropdown' ? (step.fieldOptions||[]) : [] })}>
                        <option value="none">No field</option>
                        <option value="note">Note (textarea)</option>
                        <option value="text">Text input</option>
                        <option value="dropdown">Dropdown</option>
                      </select>
                      <button className="btn btn-ghost btn-sm" style={{ color:'#EF4444' }} onClick={() => setEditFlow(editFlow.filter((_,i)=>i!==idx))}><Trash2 size={13}/></button>
                    </div>
                    {step.fieldType && step.fieldType !== 'none' && (
                      <div style={{ paddingLeft:30, display:'flex', flexDirection:'column', gap:6 }}>
                        <input className="form-input" style={{ fontSize:12 }} placeholder="Field label (e.g. VARK Learning Style)"
                          value={step.fieldLabel||''} onChange={e => upd({ fieldLabel: e.target.value })}/>
                        {step.fieldType === 'dropdown' && (
                          <>
                            <div style={{ fontSize:11, color:'#6B7280' }}>Options (one per line):</div>
                            <textarea className="form-input" rows={3} style={{ fontSize:11 }}
                              value={(step.fieldOptions||[]).join('\n')}
                              onChange={e => upd({ fieldOptions: e.target.value.split('\n') })}
                              placeholder={'Option 1\nOption 2\nOption 3'}/>
                            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
                              <input type="checkbox" checked={!!step.displayInTable}
                                onChange={e => upd({ displayInTable: e.target.checked })}/>
                              Show selected value in student table
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom:16 }}
              onClick={() => setEditFlow([...editFlow, { key:generateKey('step'), label:'New Step', phase:'course', fieldType:'none' }])}>
              <Plus size={13}/> Add Step
            </button>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowFlowConfig(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveFlowConfig} disabled={saving}>{saving?'Saving...':'Save Flow'}</button>
            </div>
          </Modal>
        )}

        {/* Student Fields Config */}
        {showFieldConfig && (
          <Modal title={`Configure Student Fields — ${selectedBatch.name}`} onClose={() => setShowFieldConfig(false)} wide persistent>
            <div style={{ fontSize:12.5, color:'var(--text-sub)', marginBottom:12, background:'var(--brand-50)', padding:'8px 12px', borderRadius:8 }}>
              Tick <strong>Show in list</strong> to display that field as a column in the students table.
              The <strong>Kids Name</strong>, <strong>Status</strong>, <strong>Onboarding</strong> and <strong>View</strong> columns are always shown.
              Use the <strong>↑ ↓</strong> arrows to reorder fields — always reorder this way, never by renaming labels
              (each field's data is tied to its permanent <em>id</em>, not its label). Removing a field hides its column but
              keeps data already saved for existing students, viewable on each student's profile.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
              {editFields.map((field, idx) => (
                <div key={field.key} style={{ display:'flex', flexDirection:'column', gap:6, padding:'8px 12px', background:'#F9FAFB', borderRadius:8 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <div style={{ display:'flex', flexDirection:'column' }}>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ height:16, padding:0 }} disabled={idx===0}
                        title="Move up" onClick={() => moveEditField(idx, -1)}><ChevronUp size={14}/></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ height:16, padding:0 }} disabled={idx===editFields.length-1}
                        title="Move down" onClick={() => moveEditField(idx, 1)}><ChevronDown size={14}/></button>
                    </div>
                    <div style={{ flex:2, display:'flex', flexDirection:'column', gap:2 }}>
                      <input className="form-input" placeholder="Label" value={field.label}
                        onChange={e => { const u=[...editFields]; u[idx]={...u[idx],label:e.target.value}; setEditFields(u); }}/>
                      <span style={{ fontSize:10, color:'#9CA3AF', paddingLeft:2 }}>
                        id: {field.key}{field.key==='name' ? ' · required student name' : ''}
                      </span>
                    </div>
                    <select className="form-input" style={{ flex:1 }} value={field.type||'text'}
                      onChange={e => { const u=[...editFields]; u[idx]={...u[idx],type:e.target.value}; setEditFields(u); }}>
                      {['text','email','tel','number','date','select'].map(t=><option key={t} value={t}>{t === 'select' ? 'select (dropdown)' : t}</option>)}
                    </select>
                    <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, whiteSpace:'nowrap' }}>
                      <input type="checkbox" checked={field.key==='name' ? true : (field.required||false)}
                        disabled={field.key==='name'}
                        onChange={e => { const u=[...editFields]; u[idx]={...u[idx],required:e.target.checked}; setEditFields(u); }}/> Required
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, whiteSpace:'nowrap' }}>
                      <input type="checkbox" checked={field.key==='name' ? true : (field.showInList !== undefined ? field.showInList : DEFAULT_LIST_KEYS.includes(field.key))}
                        disabled={field.key==='name'}
                        onChange={e => { const u=[...editFields]; u[idx]={...u[idx],showInList:e.target.checked}; setEditFields(u); }}/> Show in list
                    </label>
                    <button className="btn btn-ghost btn-sm" style={{ color:'#EF4444' }} disabled={field.key==='name'} onClick={() => removeEditField(idx)}><Trash2 size={13}/></button>
                  </div>
                  {field.type === 'select' && (
                    <div style={{ paddingLeft:2 }}>
                      <div style={{ fontSize:11, color:'#6B7280', marginBottom:3 }}>Dropdown options (one per line):</div>
                      <textarea className="form-input" rows={3} style={{ fontSize:12 }}
                        value={(field.options||[]).join('\n')}
                        onChange={e => { const u=[...editFields]; u[idx]={...u[idx], options: e.target.value.split('\n')}; setEditFields(u); }}
                        placeholder={'Option 1\nOption 2\nOption 3'}/>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom:16 }} onClick={() => setEditFields([...editFields, { key:generateKey('field'), label:'New Field', required:false, type:'text' }])}>
              <Plus size={13}/> Add Field
            </button>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowFieldConfig(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveFieldConfig} disabled={saving}>{saving?'Saving...':'Save Fields'}</button>
            </div>
          </Modal>
        )}

        {/* Edit course duration (CEO controls active/expired via dates + status) */}
        {showDates && (
          <Modal title={`Course Duration — ${selectedBatch.name}`} onClose={() => setShowDates(false)} persistent>
            <div style={{ fontSize:12.5, color:'var(--text-sub)', marginBottom:14, background:'var(--brand-50)', padding:'8px 12px', borderRadius:8 }}>
              Set the course start &amp; end dates. A batch counts as <strong>Expired</strong> once its end date passes and its status isn't <strong>Active</strong>. Keep the status <strong>Active</strong> (top of the page) to keep adding students, tasks &amp; assessments even past the end date.
            </div>
            <FormRow>
              <div className="form-group"><label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={datesForm.startDate} onChange={e => setDatesForm(f => ({ ...f, startDate:e.target.value, endDate: addMonthsToDate(e.target.value, f.courseDurationMonths) }))}/></div>
              <div className="form-group"><label className="form-label">End Date <span style={{ fontWeight:400, color:'var(--text-muted)', fontSize:11 }}>(auto)</span></label>
                <input className="form-input" type="date" value={datesForm.endDate} readOnly tabIndex={-1}
                  style={{ background:'var(--surface-sunken)', cursor:'not-allowed' }}
                  title="Calculated automatically from start date + duration"/></div>
            </FormRow>
            <div className="form-group"><label className="form-label">Course Duration (months)</label>
              <input className="form-input" type="number" min="0" value={datesForm.courseDurationMonths} onChange={e => setDatesForm(f => ({ ...f, courseDurationMonths:e.target.value, endDate: addMonthsToDate(f.startDate, e.target.value) }))}/></div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
              <button className="btn btn-ghost" onClick={() => setShowDates(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveDates} disabled={saving}>{saving?'Saving...':'Save Duration'}</button>
            </div>
          </Modal>
        )}

        {/* Subject Config */}
        {showSubjectConfig && (
          <Modal title={`Configure Subjects — ${selectedBatch.name}`} onClose={() => setShowSubjectConfig(false)} wide persistent>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
              {editSubjects.map((sub, idx) => (
                <div key={idx} style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 12px', background:'#F9FAFB', borderRadius:8 }}>
                  <input className="form-input" style={{ flex:2 }} placeholder="Subject name" value={sub.name}
                    onChange={e => { const u=[...editSubjects]; u[idx]={...u[idx],name:e.target.value}; setEditSubjects(u); }}/>
                  <select className="form-input" style={{ flex:2 }} value={sub.facultyName||''}
                    onChange={e => { const u=[...editSubjects]; u[idx]={...u[idx],facultyName:e.target.value}; setEditSubjects(u); }}>
                    <option value="">Select Faculty</option>
                    {(selectedBatch.faculties||[]).map((f,i)=><option key={i}>{f}</option>)}
                    {staffList.filter(s=>s.active!==false).map(s=><option key={s.id}>{s.name}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" style={{ color:'#EF4444' }} onClick={() => setEditSubjects(editSubjects.filter((_,i)=>i!==idx))}><Trash2 size={13}/></button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom:16 }} onClick={() => setEditSubjects([...editSubjects, { name:'', facultyName:'' }])}>
              <Plus size={13}/> Add Subject
            </button>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowSubjectConfig(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveSubjectConfig} disabled={saving}>{saving?'Saving...':'Save Subjects'}</button>
            </div>
          </Modal>
        )}

        {/* Add Task / Assignment */}
        {showTask && (
          <Modal title="Create Assignment / Task" onClose={() => setShowTask(false)} persistent>
            <form onSubmit={handleAddTask} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div className="form-group"><label className="form-label">Task Title *</label><input className="form-input" required placeholder="e.g. Complete Chapter 3 exercises" value={taskForm.title} onChange={e=>setTaskForm({...taskForm,title:e.target.value})}/></div>
              <FormRow>
                <div className="form-group">
                  <label className="form-label">Subject</label>
                  <select className="form-input" value={taskForm.subject} onChange={e=>setTaskForm({...taskForm,subject:e.target.value})}>
                    <option value="">Select subject</option>
                    {[...new Set((selectedBatch.staffDetails||[]).flatMap(s => (s.subjects||[]).map(x => typeof x==='object'?x.name:x)).filter(Boolean))].map((sub,i) => (
                      <option key={i} value={sub}>{sub}</option>
                    ))}
                    {(selectedBatch.subjects||[]).filter(s => s.name).map((s,i)=><option key={`bs-${i}`} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Assigned Faculty</label>
                  <select className="form-input" value={taskForm.assignedFaculty} onChange={e=>setTaskForm({...taskForm,assignedFaculty:e.target.value})}>
                    <option value="">Select faculty</option>
                    {staffList.filter(s=>s.active!==false&&s.role!=='ceo').map(s=><option key={s.id} value={s.name}>{s.name}{s.email?` — ${s.email}`:''}</option>)}
                  </select>
                </div>
              </FormRow>
              <div className="form-group"><label className="form-label">Description / Instructions</label><textarea className="form-input" rows={3} value={taskForm.description} onChange={e=>setTaskForm({...taskForm,description:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={taskForm.dueDate} onChange={e=>setTaskForm({...taskForm,dueDate:e.target.value})}/></div>

              {/* Assign to all or specific students — different students can get different tasks */}
              <div className="form-group">
                <label className="form-label">Assign To</label>
                <div className="segmented" style={{ marginBottom:10 }}>
                  <button type="button" className={taskForm.assignedType==='all'?'active':''}
                    onClick={() => setTaskForm(f => ({ ...f, assignedType:'all', assignedStudentIds:[] }))}>
                    All {batchStudents.length} students
                  </button>
                  <button type="button" className={taskForm.assignedType==='specific'?'active':''}
                    onClick={() => setTaskForm(f => ({ ...f, assignedType:'specific' }))}>
                    Specific students
                  </button>
                </div>
                {taskForm.assignedType === 'specific' && (
                  <>
                    <input className="form-input" placeholder="Type to filter by name or phone…" style={{ marginBottom:8 }}
                      value={taskStudentSearch} onChange={e => setTaskStudentSearch(e.target.value)}/>
                    <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:6, maxHeight:200, overflowY:'auto' }}>
                      {batchStudents
                        .filter(s => !taskStudentSearch || s.name?.toLowerCase().includes(taskStudentSearch.toLowerCase()) || (s.phone||'').includes(taskStudentSearch))
                        .map(s => {
                          const checked = taskForm.assignedStudentIds.includes(s.id);
                          return (
                            <label key={s.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'6px 8px', cursor:'pointer', borderRadius:6, background: checked ? 'var(--brand-50)' : 'transparent' }}>
                              <input type="checkbox" checked={checked}
                                onChange={e => setTaskForm(f => ({ ...f, assignedStudentIds: e.target.checked ? [...f.assignedStudentIds, s.id] : f.assignedStudentIds.filter(id => id !== s.id) }))}/>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:500 }}>{s.name}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.phone || 'no phone'}{s.course ? ` · ${s.course}` : ''}</div>
                              </div>
                            </label>
                          );
                        })}
                      {batchStudents.length === 0 && <div style={{ fontSize:12, color:'var(--text-muted)', padding:8 }}>No students in this batch.</div>}
                    </div>
                    {taskForm.assignedStudentIds.length > 0 && (
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:6 }}>{taskForm.assignedStudentIds.length} student(s) will get this assignment</div>
                    )}
                  </>
                )}
              </div>

              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowTask(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Creating...':'Create Task'}</button>
              </div>
            </form>
          </Modal>
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}

        {/* In-app confirmation dialog (batch detail) */}
        {confirmDialog && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
            onClick={e => { if (e.target === e.currentTarget) setConfirmDialog(null); }}>
            <div style={{ background:'#fff', borderRadius:16, padding:28, maxWidth:420, width:'90%', boxShadow:'0 20px 60px rgba(0,0,0,0.35)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Are you sure?</div>
              <div style={{ fontSize:14, color:'#6B7280', marginBottom:24, lineHeight:1.6 }}>{confirmDialog.message}</div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>Cancel</button>
                <button className="btn btn-sm" style={{ background:'#EF4444', color:'#fff', border:'none', padding:'8px 20px' }}
                  onClick={async () => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); await fn(); }}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH LIST VIEW
  // ══════════════════════════════════════════════════════════════
  const activeBatches    = batches.filter(b => b.status === 'active');
  const upcomingBatches  = batches.filter(b => b.status === 'upcoming');
  const completedBatches = batches.filter(b => b.status !== 'active' && b.status !== 'upcoming');

  const byStatus = batchFilter === 'all'       ? batches
                 : batchFilter === 'active'    ? activeBatches
                 : batchFilter === 'upcoming'  ? upcomingBatches
                 : completedBatches;
  const bq = batchListSearch.trim().toLowerCase();
  const filteredBatches = bq
    ? byStatus.filter(b => (b.name || '').toLowerCase().includes(bq) || (b.course || '').toLowerCase().includes(bq))
    : byStatus;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text)', margin: 0 }}>Batch Management</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Organize courses, cohorts and schedules across all programs.
          </p>
        </div>
        {isCEOorAdmin && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16}/> Create Batch
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180, maxWidth: 340, order: -1 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ height: 38, paddingLeft: 34, width: '100%' }} placeholder="Search batch by name or course…"
            value={batchListSearch} onChange={e => setBatchListSearch(e.target.value)} />
        </div>
        {[
          { key: 'all',       label: `All batches ${batches.length}` },
          { key: 'active',    label: `Active ${activeBatches.length}` },
          { key: 'upcoming',  label: `Upcoming ${upcomingBatches.length}` },
          { key: 'completed', label: `Completed ${completedBatches.length}` },
        ].map(pill => (
          <button key={pill.key}
            onClick={() => setBatchFilter(pill.key)}
            style={{
              padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: batchFilter === pill.key ? 'var(--brand)' : 'var(--surface)',
              color: batchFilter === pill.key ? '#fff' : 'var(--text-sub)',
              border: batchFilter === pill.key ? 'none' : '1px solid var(--border)',
              transition: 'all 0.15s',
            }}>
            {pill.label}
          </button>
        ))}
      </div>

      {batches.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:14, color:'#6B7280', marginBottom:16 }}>No batches yet.</div>
          {isCEOorAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16}/> Create First Batch</button>}
        </div>
      )}

      {batches.length > 0 && filteredBatches.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>
          No batches match{batchListSearch ? ` “${batchListSearch}”` : ' this filter'}.
        </div>
      )}

      <div className="grid-3">
        {filteredBatches.map(b => {
          const studentCount = batchCounts[b.id] || 0;
          const onboardPct   = b._onboardPct || 0;
          b = { ...b, _studentCount: studentCount, _onboardPct: onboardPct };
          return (
            <div key={b.id}
              style={{
                background: '#fff', borderRadius: 14, border: '1px solid var(--border)',
                padding: '18px 20px', cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                transition: 'box-shadow 0.2s, transform 0.15s',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}
              onClick={() => openBatch(b)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'none'; }}
            >
              {/* Top row: course chip + status badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-sub)' }}>
                  {b.course || 'Course'}
                </span>
                <span style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                  background: b.status === 'active' ? '#D1FAE5' : b.status === 'upcoming' ? '#DBEAFE' : '#F3F4F6',
                  color: b.status === 'active' ? '#065F46' : b.status === 'upcoming' ? '#1E40AF' : '#6B7280',
                }}>{b.status || 'active'}</span>
              </div>

              {/* Batch name */}
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 4 }}>
                  {b.name}
                </div>
                {b.mentorName && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--grad-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                      {(b.mentorName || 'M')[0].toUpperCase()}
                    </div>
                    Mentor · {b.mentorName}
                  </div>
                )}
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{b._studentCount || 0}</span> students
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{b._onboardPct || 0}%</span> onboarded
                </div>
              </div>

              {/* Progress bar */}
              {(() => {
                const pct = b._onboardPct || 0;
                const barColor = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#E81620';
                return (
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                );
              })()}

              {/* Footer: schedule + open link */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {b.scheduleDay ? `${b.scheduleDay} · ${b.scheduleTime || ''}` : 'Schedule TBD'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600 }}>Open </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Batch Modal */}
      {showCreate && (
        <Modal title="Create New Batch" onClose={() => setShowCreate(false)} wide persistent>
          <form onSubmit={handleCreateBatch} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="form-group"><label className="form-label">Batch Name *</label><input className="form-input" required placeholder="e.g. ISC Level 1 — June 2026" value={createForm.name} onChange={e=>setCreateForm({...createForm,name:e.target.value})}/></div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Course *</label>
                {(() => {
                  // Options: ISC Level 1 + any custom course previously saved on a
                  // batch (excludes the removed legacy courses) + "Other".
                  const custom = [...new Set(batches.map(b => b.course).filter(Boolean))]
                    .filter(c => !BASE_COURSES.includes(c) && !LEGACY_COURSES.includes(c));
                  const options = [...BASE_COURSES, ...custom];
                  return (
                    <select className="form-input" value={createForm.courseIsOther ? OTHER_COURSE : createForm.course}
                      onChange={e => {
                        if (e.target.value === OTHER_COURSE) setCreateForm({ ...createForm, courseIsOther: true, course: '' });
                        else setCreateForm({ ...createForm, courseIsOther: false, course: e.target.value });
                      }}>
                      <option value="">Select</option>
                      {options.map(c => <option key={c} value={c}>{c}</option>)}
                      <option value={OTHER_COURSE}>Other (type a new course)…</option>
                    </select>
                  );
                })()}
                {createForm.courseIsOther && (
                  <input className="form-input" style={{ marginTop:8 }} autoFocus placeholder="e.g. ISC Level 3"
                    value={createForm.course} onChange={e => setCreateForm({ ...createForm, course: e.target.value })}/>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Course Duration (months) *</label>
                <input className="form-input" type="number" min="0" required placeholder="6" value={createForm.courseDurationMonths}
                  onChange={e => setCreateForm(f => ({ ...f, courseDurationMonths: e.target.value, endDate: addMonthsToDate(f.startDate, e.target.value) }))}/>
              </div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={createForm.startDate}
                  onChange={e => setCreateForm(f => ({ ...f, startDate: e.target.value, endDate: addMonthsToDate(e.target.value, f.courseDurationMonths) }))}/></div>
              <div className="form-group"><label className="form-label">End Date <span style={{ fontWeight:400, color:'var(--text-muted)', fontSize:11 }}>(auto)</span></label>
                <input className="form-input" type="date" value={createForm.endDate} readOnly tabIndex={-1}
                  style={{ background:'var(--surface-sunken)', cursor:'not-allowed' }}
                  title="Calculated automatically from start date + duration"/></div>
            </FormRow>
            <div className="form-group">
              <label className="form-label">Assign Mentor</label>
              <select className="form-input" value={createForm.mentorId}
                onChange={e => {
                  const sel = staffList.find(s => s.id === e.target.value);
                  setCreateForm({ ...createForm, mentorId: e.target.value, mentorName: sel?.name || '' });
                }}>
                <option value="">Select Mentor</option>
                {staffList.filter(s=>s.role!=='ceo'&&s.active!==false).map(s=>(
                  <option key={s.id} value={s.id}>{s.name} — {s.email || s.phone || 'no email'}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Assign Faculties / Staff <span style={{ fontWeight:400, color:'var(--text-muted)', fontSize:12 }}>(select multiple)</span></label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, padding:'10px', background:'var(--bg)', borderRadius:8, border:'1px solid var(--border)', minHeight:48 }}>
                {staffList.filter(s=>s.role!=='ceo'&&s.active!==false).map(s=>(
                  <div key={s.id} onClick={() => toggleFaculty(s.name)} style={{
                    padding:'5px 12px', borderRadius:20, fontSize:12, cursor:'pointer', fontWeight:500,
                    background: createForm.faculties.includes(s.name)?'#E53935':'var(--white)',
                    color: createForm.faculties.includes(s.name)?'#fff':'var(--text)',
                    border: `1px solid ${createForm.faculties.includes(s.name)?'#E53935':'var(--border)'}`,
                    transition:'all 0.12s',
                  }}>
                    {s.name}{s.email ? ` · ${s.email}` : s.phone ? ` · ${s.phone}` : ''}
                  </div>
                ))}
              </div>
            </div>
            <FormRow>
              <div className="form-group"><label className="form-label">Max Seats</label><input className="form-input" type="number" placeholder="60" value={createForm.maxSeats} onChange={e=>setCreateForm({...createForm,maxSeats:e.target.value})}/></div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-input" value={createForm.status} onChange={e=>setCreateForm({...createForm,status:e.target.value})}>
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                </select>
              </div>
            </FormRow>
            <div style={{ padding:'10px 12px', background:'#EFF6FF', borderRadius:8, fontSize:12, color:'#1E40AF' }}>
              After creating the batch, use "Course Flow", "Student Fields", and "Subjects" buttons inside to customize them.
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Creating...':'Create Batch'}</button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}

      {/* In-app confirmation dialog */}
      {confirmDialog && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDialog(null); }}>
          <div style={{ background:'#fff', borderRadius:16, padding:28, maxWidth:420, width:'90%', boxShadow:'0 20px 60px rgba(0,0,0,0.35)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Are you sure?</div>
            <div style={{ fontSize:14, color:'#6B7280', marginBottom:24, lineHeight:1.6 }}>{confirmDialog.message}</div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button className="btn btn-sm" style={{ background:'#EF4444', color:'#fff', border:'none', padding:'8px 20px' }}
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await fn();
                }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
