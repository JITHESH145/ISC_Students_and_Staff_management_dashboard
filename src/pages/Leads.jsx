import { useEffect, useState } from 'react';
import { getLeads, addLead, updateLead } from '../firebase/services';
import { Modal, Toast, Loading, FormRow } from '../components/ui';
import { Plus, Search, ArrowRight } from 'lucide-react';

const STAGES = ['lead', 'counselling', 'demo', 'enrolled', 'active'];
const STAGE_LABELS = { lead: 'Lead', counselling: 'Counselling', demo: 'Demo Class', enrolled: 'Enrolled', active: 'Active Student' };
const COURSES = ['Python', 'Data Science', 'Web Development', 'Machine Learning', 'Digital Marketing', 'Other'];

const STAGE_STYLE = {
  lead:        { bg: 'var(--slate-soft)',  ink: 'var(--slate-ink)',  headerBg: 'var(--slate-soft)',  bar: 'var(--slate-soft)',  badgeClass: 'badge-gray'   },
  counselling: { bg: 'var(--blue-soft)',   ink: 'var(--blue-ink)',   headerBg: 'var(--blue-soft)',   bar: 'var(--blue-soft)',   badgeClass: 'badge-blue'   },
  demo:        { bg: 'var(--amber-soft)',  ink: 'var(--amber-ink)',  headerBg: 'var(--amber-soft)',  bar: 'var(--amber-soft)',  badgeClass: 'badge-amber'  },
  enrolled:    { bg: 'var(--violet-soft)', ink: 'var(--violet-ink)', headerBg: 'var(--violet-soft)', bar: 'var(--violet-soft)', badgeClass: 'badge-violet' },
  active:      { bg: 'var(--green-soft)',  ink: 'var(--green-ink)',  headerBg: 'var(--green-soft)',  bar: 'var(--green-soft)',  badgeClass: 'badge-green'  },
};

const STAGE_BAR_COLOR = {
  lead: '#94A3B8', counselling: '#3B82F6', demo: '#F59E0B', enrolled: '#8B5CF6', active: '#10B981',
};

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', course: '', source: '', notes: '' });
  const [view, setView] = useState('kanban');

  const load = async () => {
    const l = await getLeads();
    setLeads(l);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchQ = !q || l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.course?.toLowerCase().includes(q);
    const matchS = !stageFilter || l.stage === stageFilter;
    return matchQ && matchS;
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    await addLead(form);
    setToast({ message: 'Lead added!', type: 'success' });
    setShowModal(false);
    setForm({ name: '', phone: '', email: '', course: '', source: '', notes: '' });
    load();
    setSaving(false);
  };

  const advanceStage = async (lead) => {
    const idx = STAGES.indexOf(lead.stage);
    if (idx < STAGES.length - 1) {
      await updateLead(lead.id, { stage: STAGES[idx + 1] });
      load();
    }
  };

  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  // Funnel counts
  const stageCounts = {};
  STAGES.forEach(s => { stageCounts[s] = leads.filter(l => l.stage === s).length; });
  const totalLeads = leads.length || 1;

  if (loading) return <Loading />;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>Lead Pipeline</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Track prospects from first contact to active student.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Lead
        </button>
      </div>

      {/* Funnel KPI Row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {STAGES.map(stage => {
          const s = STAGE_STYLE[stage];
          return (
            <div key={stage} style={{
              flex: '1 1 120px',
              background: s.bg,
              color: s.ink,
              borderRadius: 12,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 100,
              marginBottom: 0,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{stageCounts[stage]}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{STAGE_LABELS[stage]}</div>
            </div>
          );
        })}
      </div>

      {/* Filter Bar + Board/List Toggle */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            placeholder="Search name, phone, course..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 180 }}
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
        >
          <option value="">All Stages</option>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>

        {/* Board / List Toggle */}
        <div style={{
          display: 'flex',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {['kanban', 'list'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                background: view === v ? 'var(--brand)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {v === 'kanban' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 8 }}>
          {STAGES.map(stage => {
            const s = STAGE_STYLE[stage];
            const colLeads = filtered.filter(l => l.stage === stage);
            const stageIdx = STAGES.indexOf(stage);
            return (
              <div key={stage} style={{
                width: 240, flexShrink: 0,
                background: 'var(--surface)',
                borderRadius: 12,
                border: '1px solid var(--border)',
                overflow: 'hidden',
              }}>
                {/* Column Header */}
                <div style={{
                  background: s.headerBg,
                  borderLeft: `3px solid ${STAGE_BAR_COLOR[stage]}`,
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: s.ink, flex: 1 }}>
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className={`badge ${s.badgeClass}`}>{colLeads.length}</span>
                </div>

                {/* Cards */}
                <div style={{ padding: 8, minHeight: 100 }}>
                  {colLeads.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                      No leads
                    </div>
                  )}
                  {colLeads.map(lead => (
                    <div key={lead.id} style={{
                      background: 'var(--surface)',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      padding: 12,
                      marginBottom: 8,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
                        {lead.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {lead.phone || '—'}
                      </div>
                      {lead.course && (
                        <div style={{ marginBottom: 6 }}>
                          <span className="badge badge-indigo">{lead.course}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: stageIdx < STAGES.length - 1 ? 8 : 0 }}>
                        {formatDate(lead.createdAt)}
                      </div>
                      {stageIdx < STAGES.length - 1 && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center' }}
                          onClick={() => advanceStage(lead)}
                        >
                          {STAGE_LABELS[STAGES[stageIdx + 1]]} <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List/Table View */}
      {view === 'list' && (
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Course</th><th>Source</th><th>Stage</th><th>Added</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No leads found.</td></tr>
              )}
              {filtered.map(lead => {
                const stageIdx = STAGES.indexOf(lead.stage);
                const s = STAGE_STYLE[lead.stage] || STAGE_STYLE.lead;
                return (
                  <tr key={lead.id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{lead.name}</div>
                      {lead.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lead.email}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>{lead.phone || '—'}</td>
                    <td style={{ fontSize: 13 }}>{lead.course || '—'}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{lead.source || '—'}</td>
                    <td>
                      <span className={`badge ${s.badgeClass}`}>{STAGE_LABELS[lead.stage]}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(lead.createdAt)}</td>
                    <td>
                      {stageIdx < STAGES.length - 1 && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => advanceStage(lead)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                        >
                          {STAGE_LABELS[STAGES[stageIdx + 1]]} <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Add Lead */}
      {showModal && (
        <Modal title="Add New Lead" onClose={() => setShowModal(false)} persistent>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Phone *</label>
                <input className="form-input" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </FormRow>
            <FormRow>
              <div className="form-group">
                <label className="form-label">Course Interested In</label>
                <select className="form-input" value={form.course} onChange={e => setForm({ ...form, course: e.target.value })}>
                  <option value="">Select</option>
                  {COURSES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Source</label>
                <select className="form-input" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
                  <option value="">Select</option>
                  <option>Instagram</option>
                  <option>WhatsApp</option>
                  <option>Referral</option>
                  <option>Walk-in</option>
                  <option>Website</option>
                  <option>Other</option>
                </select>
              </div>
            </FormRow>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any additional info..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Add Lead'}</button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
