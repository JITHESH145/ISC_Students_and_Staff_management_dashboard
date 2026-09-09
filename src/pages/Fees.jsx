import { useEffect, useState } from 'react';
import { getBatches, getBatchStudents, getFeesByBatch, saveFee } from '../firebase/services';
import { useAuth } from '../context/AuthContext';
import { Modal, Toast, Loading, Confirm } from '../components/ui';
import { Wallet, Plus, Search, Trash2, Edit2, CheckCircle, TrendingUp, AlertTriangle } from 'lucide-react';

const METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'];
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const todayStr = () => new Date().toISOString().slice(0, 10);
const pid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const STATUS_META = {
  paid:    { c: 'var(--green-ink)', bg: 'var(--pos-50)', label: 'Paid' },
  partial: { c: 'var(--amber-ink)', bg: 'var(--amber-soft)', label: 'Partial' },
  unpaid:  { c: 'var(--red-ink)',   bg: 'var(--neg-50)', label: 'Unpaid' },
};

const calcFee = (fee) => {
  const total = Number(fee?.totalFee || 0);
  const paid = (fee?.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const balance = total - paid;
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : (paid > 0 ? 100 : 0);
  const status = total > 0 && paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  const overdue = balance > 0.01 && fee?.dueDate && fee.dueDate < todayStr();
  return { total, paid, balance, pct, status, overdue };
};

// Circular progress ring — the signature element of each student card.
function Ring({ pct, color, size = 56, stroke = 6 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, color }}>{pct}%</div>
    </div>
  );
}

