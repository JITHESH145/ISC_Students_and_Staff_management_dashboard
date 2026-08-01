import { useEffect, useState } from 'react';
import {
  getConcerns, addConcern, updateConcern,
  getStudents, getStaffProfiles, notifyStaff
} from '../firebase/services';
import { Modal, Toast, Loading, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Mail } from 'lucide-react';

const CONCERN_TYPES = [
  'Fee Issue','Attendance Issue','Technical Issue',
  'Course Doubt','Personal Concern','Weak Subject','Other'
];
const TYPE_COLORS = {
  'Fee Issue':        { bg:'var(--red-soft)',    color:'#E81620' },
  'Attendance Issue': { bg:'var(--amber-soft)',  color:'#F5A623' },
  'Technical Issue':  { bg:'var(--blue-soft)',   color:'#3B6EF6' },
  'Course Doubt':     { bg:'var(--violet-soft)', color:'#8B5CF6' },
  'Personal Concern': { bg:'var(--pink-soft)',   color:'#EC4899' },
  'Weak Subject':     { bg:'var(--orange-soft)', color:'#F4683B' },
  'Other':            { bg:'var(--slate-soft)',  color:'#6E7488' },
};

export default function Concerns() {
  const { profile, user } = useAuth();
  const isCeo = profile?.role === 'ceo';
  const [concerns, setConcerns]   = useState([]);
  const [students, setStudents]   = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [staffFilter, setStaffFilter]   = useState(''); // CEO: filter by raised-by / assigned staff
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({
    studentId:'', type:'', description:'',
    assignedTo:'', assignedToEmail:'', status:'open'
  });

  const load = async () => {
    const scope = { role: profile?.role, uid: profile?.uid, email: user?.email };
    const [c, s, st] = await Promise.all([
      getConcerns({}, scope), getStudents(scope), getStaffProfiles()
    ]);
    setConcerns(c);
    setStudents(s);
    setStaffList(st.filter(x => x.active !== false));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Visibility: CEO/admin see everything. Staff see only concerns they raised
  // or that are assigned to them.
  const myEmail = user?.email;
  const myName  = profile?.name;
  const visible = concerns.filter(c => isCeo
    || c.raisedByEmail === myEmail || c.raisedBy === myName
    || c.assignedToEmail === myEmail || c.assignedTo === myName);

  const filtered = visible.filter(c => {
    const q = search.toLowerCase();
    const matchQ = !q ||
      c.studentName?.toLowerCase().includes(q) ||
      c.type?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q);
    const matchS = !statusFilter || c.status === statusFilter;
    const matchStaff = !staffFilter || c.assignedTo === staffFilter || c.raisedBy === staffFilter;
    return matchQ && matchS && matchStaff;
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const stu = students.find(s => s.id === form.studentId);
      const assignedStaff = staffList.find(s => s.id === form.assignedTo);

      await addConcern({
        ...form,
        studentName:     stu?.name || '',
        assignedTo:      assignedStaff?.name || '',
        assignedToEmail: assignedStaff?.email || '',
        raisedBy:        profile?.name || '',
        raisedByEmail:   user?.email || '',
      });

      // In-app notification + structured email together
      if (assignedStaff?.email) {
        await notifyStaff({
          toEmail:  assignedStaff.email,
          fromName: profile?.name,
          type:     'concern',
          title:    'Concern Assigned to You',
          body:     `Concern raised for student "${stu?.name}" — ${form.type}: ${form.description.slice(0, 80)}`,
          route:    '/concerns',
          intro:    `Hi ${assignedStaff.name}, a student concern has been assigned to you on ISC SMS.`,
          details: [
            { label: 'Student',     value: stu?.name },
            { label: 'Concern',     value: form.type },
            { label: 'Description', value: form.description },
            { label: 'Raised by',   value: `${profile?.name || 'ISC SMS'}${user?.email ? ` (${user.email})` : ''}` },
          ].filter(d => d.value),
        });
      }

      setToast({
        message: assignedStaff
          ? `Concern logged and ${assignedStaff.name} notified!`
          : 'Concern logged!',
        type:'success'
      });
      setShowModal(false);
      setForm({ studentId:'', type:'', description:'', assignedTo:'', assignedToEmail:'', status:'open' });
      load();
    } catch (err) {
      setToast({ message:'Failed: ' + err.message, type:'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (concern) => {
    const next = concern.status === 'open' ? 'resolved' : 'open';
    await updateConcern(concern.id, { status: next });
    load();
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
  };

  // Status meta
  const STATUS = {
    open:          { label:'Open',        cls:'badge-red'   },
    'in-progress': { label:'In Progress', cls:'badge-amber' },
    resolved:      { label:'Resolved',    cls:'badge-green' },
  };
  const statusOf = (c) => c.status || 'open';
  const counts = {
    all:           visible.length,
    open:          visible.filter(c => statusOf(c) === 'open').length,
    'in-progress': visible.filter(c => statusOf(c) === 'in-progress').length,
    resolved:      visible.filter(c => statusOf(c) === 'resolved').length,
  };
  const TABS = [
    { key:'open',        label:'Open'        },
    { key:'in-progress', label:'In Progress' },
    { key:'resolved',    label:'Resolved'    },
    { key:'',            label:'All'         },
  ];

  const initials = (name='') => {
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
  };
  const concernKey = (c, i) => 'CON-' + (c.id ? c.id.slice(-3).toUpperCase() : String(i + 1).padStart(3, '0'));

  if (loading) return <Loading />;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:16 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <h2 style={{ fontSize:24, fontWeight:700 }}>Student Concerns</h2>
            {counts.open > 0 && <span className="badge badge-red"><span className="dot" />{counts.open} open</span>}
          </div>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Review and resolve flagged issues raised by staff and students.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Raise Concern
        </button>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:18 }}>
        <div className="search-bar" style={{ width:320 }}>
          <Search size={15} style={{ color:'var(--text-muted)', flexShrink:0 }} />
          <input placeholder="Search concern, student or category…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {isCeo && (
          <select className="form-input" style={{ width:'auto', height:38 }} value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
            <option value="">All staff</option>
            {[...new Set(concerns.flatMap(c => [c.assignedTo, c.raisedBy]).filter(Boolean))].sort().map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
        <div style={{ flex:1 }} />
        <div className="segmented">
          {TABS.map(t => (
            <button key={t.key || 'all'} className={statusFilter === t.key ? 'active' : ''} onClick={() => setStatusFilter(t.key)}>
              {t.label}<span className="seg-count">{counts[t.key || 'all']}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Concern cards */}
      <div style={{ display:'flex', flexDirection:'column', gap:12, maxWidth:920 }}>
        {filtered.length === 0 && (
          <div style={{ padding:'48px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13.5, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14 }}>
            No concerns in this view.
          </div>
        )}
        {filtered.map((c, i) => {
          const style = TYPE_COLORS[c.type] || TYPE_COLORS['Other'];
          const st = STATUS[statusOf(c)] || STATUS.open;
          const isOpen = statusOf(c) !== 'resolved';
          return (
            <div key={c.id} className="card" style={{ padding:'16px 20px', borderLeft:`3px solid ${style.color}` }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontFamily:'var(--font-display)', fontSize:11.5, fontWeight:600, color:'var(--text-muted)' }}>{concernKey(c, i)}</span>
                    <span style={{ fontSize:14, fontWeight:600 }}>{c.type}</span>
                  </div>
                  <div style={{ fontSize:12.5, color:'var(--text-sub)', marginTop:8 }}>{c.description}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:11, fontSize:12, color:'var(--text-muted)', flexWrap:'wrap' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:9, color:'#fff', background:style.color }}>{initials(c.studentName)}</span>
                      {c.studentName}
                    </span>
                    {c.assignedTo && <span className="chip">{c.assignedTo}</span>}
                    {c.raisedBy && <span>Raised by {c.raisedBy} · {formatDate(c.createdAt)}</span>}
                  </div>
                </div>
                <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:10 }}>
                  <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
                  {isOpen && <button className="btn btn-secondary btn-sm" onClick={() => toggleStatus(c)}>Resolve</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Log Concern Modal */}
      {showModal && (
        <Modal title="Log Student Concern" onClose={() => setShowModal(false)}>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ padding:'8px 12px', background:'var(--blue-soft)', borderRadius:8, fontSize:12, color:'var(--blue-ink)', display:'flex', gap:6 }}>
              <Mail size={13} style={{ flexShrink:0, marginTop:1 }} />
              If you assign this to a staff member, they will be notified via email + in-app notification.
            </div>
            <div className="form-group">
              <label className="form-label">Student *</label>
              <select className="form-input" required value={form.studentId}
                onChange={e => setForm({...form, studentId:e.target.value})}>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Concern Type *</label>
                <select className="form-input" required value={form.type}
                  onChange={e => setForm({...form, type:e.target.value})}>
                  <option value="">Select type</option>
                  {CONCERN_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assign / Raise To</label>
                <select className="form-input" value={form.assignedTo}
                  onChange={e => setForm({...form, assignedTo:e.target.value})}>
                  <option value="">No assignment</option>
                  {/* CEOs first so staff can raise a concern directly to the CEO */}
                  {staffList.filter(s => s.role === 'ceo' && s.active !== false).map(s => (
                    <option key={s.id} value={s.id}>⭐ {s.name} (CEO)</option>
                  ))}
                  {staffList.filter(s => s.role !== 'ceo' && s.active !== false).map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                  ))}
                </select>
                {form.assignedTo && (
                  <div style={{ fontSize:11, color:'var(--green-ink)', marginTop:3 }}>
                    Will notify: {staffList.find(s=>s.id===form.assignedTo)?.email}
                  </div>
                )}
              </div>
            </FormRow>
            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea className="form-input" rows={3} required
                placeholder="Describe the concern in detail..."
                value={form.description} onChange={e => setForm({...form, description:e.target.value})} />
            </div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-input" value={form.status}
                  onChange={e => setForm({...form, status:e.target.value})}>
                  <option value="open">Open</option>
                  <option value="in-progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
            </FormRow>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Logging...' : <><Mail size={14}/> Log & Notify</>}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}