import { useEffect, useState, useRef } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { createStaffAccount, recordDeletedStaffAccount, deleteStaffAuthAccount, resendStaffSetupEmail } from '../firebase/adminAuth';
import { setRoleDoc, deleteRoleDoc, setDirectoryDoc, deleteDirectoryDoc } from '../firebase/services';
import { Modal, Toast, Loading, Confirm, FormRow } from '../components/ui';
import {
  Plus, ShieldOff, RefreshCw, Shield,
  BookOpen, Edit, CheckCircle, Mail, Key, Trash2
} from 'lucide-react';

const ALL_SUBJECTS = [
  'Mathematics','Science','English','Hindi','Social Science',
  'Physics','Chemistry','Biology','Computer Science',
  'Python','Data Science','Web Development','Machine Learning',
  'Economics','Accountancy','Business Studies','Other'
];

const ROLE_INFO = {
  ceo:   {
    label:'CEO', badgeCls:'badge-red', color:'#E53935',
    desc:'Full access — all modules, assign tasks, manage all staff and reports'
  },
  admin: {
    label:'Admin', badgeCls:'badge-purple', color:'#8B5CF6',
    desc:'Manage students, batches, documents, concerns. Cannot manage staff.'
  },
  staff: {
    label:'Staff', badgeCls:'badge-blue', color:'#3B82F6',
    desc:'View assigned students, log follow-ups, submit reports, complete tasks.'
  },
};

