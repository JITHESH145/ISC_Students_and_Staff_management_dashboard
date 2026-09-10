import { useEffect, useState } from 'react';
import { getAllFollowUps, getStudents, addFollowUp, completeFollowUp, notifyStaff, getStaffProfiles, getBatches, getBatchStudents } from '../firebase/services';
import { Modal, Toast, Loading, Avatar, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Mail, CheckCircle, Clock } from 'lucide-react';

export default function FollowUps() {
  const { profile, user } = useAuth();
  const [followups, setFollowups]   = useState([]);
  const [students, setStudents]     = useState([]);
  const [staff, setStaff]           = useState([]);
  const [batches, setBatches]       = useState([]);
  const [batchStudentsList, setBatchStudentsList] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState('all');
  const [showModal, setShowModal]   = useState(false);
  const [completing, setCompleting] = useState(null);
  const [completionNote, setCompletionNote] = useState('');
  const [toast, setToast]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({
    batchId: '',
    studentId: '', studentName: '',
    staffId: '',
    note: '', nextAction: '', priority: 'normal'
  });

  const isCEOorAdmin = profile?.role === 'ceo';
  const scope = { role: profile?.role, uid: profile?.uid, email: user?.email };

  // Staff belonging to a batch (its faculty + mentor).
  const batchStaffFor = (batchId) => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return [];
    const ids = [...(batch.staffIds || []), batch.mentorId].filter(Boolean);
    return staff.filter(s => ids.includes(s.id));
  };

  const load = async () => {
    // Queries are scoped server-side: staff receive only their own
    // follow-ups / students (rules reject unscoped queries).
    const [f, s, st, b] = await Promise.all([getAllFollowUps(scope), getStudents(scope), getStaffProfiles(), getBatches().catch(() => [])]);
    setFollowups(f);
    setStudents(s);
    setStaff(st.filter(s => s.active !== false && s.role !== 'ceo'));
    setBatches(b || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Load the chosen batch's full student roster (the general list is paginated).
  useEffect(() => {
    if (!form.batchId) { setBatchStudentsList([]); return; }
    getBatchStudents(form.batchId, scope).then(r => setBatchStudentsList(r.students || [])).catch(() => setBatchStudentsList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.batchId]);

  const filtered = followups.filter(f => {
    const q = search.toLowerCase();
    const matchQ = !q || f.studentName?.toLowerCase().includes(q) || f.note?.toLowerCase().includes(q) || f.assignedTo?.toLowerCase().includes(q);
    if (filter === 'pending')   return matchQ && !f.completed;
    if (filter === 'completed') return matchQ && f.completed;
    if (filter === 'urgent')    return matchQ && f.priority === 'urgent' && !f.completed;
    return matchQ;
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Recipients: one selected staff, or every staff of the chosen batch.
      let recipients;
      if (form.staffId === '__all__') {
        recipients = batchStaffFor(form.batchId).filter(s => s.email);
        if (!recipients.length) { setToast({ message: 'No staff (with email) in this batch to assign.', type: 'error' }); setSaving(false); return; }
      } else {
        const sel = staff.find(s => s.id === form.staffId);
        if (!sel) { setToast({ message: 'Please select a staff member.', type: 'error' }); setSaving(false); return; }
        recipients = [sel];
      }

      for (const selectedStaff of recipients) {
        await addFollowUp({
          studentId:       form.studentId,
          studentName:     form.studentName,
          assignedTo:      selectedStaff.name,
          assignedToEmail: selectedStaff.email, // auto from Firestore
          note:            form.note,
          nextAction:      form.nextAction,
          priority:        form.priority,
          assignedBy:      profile?.name,
          assignedByEmail: user?.email,
        });
        // In-app notification + structured email together
        await notifyStaff({
          toEmail:  selectedStaff.email,
          fromName: profile?.name,
          type:     'followup',
          title:    'New Follow-Up Assigned',
          body:     `Follow-up assigned: "${form.studentName}" — ${form.note.slice(0, 60)}`,
          route:    '/followups',
          intro:    `Hi ${selectedStaff.name}, a student follow-up has been assigned to you on ISC SMS.`,
          details: [
            { label: 'Student',     value: form.studentName },
            { label: 'Note',        value: form.note },
            { label: 'Next action', value: form.nextAction },
            { label: 'Priority',    value: form.priority },
            { label: 'Assigned by', value: `${profile?.name || 'ISC SMS'}${user?.email ? ` (${user.email})` : ''}` },
          ].filter(d => d.value),
        }).catch(() => {});
      }

      setToast({ message: recipients.length > 1 ? `Follow-up assigned to ${recipients.length} staff!` : `Follow-up assigned to ${recipients[0].name}!`, type: 'success' });
      setShowModal(false);
      setForm({ batchId: '', studentId: '', studentName: '', staffId: '', note: '', nextAction: '', priority: 'normal' });
      load();
    } catch (err) {
      setToast({ message: 'Failed: ' + err.message, type: 'error' });
    } finally { setSaving(false); }
  };

  const handleComplete = async () => {
    await completeFollowUp(completing.id, completionNote);
    // NOTE: notifying the assigner on completion is intentionally NOT done here —
    // notifications are owned by the notification workstream. The completion note
    // itself is stored and shown on the row below.
    setCompleting(null);
    setCompletionNote('');
    setToast({ message: 'Follow-up completed!', type: 'success' });
    load();
  };

  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  if (loading) return <Loading />;

  const pendingCount = followups.filter(f => !f.completed).length;
  const urgentCount  = followups.filter(f => f.priority === 'urgent' && !f.completed).length;

  return (
    <div>
      <div className="page-header">
        <h2>Follow-Up Tracker
          <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
            ({pendingCount} pending)
          </span>
        </h2>
        {/* Staff can now assign follow-ups to each other (both parties see it). */}
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Assign Follow-Up
        </button>
      </div>

      {isCEOorAdmin && (
        <div style={{ padding: '10px 14px', background: '#EFF6FF', borderRadius: 8, fontSize: 12, color: '#1E40AF', marginBottom: 16, display: 'flex', gap: 8 }}>
          <Mail size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Select a staff member — their email is fetched automatically. No manual email entry needed.
        </div>
      )}

      {/* Search row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input placeholder="Search student, staff, note..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Status filter chips */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
        {[
          { key:'all',       label:'All',       dot:'var(--n-400)' },
          { key:'pending',   label:'Pending',   dot:'var(--amber)' },
          { key:'urgent',    label:'Urgent',    dot:'var(--red)' },
          { key:'completed', label:'Completed', dot:'var(--green)' },
        ].map(chip => {
          const count = chip.key === 'all' ? followups.length
            : chip.key === 'pending'   ? followups.filter(f => !f.completed).length
            : chip.key === 'urgent'    ? followups.filter(f => f.priority === 'urgent' && !f.completed).length
            : followups.filter(f => f.completed).length;
          const isActive = filter === chip.key;
          return (
            <button key={chip.key} onClick={() => setFilter(chip.key)}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:'var(--radius-pill)', border:`1px solid ${isActive?'var(--brand)':'var(--border)'}`, background:isActive?'var(--brand-50)':'var(--surface)', cursor:'pointer', fontSize:12, fontWeight:600, color:isActive?'var(--brand-ink)':'var(--text-sub)', transition:'all 0.12s' }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:chip.dot, flexShrink:0 }} />
              {chip.label}
              <span style={{ fontSize:11, color:isActive?'var(--brand)':'var(--text-muted)', fontWeight:500 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              {isCEOorAdmin && <th>Assigned To</th>}
              <th>Note</th>
              <th>Priority</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>No follow-ups found.</td></tr>
            )}
            {filtered.map(f => (
              <tr key={f.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={f.studentName || '?'} size="sm" />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{f.studentName}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>by {f.assignedBy}</div>
                    </div>
                  </div>
                </td>
                {isCEOorAdmin && <td style={{ fontSize: 13 }}>{f.assignedTo || '—'}</td>}
                <td style={{ fontSize: 13, maxWidth: 260 }}>
                  {f.note}
                  {f.completed && f.completionNote && (
                    <div style={{ marginTop: 5, padding: '5px 9px', background: 'var(--green-soft)', color: 'var(--green-ink)', borderRadius: 7, fontSize: 11.5, lineHeight: 1.4 }}>
                      <strong>Outcome:</strong> {f.completionNote}
                    </div>
                  )}
                </td>
                <td>
                  {f.priority === 'urgent' ? <span className="badge badge-red">Urgent</span>
                   : f.priority === 'high' ? <span className="badge badge-amber">High</span>
                   : <span className="badge badge-gray">Normal</span>}
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDate(f.createdAt)}</td>
                <td>
                  {f.completed
                    ? <span className="badge badge-green"><CheckCircle size={11} style={{ marginRight: 3 }} />Done</span>
                    : <span className="badge badge-amber"><Clock size={11} style={{ marginRight: 3 }} />Pending</span>}
                </td>
                <td>
                  {!f.completed && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setCompleting(f)}>Log & Close</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign Modal */}
      {showModal && (
        <Modal title="Assign Follow-Up" onClose={() => setShowModal(false)} persistent>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '8px 12px', background: '#F0FDF4', borderRadius: 8, fontSize: 12, color: '#065F46' }}>
              Pick a batch to narrow the student and staff lists — email is auto-fetched from their account.
            </div>
            {(() => {
              const modalStudents = form.batchId ? batchStudentsList : students;
              const modalStaff = form.batchId ? batchStaffFor(form.batchId).filter(s => s.active !== false) : staff.filter(s => s.active !== false);
              return (
                <>
                  <div className="form-group">
                    <label className="form-label">Batch <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(optional — filters below)</span></label>
                    <select className="form-input" value={form.batchId}
                      onChange={e => setForm({ ...form, batchId: e.target.value, studentId: '', studentName: '', staffId: '' })}>
                      <option value="">All batches</option>
                      {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Student *</label>
                    <select className="form-input" required value={form.studentId}
                      onChange={e => {
                        const s = modalStudents.find(s => s.id === e.target.value);
                        setForm({ ...form, studentId: e.target.value, studentName: s?.name || '' });
                      }}>
                      <option value="">Select student</option>
                      {modalStudents.map(s => <option key={s.id} value={s.id}>{s.name}{s.course ? ` — ${s.course}` : ''}</option>)}
                    </select>
                    {form.batchId && modalStudents.length === 0 && <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 4 }}>No students in this batch.</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Assign To *</label>
                    <select className="form-input" required value={form.staffId}
                      onChange={e => setForm({ ...form, staffId: e.target.value })}>
                      <option value="">Select staff member</option>
                      {form.batchId && modalStaff.length > 0 && <option value="__all__">★ All staff of this batch ({modalStaff.length})</option>}
                      {modalStaff.map(s => <option key={s.id} value={s.id}>{s.name} — {s.access === 'admin' ? 'admin/staff' : s.role}</option>)}
                    </select>
                    {form.batchId && modalStaff.length === 0 && <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 4 }}>No staff assigned to this batch.</div>}
                    {form.staffId === '__all__' && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                        Will assign & notify all {modalStaff.length} staff: <strong>{modalStaff.map(s => s.name).join(', ')}</strong>
                      </div>
                    )}
                    {form.staffId && form.staffId !== '__all__' && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                        Will notify: <strong>{staff.find(s => s.id === form.staffId)?.email}</strong>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
            <div className="form-group">
              <label className="form-label">Instructions *</label>
              <textarea className="form-input" rows={3} required
                placeholder="What should the staff member do?"
                value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            </div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Next Action</label>
                <input className="form-input" placeholder="e.g. Call again tomorrow"
                  value={form.nextAction} onChange={e => setForm({ ...form, nextAction: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </FormRow>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Assigning...' : <><Mail size={14} /> Assign & Notify</>}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Complete Modal */}
      {completing && (
        <Modal title="Log & Complete Follow-Up" onClose={() => setCompleting(null)} persistent>
          <div style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, marginBottom: 14 }}>
            <div style={{ fontWeight: 500 }}>{completing.studentName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{completing.note}</div>
          </div>
          <div className="form-group">
            <label className="form-label">What did you do? *</label>
            <textarea className="form-input" rows={3}
              placeholder="Called student — answered, said will attend. / Visited home — parent confirmed enrolled..."
              value={completionNote} onChange={e => setCompletionNote(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => setCompleting(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleComplete} disabled={!completionNote.trim()}>
              <CheckCircle size={14} /> Mark Complete
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}