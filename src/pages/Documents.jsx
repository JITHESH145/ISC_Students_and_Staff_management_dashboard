import { useEffect, useState, useRef } from 'react';
import { getStudents } from '../firebase/services';
import {
  ref, uploadBytesResumable, getDownloadURL, listAll, deleteObject
} from 'firebase/storage';
import { storage } from '../firebase/config';
import { Modal, Toast, Loading, Confirm } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { Upload, Download, Trash2, Search } from 'lucide-react';

const DOC_TYPES = ['Admission Form', 'ID Proof', 'Certificate', 'Test Report', 'Assessment PDF', 'Internal Document', 'Other'];

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name = '') { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACCENTS[h % ACCENTS.length]; }
function initials(name = '') { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }

function fileExt(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return { ext:'IMG', cls:'badge-violet', tint:'var(--violet-soft)', ink:'var(--violet-ink)' };
  if (['xls','xlsx'].includes(ext))                     return { ext:'XLS', cls:'badge-green',  tint:'var(--green-soft)',  ink:'var(--green-ink)' };
  if (['csv'].includes(ext))                            return { ext:'CSV', cls:'badge-teal',   tint:'var(--teal-soft)',   ink:'var(--teal-ink)' };
  if (['doc','docx'].includes(ext))                     return { ext:'DOC', cls:'badge-blue',   tint:'var(--blue-soft)',   ink:'var(--blue-ink)' };
  return { ext:'PDF', cls:'badge-red', tint:'var(--red-soft)', ink:'var(--red-ink)' };
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function Documents() {
  const { profile } = useAuth();
  const [students, setStudents] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [form, setForm] = useState({ studentId: '', docType: '', file: null });
  const fileRef = useRef();

  const [loadError, setLoadError] = useState('');

  const loadDocs = async () => {
    try {
      const listRef = ref(storage, 'documents/');
      // Guard against a Storage call that never resolves (bucket not set up etc.)
      const res = await Promise.race([
        listAll(listRef),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Storage timed out — is Firebase Storage enabled?')), 8000)),
      ]);
      const items = await Promise.all(res.items.map(async item => {
        const url = await getDownloadURL(item).catch(() => '');
        const parts = item.name.split('__');
        return {
          fullPath: item.fullPath, name: item.name, url,
          studentId: parts[0] || '', docType: parts[1] || 'Document', fileName: parts[2] || item.name,
        };
      }));
      setDocs(items);
      setLoadError('');
    } catch (err) {
      import.meta.env.DEV && console.error('Documents load failed:', err);
      setDocs([]);
      setLoadError(err?.message || 'Could not load documents. Check that Firebase Storage is enabled and its rules allow access.');
    }
  };

  useEffect(() => {
    let done = false;
    // Never let the page hang on the spinner — always resolve loading.
    (async () => {
      try {
        const s = await getStudents({ role: profile?.role, uid: profile?.uid, email: profile?.email }).catch(() => []);
        setStudents(s);
        await loadDocs();
      } finally {
        if (!done) setLoading(false);
      }
    })();
    // hard fallback in case something above never returns
    const t = setTimeout(() => { done = true; setLoading(false); }, 9000);
    return () => clearTimeout(t);
  }, []);

  const studentName = (id) => students.find(s => s.id === id)?.name || id || 'Unknown';

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!form.file || !form.studentId) return;
    setUploading(true);
    const safeName = `${form.studentId}__${form.docType}__${form.file.name}`;
    const storageRef = ref(storage, `documents/${safeName}`);
    const task = uploadBytesResumable(storageRef, form.file);
    task.on('state_changed',
      snap => setProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      () => { setToast({ message: 'Upload failed.', type: 'error' }); setUploading(false); },
      async () => {
        setToast({ message: 'Document uploaded!', type: 'success' });
        setUploading(false);
        setProgress(0);
        setShowModal(false);
        setForm({ studentId: '', docType: '', file: null });
        loadDocs();
      }
    );
  };

  const handleDelete = async () => {
    const docRef = ref(storage, deleting);
    await deleteObject(docRef);
    setDeleting(null);
    setToast({ message: 'Document deleted.', type: 'info' });
    loadDocs();
  };

  const filtered = docs.filter(d => {
    const q = search.toLowerCase();
    const matchQ = !q || studentName(d.studentId).toLowerCase().includes(q) || d.docType.toLowerCase().includes(q) || d.fileName.toLowerCase().includes(q);
    const matchS = !studentFilter || d.studentId === studentFilter;
    return matchQ && matchS;
  });

  if (loading) return <Loading />;

  // Folder summary by document type (only types that have files)
  const FOLDER_TINTS = [
    { tint:'var(--blue-soft)',   ink:'var(--blue-ink)'   },
    { tint:'var(--violet-soft)', ink:'var(--violet-ink)' },
    { tint:'var(--green-soft)',  ink:'var(--green-ink)'  },
    { tint:'var(--amber-soft)',  ink:'var(--amber-ink)'  },
    { tint:'var(--teal-soft)',   ink:'var(--teal-ink)'   },
    { tint:'var(--red-soft)',    ink:'var(--red-ink)'    },
    { tint:'var(--slate-soft)',  ink:'var(--slate-ink)'  },
  ];
  const folders = DOC_TYPES
    .map((t, i) => ({ name: t, count: docs.filter(d => d.docType === t).length, ...FOLDER_TINTS[i % FOLDER_TINTS.length] }))
    .filter(f => f.count > 0)
    .slice(0, 4);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:18 }}>
        <div>
          <h2 style={{ fontSize:24, fontWeight:700 }}>Documents</h2>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Shared templates, student records, and operational files.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Upload size={16} /> Upload</button>
      </div>

      {loadError && (
        <div style={{ padding:'12px 16px', borderRadius:10, background:'var(--amber-soft)', color:'var(--amber-ink)', fontSize:13, marginBottom:16 }}>
          {loadError}
        </div>
      )}

      {folders.length > 0 && (
        <>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', color:'var(--text-muted)', marginBottom:10 }}>FOLDERS</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:14, marginBottom:24 }}>
            {folders.map(f => (
              <div key={f.name} className="card" style={{ padding:'16px 18px', display:'flex', alignItems:'center', gap:13 }}>
                <div style={{ width:42, height:42, borderRadius:11, background:f.tint, color:f.ink, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Upload size={20} />
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize:11.5, color:'var(--text-muted)', marginTop:2 }}>{f.count} file{f.count > 1 ? 's' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', color:'var(--text-muted)' }}>RECENT FILES</div>
        <div style={{ flex:1 }} />
        <select className="form-input" style={{ width:180 }} value={studentFilter} onChange={e => setStudentFilter(e.target.value)}>
          <option value="">All Students</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="search-bar" style={{ width:280 }}>
          <Search size={15} style={{ color:'var(--text-muted)' }} />
          <input placeholder="Search files…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr><th>Name</th><th style={{ width:120 }}>Type</th><th style={{ width:200 }}>Student</th><th style={{ width:60 }}></th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:40 }}>
                No documents uploaded yet.
              </td></tr>
            )}
            {filtered.map((doc, i) => {
              const fx = fileExt(doc.fileName);
              const sName = studentName(doc.studentId);
              return (
                <tr key={i}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                      <div style={{ width:32, height:32, borderRadius:8, background:fx.tint, color:fx.ink, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'var(--font-display)', fontWeight:700, fontSize:10 }}>{fx.ext}</div>
                      <span style={{ fontSize:13, fontWeight:600 }}>{doc.fileName}</span>
                    </div>
                  </td>
                  <td><span className={`badge ${fx.cls}`} style={{ fontSize:10.5 }}>{doc.docType}</span></td>
                  <td>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                      <span style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:9, color:'#fff', background:avatarColor(sName) }}>{initials(sName)}</span>
                      <span style={{ fontSize:12.5, color:'var(--text-sub)' }}>{sName}</span>
                    </span>
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:6 }}>
                      <a href={doc.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon" title="Download">
                        <Download size={14} />
                      </a>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color:'var(--red)' }} onClick={() => setDeleting(doc.fullPath)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="Upload Document" onClose={() => setShowModal(false)} persistent>
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Student *</label>
              <select className="form-input" required value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })}>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Document Type *</label>
              <select className="form-input" required value={form.docType} onChange={e => setForm({ ...form, docType: e.target.value })}>
                <option value="">Select type</option>
                {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">File *</label>
              <input ref={fileRef} type="file" style={{ display: 'none' }}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={e => setForm({ ...form, file: e.target.files[0] })} />
              <div
                onClick={() => fileRef.current.click()}
                style={{
                  border: '2px dashed var(--border-strong)', borderRadius: 10, padding: '20px',
                  textAlign: 'center', cursor: 'pointer', transition: 'border 0.15s',
                  background: form.file ? 'var(--green-soft)' : 'var(--surface-sunken)'
                }}
              >
                {form.file ? (
                  <div style={{ color: 'var(--green-ink)', fontSize: 13, fontWeight: 600 }}>
                    {form.file.name} ({formatBytes(form.file.size)})
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    <Upload size={20} style={{ margin: '0 auto 6px', display: 'block' }} />
                    Click to select a file (PDF, JPG, PNG, DOC)
                  </div>
                )}
              </div>
            </div>
            {uploading && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Uploading... {progress}%</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%`, background: 'var(--green)' }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={uploading || !form.file || !form.studentId}>
                {uploading ? `Uploading ${progress}%...` : <><Upload size={14} /> Upload</>}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Confirm
          message="Delete this document? This cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
