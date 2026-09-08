import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudentsPaged, searchStudents, deleteStudent, addStudent, getStudentCount, getBatches, getStaffProfiles } from '../firebase/services';
import { Modal, Toast, Avatar, StatusBadge, Loading, Confirm, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Eye, Trash2, Upload, ChevronRight, ChevronLeft, Users } from 'lucide-react';
import { useNavigate as useNav } from 'react-router-dom';

const COURSES = ['Python','Data Science','Web Development','Machine Learning','Digital Marketing','UI/UX Design','Cyber Security','Other'];
const STATUSES = ['active','moderate','at-risk','dropped'];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function StudentsPage() {
  const { profile }    = useAuth();
  const navigate       = useNavigate();
  const [students, setStudents]       = useState([]);
  const [batches, setBatches]         = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [totalCount, setTotalCount]   = useState(0);
  const [lastDoc, setLastDoc]         = useState(null);
  const [hasMore, setHasMore]         = useState(false);
  const [search, setSearch]           = useState('');
  const [searching, setSearching]     = useState(false);
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [toast, setToast]             = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [saving, setSaving]           = useState(false);
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

  const loadPage = useCallback(async (reset = false) => {
    setLoading(true);
    const filters = {};
    if (batchFilter)  filters.batchId = batchFilter;
    if (statusFilter) filters.status  = statusFilter;

    const startDoc = reset ? null : lastDoc;
    const result = await getStudentsPaged(filters, reset ? null : startDoc, scope);
    if (reset) {
      setStudents(result.students);
    } else {
      setStudents(prev => [...prev, ...result.students]);
    }
    setLastDoc(result.lastDoc);
    setHasMore(result.hasMore);

    if (reset) {
      const count = await getStudentCount(scope);
      setTotalCount(count);
    }
    setLoading(false);
  }, [batchFilter, statusFilter, profile]);

  useEffect(() => {
    Promise.all([getBatches(), getStaffProfiles()]).then(([b, s]) => {
      setBatches(b);
      setStaffList(s.filter(s => s.active !== false));
    });
    loadPage(true);
  }, [batchFilter, statusFilter]);

  // Search with debounce
  useEffect(() => {
    if (!search.trim()) { loadPage(true); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const results = await searchStudents(search, scope);
      setStudents(results);
      setHasMore(false);
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await addStudent(form);
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

      {/* Search + batch filter row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
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
                  <div style={{ fontSize: 13 }}>{s.course || '—'}</div>
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
              <div className="form-group"><label className="form-label">Course *</label>
                <select className="form-input" required value={form.course} onChange={e => setForm({...form, course: e.target.value})}>
                  <option value="">Select</option>{COURSES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Batch</label>
                <select className="form-input" value={form.batchId} onChange={e => setForm({...form, batchId: e.target.value})}>
                  <option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
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

      {deleting && <Confirm message="Delete this student? This cannot be undone." onConfirm={handleDelete} onCancel={() => setDeleting(null)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}