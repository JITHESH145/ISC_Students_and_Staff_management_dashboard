import { useEffect, useState } from 'react';
import { subscribeTrashItems, restoreFromTrash, permanentDelete } from '../firebase/services';
import { Loading, Toast, Confirm } from '../components/ui';
import { Trash2, RotateCcw, AlertCircle, User, School } from 'lucide-react';

const TAB_META = {
  student: { label:'Student', tileBg:'var(--blue-soft)',   tileInk:'var(--blue-ink)',   Icon: User },
  batch:   { label:'Batch',   tileBg:'var(--indigo-soft)', tileInk:'var(--indigo-ink)', Icon: School },
};

export default function Trash() {
  const [tab, setTab]         = useState('student');
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [busy, setBusy]       = useState(false);
  const [confirmBox, setConfirmBox] = useState(null); // in-app confirm (replaces window.confirm)
  const askConfirm = (message, onConfirm, confirmLabel = 'Delete') => setConfirmBox({ message, onConfirm, confirmLabel });

  // Live: restores/deletes by any CEO/Admin reflect immediately.
  useEffect(() => {
    setLoading(true);
    return subscribeTrashItems(tab, (i) => { setItems(i); setLoading(false); });
  }, [tab]);

  const handleRestore = (item) => askConfirm('Restore this item?', () => doRestore(item), 'Restore');

  const doRestore = async (item) => {
    setBusy(true);
    try {
      await restoreFromTrash(item.id, item.type, item.originalId, item.data);
      setToast({ message: 'Restored successfully!', type: 'success' });
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setBusy(false);
  };

  const handlePermDelete = (item) => askConfirm('Permanently delete? This cannot be undone.', () => doPermDelete(item), 'Delete');

  const doPermDelete = async (item) => {
    setBusy(true);
    try {
      await permanentDelete(item.id);
      setToast({ message: 'Permanently deleted.', type: 'success' });
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setBusy(false);
  };

  const handleDeleteAll = () => {
    if (items.length === 0) return;
    askConfirm(`Permanently delete all ${items.length} item(s) in ${tab}s? This cannot be undone.`, doDeleteAll, 'Delete all');
  };

  const doDeleteAll = async () => {
    setBusy(true);
    try {
      await Promise.all(items.map(item => permanentDelete(item.id)));
      setToast({ message: `All ${tab}s permanently deleted.`, type: 'success' });
    } catch (err) {
      setToast({ message: 'Error: ' + err.message, type: 'error' });
    }
    setBusy(false);
  };

  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const meta = TAB_META[tab] || TAB_META.student;
  const TabIcon = meta.Icon;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:24, fontWeight:700 }}>Trash</h2>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Deleted items are kept for 30 days, then removed permanently.</div>
        </div>
        {items.length > 0 && (
          <button className="btn btn-danger btn-sm" style={{ height:38 }} disabled={busy} onClick={handleDeleteAll}>
            <Trash2 size={15} /> Empty Trash
          </button>
        )}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--amber-soft)', borderRadius:10, padding:'11px 16px', marginBottom:18, maxWidth:760 }}>
        <AlertCircle size={16} style={{ color:'var(--amber-ink)', flexShrink:0 }} />
        <span style={{ fontSize:12.5, color:'var(--amber-ink)' }}>Restoring a batch also restores all of its students and their progress.</span>
      </div>

      <div className="segmented" style={{ marginBottom:18 }}>
        {[{ key:'student', label:'Students' }, { key:'batch', label:'Batches' }].map(t => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? <Loading /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ width:120 }}>Type</th>
                {tab === 'student' && <th style={{ width:160 }}>Batch</th>}
                <th style={{ width:140 }}>Deleted</th>
                <th style={{ width:230 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text-muted)', padding:56, fontSize:13.5 }}>Trash is empty.</td></tr>
              )}
              {items.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                      <div style={{ width:34, height:34, borderRadius:10, background:meta.tileBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <TabIcon size={16} style={{ color:meta.tileInk }} />
                      </div>
                      <div style={{ fontSize:13.5, fontWeight:600 }}>{item.data?.name || item.data?.batchName || '—'}</div>
                    </div>
                  </td>
                  <td><span className="chip">{meta.label}</span></td>
                  {tab === 'student' && <td style={{ fontSize:12.5, color:'var(--text-sub)' }}>{item.data?.batchName || '—'}</td>}
                  <td style={{ fontSize:12.5, color:'var(--text-muted)' }}>{formatDate(item.deletedAt)}</td>
                  <td>
                    <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => handleRestore(item)}>
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => handlePermDelete(item)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmBox && (
        <Confirm message={confirmBox.message} confirmLabel={confirmBox.confirmLabel}
          onCancel={() => setConfirmBox(null)}
          onConfirm={async () => { const fn = confirmBox.onConfirm; setConfirmBox(null); await fn(); }} />
      )}
    </div>
  );
}