export default function StaffManagement() {
  const [staffList, setStaffList]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [showSuccess, setShowSuccess] = useState(null);
  const [showSubjectModal, setShowSubjectModal] = useState(null);
  const [revoking, setRevoking]       = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [toast, setToast]             = useState(null);
  const [saving, setSaving]           = useState(false);
  const [editingSubjects, setEditingSubjects] = useState([]);
  const [form, setForm] = useState({ name:'', email:'', role:'staff' });
  // Resend-setup-email cooldown: one active email at a time, counts down secs.
  const [resend, setResend] = useState(null); // { email, secs }
  const resendTimer = useRef(null);

  const load = async () => {
    const snap = await getDocs(collection(db, 'staff'));
    setStaffList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Add staff — completely in-app, no Firebase Console needed ─
  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await createStaffAccount({
        name:     form.name,
        email:    form.email,
        role:     form.role,
        subjects: [],
      });

      setShowModal(false);
      setShowSuccess({
        name:  form.name,
        email: (result?.email || form.email || '').trim().toLowerCase() || form.email,
        role:  form.role,
        restored: !!result?.restored,
      });
      // The setup email just went out — arm the resend cooldown so the CEO
      // waits a moment before re-sending.
      startResendCooldown((form.email || '').trim().toLowerCase(), 30);
      setForm({ name:'', email:'', role:'staff' });
      load();
    } catch (err) {
      setToast({ message: err.message, type:'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Revoke / restore access ────────────────────────────────
  // Roles doc is the authorization source of truth — revoking there
  // cuts off ALL data access immediately (rules check roles.active).
  const handleRevoke = async () => {
    await updateDoc(doc(db, 'staff', revoking.id), { active: false });
    await setRoleDoc(revoking.id, { role: revoking.role || 'staff', active: false });
    await setDirectoryDoc(revoking.id, { ...revoking, active: false });
    setRevoking(null);
    setToast({ message: `Access revoked for ${revoking.name}.`, type:'info' });
    load();
  };

  const handleRestore = async (member) => {
    await updateDoc(doc(db, 'staff', member.id), { active: true });
    await setRoleDoc(member.id, { role: member.role || 'staff', active: true });
    await setDirectoryDoc(member.id, { ...member, active: true });
    setToast({ message: `Access restored for ${member.name}.`, type:'success' });
    load();
  };

  // ── Permanent delete (revoked staff only) ──────────────────
  const handlePermanentDelete = async () => {
    if (!deleting) return;
    try {
      // Tombstone first: a safety net in case the Auth account can't be
      // deleted server-side (service account not configured). It records
      // the uid/email so a later re-add can still adopt the account.
      await recordDeletedStaffAccount({
        uid:   deleting.id,
        email: deleting.email,
        name:  deleting.name,
        role:  deleting.role,
      }).catch(() => {});

      // Remove the Firestore half (profile, authorization, directory).
      await deleteDoc(doc(db, 'staff', deleting.id));
      await deleteRoleDoc(deleting.id).catch(() => {});
      await deleteDirectoryDoc(deleting.id).catch(() => {});

      // Remove the Auth half too (server-side, Admin SDK). This is what
      // prevents the "email already exists" orphan on re-add. Best-effort:
      // 'disabled' means no service account is set — the tombstone covers us.
      const authRes = await deleteStaffAuthAccount({ uid: deleting.id, email: deleting.email });
      const authRemoved = authRes?.status === 'ok' || authRes?.status === 'already-gone';
      if (authRemoved) {
        // Login fully gone → the tombstone is no longer needed.
        await deleteDoc(doc(db, 'deletedStaff', deleting.id)).catch(() => {});
      }

      setToast({
        message: authRemoved
          ? `${deleting.name} permanently deleted (login removed).`
          : `${deleting.name} removed. Their login is retained — re-adding the same email will reactivate it.`,
        type: 'success',
      });
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type:'error' });
    }
    setDeleting(null);
    load();
  };

  // ── Resend the password-setup / login link ─────────────────
  const startResendCooldown = (email, secs = 30) => {
    if (resendTimer.current) clearInterval(resendTimer.current);
    setResend({ email, secs });
    resendTimer.current = setInterval(() => {
      setResend(prev => {
        if (!prev || prev.secs <= 1) { clearInterval(resendTimer.current); return null; }
        return { ...prev, secs: prev.secs - 1 };
      });
    }, 1000);
  };
  useEffect(() => () => { if (resendTimer.current) clearInterval(resendTimer.current); }, []);

  const handleResend = async (email) => {
    if (!email) return;
    if (resend?.email === email && resend.secs > 0) return; // on cooldown
    try {
      await resendStaffSetupEmail(email);
      setToast({ message: `Setup email re-sent to ${email}.`, type:'success' });
      startResendCooldown(email, 30);
    } catch (err) {
      setToast({ message: 'Could not resend: ' + err.message, type:'error' });
    }
  };
  const resendSecsFor = (email) => (resend?.email === email ? resend.secs : 0);

  // ── Subject assignment ─────────────────────────────────────
  const handleSaveSubjects = async () => {
    await updateDoc(doc(db, 'staff', showSubjectModal.id), { subjects: editingSubjects });
    await setDirectoryDoc(showSubjectModal.id, { ...showSubjectModal, subjects: editingSubjects });
    setToast({ message: `Subjects updated for ${showSubjectModal.name}!`, type:'success' });
    setShowSubjectModal(null);
    load();
  };

  const toggleSubject = (sub) => {
    setEditingSubjects(prev =>
      prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]
    );
  };

  const active  = staffList.filter(s => s.active !== false);
  const revoked = staffList.filter(s => s.active === false);

  if (loading) return <Loading />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin:0 }}>Staff Management</h2>
          <p style={{ fontSize:13, color:'var(--text-muted)', margin:'4px 0 0' }}>Manage your teaching and administrative team.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Staff Member
        </button>
      </div>

      {/* KPI stat tiles */}
      {staffList.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12, marginBottom:20 }}>
          {[
            { label:'Total Staff', value: staffList.length, color:'var(--brand)' },
            { label:'Active', value: active.length, color:'var(--green)' },
            { label:'CEO', value: staffList.filter(s=>s.role==='ceo').length, color:'#7C3AED' },
            { label:'Teaching Staff', value: staffList.filter(s=>s.role==='staff').length, color:'#2563EB' },
          ].map(tile => (
            <div key={tile.label} style={{ background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', padding:'14px 18px', boxShadow:'var(--shadow-xs)' }}>
              <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-muted)', marginBottom:6 }}>{tile.label}</div>
              <div style={{ fontSize:24, fontWeight:700, fontFamily:'var(--font-display)', color:tile.color }}>{tile.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Role explanation cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginBottom:20 }}>
        {Object.entries(ROLE_INFO).map(([key, info]) => (
          <div key={key} style={{
            padding:'14px 16px', borderRadius:10,
            border:`1.5px solid ${info.color}30`, background:`${info.color}08`
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <Shield size={15} style={{ color:info.color }}/>
              <span style={{ fontWeight:600, fontSize:13, color:info.color }}>{info.label}</span>
            </div>
            <div style={{ fontSize:12, color:'#6B7280', lineHeight:1.5 }}>{info.desc}</div>
          </div>
        ))}
      </div>

      {/* Info banner — new flow */}
      <div style={{
        padding:'12px 16px', background:'#F0FDF4',
        border:'1px solid #BBF7D0', borderRadius:10, marginBottom:20,
        display:'flex', gap:10, alignItems:'flex-start'
      }}>
        <CheckCircle size={18} style={{ color:'#10B981', flexShrink:0, marginTop:1 }}/>
        <div>
          <div style={{ fontWeight:600, fontSize:13, color:'#065F46', marginBottom:4 }}>
            Staff accounts created directly from this dashboard
          </div>
          <div style={{ fontSize:12, color:'#374151', lineHeight:1.7 }}>
            Enter staff name, email and role click Add. The system automatically:
            <br/>Creates their login account
            <br/>Saves their profile with correct role
            <br/>Sends them a password setup email
            <br/>Staff clicks the email link sets their own password logs in. Done.
            <br/><strong>No Firebase Console needed ever again.</strong>
          </div>
        </div>
      </div>

      {/* Active staff table */}
      <div className="table-container" style={{ marginBottom:20 }}>
        <div style={{
          padding:'12px 16px', borderBottom:'1px solid var(--border)',
          fontWeight:600, fontSize:13
        }}>
          Active Staff ({active.length})
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Subjects Handling</th>
              <th>Account</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign:'center', color:'#6B7280', padding:30 }}>
                  No staff yet. Add your first staff member above.
                </td>
              </tr>
            )}
            {active.map(member => {
              const ri = ROLE_INFO[member.role] || ROLE_INFO.staff;
              return (
                <tr key={member.id}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{
                        width:30, height:30, borderRadius:'50%',
                        background:ri.color, color:'#fff',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:11, fontWeight:600
                      }}>
                        {member.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <span style={{ fontWeight:500, fontSize:13 }}>{member.name}</span>
                    </div>
                  </td>
                  <td style={{ color:'#6B7280', fontSize:13 }}>{member.email}</td>
                  <td>
                    <span className={`badge ${ri.badgeCls}`}>{ri.label}</span>
                  </td>
                  <td>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
                      {(member.subjects || []).length === 0 ? (
                        <span style={{ fontSize:12, color:'#9CA3AF' }}>None assigned</span>
                      ) : (
                        (member.subjects || []).slice(0, 3).map(s => (
                          <span key={s} className="badge badge-blue" style={{ fontSize:10 }}>{s}</span>
                        ))
                      )}
                      {(member.subjects || []).length > 3 && (
                        <span style={{ fontSize:11, color:'#6B7280' }}>
                          +{member.subjects.length - 3} more
                        </span>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding:'3px 8px', fontSize:11 }}
                        onClick={() => {
                          setShowSubjectModal(member);
                          setEditingSubjects(member.subjects || []);
                        }}>
                        <Edit size={11}/> Edit
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-green">
                      <CheckCircle size={11} style={{ marginRight:3 }}/> Active
                    </span>
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Re-send the password-setup / login link"
                        disabled={resendSecsFor(member.email) > 0}
                        style={{ padding:'5px 10px', fontSize:12 }}
                        onClick={() => handleResend(member.email)}>
                        <Mail size={13}/>
                        {resendSecsFor(member.email) > 0 ? `${resendSecsFor(member.email)}s` : 'Resend link'}
                      </button>
                      {member.role !== 'ceo' && (
                        <button
                          className="btn btn-sm"
                          style={{
                            background:'#FEE2E2', color:'#991B1B',
                            border:'none', borderRadius:6, cursor:'pointer',
                            padding:'5px 10px', fontSize:12,
                            display:'flex', alignItems:'center', gap:4
                          }}
                          onClick={() => setRevoking(member)}>
                          <ShieldOff size={13}/> Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Revoked staff */}
      {revoked.length > 0 && (
        <div className="table-container">
          <div style={{
            padding:'12px 16px',
            borderBottom:'1px solid var(--border)',
            fontWeight:600, fontSize:13, color:'#6B7280'
          }}>
            Revoked ({revoked.length})
          </div>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              {revoked.map(member => (
                <tr key={member.id} style={{ opacity:0.6 }}>
                  <td style={{ fontSize:13, fontWeight:500 }}>{member.name}</td>
                  <td style={{ fontSize:13, color:'#6B7280' }}>{member.email}</td>
                  <td>
                    <span className={`badge ${ROLE_INFO[member.role]?.badgeCls || 'badge-gray'}`}>
                      {member.role}
                    </span>
                  </td>
                  <td style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleRestore(member)}>
                      <RefreshCw size={13}/> Restore
                    </button>
                    <button className="btn btn-sm" style={{ background:'var(--red-soft)', color:'var(--red-ink)', border:'none' }}
                      onClick={() => setDeleting(member)}>
                      <Trash2 size={13}/> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ADD STAFF MODAL ── */}
      {showModal && (
        <Modal title="Add New Staff Member" onClose={() => setShowModal(false)} persistent>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{
              padding:'10px 14px', background:'#EFF6FF',
              borderRadius:8, fontSize:12, color:'#1E40AF',
              display:'flex', gap:8, alignItems:'flex-start'
            }}>
              <Mail size={14} style={{ flexShrink:0, marginTop:1 }}/>
              <span>
                After adding, the staff member gets a <strong>password setup email</strong>.
                They click the link, set their password, and log in. No extra steps for you.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                className="form-input" required
                placeholder="e.g. Priya Suresh"
                value={form.name}
                onChange={e => setForm({...form, name:e.target.value})}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email Address *</label>
              <input
                className="form-input" type="email" required
                placeholder="priya@internationalskillsclub.com"
                value={form.email}
                onChange={e => setForm({...form, email:e.target.value})}
              />
              <div style={{ fontSize:11, color:'#6B7280', marginTop:4 }}>
                The password setup email will be sent here automatically.
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Role *</label>
              <select
                className="form-input"
                value={form.role}
                onChange={e => setForm({...form, role:e.target.value})}
              >
                <option value="staff">Staff — Limited access</option>
                <option value="ceo">CEO — Full access</option>
              </select>
              <div style={{ fontSize:11, color:'#6B7280', marginTop:4 }}>
                {ROLE_INFO[form.role]?.desc}
              </div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button type="button" className="btn btn-ghost"
                onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving
                  ? 'Creating account...'
                  : <><Plus size={14}/> Add & Send Email</>
                }
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── SUCCESS MODAL ── */}
      {showSuccess && (
        <Modal title="Staff Added Successfully!" onClose={() => setShowSuccess(null)}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{
              padding:'14px', background:'#F0FDF4',
              borderRadius:10, border:'1px solid #BBF7D0'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <CheckCircle size={20} style={{ color:'#10B981' }}/>
                <span style={{ fontWeight:600, fontSize:14, color:'#065F46' }}>
                  Account created for {showSuccess.name}
                </span>
              </div>
              <div style={{ fontSize:13, color:'#374151', lineHeight:1.8 }}>
                {showSuccess.restored
                  ? <>Existing login <strong>reactivated</strong> for this email<br/></>
                  : <>Login account created<br/></>}
                Profile saved with <strong>{showSuccess.role}</strong> role<br/>
                Password setup email sent to <strong>{showSuccess.email}</strong>
                <br/><br/>
                <strong>What happens next:</strong><br/>
                The staff member opens the email, clicks <strong>“Reset Password”</strong>,
                sets their own password, and logs in with their email.
              </div>
            </div>

            {/* Resend setup email — with cooldown */}
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:10, padding:'10px 14px', background:'var(--surface-sunken)',
              borderRadius:10, fontSize:12.5, color:'var(--text-sub)'
            }}>
              <span>Didn’t arrive? Check spam, or resend the setup link.</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={resendSecsFor(showSuccess.email) > 0}
                onClick={() => handleResend(showSuccess.email)}
                style={{ whiteSpace:'nowrap' }}
              >
                <Mail size={13}/>
                {resendSecsFor(showSuccess.email) > 0
                  ? `Resend in ${resendSecsFor(showSuccess.email)}s`
                  : 'Resend email'}
              </button>
            </div>

            <button className="btn btn-primary" onClick={() => setShowSuccess(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {/* ── SUBJECT ASSIGNMENT MODAL ── */}
      {showSubjectModal && (
        <Modal
          title={`Assign Subjects — ${showSubjectModal.name}`}
          onClose={() => setShowSubjectModal(null)}
          persistent
        >
          <div style={{ fontSize:13, color:'#6B7280', marginBottom:14 }}>
            Select all subjects this staff member handles.
            A staff can handle multiple subjects.
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:18 }}>
            {ALL_SUBJECTS.map(sub => (
              <div
                key={sub}
                onClick={() => toggleSubject(sub)}
                style={{
                  padding:'6px 14px', borderRadius:20, fontSize:12,
                  cursor:'pointer', fontWeight:500, transition:'all .15s',
                  background: editingSubjects.includes(sub) ? '#3B82F6' : 'var(--bg)',
                  color:      editingSubjects.includes(sub) ? '#fff'    : 'var(--muted)',
                  border:     `1px solid ${editingSubjects.includes(sub) ? '#3B82F6' : 'var(--border)'}`,
                }}
              >
                {editingSubjects.includes(sub) ? '' : ''}{sub}
              </div>
            ))}
          </div>
          {editingSubjects.length > 0 && (
            <div style={{
              padding:'8px 12px', background:'#DBEAFE',
              borderRadius:8, fontSize:12, color:'#1E40AF', marginBottom:14
            }}>
              <strong>Selected:</strong> {editingSubjects.join(', ')}
            </div>
          )}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowSubjectModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveSubjects}>
              <BookOpen size={14}/> Save Subjects
            </button>
          </div>
        </Modal>
      )}

      {/* Revoke confirmation */}
      {revoking && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:400 }}>
            <p style={{ marginBottom:16, fontSize:14, lineHeight:1.6 }}>
              Revoke access for <strong>{revoking.name}</strong>?
              They will immediately lose the ability to log in.
              Their data and history will be preserved.
            </p>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setRevoking(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleRevoke}>Revoke Access</button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:400 }}>
            <p style={{ marginBottom:16, fontSize:14, lineHeight:1.6 }}>
              Permanently delete <strong>{deleting.name}</strong>?
              This removes the staff profile for good and cannot be undone.
              (You can add them back later with the same email — their
              login account will be reactivated automatically.)
            </p>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handlePermanentDelete}>Delete Permanently</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}