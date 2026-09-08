import { useEffect, useState } from 'react';
import { getDailyReports, addReport } from '../firebase/services';
import { Modal, Toast, Loading, FormRow } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Send, Plus, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name = '') { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACCENTS[h % ACCENTS.length]; }
function initials(name = '') { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }

function toDateStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN');
}
function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function isoToDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function Reports() {
  const { profile } = useAuth();
  const isCEO = profile?.role === 'ceo';

  const [allReports, setAllReports] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [dateFilter, setDateFilter] = useState('');   // ISO yyyy-mm-dd, CEO only

  const blankForm = () => ({
    studentsContacted: '',
    followupsDone:     '',
    newAdmissions:     '',
    problemsFound:     '',
    highlights:        '',
    challenges:        '',
    summary:           '',
  });
  const [form, setForm] = useState(blankForm());

  const load = async () => {
    const r = await getDailyReports({ role: profile?.role, uid: profile?.uid, email: profile?.email });
    setAllReports(r);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Filter: staff see only their own reports; CEO sees all (optionally by date)
  const reports = allReports.filter(r => {
    if (!isCEO) {
      return (
        r.staffEmail === profile?.email ||
        r.staffName  === profile?.name
      );
    }
    if (dateFilter) {
      const display = isoToDisplay(dateFilter);
      return r.date === display;
    }
    return true;
  });

  // Sort most-recent first (no orderBy in Firestore — sort in JS)
  const sorted = [...reports].sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });

  const totalCalls      = reports.reduce((s, r) => s + (Number(r.studentsContacted) || 0), 0);
  const totalFollowups  = reports.reduce((s, r) => s + (Number(r.followupsDone)     || 0), 0);
  const totalAdmissions = reports.reduce((s, r) => s + (Number(r.newAdmissions)     || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await addReport({
      ...form,
      staffName:  profile?.name  || '',
      staffEmail: profile?.email || '',
      date: new Date().toLocaleDateString('en-IN'),
    });
    setToast({ message: 'Report submitted successfully!', type: 'success' });
    setForm(blankForm());
    setShowModal(false);
    load();
    setSaving(false);
  };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  if (loading) return <Loading />;

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:18 }}>
        <div>
          <h2 style={{ fontSize:24, fontWeight:700 }}>Daily Reports</h2>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>
            {isCEO ? 'End-of-day summaries submitted by each staff member.' : `Your submitted reports, ${profile?.name || ''}.`}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {isCEO && (
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 10px' }}>
              <Calendar size={14} style={{ color:'var(--text-muted)' }}/>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ border:'none', background:'transparent', fontSize:13, color:'var(--text)', outline:'none', cursor:'pointer', fontFamily:'var(--font-body)' }}
              />
              {dateFilter && (
                <button onClick={() => setDateFilter('')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:0 }}>
                  ×
                </button>
              )}
            </div>
          )}
          {!isCEO && (
            <button className="btn btn-secondary btn-sm" style={{ height:40 }}>
              <Calendar size={14} /> {today}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Submit Report
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:16, marginBottom:18 }}>
        <div style={{ background:'var(--grad-brand)', borderRadius:14, padding:'16px 20px', color:'#fff', boxShadow:'var(--shadow-md)' }}>
          <div style={{ fontSize:12, color:'rgba(255,255,255,.85)' }}>
            {dateFilter && isCEO ? `Reports on ${isoToDisplay(dateFilter)}` : 'Total Reports'}
          </div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, lineHeight:1, marginTop:8 }}>{reports.length}</div>
        </div>
        <div className="card" style={{ padding:'16px 20px' }}>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>Calls Made</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, lineHeight:1, marginTop:8, color:'var(--teal-ink)' }}>{totalCalls}</div>
        </div>
        <div className="card" style={{ padding:'16px 20px' }}>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>Follow-ups Closed</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, lineHeight:1, marginTop:8, color:'var(--green-ink)' }}>{totalFollowups}</div>
        </div>
        <div className="card" style={{ padding:'16px 20px' }}>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>New Admissions</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, lineHeight:1, marginTop:8, color:'var(--amber-ink)' }}>{totalAdmissions}</div>
        </div>
      </div>

      {/* CEO date label */}
      {isCEO && dateFilter && (
        <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:10 }}>
          Showing reports for <strong>{isoToDisplay(dateFilter)}</strong> · {sorted.length} result{sorted.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Report card list */}
      <div style={{ display:'flex', flexDirection:'column', gap:12, maxWidth:980 }}>
        {sorted.length === 0 && (
          <div style={{ padding:'48px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13.5, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14 }}>
            {isCEO && dateFilter ? `No reports found for ${isoToDisplay(dateFilter)}.` : 'No reports submitted yet.'}
          </div>
        )}
        {sorted.map(r => {
          const metrics = [
            { value: r.studentsContacted, label: 'calls',      color: 'var(--teal-ink)'  },
            { value: r.followupsDone,     label: 'follow-ups', color: 'var(--green-ink)' },
            { value: r.newAdmissions,     label: 'onboarded',  color: 'var(--blue-ink)'  },
            { value: r.problemsFound,     label: 'problems',   color: 'var(--amber-ink)' },
          ].filter(m => m.value);
          return (
            <div key={r.id} className="card" style={{ padding:'16px 20px' }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
                <div style={{ width:40, height:40, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, color:'#fff', flexShrink:0, background:avatarColor(r.staffName || '') }}>{initials(r.staffName || '')}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14, fontWeight:600 }}>{r.staffName || '—'}</span>
                    <span style={{ flex:1 }} />
                    <span style={{ fontSize:11.5, color:'var(--text-muted)' }}>{r.date || ''}{formatTime(r.createdAt) ? ` · ${formatTime(r.createdAt)}` : ''}</span>
                    <span className="badge badge-green"><span className="dot" />Submitted</span>
                  </div>

                  {/* Narrative sections */}
                  {r.highlights && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:3 }}>Highlights</div>
                      <div style={{ fontSize:13, color:'var(--text-sub)', lineHeight:1.55 }}>{r.highlights}</div>
                    </div>
                  )}
                  {r.challenges && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:3 }}>Challenges</div>
                      <div style={{ fontSize:13, color:'var(--text-sub)', lineHeight:1.55 }}>{r.challenges}</div>
                    </div>
                  )}
                  {r.summary && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:3 }}>Summary / Notes</div>
                      <div style={{ fontSize:13, color:'var(--text-sub)', lineHeight:1.55 }}>{r.summary}</div>
                    </div>
                  )}

                  {/* Metric chips */}
                  {metrics.length > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:12, flexWrap:'wrap' }}>
                      {metrics.map(m => (
                        <span key={m.label} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--surface-sunken)', borderRadius:8, padding:'5px 10px', fontSize:11.5, color:'var(--text-sub)' }}>
                          <span style={{ fontFamily:'var(--font-display)', fontWeight:700, color:m.color }}>{m.value}</span>{m.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit modal */}
      {showModal && (
        <Modal title="Submit Today's Report" onClose={() => { setShowModal(false); setForm(blankForm()); }} persistent>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Staff name — auto-filled, read-only */}
            <div className="form-group">
              <label className="form-label">Staff Member</label>
              <div style={{ padding:'8px 12px', background:'var(--surface-sunken)', border:'1px solid var(--border)', borderRadius:8, fontSize:13, color:'var(--text)', display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:avatarColor(profile?.name||''), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(profile?.name||'')}</div>
                <span style={{ fontWeight:500 }}>{profile?.name || profile?.email || '—'}</span>
              </div>
            </div>

            {/* Key metrics row */}
            <FormRow>
              <div className="form-group">
                <label className="form-label">Students Contacted</label>
                <input className="form-input" type="number" min="0" placeholder="0" value={form.studentsContacted} onChange={e => setForm({ ...form, studentsContacted: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Follow-Ups Done</label>
                <input className="form-input" type="number" min="0" placeholder="0" value={form.followupsDone} onChange={e => setForm({ ...form, followupsDone: e.target.value })} />
              </div>
            </FormRow>
            <FormRow>
              <div className="form-group">
                <label className="form-label">New Admissions</label>
                <input className="form-input" type="number" min="0" placeholder="0" value={form.newAdmissions} onChange={e => setForm({ ...form, newAdmissions: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Problems / Issues Found</label>
                <input className="form-input" type="number" min="0" placeholder="0" value={form.problemsFound} onChange={e => setForm({ ...form, problemsFound: e.target.value })} />
              </div>
            </FormRow>

            {/* Narrative fields */}
            <div className="form-group">
              <label className="form-label">Today's Highlights</label>
              <textarea className="form-input" rows={3} placeholder="What went well today? Key wins, successful calls, admissions closed..." value={form.highlights} onChange={e => setForm({ ...form, highlights: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Challenges Faced</label>
              <textarea className="form-input" rows={3} placeholder="Any blockers, student issues, or things that need attention..." value={form.challenges} onChange={e => setForm({ ...form, challenges: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Additional Notes for CEO</label>
              <textarea className="form-input" rows={3} placeholder="Anything else the CEO should know — escalations, ideas, observations..." value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowModal(false); setForm(blankForm()); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Send size={15} /> {saving ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
