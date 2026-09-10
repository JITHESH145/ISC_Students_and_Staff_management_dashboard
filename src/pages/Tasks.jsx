import { useEffect, useState } from 'react';
import { getTasks, addTask, updateTask, addNotification, notifyStaff, getStaffProfiles } from '../firebase/services';
import { Modal, Toast, Loading, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Flag, Calendar, LayoutGrid, List, Mail } from 'lucide-react';

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name=''){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;return ACCENTS[h%ACCENTS.length];}
function initials(name=''){const p=name.trim().split(/\s+/);return((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()||'?';}

const COLUMNS = [
  { key:'pending',     label:'TO DO',       dot:'var(--slate)', badge:'badge-gray'  },
  { key:'in-progress', label:'IN PROGRESS', dot:'var(--blue)',  badge:'badge-blue'  },
  { key:'completed',   label:'DONE',        dot:'var(--green)', badge:'badge-green' },
];

const PRIO = {
  urgent: { label:'Urgent', flag:'var(--red-ink)'    },
  high:   { label:'High',   flag:'var(--orange-ink)' },
  normal: { label:'Normal', flag:'var(--slate)'      },
  low:    { label:'Low',    flag:'var(--blue-ink)'   },
};

const LABELS = {
  'Outreach':   'badge-pink',
  'Data':       'badge-blue',
  'Fees':       'badge-amber',
  'Onboarding': 'badge-green',
  'Follow-up':  'badge-teal',
  'Assessment': 'badge-violet',
  'Docs':       'badge-gray',
};

export default function Tasks() {
  const { profile, user } = useAuth();
  const [tasks, setTasks]         = useState([]);
  const [staff, setStaff]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({ title:'', staffId:'', dueDate:'', priority:'normal', notes:'', label:'' });
  const [search, setSearch]           = useState('');
  const [prioFilter, setPrioFilter]   = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [view, setView]               = useState('board');

  const isCEOorAdmin = profile?.role === 'ceo';

  const load = async () => {
    // Server-side scoping: staff query only their own tasks (rules
    // reject an unscoped read for them).
    const scope = { role: profile?.role, uid: profile?.uid, email: user?.email };
    const [allTasks, allStaff] = await Promise.all([getTasks(scope), getStaffProfiles()]);
    setTasks(allTasks);
    setStaff(allStaff.filter(s => s.active !== false && s.role !== 'ceo'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const selectedStaff = staff.find(s => s.id === form.staffId);
      if (!selectedStaff) {
        setToast({ message:'Please select a staff member.', type:'error' });
        setSaving(false);
        return;
      }
      const taskData = {
        title:           form.title,
        assignedTo:      selectedStaff.name,
        assignedToEmail: selectedStaff.email,
        dueDate:         form.dueDate,
        priority:        form.priority,
        notes:           form.notes,
        label:           form.label,
        assignedBy:      profile?.name,
        assignedByEmail: user?.email,
      };
      await addTask(taskData);
      // In-app + email together (email best-effort via /api/send-email).
      // `details` renders as a structured table in the email.
      await notifyStaff({
        toEmail:  selectedStaff.email,
        type:     'task',
        title:    'New Task Assigned',
        body:     `New task: "${form.title}"${form.dueDate ? ` — due ${form.dueDate}` : ''}`,
        route:    '/tasks',
        fromName: profile?.name,
        intro:    `Hi ${selectedStaff.name}, a new task has been assigned to you on ISC SMS.`,
        details: [
          { label: 'Task',        value: form.title },
          { label: 'Assigned by', value: `${profile?.name || 'ISC SMS'}${user?.email ? ` (${user.email})` : ''}` },
          { label: 'Due date',    value: form.dueDate },
          { label: 'Priority',    value: PRIO[form.priority]?.label || form.priority },
          { label: 'Category',    value: form.label },
          { label: 'Notes',       value: form.notes },
        ].filter(d => d.value),
      });
      setToast({ message:`Task assigned to ${selectedStaff.name}!`, type:'success' });
      setShowModal(false);
      setForm({ title:'', staffId:'', dueDate:'', priority:'normal', notes:'', label:'' });
      load();
    } catch (err) {
      setToast({ message:'Failed to assign task: ' + err.message, type:'error' });
    } finally {
      setSaving(false);
    }
  };

  const moveTask = async (id, newStatus) => {
    await updateTask(id, { status: newStatus });
    load();
  };

  // Complete-with-note flow (staff writes a short note the CEO can read)
  const [completing, setCompleting] = useState(null); // task being completed
  const [doneNote,   setDoneNote]   = useState('');

  const handleComplete = async () => {
    if (!completing) return;
    setSaving(true);
    try {
      await updateTask(completing.id, {
        status: 'completed',
        completionNote: doneNote.trim(),
        completedBy: profile?.name || user?.email || '',
        completedAt: new Date().toISOString(),
      });
      if (completing.assignedByEmail && completing.assignedByEmail !== user?.email) {
        await addNotification({
          toEmail:  completing.assignedByEmail,
          toName:   completing.assignedBy || '',
          fromName: profile?.name,
          type:     'task',
          message:  `Task completed: "${completing.title}"${doneNote.trim() ? ` — ${doneNote.trim()}` : ''}`,
        });
      }
      setToast({ message: 'Task marked as completed!', type: 'success' });
      setCompleting(null); setDoneNote('');
      load();
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setSaving(false);
  };

  if (loading) return <Loading />;

  const allFiltered = tasks.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.title?.toLowerCase().includes(q) && !t.assignedTo?.toLowerCase().includes(q)) return false;
    if (prioFilter && t.priority !== prioFilter) return false;
    if (assigneeFilter && t.assignedTo !== assigneeFilter) return false;
    return true;
  });

  const grouped = { pending:[], 'in-progress':[], completed:[] };
  allFiltered.forEach(t => { (grouped[t.status] || grouped.pending).push(t); });

  const teamNames = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))];
  const hasFilters = !!search || !!prioFilter || !!assigneeFilter;

  const cardHover = (el, on) => {
    el.style.boxShadow = on ? 'var(--shadow-md)' : 'var(--shadow-sm)';
    el.style.transform = on ? 'translateY(-1px)' : 'translateY(0)';
  };

  return (
    <div>
      {/* Page Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:18 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <h2 style={{ fontSize:24, fontWeight:700 }}>Staff Tasks</h2>
            <span className="badge badge-gray" style={{ fontSize:11.5 }}>Sprint board</span>
          </div>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>
            Assign and track your team's work — drag a card across columns to update its status.
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          {/* Team avatar stack */}
          {teamNames.length > 0 && (
            <div style={{ display:'flex', alignItems:'center' }}>
              {teamNames.slice(0,6).map((name, i) => (
                <div key={name} title={name} style={{
                  width:30, height:30, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                  fontFamily:'var(--font-display)', fontWeight:700, fontSize:11, color:'#fff',
                  boxShadow:'0 0 0 2px var(--surface)', background:avatarColor(name),
                  marginLeft: i === 0 ? 0 : -8, zIndex: 6-i,
                }}>
                  {initials(name)}
                </div>
              ))}
            </div>
          )}
          {isCEOorAdmin && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Assign Task
            </button>
          )}
        </div>
      </div>

      {/* Info Banner */}
      {isCEOorAdmin && (
        <div style={{ padding:'10px 14px', background:'var(--blue-soft)', borderRadius:10, fontSize:12, color:'var(--blue-ink)', marginBottom:16, display:'flex', gap:8, alignItems:'center' }}>
          <Mail size={14} />
          Staff receive an email + in-app notification instantly when you assign a task. Email is pulled automatically from their account.
        </div>
      )}

      {/* Toolbar */}
      <div className="mobile-stack" style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:18 }}>
        <div className="search-bar" style={{ width:280 }}>
          <Search size={15} style={{ color:'var(--text-muted)' }} />
          <input placeholder="Search board by task or assignee…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Assignee dropdown filter (clear, name-based) */}
        {teamNames.length > 0 && (
          <select className="form-input" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
            style={{ width:'auto', height:36, minWidth:150 }}>
            <option value="">All staff</option>
            {teamNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}

        <select className="form-input" value={prioFilter} onChange={e => setPrioFilter(e.target.value)}
          style={{ width:'auto', height:36, minWidth:130 }}>
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        {hasFilters && (
          <button className="btn btn-ghost btn-sm" style={{ height:36 }}
            onClick={() => { setSearch(''); setPrioFilter(''); setAssigneeFilter(''); }}>
            Clear filters
          </button>
        )}

        <div style={{ flex:1 }} />

        <span style={{ fontSize:12.5, color:'var(--text-muted)' }}>
          {allFiltered.length} of {tasks.length} tasks
        </span>

        {/* Board / List toggle */}
        <div style={{ display:'inline-flex', background:'var(--surface-sunken)', borderRadius:10, padding:3, gap:3 }}>
          {[
            { key:'board', Icon: LayoutGrid, label:'Board' },
            { key:'list',  Icon: List,       label:'List'  },
          ].map(({ key, Icon, label }) => (
            <button key={key} onClick={() => setView(key)} style={{
              display:'flex', alignItems:'center', gap:6, padding:'6px 12px', border:'none', borderRadius:8,
              fontSize:12.5, fontWeight:600, cursor:'pointer',
              background: view === key ? 'var(--surface)' : 'transparent',
              color:      view === key ? 'var(--text)'    : 'var(--text-muted)',
              boxShadow:  view === key ? 'var(--shadow-xs)' : 'none',
            }}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Board View */}
      {view === 'board' && (
        <div className="task-board" style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
          {COLUMNS.map(col => {
            const colTasks = grouped[col.key] || [];
            return (
              <div key={col.key} style={{ flex:1, minWidth:0, background:'var(--surface-sunken)', border:'1px solid transparent', borderRadius:14, padding:6, transition:'background .15s, border-color .15s' }}>
                {/* Column Header */}
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px 8px' }}>
                  <span style={{ width:9, height:9, borderRadius:'50%', background:col.dot, flexShrink:0 }} />
                  <span style={{ fontSize:12.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', color:'var(--text-sub)', flex:1 }}>
                    {col.label}
                  </span>
                  <span className={`badge ${col.badge}`} style={{ fontSize:11 }}>{colTasks.length}</span>
                </div>

                {/* Cards */}
                <div style={{ display:'flex', flexDirection:'column', gap:9, padding:4, minHeight:120 }}>
                  {colTasks.length === 0 && (
                    <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:13, padding:'32px 0' }}>No tasks</div>
                  )}
                  {colTasks.map(task => {
                    const prio = PRIO[task.priority] || PRIO.normal;
                    const labelCls = LABELS[task.label] || 'badge-gray';
                    return (
                      <div
                        key={task.id}
                        style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'13px 14px', boxShadow:'var(--shadow-sm)', cursor:'grab', transition:'box-shadow .15s, transform .12s' }}
                        onMouseEnter={e => cardHover(e.currentTarget, true)}
                        onMouseLeave={e => cardHover(e.currentTarget, false)}
                      >
                        {/* Card top: label badge + key */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                          <span className={`badge ${labelCls}`} style={{ fontSize:10.5, padding:'2px 8px' }}>
                            {task.label || 'Task'}
                          </span>
                          <span style={{ fontFamily:'var(--font-display)', fontSize:11, fontWeight:600, color:'var(--text-muted)', letterSpacing:'.02em' }}>
                            {task.key || ''}
                          </span>
                        </div>

                        {/* Title */}
                        <div style={{ fontSize:13.5, fontWeight:500, lineHeight:1.4, color:'var(--text)' }}>
                          {task.title}
                        </div>

                        {/* Bottom row */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginTop:11 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11.5, fontWeight:600, color:prio.flag }}>
                              <Flag size={13} /> {prio.label}
                            </span>
                            {task.dueDate && (
                              <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11.5, color:'var(--text-muted)' }}>
                                <Calendar size={13} /> {task.dueDate}
                              </span>
                            )}
                          </div>
                          {/* Assignee: avatar + name so it is clear who owns the card */}
                          <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                            <div title={task.assignedTo} style={{
                              width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                              fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, color:'#fff', flexShrink:0,
                              background:avatarColor(task.assignedTo||''),
                            }}>
                              {initials(task.assignedTo||'')}
                            </div>
                            <span style={{ fontSize:11.5, fontWeight:600, color:'var(--text-sub)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:96 }}>
                              {task.assignedTo || '—'}
                            </span>
                          </div>
                        </div>

                        {/* Completion note (visible once completed) */}
                        {col.key === 'completed' && task.completionNote && (
                          <div style={{ marginTop:9, padding:'7px 10px', background:'var(--green-soft)', borderRadius:8, fontSize:11.5, color:'var(--green-ink)', lineHeight:1.45 }}>
                            <strong>Note:</strong> {task.completionNote}
                            {task.completedBy && <span style={{ opacity:.75 }}> — {task.completedBy}</span>}
                          </div>
                        )}

                        {/* Move buttons — CEO/admin or the assigned staff member */}
                        {(isCEOorAdmin || task.assignedToEmail === user?.email) && (
                          <div style={{ display:'flex', gap:6, marginTop:10, borderTop:'1px solid var(--border)', paddingTop:8 }}>
                            {col.key !== 'pending' && (
                              <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }}
                                onClick={() => moveTask(task.id, col.key === 'in-progress' ? 'pending' : 'in-progress')}>
                                Back
                              </button>
                            )}
                            {col.key === 'pending' && (
                              <button className="btn btn-primary btn-sm" style={{ fontSize:11 }}
                                onClick={() => moveTask(task.id, 'in-progress')}>
                                Start
                              </button>
                            )}
                            {col.key === 'in-progress' && (
                              <button className="btn btn-primary btn-sm" style={{ fontSize:11 }}
                                onClick={() => { setCompleting(task); setDoneNote(''); }}>
                                Complete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width:80 }}>Key</th>
                <th>Summary</th>
                <th style={{ width:120 }}>Label</th>
                <th style={{ width:120 }}>Priority</th>
                <th style={{ width:130 }}>Status</th>
                <th style={{ width:170 }}>Assignee</th>
                <th style={{ width:110 }}>Due</th>
              </tr>
            </thead>
            <tbody>
              {allFiltered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding:48, fontSize:13.5 }}>No tasks match your filters.</td></tr>
              )}
              {allFiltered.map(task => {
                const prio = PRIO[task.priority] || PRIO.normal;
                const labelCls = LABELS[task.label] || 'badge-gray';
                const col = COLUMNS.find(c => c.key === (task.status || 'pending')) || COLUMNS[0];
                return (
                  <tr key={task.id} style={{ cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background=''}>
                    <td style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:12, color:'var(--text-muted)' }}>{task.key || '—'}</td>
                    <td style={{ fontWeight:500 }}>{task.title}</td>
                    <td><span className={`badge ${labelCls}`} style={{ fontSize:11 }}>{task.label || 'Task'}</span></td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, color:prio.flag }}>
                        <Flag size={13} /> {prio.label}
                      </span>
                    </td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:12.5, color:'var(--text-sub)' }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:col.dot }} />
                        {col.label}
                      </span>
                    </td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:9.5, color:'#fff', background:avatarColor(task.assignedTo||'') }}>
                          {initials(task.assignedTo||'')}
                        </span>
                        <span style={{ fontSize:12.5 }}>{task.assignedTo || '—'}</span>
                      </span>
                    </td>
                    <td style={{ fontSize:12.5, color:'var(--text-sub)' }}>{task.dueDate || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Assign Task */}
      {showModal && (
        <Modal title="Assign Task to Staff" onClose={() => setShowModal(false)} persistent>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ padding:'10px 12px', background:'var(--blue-soft)', borderRadius:8, fontSize:12, color:'var(--blue-ink)' }}>
              Staff email is pulled automatically from their account — you just select their name.
            </div>
            <div className="form-group">
              <label className="form-label">Task Title *</label>
              <input className="form-input" required placeholder="e.g. Call 20 at-risk students"
                value={form.title} onChange={e => setForm({ ...form, title:e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Assign To *</label>
              <select className="form-input" required value={form.staffId}
                onChange={e => setForm({ ...form, staffId:e.target.value })}>
                <option value="">Select staff member</option>
                {staff.filter(s=>s.active!==false).map(s => <option key={s.id} value={s.id}>{s.name} — {s.access === 'admin' ? 'admin/staff' : s.role}</option>)}
              </select>
              {form.staffId && (
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                  Email notification will go to: <strong>{staff.find(s => s.id === form.staffId)?.email}</strong>
                </div>
              )}
            </div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Label</label>
                <select className="form-input" value={form.label} onChange={e => setForm({ ...form, label:e.target.value })}>
                  <option value="">Select label</option>
                  {Object.keys(LABELS).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-input" value={form.priority} onChange={e => setForm({ ...form, priority:e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </FormRow>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.dueDate}
                onChange={e => setForm({ ...form, dueDate:e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={2} placeholder="Additional instructions…"
                value={form.notes} onChange={e => setForm({ ...form, notes:e.target.value })} />
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Mail size={14} /> {saving ? 'Assigning…' : 'Assign & Notify'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Complete with note modal */}
      {completing && (
        <Modal title={`Complete — ${completing.title}`} onClose={() => setCompleting(null)} persistent>
          <div style={{ fontSize:13, color:'var(--text-sub)', marginBottom:12, lineHeight:1.5 }}>
            Add a short note about what was done. This is visible to the person who assigned the task.
          </div>
          <textarea className="form-input" rows={3} autoFocus required
            placeholder="e.g. Called all 12 parents, 2 need follow-up next week…"
            value={doneNote} onChange={e => setDoneNote(e.target.value)}/>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
            <button className="btn btn-ghost" onClick={() => setCompleting(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !doneNote.trim()} onClick={handleComplete}>
              {saving ? 'Saving…' : 'Mark Completed'}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
