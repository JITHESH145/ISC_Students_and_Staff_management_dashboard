import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeStudents, searchStudents, deleteStudent, addStudent, assignStudentsToBatch, syncStudentCoursesFromBatches, getBatches, getStaffProfiles } from '../firebase/services';
import { Modal, Toast, Avatar, StatusBadge, Loading, Confirm, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Eye, Trash2, Upload, ChevronRight, ChevronLeft, Users, AlertTriangle } from 'lucide-react';
import { useNavigate as useNav } from 'react-router-dom';

const STATUSES = ['active','moderate','at-risk','dropped'];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function StudentsPage() {
  const { profile }    = useAuth();
  const navigate       = useNavigate();
  const [liveStudents, setLiveStudents] = useState([]); // live scoped list
  const [searchResults, setSearchResults] = useState(null); // non-null while searching
  const [batches, setBatches]         = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [toast, setToast]             = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [saving, setSaving]           = useState(false);
  const [fixOpen, setFixOpen]         = useState(false);
  const [fixBatchId, setFixBatchId]   = useState('');
  const [fixSelected, setFixSelected] = useState([]);
  const [fixing, setFixing]           = useState(false);
  const [courseFixOpen, setCourseFixOpen] = useState(false);
  const [syncingCourses, setSyncingCourses] = useState(false);
  const [form, setForm] = useState({
    name:'', phone:'', parentPhone:'', email:'',
    course:'', batchId:'', joiningDate:todayStr(), location:'',
    education:'', staffAssigned:'', classplusId:'',
    status:'active', notes:'',
  });

  const isCEOorAdmin = profile?.role === 'ceo';
  // Access scope: staff queries carry the staffIds clause the security
  // rules require; CEO queries are unscoped.
  const scope = { role: profile?.role, uid: profile?.uid, email: profile?.email };

  // Displayed list: search results when a search is active, else the live list.
  const students   = searchResults ?? liveStudents;
  const totalCount = liveStudents.length;
  const searching  = !!search.trim() && searchResults === null; // debouncing
  const hasMore    = false;
  const loadPage   = () => {}; // no-op: the live listener keeps the list current

  // Batches + staff for the filter dropdown / add form — one-time.
  useEffect(() => {
    Promise.all([getBatches(), getStaffProfiles()]).then(([b, s]) => {
      setBatches(b);
      setStaffList(s.filter(s => s.active !== false));
    });
  }, []);

  // Live students: any add/edit/delete (by anyone) reflects with no refresh.
  // Staff see only their scoped set; CEO sees the newest 500 live.
  useEffect(() => {
    if (!profile?.role) return;
    setLoading(true);
    const filters = {};
    if (batchFilter)  filters.batchId = batchFilter;
    if (statusFilter) filters.status  = statusFilter;
    const sc = { role: profile.role, uid: profile.uid, email: profile.email };
    return subscribeStudents(filters, sc, (rows) => { setLiveStudents(rows); setLoading(false); });
  }, [batchFilter, statusFilter, profile?.role, profile?.uid, profile?.email]);

  // Search with debounce (transient — overlays the live list while typing).
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      const results = await searchStudents(search, scope);
      setSearchResults(results);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleAdd = async (e) => {
    e.preventDefault();
    // The batch decides the course (and course flow) — same as adding from
    // the Batches page, so both entry points produce identical students.
    const batch = batches.find(b => b.id === form.batchId);
    if (!batch) { setToast({ message: 'Select a batch.', type: 'error' }); return; }
    setSaving(true);
    try {
      await addStudent({ ...form, batchName: batch.name || '', course: batch.course || '', courseDurationMonths: batch.courseDurationMonths || '' });
      setToast({ message: 'Student added!', type: 'success' });
      setShowModal(false);
      setForm({ name:'',phone:'',parentPhone:'',email:'',course:'',batchId:'',joiningDate:todayStr(),location:'',education:'',staffAssigned:'',classplusId:'',status:'active',notes:'' });
      loadPage(true);
    } catch {
      setToast({ message: 'Failed to add student.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    await deleteStudent(deleting);
    setDeleting(null);
    setToast({ message: 'Student deleted.', type: 'info' });
    loadPage(true);
  };

  const batchName = (id) => batches.find(b => b.id === id)?.name || '—';
  const formBatch = batches.find(b => b.id === form.batchId);

  // Students whose batchId doesn't resolve to a batch (added without one, or
  // their batch was removed). They show "—" and fall back to the default flow.
  const noBatchStudents = batches.length
    ? liveStudents.filter(s => !s.batchId || !batches.some(b => b.id === s.batchId))
    : [];
  const openFix = () => { setFixSelected(noBatchStudents.map(s => s.id)); setFixBatchId(''); setFixOpen(true); };
  const handleFix = async () => {
    const batch = batches.find(b => b.id === fixBatchId);
    const chosen = noBatchStudents.filter(s => fixSelected.includes(s.id));
    if (!batch || !chosen.length) return;
    setFixing(true);
    try {
      await assignStudentsToBatch(chosen, batch);
      setToast({ message: `${chosen.length} student${chosen.length > 1 ? 's' : ''} moved to ${batch.name}.`, type: 'success' });
      setFixOpen(false);
    } catch {
      setToast({ message: 'Failed to assign batch.', type: 'error' });
    } finally { setFixing(false); }
  };

  // Students in a valid batch whose stored course has drifted from the
  // batch's own course (e.g. left over from the old free-text course field).
  const courseMismatchStudents = batches.length
    ? liveStudents.filter(s => {
        const batch = batches.find(b => b.id === s.batchId);
        return batch && batch.course && (s.course || '') !== batch.course;
      })
    : [];
  // What the list should show for a student's course — the batch's course
  // wins when the student is in a valid batch, even before the sync runs.
  const courseFor = (s) => batches.find(b => b.id === s.batchId)?.course || s.course || '—';
  const handleSyncCourses = async () => {
    setSyncingCourses(true);
    try {
      const { updated } = await syncStudentCoursesFromBatches(courseMismatchStudents, batches);
      setToast({ message: `${updated} student${updated === 1 ? '' : 's'} updated.`, type: 'success' });
      setCourseFixOpen(false);
    } catch {
      setToast({ message: 'Failed to sync courses.', type: 'error' });
    } finally { setSyncingCourses(false); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>
          All Students
          <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
            ({totalCount.toLocaleString()} total)
          </span>
        </h2>
        {isCEOorAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} /> Add Student
            </button>
          </div>
        )}
      </div>

      {/* Scale info */}
      {totalCount > 500 && (
        <div style={{ padding: '8px 14px', background: '#F0FDF4', borderRadius: 8, fontSize: 12, color: '#065F46', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Users size={13} /> Showing 50 students at a time. Use search or filters to find specific students instantly.
        </div>
      )}

      {/* Students without a valid batch — CEO can move them into one */}
      {isCEOorAdmin && !batchFilter && noBatchStudents.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 13, color: '#92400E', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{noBatchStudents.length}</b> student{noBatchStudents.length > 1 ? 's are' : ' is'} not in any batch, so their course and course flow are wrong.
          </span>
          <button className="btn btn-primary btn-sm" onClick={openFix}>Assign to batch</button>
        </div>
      )}

      {/* Students whose stored course doesn't match their batch's course — CEO can re-sync */}
      {isCEOorAdmin && !batchFilter && courseMismatchStudents.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 13, color: '#92400E', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{courseMismatchStudents.length}</b> student{courseMismatchStudents.length > 1 ? 's have' : ' has'} a course that doesn't match their batch (e.g. 'Other').
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setCourseFixOpen(true)}>Fix courses</button>
        </div>
      )}

      {/* Search + batch filter row */}
      <div className="mobile-stack" style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input placeholder="Search name, phone, ClassPlus ID, email..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {searching && <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Searching...</span>}
        </div>
        <select className="form-input" style={{ width: 180 }} value={batchFilter} onChange={e => { setBatchFilter(e.target.value); setSearch(''); }}>
          <option value="">All Batches</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Status filter chips */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
        {[
          { key:'', label:'All', dot:'var(--n-400)' },
          { key:'active', label:'Active', dot:'var(--green)' },
          { key:'moderate', label:'Moderate', dot:'var(--amber)' },
          { key:'at-risk', label:'At Risk', dot:'var(--red)' },
          { key:'dropped', label:'Dropped', dot:'var(--slate)' },
        ].map(chip => {
          const count = chip.key ? students.filter(s=>s.status===chip.key).length : students.length;
          const active = statusFilter === chip.key;
          return (
            <button key={chip.key} onClick={() => { setStatusFilter(chip.key); setSearch(''); }}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:'var(--radius-pill)', border:`1px solid ${active?'var(--brand)':'var(--border)'}`, background:active?'var(--brand-50)':'var(--surface)', cursor:'pointer', fontSize:12, fontWeight:600, color:active?'var(--brand-ink)':'var(--text-sub)', transition:'all 0.12s' }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:chip.dot, flexShrink:0 }} />
              {chip.label}
              <span style={{ fontSize:11, color:active?'var(--brand)':'var(--text-muted)', fontWeight:500 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr><th>Student</th><th>Course / Batch</th><th>Phone</th><th>Staff</th><th>Joined</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {loading && students.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            )}
            {!loading && students.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
                No students found. {isCEOorAdmin && 'Add your first student or use Bulk Import.'}
              </td></tr>
            )}
            {students.map(s => (
              <tr key={s.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Avatar name={s.name} size="sm" />
                    <div>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {s.location}{s.classplusId ? ` · ${s.classplusId}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>{courseFor(s)}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{batchName(s.batchId)}</div>
                </td>
                <td style={{ fontSize: 13 }}>{s.phone || '—'}</td>
                <td style={{ fontSize: 13 }}>{s.staffAssigned || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{s.joiningDate || '—'}</td>
                <td><StatusBadge status={s.status} /></td>
                <td>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate(`/students/${s.id}`)}>
                      <Eye size={13} />
                    </button>
                    {isCEOorAdmin && (
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#EF4444' }} onClick={() => setDeleting(s.id)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Pagination */}
        {!search && hasMore && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => loadPage(false)} disabled={loading}>
              {loading ? 'Loading...' : <><ChevronRight size={15} /> Load next 50 students</>}
            </button>
          </div>
        )}
        {!search && students.length > 0 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
            Showing {students.length} of {totalCount.toLocaleString()} students
          </div>
        )}
      </div>

      {/* Add Student Modal */}
      {showModal && (
        <Modal title="Add New Student" onClose={() => setShowModal(false)} wide persistent>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormRow>
              <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">Phone *</label><input className="form-input" required value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Parent Phone</label><input className="form-input" value={form.parentPhone} onChange={e => setForm({...form, parentPhone: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Batch *</label>
                <select className="form-input" required value={form.batchId} onChange={e => setForm({...form, batchId: e.target.value})}>
                  <option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name}{b.course ? ` — ${b.course}` : ''}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Course</label>
                <input className="form-input" readOnly value={formBatch ? (formBatch.course || '—') : ''} placeholder="Set by the batch" style={{ background: 'var(--n-50, #F9FAFB)', color: 'var(--text-sub)' }} />
              </div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">ClassPlus ID</label><input className="form-input" value={form.classplusId} onChange={e => setForm({...form, classplusId: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">Joining Date</label><input className="form-input" type="date" value={form.joiningDate} onChange={e => setForm({...form, joiningDate: e.target.value})} /></div>
            </FormRow>
            <FormRow>
              <div className="form-group"><label className="form-label">Education</label><input className="form-input" value={form.education} onChange={e => setForm({...form, education: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">Status</label>
                <select className="form-input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                  {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </FormRow>
            <div className="form-group"><label className="form-label">Notes</label><textarea className="form-input" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Add Student'}</button>
            </div>
          </form>
        </Modal>
      )}

      {fixOpen && (
        <Modal title="Assign students to a batch" onClose={() => setFixOpen(false)} wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
              The selected students get the batch's course, course flow and staff. Progress already recorded is kept.
            </div>
            <div className="form-group"><label className="form-label">Batch *</label>
              <select className="form-input" value={fixBatchId} onChange={e => setFixBatchId(e.target.value)}>
                <option value="">Select batch</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}{b.course ? ` — ${b.course}` : ''}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={fixSelected.length === noBatchStudents.length}
                onChange={e => setFixSelected(e.target.checked ? noBatchStudents.map(s => s.id) : [])} />
              Select all ({fixSelected.length}/{noBatchStudents.length})
            </label>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {noBatchStudents.map(s => (
                <label key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={fixSelected.includes(s.id)}
                    onChange={e => setFixSelected(e.target.checked ? [...fixSelected, s.id] : fixSelected.filter(x => x !== s.id))} />
                  <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{s.course || '—'} · {s.phone || ''}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setFixOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={fixing || !fixBatchId || !fixSelected.length} onClick={handleFix}>
                {fixing ? 'Saving...' : `Assign ${fixSelected.length} student${fixSelected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleting && <Confirm message="Delete this student? This cannot be undone." onConfirm={handleDelete} onCancel={() => setDeleting(null)} />}
      {courseFixOpen && (
        <Confirm
          message={`Set the course of ${courseMismatchStudents.length} students to their batch's course?`}
          onConfirm={handleSyncCourses}
          onCancel={() => !syncingCourses && setCourseFixOpen(false)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}