export default function Fees() {
  const { profile } = useAuth();
  const scope = { role: profile?.role, uid: profile?.uid, email: profile?.email };

  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState([]);            // { student, fee }
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmBox, setConfirmBox] = useState(null);

  // Fee editor modal
  const [feeStudent, setFeeStudent] = useState(null);
  const [draftTotal, setDraftTotal] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [draftPayments, setDraftPayments] = useState([]);
  const [payForm, setPayForm] = useState({ amount: '', date: todayStr(), method: 'Cash', note: '' });
  const [editingPayId, setEditingPayId] = useState(null);
  const [savingFee, setSavingFee] = useState(false);

  useEffect(() => {
    getBatches().then(bs => {
      const list = (bs || []).filter(b => b.status !== 'archived');
      setBatches(list);
      setBatchId(prev => prev || list[0]?.id || '');
    }).catch(() => {});
  }, []);

  const loadBatch = async (bid) => {
    if (!bid) { setRows([]); return; }
    setLoading(true);
    const [studentsRes, fees] = await Promise.all([
      getBatchStudents(bid, scope).catch(() => ({ students: [] })),
      getFeesByBatch(bid, scope).catch(() => []),
    ]);
    const feeMap = {};
    fees.forEach(f => { feeMap[f.studentId || f.id] = f; });
    const merged = (studentsRes.students || []).map(s => ({
      student: s,
      fee: feeMap[s.id] || { studentId: s.id, totalFee: 0, payments: [] },
    }));
    setRows(merged);
    setLoading(false);
  };
  useEffect(() => { loadBatch(batchId); /* eslint-disable-next-line */ }, [batchId]);

  const batchName = batches.find(b => b.id === batchId)?.name || '';

  // KPIs across the whole batch
  const kpi = rows.reduce((a, { fee }) => {
    const c = calcFee(fee);
    a.expected += c.total; a.collected += c.paid;
    if (c.status === 'paid') a.paidCount++;
    if (c.overdue) a.overdue++;
    return a;
  }, { expected: 0, collected: 0, paidCount: 0, overdue: 0 });
  const outstanding = kpi.expected - kpi.collected;
  const rate = kpi.expected > 0 ? Math.round((kpi.collected / kpi.expected) * 100) : 0;

  const filtered = rows.filter(({ student, fee }) => {
    const { status } = calcFee(fee);
    if (statusFilter && status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return student.name?.toLowerCase().includes(q) || (student.phone || '').includes(search);
  });

  // ── Fee editor ────────────────────────────────────────────────
  const openFee = ({ student, fee }) => {
    setFeeStudent(student);
    setDraftTotal(fee.totalFee ? String(fee.totalFee) : '');
    setDraftDue(fee.dueDate || '');
    setDraftPayments([...(fee.payments || [])]);
    setPayForm({ amount: '', date: todayStr(), method: 'Cash', note: '' });
    setEditingPayId(null);
  };
  const closeFee = () => { setFeeStudent(null); setEditingPayId(null); };

  const addOrUpdatePayment = () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) { setToast({ message: 'Enter a valid payment amount.', type: 'error' }); return; }
    if (editingPayId) {
      setDraftPayments(prev => prev.map(p => p.id === editingPayId
        ? { ...p, amount, date: payForm.date, method: payForm.method, note: payForm.note.trim() } : p));
    } else {
      setDraftPayments(prev => [...prev, {
        id: pid(), amount, date: payForm.date, method: payForm.method, note: payForm.note.trim(),
        recordedBy: profile?.uid || '', recordedByName: profile?.name || 'Staff', recordedAt: new Date().toISOString(),
      }]);
    }
    setPayForm({ amount: '', date: todayStr(), method: 'Cash', note: '' });
    setEditingPayId(null);
  };
  const editPayment = (p) => { setEditingPayId(p.id); setPayForm({ amount: String(p.amount), date: p.date || todayStr(), method: p.method || 'Cash', note: p.note || '' }); };
  const removePayment = (id) => setDraftPayments(prev => prev.filter(p => p.id !== id));

  const saveFeeDoc = async () => {
    if (!feeStudent) return;
    setSavingFee(true);
    const payload = {
      studentId: feeStudent.id,
      studentName: feeStudent.name || '',
      batchId,
      batchName,
      totalFee: Number(draftTotal || 0),
      dueDate: draftDue || '',
      payments: draftPayments,
    };
    try {
      await saveFee(feeStudent.id, payload);
      setToast({ message: 'Fee record saved.', type: 'success' });
      closeFee();
      await loadBatch(batchId);
    } catch {
      setToast({ message: 'Could not save the fee record.', type: 'error' });
    }
    setSavingFee(false);
  };

  const draftPaid = draftPayments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const draftBalance = Number(draftTotal || 0) - draftPaid;

  const KPI = ({ label, value, sub, color, bg, icon: Icon }) => (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color }}>
        <Icon size={19} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>Fees</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>Track and record student fee payments per batch.</p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" style={{ width: 'auto', minWidth: 200, height: 40 }} value={batchId} onChange={e => setBatchId(e.target.value)}>
          <option value="">Select a batch…</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180, maxWidth: 340 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input className="form-input" style={{ height: 40, paddingLeft: 34, width: '100%' }} placeholder="Search student by name or phone…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
          {[{ k: '', l: 'All' }, { k: 'unpaid', l: 'Unpaid' }, { k: 'partial', l: 'Partial' }, { k: 'paid', l: 'Paid' }].map(f => (
            <span key={f.k} onClick={() => setStatusFilter(f.k)}
              style={{ padding: '6px 13px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                background: statusFilter === f.k ? 'var(--accent-50)' : 'transparent',
                color: statusFilter === f.k ? 'var(--accent-ink)' : 'var(--muted)' }}>{f.l}</span>
          ))}
        </div>
      </div>

      {/* KPI band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 18 }}>
        <KPI label="Expected" value={inr(kpi.expected)} sub={`${rows.length} students`} color="var(--info)" bg="var(--blue-soft)" icon={Wallet} />
        <KPI label="Collected" value={inr(kpi.collected)} sub={`${rate}% collected`} color="var(--green-ink)" bg="var(--pos-50)" icon={CheckCircle} />
        <KPI label="Outstanding" value={inr(outstanding)} sub={kpi.overdue ? `${kpi.overdue} overdue` : 'On track'} color="var(--red-ink)" bg="var(--neg-50)" icon={TrendingUp} />
        <KPI label="Fully Paid" value={`${kpi.paidCount}/${rows.length}`} sub="students cleared" color="var(--accent-ink)" bg="var(--accent-50)" icon={CheckCircle} />
      </div>

      {loading ? <Loading /> : !batchId ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>Select a batch to view its fees.</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
          {rows.length === 0 ? 'No students in this batch yet.' : 'No students match your filter.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {filtered.map(({ student, fee }) => {
            const c = calcFee(fee);
            const meta = STATUS_META[c.status];
            return (
              <div key={student.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer', transition: 'box-shadow .15s' }}
                onClick={() => openFee({ student, fee })}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = ''}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Ring pct={c.pct} color={c.status === 'paid' ? 'var(--green-ink)' : c.status === 'partial' ? 'var(--amber-ink)' : 'var(--red-ink)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student.name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{student.phone || '—'}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, color: meta.c, background: meta.bg }}>{meta.label}</span>
                      {c.overdue && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, color: 'var(--red-ink)', background: 'var(--neg-50)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={11} />Overdue</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div><div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Paid</div><div style={{ fontWeight: 700, color: 'var(--green-ink)' }}>{inr(c.paid)}</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Balance</div><div style={{ fontWeight: 700, color: c.balance > 0 ? 'var(--red-ink)' : 'var(--text-muted)' }}>{inr(Math.max(0, c.balance))}</div></div>
                  <div style={{ textAlign: 'right' }}><div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</div><div style={{ fontWeight: 700 }}>{c.total ? inr(c.total) : '—'}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fee editor modal */}
      {feeStudent && (
        <Modal title={`Fees — ${feeStudent.name || 'Student'}`} onClose={closeFee} wide persistent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Totals summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{inr(draftTotal)}</div>
              </div>
              <div className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Paid</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--green-ink)' }}>{inr(draftPaid)}</div>
              </div>
              <div className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Balance</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: draftBalance > 0 ? 'var(--red-ink)' : 'var(--text-muted)' }}>{inr(Math.max(0, draftBalance))}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Total Course Fee (₹)</label>
                <input className="form-input" type="number" min="0" placeholder="e.g. 25000" value={draftTotal} onChange={e => setDraftTotal(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
                <input className="form-input" type="date" value={draftDue} onChange={e => setDraftDue(e.target.value)} />
              </div>
            </div>

            {/* Add / edit a payment */}
            <div style={{ background: 'var(--surface-sunken)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{editingPayId ? 'Edit payment' : 'Record a payment'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Amount (₹)</label>
                  <input className="form-input" type="number" min="0" placeholder="Amount" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Method</label>
                  <select className="form-input" value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Note <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
                  <input className="form-input" placeholder="e.g. 2nd installment" value={payForm.note} onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {editingPayId && <button className="btn btn-ghost btn-sm" onClick={() => { setEditingPayId(null); setPayForm({ amount: '', date: todayStr(), method: 'Cash', note: '' }); }}>Cancel edit</button>}
                <button className="btn btn-primary btn-sm" onClick={addOrUpdatePayment}><Plus size={14} /> {editingPayId ? 'Update payment' : 'Add payment'}</button>
              </div>
            </div>

            {/* Payment history */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Payment history ({draftPayments.length})</div>
              {draftPayments.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '14px 0', textAlign: 'center' }}>No payments recorded yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                  {[...draftPayments].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--pos-50)', color: 'var(--green-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, fontSize: 12 }}>{'₹'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{inr(p.amount)} <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>· {p.method}</span></div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.date}{p.note ? ` · ${p.note}` : ''}{p.recordedByName ? ` · by ${p.recordedByName}` : ''}</div>
                      </div>
                      <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => editPayment(p)}><Edit2 size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: 'var(--red-ink)' }}
                        onClick={() => setConfirmBox({ message: `Delete this ${inr(p.amount)} payment?`, confirmLabel: 'Delete', onConfirm: () => { removePayment(p.id); setConfirmBox(null); } })}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button className="btn btn-ghost" onClick={closeFee}>Cancel</button>
              <button className="btn btn-primary" onClick={saveFeeDoc} disabled={savingFee}>{savingFee ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmBox && <Confirm message={confirmBox.message} confirmLabel={confirmBox.confirmLabel} onConfirm={confirmBox.onConfirm} onCancel={() => setConfirmBox(null)} />}
    </div>
  );
}
