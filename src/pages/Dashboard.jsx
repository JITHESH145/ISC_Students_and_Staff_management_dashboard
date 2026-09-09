import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getBatches, getBatchStudentCount, getTasks, getAllFollowUps,
  getRequests, addNotification, updateRequest, markNotificationRead,
  getBatchSchedules, getAssessments, getBatchTasks,
} from '../firebase/services';
import { query, collection, where, limit, orderBy, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Loading } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  Users, TrendingUp, School, AlertTriangle, CheckSquare,
  ChevronRight, Phone, Bell, Inbox, X, Calendar,
} from 'lucide-react';

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name=''){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;return ACCENTS[h%ACCENTS.length];}
function initials(name=''){const p=name.trim().split(/\s+/);return((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()||'?';}

// Local calendar date (YYYY-MM-DD) — NOT toISOString(), which is UTC and
// shifts the day backward in ahead-of-UTC timezones (e.g. IST after ~6:30pm).
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// A class needs a completion mark if it started >2h ago and is still pending
// (not completed/cancelled/rescheduled). Returns true only for a concrete
// occurrence that has passed. Recurring classes are checked against today.
const GRACE_MS = 2 * 60 * 60 * 1000;
function classNeedsCompletion(s) {
  if (['completed', 'cancelled', 'rescheduled'].includes(s.status)) return false;
  const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let dateStr = null;
  if (s.recurring) { if (s.day === WD[new Date().getDay()]) dateStr = localDateStr(); }
  else dateStr = s.scheduledDate || null;
  if (!dateStr) return false;
  const start = new Date(`${dateStr}T${(s.time && /^\d{1,2}:\d{2}$/.test(s.time)) ? s.time : '00:00'}`);
  if (isNaN(start)) return false;
  return (Date.now() - start.getTime()) > GRACE_MS;
}

function timeAgo(ts){
  if(!ts) return '';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  const diff = Math.floor((Date.now()-d.getTime())/1000);
  if(diff<60) return `${diff}s ago`;
  if(diff<3600) return `${Math.floor(diff/60)}m ago`;
  if(diff<86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function BatchActivityHub({ batches, schedBatch, setSchedBatch, schedFilter, setSchedFilter,
  schedItems, schedLoading, navigate,
  schedTimeFilter, setSchedTimeFilter, schedCourse, setSchedCourse, schedTypeFilter, setSchedTypeFilter }) {
  const [search, setSearch] = useState('');

  const kindColors = {
    schedule:   { dot:'var(--blue)',  bg:'var(--blue-soft)',   ink:'var(--blue-ink)'  },
    assessment: { dot:'var(--green)', bg:'var(--green-soft)',  ink:'var(--green-ink)' },
    task:       { dot:'var(--amber)', bg:'var(--amber-soft)',  ink:'var(--amber-ink)' },
  };

  const courseOptions = [...new Set(schedItems.map(i => i._course).filter(Boolean))];

  let list = schedItems;
  if (schedFilter !== 'all')             list = list.filter(i => i._kind === schedFilter);
  if (schedTimeFilter === 'active')      list = list.filter(i => i._timeStatus === 'active');
  else if (schedTimeFilter === 'upcoming') list = list.filter(i => i._timeStatus === 'upcoming');
  else if (schedTimeFilter === 'past')   list = list.filter(i => i._timeStatus === 'past' || i._timeStatus === 'completed');
  if (schedCourse)  list = list.filter(i => i._course === schedCourse);
  if (schedTypeFilter) list = list.filter(i => i._type === schedTypeFilter);
  if (search.trim()) list = list.filter(i => i._label.toLowerCase().includes(search.toLowerCase()) || (i._sub||'').toLowerCase().includes(search.toLowerCase()));

  const clearAll = () => { setSchedFilter('all'); setSchedTimeFilter('active'); setSchedCourse(''); setSchedTypeFilter(''); setSearch(''); };

  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-sm)', marginBottom:18, overflow:'hidden' }}>
      <div style={{ padding:'16px 20px 14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10, marginBottom:14 }}>
          <h3 style={{ fontSize:16, fontWeight:700 }}>Batch Activity Hub</h3>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {batches.map(b => (
              <button key={b.id} onClick={() => { setSchedBatch(b.id); clearAll(); }}
                style={{ padding:'5px 14px', borderRadius:20, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, transition:'all .15s',
                  background: schedBatch === b.id ? 'var(--brand)' : 'var(--surface-sunken)',
                  color:      schedBatch === b.id ? '#fff'         : 'var(--text-sub)' }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {!schedBatch && (
          <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'36px 0', fontSize:13 }}>
            <Calendar size={28} style={{ color:'var(--border)', display:'block', margin:'0 auto 8px' }} />
            Select a batch above to view its classes, assessments and tasks
          </div>
        )}

        {schedBatch && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12, padding:'10px 12px', background:'var(--surface-sunken)', borderRadius:10, border:'1px solid var(--border)' }}>
            <select value={schedFilter} onChange={e => { setSchedFilter(e.target.value); setSchedTypeFilter(''); }}
              style={{ padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, fontWeight:600, background:'var(--surface)', color:'var(--text)', cursor:'pointer' }}>
              <option value="all">All types</option>
              <option value="schedule">Classes</option>
              <option value="assessment">Assessments</option>
              <option value="task">Tasks</option>
            </select>
            <select value={schedTimeFilter} onChange={e => setSchedTimeFilter(e.target.value)}
              style={{ padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, fontWeight:600, background:'var(--surface)', color:'var(--text)', cursor:'pointer' }}>
              <option value="active">Active</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
              <option value="all">All time</option>
            </select>
            {courseOptions.length > 0 && (
              <select value={schedCourse} onChange={e => setSchedCourse(e.target.value)}
                style={{ padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, fontWeight:600, background:'var(--surface)', color:'var(--text)', cursor:'pointer' }}>
                <option value="">All Courses</option>
                {courseOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, background:'var(--surface)', color:'var(--text)', minWidth:140, flex:1 }} />
          </div>
        )}
      </div>

      {schedBatch && schedLoading && (
        <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'24px 0', fontSize:13 }}>Loading…</div>
      )}

      {schedBatch && !schedLoading && (
        <div style={{ padding:'0 20px 20px' }}>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
            <span style={{ fontWeight:600, color:'var(--text)' }}>{list.length} item{list.length !== 1 ? 's' : ''}</span>
            <span style={{ marginLeft:12 }}>{schedItems.filter(i=>i._kind==='schedule').length} classes</span>
            <span style={{ marginLeft:10 }}>{schedItems.filter(i=>i._kind==='assessment').length} assessments</span>
            <span style={{ marginLeft:10 }}>{schedItems.filter(i=>i._kind==='task').length} tasks</span>
          </div>
          {list.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'24px 0', fontSize:13 }}>No items match your filters.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:400, overflowY:'auto' }}>
              {list.map((item, i) => {
                const c = kindColors[item._kind] || kindColors.task;
                const tab = item._kind === 'assessment' ? 'assessments' : 'tasks';
                return (
                  <div key={item.id || i}
                    onClick={() => item._kind === 'schedule'
                      ? navigate('/schedule')
                      : navigate('/batches', { state:{ batchId:schedBatch, tab } })}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:10, border:'1px solid var(--border)', borderLeft: item._needsCompletion ? '3px solid var(--amber)' : '1px solid var(--border)', cursor:'pointer', background: item._needsCompletion ? 'var(--amber-soft)' : 'var(--surface)', transition:'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = item._needsCompletion ? 'var(--amber-soft)' : 'var(--surface)'}>
                    <span style={{ width:10, height:10, borderRadius:'50%', background:c.dot, flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item._label}</div>
                      {item._sub && <div style={{ fontSize:12, color:'var(--text-muted)' }}>{item._sub}</div>}
                    </div>
                    {item._needsCompletion && (
                      <span style={{ fontSize:10, padding:'2px 8px', borderRadius:20, background:'var(--amber)', color:'#fff', fontWeight:700, flexShrink:0, whiteSpace:'nowrap' }}>Not marked</span>
                    )}
                    {item._course && (
                      <span style={{ fontSize:10, padding:'2px 8px', borderRadius:20, background:'var(--surface-sunken)', color:'var(--text-sub)', fontWeight:500, flexShrink:0 }}>{item._course}</span>
                    )}
                    <span style={{ fontSize:11, padding:'3px 10px', borderRadius:20, background:c.bg, color:c.ink, fontWeight:600, flexShrink:0, whiteSpace:'nowrap' }}>
                      {item._kind === 'schedule' ? 'Class' : item._kind === 'assessment' ? 'Assessment' : 'Task'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [loading, setLoading]             = useState(true);
  const [totalStudents, setTotalStudents] = useState(0);
  const [atRiskCount, setAtRiskCount]     = useState(0);
  const [batches, setBatches]             = useState([]);
  const [batchRows, setBatchRows]         = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [recentStudents, setRecentStudents] = useState([]);
  const [pendingTasks, setPendingTasks]   = useState([]);
  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [actFilter, setActFilter]         = useState('all');

  const [schedBatch,      setSchedBatch]      = useState('');
  const [schedItems,      setSchedItems]      = useState([]);
  const [schedLoading,    setSchedLoading]    = useState(false);
  const [schedFilter,     setSchedFilter]     = useState('all');
  const [schedTimeFilter, setSchedTimeFilter] = useState('active');
  const [schedCourse,     setSchedCourse]     = useState('');
  const [schedTypeFilter, setSchedTypeFilter] = useState('');

  const [showSidebar, setShowSidebar]     = useState(false);
  const [sidebarTab, setSidebarTab]       = useState('requests');
  const [pendingRequests, setPendingRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [processingReq, setProcessingReq] = useState(null);

  const isCEOorAdmin = profile?.role === 'ceo';

  useEffect(() => {
    const load = async () => {
      try {
        const totalSnap = await getCountFromServer(collection(db, 'students'));
        setTotalStudents(totalSnap.data().count);

        const uid = profile?.uid;
        const isStaff = !isCEOorAdmin;

        // At-risk students — full list shown in-section (scroll-capped), no
        // "view all" redirect. Staff: rules reject unscoped student queries,
        // so scope by staffIds (array-contains, auto-indexed) and filter the
        // status client-side. CEO: unscoped query is allowed.
        try {
          let atRisk;
          if (isStaff) {
            const snap = await getDocs(query(collection(db,'students'), where('staffIds','array-contains',uid), limit(500)));
            atRisk = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(s => s.status === 'at-risk');
          } else {
            const snap = await getDocs(query(collection(db,'students'), where('status','==','at-risk'), limit(500)));
            atRisk = snap.docs.map(d => ({ id:d.id, ...d.data() }));
          }
          atRisk.sort((a,b) => (a.name||'').localeCompare(b.name||''));
          setAtRiskStudents(atRisk);
          setAtRiskCount(atRisk.length);
        } catch {}

        // Recently joined students — identical on both dashboards: students
        // who joined in the last 7 days, newest first. CEO sees all; staff are
        // scoped by staffIds (rules reject the unscoped query for staff).
        try {
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const recentSnap = isStaff
            ? await getDocs(query(collection(db,'students'), where('staffIds','array-contains',uid), limit(500)))
            : await getDocs(query(collection(db,'students'), orderBy('createdAt','desc'), limit(200)));
          const rows = recentSnap.docs.map(d => ({ id:d.id, ...d.data() }))
            .filter(s => (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : 0) >= cutoff)
            .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
          setRecentStudents(rows);
        } catch {}

        const allBatches = await getBatches();
        const batchList = isStaff
          ? allBatches.filter(b => b.mentorId === uid || (b.staffIds || []).includes(uid))
          : allBatches;
        setBatches(batchList);
        if (isStaff && batchList.length > 0) setSchedBatch(batchList[0].id);

        const tasks = await getTasks().catch(() => []);
        setPendingTasks(tasks.filter(t => t.status !== 'completed'));

        const fups = await getAllFollowUps().catch(() => []);
        const combined = [
          ...fups.map(f => ({ ...f, _type:'followup', _ts: f.createdAt?.seconds || 0 })),
          ...tasks.map(t => ({ ...t, _type:'task',    _ts: t.createdAt?.seconds || 0 })),
        ].sort((a,b) => b._ts - a._ts);
        setRecentActivity(combined);

        const rows = await Promise.all(batchList.map(async (batch) => {
          const count = await getBatchStudentCount(batch.id).catch(() => 0);
          let onboardedCount = 0;
          try {
            const batchStudentsSnap = await getDocs(query(collection(db,'students'), where('batchId','==',batch.id), limit(200)));
            const students = batchStudentsSnap.docs.map(d => d.data());
            const flow = batch.courseFlow || [];
            if (flow.length > 0) {
              onboardedCount = students.filter(s => flow.every(step => s.courseFlow?.[step.key]?.done)).length;
            }
          } catch {}
          return { batch, count, onboardedCount };
        }));
        setBatchRows(rows);

        const [reqs, notifs] = await Promise.all([
          getRequests('pending').catch(() => []),
          profile?.email ? (async () => {
            const q = query(collection(db,'notifications'), where('toEmail','==',profile.email), limit(20));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id:d.id, ...d.data() }))
              .sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
          })() : Promise.resolve([]),
        ]);
        setPendingRequests(reqs);
        setNotifications(notifs);
      } catch (err) {
        import.meta.env.DEV && console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.email]);

  const handleAcceptRequest = async (req) => {
    setProcessingReq(req.id);
    try {
      await updateRequest(req.id, { status:'accepted' });
      if (req.requestedByEmail) {
        await addNotification({ toEmail:req.requestedByEmail, message:`Your request "${req.title || req.type}" has been approved.`, type:'request_accepted', requestId:req.id });
      }
      setPendingRequests(prev => prev.filter(r => r.id !== req.id));
    } catch {}
    setProcessingReq(null);
  };

  const handleRejectRequest = async (req) => {
    setProcessingReq(req.id);
    try {
      await updateRequest(req.id, { status:'rejected' });
      if (req.requestedByEmail) {
        await addNotification({ toEmail:req.requestedByEmail, message:`Your request "${req.title || req.type}" has been declined.`, type:'request_rejected', requestId:req.id });
      }
      setPendingRequests(prev => prev.filter(r => r.id !== req.id));
    } catch {}
    setProcessingReq(null);
  };

  const loadBatchActivity = async (batchId) => {
    if (!batchId) return setSchedItems([]);
    setSchedLoading(true);
    const today = localDateStr();
    try {
      const [scheds, asmts, bTasks] = await Promise.all([
        getBatchSchedules(batchId).catch(() => []),
        getAssessments(batchId).catch(() => []),
        getBatchTasks(batchId).catch(() => []),
      ]);
      const items = [
        ...scheds.map(s => {
          const _timeStatus = s.recurring ? 'active' : !s.scheduledDate ? 'active'
            : s.scheduledDate > today ? 'upcoming' : s.scheduledDate < today ? 'past' : 'active';
          return { ...s, _kind:'schedule', _timeStatus, _needsCompletion:classNeedsCompletion(s), _label:s.title||'Class', _sub:s.recurring?`Every ${s.day} at ${s.time}`:`${s.scheduledDate} at ${s.time}`, _type:s.type||'live-class', _course:s.course||'' };
        }),
        ...asmts.map(a => {
          const _timeStatus = a.status==='completed' ? 'completed' : a.date>today ? 'upcoming' : a.date<today ? 'past' : 'active';
          return { ...a, _kind:'assessment', _timeStatus, _label:a.title||'Assessment', _sub:`${a.date||'—'} · ${a.totalMarks} marks`, _type:a.subject||'', _course:a.course||'' };
        }),
        ...bTasks.map(t => {
          const _timeStatus = (t.status==='completed'||t.status==='submitted') ? 'completed' : t.dueDate>today ? 'upcoming' : t.dueDate<today ? 'past' : 'active';
          return { ...t, _kind:'task', _timeStatus, _label:t.title||'Task', _sub:t.subject||t.assignedTo||'', _type:t.subject||'', _course:t.course||'' };
        }),
      ];
      setSchedItems(items);
    } catch {}
    setSchedLoading(false);
  };

  useEffect(() => { loadBatchActivity(schedBatch); }, [schedBatch]);

  const handleMarkNotifRead = async (notif) => {
    if (notif.read) return;
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read:true } : n));
    await markNotificationRead(notif.id).catch(() => {});
  };

  if (loading) return <Loading text="Loading dashboard…" />;

  const activeBatches = batches.filter(b => b.status === 'active');
  const unreadNotifs  = notifications.filter(n => !n.read).length;

  // Only surface RECENT activity — items from the last ~36h — so the dashboard
  // stays relevant as the data grows instead of showing history from day one.
  const RECENT_WINDOW_MS = 36 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const filteredActivity = recentActivity.filter(item => {
    if (actFilter === 'followup' && item._type !== 'followup') return false;
    if (actFilter === 'task'     && item._type !== 'task')     return false;
    const ts = (item._ts ? item._ts * 1000 : (item.createdAt?.seconds ? item.createdAt.seconds * 1000 : null));
    if (ts == null) return true; // no timestamp → keep (rare)
    return (nowMs - ts) <= RECENT_WINDOW_MS;
  }).slice(0, 8);

  return (
    <div>
      {/* Welcome Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:24, fontWeight:700, margin:0 }}>
            Welcome back, {(profile?.name || 'there').split(' ')[0]}
          </h2>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>
            Here's what's happening across International Skills Club today.
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ display:'inline-flex', background:'var(--surface-sunken)', borderRadius:10, padding:3, gap:3 }}>
            <button style={{ padding:'6px 14px', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', background:'var(--surface)', color:'var(--text)', boxShadow:'var(--shadow-xs)' }}>This week</button>
            <button style={{ padding:'6px 14px', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', background:'transparent', color:'var(--text-muted)' }}>This month</button>
          </div>
          <button
            onClick={() => { setSidebarTab('notif'); setShowSidebar(true); }}
            style={{ position:'relative', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:500, color:'var(--text-sub)' }}>
            <Bell size={15} /> Notifications
            {unreadNotifs > 0 && (
              <span style={{ position:'absolute', top:-5, right:-5, background:'var(--brand)', color:'#fff', borderRadius:'50%', width:17, height:17, fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{unreadNotifs}</span>
            )}
          </button>
          <button
            onClick={() => { setSidebarTab('requests'); setShowSidebar(true); }}
            style={{ position:'relative', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:500, color:'var(--text-sub)' }}>
            <Inbox size={15} /> Requests
            {pendingRequests.length > 0 && (
              <span style={{ position:'absolute', top:-5, right:-5, background:'var(--amber)', color:'#fff', borderRadius:'50%', width:17, height:17, fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{pendingRequests.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* CEO Sidebar */}
      {showSidebar && (
        <div style={{ position:'fixed', inset:0, zIndex:9000 }} onClick={() => setShowSidebar(false)}>
          <div
            style={{ position:'absolute', top:0, right:0, width:380, height:'100%', background:'var(--surface)', boxShadow:'-4px 0 24px rgba(0,0,0,.13)', display:'flex', flexDirection:'column', zIndex:9001 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'18px 20px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', gap:8 }}>
                {[{key:'requests',label:`Requests${pendingRequests.length>0?` (${pendingRequests.length})`:''}`},{key:'notif',label:`Notifications${unreadNotifs>0?` (${unreadNotifs})`:''}`}].map(t => (
                  <button key={t.key} onClick={() => setSidebarTab(t.key)}
                    style={{ padding:'5px 14px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:600, fontSize:13,
                      background: sidebarTab===t.key ? 'var(--brand)' : 'var(--surface-sunken)',
                      color:      sidebarTab===t.key ? '#fff'         : 'var(--text-sub)' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowSidebar(false)} style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}>
                <X size={18} style={{ color:'var(--text-muted)' }} />
              </button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
              {sidebarTab === 'requests' && (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {pendingRequests.length === 0 && <div style={{ textAlign:'center', color:'var(--text-muted)', paddingTop:40, fontSize:13 }}>No pending requests</div>}
                  {pendingRequests.map(req => (
                    <div key={req.id} style={{ background:'var(--surface-sunken)', borderRadius:10, padding:'12px 14px', border:'1px solid var(--border)' }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{req.title || req.type || 'Request'}</div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>From: <b>{req.requestedByName || req.requestedByEmail || '—'}</b></div>
                      {req.reason && <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>Reason: {req.reason}</div>}
                      <div style={{ display:'flex', gap:8, marginTop:8 }}>
                        <button disabled={processingReq===req.id} onClick={() => handleAcceptRequest(req)}
                          style={{ flex:1, padding:'6px 0', borderRadius:7, border:'none', background:'var(--green)', color:'#fff', fontWeight:600, fontSize:12, cursor:'pointer' }}>Accept</button>
                        <button disabled={processingReq===req.id} onClick={() => handleRejectRequest(req)}
                          style={{ flex:1, padding:'6px 0', borderRadius:7, border:'none', background:'var(--red-soft)', color:'var(--red-ink)', fontWeight:600, fontSize:12, cursor:'pointer' }}>Reject</button>
                        <button onClick={() => { setShowSidebar(false); navigate('/requests'); }}
                          style={{ flex:1, padding:'6px 0', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontWeight:600, fontSize:12, cursor:'pointer' }}>View</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => { setShowSidebar(false); navigate('/requests'); }}
                    style={{ marginTop:8, padding:9, borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--brand)', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                    View All Requests
                  </button>
                </div>
              )}
              {sidebarTab === 'notif' && (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {notifications.length === 0 && <div style={{ textAlign:'center', color:'var(--text-muted)', paddingTop:40, fontSize:13 }}>No notifications</div>}
                  {notifications.map(notif => (
                    <div key={notif.id} onClick={() => handleMarkNotifRead(notif)}
                      style={{ padding:'10px 12px', borderRadius:9, cursor:'pointer',
                        border:`1px solid ${notif.read ? 'var(--border)' : 'var(--blue-ink)'}`,
                        background: notif.read ? 'var(--surface-sunken)' : 'var(--blue-soft)' }}>
                      <div style={{ fontSize:13, color:'var(--text)', fontWeight: notif.read ? 400 : 600 }}>{notif.message}</div>
                      {notif.createdAt?.seconds && (
                        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                          {new Date(notif.createdAt.seconds*1000).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI tiles */}
      {isCEOorAdmin ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:16, marginBottom:18 }}>
          {/* Hero tile */}
          <div style={{ background:'var(--grad-brand)', borderRadius:16, padding:'18px 20px', color:'#fff', boxShadow:'var(--shadow-md)', position:'relative', overflow:'hidden', cursor:'pointer' }} onClick={() => navigate('/students')}>
            <div style={{ position:'absolute', right:-20, top:-20, width:110, height:110, borderRadius:'50%', background:'rgba(255,255,255,.10)' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', position:'relative' }}>
              <div>
                <div style={{ fontSize:12.5, color:'rgba(255,255,255,.85)', fontWeight:500 }}>Total Students</div>
                <div style={{ fontFamily:'var(--font-display)', fontSize:34, fontWeight:700, letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{totalStudents}</div>
              </div>
              <div style={{ width:40, height:40, borderRadius:10, background:'rgba(255,255,255,.18)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Users size={20} color="#fff" />
              </div>
            </div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,.9)', marginTop:12, display:'flex', alignItems:'center', gap:5, position:'relative' }}>
              <TrendingUp size={14} /> All enrolled
            </div>
          </div>

          {/* Active Batches */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)', cursor:'pointer' }} onClick={() => navigate('/batches')}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>Active Batches</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--blue-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <School size={20} style={{ color:'var(--blue-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--blue-ink)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{activeBatches.length}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>{batches.filter(b=>b.status==='upcoming').length} starting soon</div>
          </div>

          {/* At-Risk */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)', cursor:'pointer' }} onClick={() => navigate('/students')}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>At-Risk Students</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--red-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <AlertTriangle size={20} style={{ color:'var(--red-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--red-ink)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{atRiskCount}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>Needs attention</div>
          </div>

          {/* Pending Tasks */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)', cursor:'pointer' }} onClick={() => navigate('/tasks')}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>Pending Tasks</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <CheckSquare size={20} style={{ color:'var(--amber-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--amber-ink)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{pendingTasks.length}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>Across the team</div>
          </div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:16, marginBottom:18 }}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)', cursor:'pointer' }} onClick={() => navigate('/batches')}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>My Batches</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--blue-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <School size={20} style={{ color:'var(--blue-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--blue-ink)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{batches.length}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>Active assignments</div>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)', cursor:'pointer' }} onClick={() => navigate('/tasks')}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>Pending Tasks</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <CheckSquare size={20} style={{ color:'var(--amber-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--amber-ink)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{pendingTasks.length}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>Open tasks</div>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-sm)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', fontWeight:500 }}>Recent Activity</div>
              <div style={{ width:40, height:40, borderRadius:10, background:'var(--indigo-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <TrendingUp size={20} style={{ color:'var(--indigo-ink)' }} />
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:700, color:'var(--text)', letterSpacing:'-.02em', lineHeight:1, marginTop:10 }}>{recentActivity.length}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>Follow-ups + tasks</div>
          </div>
        </div>
      )}

      {/* Recently joined students — last 7 days, identical for CEO and staff */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'16px 20px', boxShadow:'var(--shadow-sm)', marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <Users size={16} style={{ color:'var(--brand)' }} />
          <h3 style={{ fontSize:15, fontWeight:700 }}>Recently Joined Students</h3>
          <span className="badge badge-green" style={{ marginLeft:2 }}>{recentStudents.length} · last 7 days</span>
        </div>
        {recentStudents.length === 0 ? (
          <div style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>
            No students joined in the last 7 days.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto', paddingRight:4 }}>
            {recentStudents.map(s => (
              <div key={s.id} onClick={() => navigate(`/students/${s.id}`)}
                style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 12px', borderRadius:10, border:'1px solid var(--border)', cursor:'pointer', transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ width:30, height:30, borderRadius:'50%', background:avatarColor(s.name||''), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(s.name||'?')}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{s.name || 'Unnamed'}</div>
                  <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>{s.batchName || '—'}{s.phone ? ` · ${s.phone}` : ''}</div>
                </div>
                <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{timeAgo(s.createdAt)}</span>
                <ChevronRight size={15} style={{ color:'var(--text-muted)', flexShrink:0 }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff: Batch Activity Hub */}
      {!isCEOorAdmin && (
        <BatchActivityHub batches={batches} schedBatch={schedBatch} setSchedBatch={setSchedBatch}
          schedFilter={schedFilter} setSchedFilter={setSchedFilter}
          schedItems={schedItems} schedLoading={schedLoading} navigate={navigate}
          schedTimeFilter={schedTimeFilter} setSchedTimeFilter={setSchedTimeFilter}
          schedCourse={schedCourse} setSchedCourse={setSchedCourse}
          schedTypeFilter={schedTypeFilter} setSchedTypeFilter={setSchedTypeFilter} />
      )}

      {/* CEO: Batches Overview */}
      {isCEOorAdmin && (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-sm)', marginBottom:18, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 14px' }}>
            <h3 style={{ fontSize:16, fontWeight:700 }}>Batches Overview</h3>
            <Link to="/batches" style={{ fontSize:12.5, color:'var(--brand)', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
              Manage batches <ChevronRight size={14} />
            </Link>
          </div>
          <div className="table-container" style={{ border:'none', boxShadow:'none', borderRadius:0, maxHeight:360, overflowY:'auto' }}>
            <table>
              <thead style={{ position:'sticky', top:0, zIndex:1, background:'var(--surface)' }}>
                <tr>
                  <th>Batch</th>
                  <th style={{ width:90 }}>Students</th>
                  <th style={{ width:230 }}>Onboarding</th>
                  <th style={{ width:130 }}>Status</th>
                  <th>Course</th>
                  <th style={{ width:80 }}></th>
                </tr>
              </thead>
              <tbody>
                {batchRows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign:'center', padding:32, color:'var(--text-muted)' }}>No batches yet.</td></tr>
                )}
                {batchRows.map(({ batch, count, onboardedCount }) => {
                  const flow = batch.courseFlow || [];
                  const onboardPct = count > 0 && flow.length > 0 ? Math.round(onboardedCount/count*100) : 0;
                  const barColor = onboardPct===100 ? 'var(--green)' : onboardPct>=60 ? 'var(--amber)' : 'var(--red)';
                  const pctColor = onboardPct===100 ? 'var(--green-ink)' : 'var(--text-sub)';
                  const statusCls = batch.status==='active' ? 'badge-green' : batch.status==='upcoming' ? 'badge-blue' : 'badge-gray';
                  const statusLabel = batch.status==='active' ? 'Active' : batch.status==='upcoming' ? 'Upcoming' : 'Completed';
                  return (
                    <tr key={batch.id} style={{ cursor:'pointer', transition:'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--brand-50)'}
                      onMouseLeave={e => e.currentTarget.style.background=''}
                      onClick={() => navigate('/batches', { state:{ batchId: batch.id, tab: 'students' } })}>
                      <td style={{ fontWeight:600 }}>{batch.name}</td>
                      <td><span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:15, color:'var(--text)' }}>{count}</span></td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div className="progress-bar" style={{ flex:1, minWidth:90 }}>
                            <div className="progress-fill" style={{ width:`${onboardPct}%`, background:barColor }} />
                          </div>
                          <span style={{ fontSize:12, fontWeight:600, color:pctColor, minWidth:34 }}>{onboardPct}%</span>
                        </div>
                      </td>
                      <td><span className={`badge ${statusCls}`}><span className="dot" />{statusLabel}</span></td>
                      <td style={{ color:'var(--text-sub)' }}>{batch.course || '—'}</td>
                      <td>
                        <span style={{ color:'var(--brand)', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
                          Open <ChevronRight size={13} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom grid: Recent Activity + At-Risk */}
      <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:18 }}>
        {/* Recent Activity */}
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-sm)', padding:'18px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <h3 style={{ fontSize:16, fontWeight:700 }}>Recent Activity</h3>
            <div style={{ display:'inline-flex', background:'var(--surface-sunken)', borderRadius:9, padding:3, gap:2 }}>
              {[
                { key:'all',      label:'All'        },
                { key:'followup', label:'Follow-ups' },
                { key:'task',     label:'Tasks'      },
              ].map(f => (
                <button key={f.key} onClick={() => setActFilter(f.key)} style={{
                  padding:'5px 12px', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer',
                  background: actFilter===f.key ? 'var(--surface)' : 'transparent',
                  color:      actFilter===f.key ? 'var(--text)'    : 'var(--text-muted)',
                  boxShadow:  actFilter===f.key ? 'var(--shadow-xs)' : 'none',
                }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:420, overflowY:'auto', paddingRight:4 }}>
            {filteredActivity.length === 0 && (
              <div style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', paddingTop:40 }}>No activity yet.</div>
            )}
            {filteredActivity.map((item, i) => {
              const isFollowup = item._type === 'followup';
              return (
                <div key={item.id || i}
                  onClick={() => navigate(isFollowup ? '/followups' : '/tasks')}
                  style={{ display:'flex', alignItems:'flex-start', gap:11, padding:10, borderRadius:10, cursor:'pointer', transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background: isFollowup ? 'var(--teal-soft)' : 'var(--amber-soft)' }}>
                    {isFollowup
                      ? <Phone size={15} style={{ color:'var(--teal-ink)' }} />
                      : <CheckSquare size={15} style={{ color:'var(--amber-ink)' }} />
                    }
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {isFollowup ? (item.studentName || 'Unknown student') : `Task · ${item.title || 'Task'}`}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--text-muted)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {isFollowup ? item.note : `Assigned to ${item.assignedTo || '—'}`}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap', flexShrink:0, marginTop:2 }}>
                    {timeAgo(item.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* At-Risk Students */}
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-sm)', padding:'18px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <h3 style={{ fontSize:16, fontWeight:700 }}>At-Risk Students</h3>
            <Link to="/students" style={{ fontSize:12.5, color:'var(--brand)', fontWeight:600 }}>View all</Link>
          </div>
          {atRiskStudents.length === 0 && (
            <div style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', paddingTop:40 }}>
              <AlertTriangle size={28} style={{ color:'var(--border)', display:'block', margin:'0 auto 8px' }} />
              No at-risk students
            </div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:420, overflowY:'auto', paddingRight:4 }}>
            {atRiskStudents.map(s => (
              <div key={s.id}
                onClick={() => navigate(`/students/${s.id}`)}
                style={{ display:'flex', alignItems:'center', gap:11, padding:'9px 10px', borderRadius:10, cursor:'pointer', transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:11, color:'#fff', flexShrink:0, background:avatarColor(s.name||'') }}>
                  {initials(s.name||'')}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                  <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>{s.batchName || '—'}</div>
                </div>
                <span className="badge badge-red" style={{ fontSize:10.5 }}>At-Risk</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CEO: Batch Activity Hub at bottom */}
      {isCEOorAdmin && (
        <div style={{ marginTop:18 }}>
          <BatchActivityHub batches={batches} schedBatch={schedBatch} setSchedBatch={setSchedBatch}
            schedFilter={schedFilter} setSchedFilter={setSchedFilter}
            schedItems={schedItems} schedLoading={schedLoading} navigate={navigate}
            schedTimeFilter={schedTimeFilter} setSchedTimeFilter={setSchedTimeFilter}
            schedCourse={schedCourse} setSchedCourse={setSchedCourse}
            schedTypeFilter={schedTypeFilter} setSchedTypeFilter={setSchedTypeFilter} />
        </div>
      )}
    </div>
  );
}
