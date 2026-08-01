import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getMyStudents, getMyTasks, getMyFollowUps, getStaffBatches,
  getMyNotifications, markNotificationRead, getMyRequests, updateRequest, addNotification, createRequest,
  getBatchSchedules, getBatchTasks, getAssessments,
} from '../firebase/services';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Loading, Toast } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  Users, CheckSquare, PhoneCall, School,
  ChevronRight, AlertTriangle, Activity, Bell, Inbox, X, Phone
} from 'lucide-react';

const CARD = {
  background: '#fff',
  borderRadius: 14,
  border: '1px solid #E5E7EB',
  padding: '20px 22px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)',
};

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name = '') { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACCENTS[h % ACCENTS.length]; }
function initials(name = '') { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }
// A class needs a completion mark if it started >2h ago and is still pending.
const GRACE_MS = 2 * 60 * 60 * 1000;
function classNeedsCompletion(s) {
  if (['completed', 'cancelled', 'rescheduled'].includes(s.status)) return false;
  const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const pad = n => String(n).padStart(2, '0');
  const ld = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  let dateStr = null;
  if (s.recurring) { if (s.day === WD[new Date().getDay()]) dateStr = ld(); }
  else dateStr = s.scheduledDate || null;
  if (!dateStr) return false;
  const start = new Date(`${dateStr}T${(s.time && /^\d{1,2}:\d{2}$/.test(s.time)) ? s.time : '00:00'}`);
  if (isNaN(start)) return false;
  return (Date.now() - start.getTime()) > GRACE_MS;
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '';
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function StaffDashboard() {
  const { profile } = useAuth();
  const navigate    = useNavigate();
  const [students,        setStudents]        = useState([]);
  const [tasks,           setTasks]           = useState([]);
  const [followups,       setFollowups]       = useState([]);
  const [myBatches,       setMyBatches]       = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [notifications,   setNotifications]   = useState([]);
  const [myRequests,      setMyRequests]      = useState([]);
  const [showSidebar,     setShowSidebar]     = useState(false);
  const [sidebarTab,      setSidebarTab]      = useState('notif'); // 'notif' | 'requests'
  const [reminding,       setReminding]       = useState({});
  const [toast,           setToast]           = useState(null);
  const [actFilter,       setActFilter]       = useState('all'); // 'all' | 'followup' | 'task'

  // Batch Activity Hub
  const [hubBatch,      setHubBatch]      = useState('');
  const [hubItems,      setHubItems]      = useState([]);
  const [hubLoading,    setHubLoading]    = useState(false);
  const [hubFilter,     setHubFilter]     = useState('all');
  const [hubSearch,     setHubSearch]     = useState('');
  const [hubTypeFilter, setHubTypeFilter] = useState('');
  const [hubCourse,     setHubCourse]     = useState('');
  const [hubTimeFilter, setHubTimeFilter] = useState('active'); // 'active'|'upcoming'|'past'|'all'
  const HUB_PAGE = 20;
  const [hubPage, setHubPage] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, t, f, b, n, r] = await Promise.all([
          getMyStudents(profile?.name, profile?.uid).catch(() => []),
          getMyTasks(profile?.email).catch(() => []),
          getMyFollowUps(profile?.email).catch(() => []),
          getStaffBatches(profile?.uid).catch(() => []),
          getMyNotifications(profile?.email).catch(() => []),
          getMyRequests(profile?.uid).catch(() => []),
        ]);
        setStudents(s);
        setTasks(t);
        setFollowups(f);
        setMyBatches(b);
        setNotifications(n);
        setMyRequests(r);
      } catch (err) {
        import.meta.env.DEV && console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (profile?.uid) load();
  }, [profile?.uid]);

  // ── Due-today & 1-hour-before reminders ──────────────────────────────────
  useEffect(() => {
    if (!myBatches.length || !profile?.email) return;

    const parseMinutes = (timeStr) => {
      if (!timeStr) return null;
      // handles "10:30 AM", "14:30", "2:30 PM"
      const clean = timeStr.trim();
      const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!match) return null;
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const meridiem = (match[3] || '').toUpperCase();
      if (meridiem === 'PM' && h !== 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const runChecks = async () => {
      const now      = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayName  = DAYS[now.getDay()];
      const nowMins  = now.getHours() * 60 + now.getMinutes();

      for (const batch of myBatches) {
        const [scheds, asmts, bTasks] = await Promise.all([
          getBatchSchedules(batch.id).catch(() => []),
          getAssessments(batch.id).catch(() => []),
          getBatchTasks(batch.id).catch(() => []),
        ]);

        // 1-hour-before schedule reminder
        for (const s of scheds) {
          const key = `rem_sched_${s.id}_${todayStr}`;
          if (localStorage.getItem(key)) continue;
          const isToday =
            (s.recurring && s.day === dayName) ||
            (!s.recurring && s.scheduledDate === todayStr);
          if (!isToday) continue;
          const schedMins = parseMinutes(s.time);
          if (schedMins === null) continue;
          const diff = schedMins - nowMins;
          if (diff >= 0 && diff <= 60) {
            await addNotification({
              toEmail: profile.email,
              title: 'Class Starting Soon',
              message: `"${s.title || 'Class'}" starts at ${s.time} in ${batch.name || 'your batch'}`,
              type: 'followup',
              fromName: 'Reminder',
              read: false,
              createdAt: new Date(),
            }).catch(() => {});
            localStorage.setItem(key, '1');
          }
        }

        // Assessment due today
        for (const a of asmts) {
          if (a.status === 'completed') continue;
          if (a.date !== todayStr) continue;
          const key = `rem_asmt_${a.id}_${todayStr}`;
          if (localStorage.getItem(key)) continue;
          await addNotification({
            toEmail: profile.email,
            title: 'Assessment Due Today',
            message: `"${a.title || 'Assessment'}" is due today in ${batch.name || 'your batch'}`,
            type: 'concern',
            fromName: 'Reminder',
            read: false,
            createdAt: new Date(),
          }).catch(() => {});
          localStorage.setItem(key, '1');
        }

        // Task/assignment due today
        for (const t of bTasks) {
          if (t.status === 'completed' || t.status === 'submitted') continue;
          if (t.dueDate !== todayStr) continue;
          const key = `rem_task_${t.id}_${todayStr}`;
          if (localStorage.getItem(key)) continue;
          await addNotification({
            toEmail: profile.email,
            title: 'Assignment Due Today',
            message: `"${t.title || 'Assignment'}" is due today in ${batch.name || 'your batch'}`,
            type: 'task',
            fromName: 'Reminder',
            read: false,
            createdAt: new Date(),
          }).catch(() => {});
          localStorage.setItem(key, '1');
        }
      }
    };

    runChecks();
    const interval = setInterval(runChecks, 5 * 60 * 1000); // recheck every 5 min
    return () => clearInterval(interval);
  }, [myBatches, profile?.email]);

  // Auto-select first batch when myBatches loads
  useEffect(() => {
    if (myBatches.length > 0 && !hubBatch) setHubBatch(myBatches[0].id);
  }, [myBatches]);

  // Load hub items whenever selected batch changes
  useEffect(() => {
    if (!hubBatch) return setHubItems([]);
    setHubLoading(true);
    // Local calendar date — toISOString() is UTC and rolls to tomorrow in
    // IST after ~6:30pm, mislabelling today's classes as past/upcoming.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    Promise.all([
      getBatchSchedules(hubBatch).catch(() => []),
      getAssessments(hubBatch).catch(() => []),
      getBatchTasks(hubBatch).catch(() => []),
    ]).then(([scheds, asmts, bTasks]) => {
      setHubItems([
        ...scheds.map(s => {
          const _timeStatus = s.recurring ? 'active'
            : !s.scheduledDate ? 'active'
            : s.scheduledDate > today ? 'upcoming'
            : s.scheduledDate < today ? 'past' : 'active';
          return { ...s, _kind: 'schedule', _timeStatus, _needsCompletion: classNeedsCompletion(s),
            _label: s.title || 'Class',
            _sub: s.recurring ? `Every ${s.day} at ${s.time}` : `${s.scheduledDate || ''} at ${s.time}`,
            _type: s.type || 'live-class', _course: s.course || '' };
        }),
        ...asmts.map(a => {
          const _timeStatus = a.status === 'completed' ? 'completed'
            : a.date > today ? 'upcoming' : a.date < today ? 'past' : 'active';
          return { ...a, _kind: 'assessment', _timeStatus,
            _label: a.title || 'Assessment',
            _sub: `${a.date || '—'} · ${a.totalMarks || ''} marks`,
            _type: a.subject || '', _course: a.course || '' };
        }),
        ...bTasks.map(t => {
          const _timeStatus = (t.status === 'completed' || t.status === 'submitted') ? 'completed'
            : t.dueDate > today ? 'upcoming' : t.dueDate < today ? 'past' : 'active';
          return { ...t, _kind: 'task', _timeStatus,
            _label: t.title || 'Task',
            _sub: `${t.subject || ''} · Due: ${t.dueDate || '—'}`,
            _type: t.subject || '', _course: t.course || '' };
        }),
      ]);
      setHubPage(0);
      setHubLoading(false);
    });
  }, [hubBatch]);

  if (loading) return <Loading text="Loading your dashboard..." />;

  const pendingTasks    = tasks.filter(t => t.status !== 'completed');
  const pendingFollowups = followups.filter(f => !f.completed);
  const atRisk          = students.filter(s => s.status === 'at-risk');

  const statCards = [
    { label: 'My Students',     value: students.length,         color: 'var(--blue-ink)', bg: 'var(--blue-soft)', icon: Users,          link: '/students'  },
    { label: 'Pending Tasks',   value: pendingTasks.length,     color: '#F59E0B', bg: '#FEF3C7', icon: CheckSquare,    link: '/tasks'     },
    { label: 'Open Follow-Ups', value: pendingFollowups.length, color: '#10B981', bg: '#D1FAE5', icon: PhoneCall,      link: '/followups' },
    { label: 'At-Risk Students',value: atRisk.length,           color: '#EF4444', bg: '#FEE2E2', icon: AlertTriangle,  link: '/students'  },
  ];

  const sHead = (title, to, label = 'View all') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
      {to && (
        <Link to={to} style={{ fontSize: 12, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 500 }}>
          {label} <ChevronRight size={13} />
        </Link>
      )}
    </div>
  );

  const unreadNotifs = notifications.filter(n => !n.read).length;
  const pendingReqs  = myRequests.filter(r => r.status === 'pending').length;

  // ── Recent Activity (merged tasks + follow-ups, newest first) ──
  const recentActivity = [
    ...tasks.map(t => ({ ...t, _type: 'task' })),
    ...followups.map(f => ({ ...f, _type: 'followup' })),
  ].sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
    const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });
  // Keep only recent activity (last ~36h) so the dashboard stays relevant at scale.
  const RECENT_WINDOW_MS = 36 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const filteredActivity = recentActivity.filter(item => {
    if (actFilter === 'followup' && item._type !== 'followup') return false;
    if (actFilter === 'task'     && item._type !== 'task')     return false;
    const ts = item.createdAt?.toDate ? item.createdAt.toDate().getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : null);
    if (!ts) return true;
    return (nowMs - ts) <= RECENT_WINDOW_MS;
  }).slice(0, 6);

  // Students in my batches who joined in the last 7 days (matches CEO dashboard).
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const newStudents = students.filter(s => {
    const ts = s.createdAt?.toDate ? s.createdAt.toDate().getTime()
      : s.createdAt?.seconds ? s.createdAt.seconds * 1000
      : (s.joiningDate ? new Date(s.joiningDate).getTime() : null);
    return ts && (nowMs - ts) <= SEVEN_DAYS_MS;
  }).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  return (
    <div>
      {/* Welcome */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Welcome back, {profile?.name?.split(' ')[0]}
          </h2>
          <div style={{ fontSize: 13, color: '#9CA3AF' }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        {/* Bell + Requests button */}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => { setShowSidebar(true); setSidebarTab('requests'); }}
            style={{ position:'relative', background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, padding:'8px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600 }}>
            <Inbox size={15} style={{ color:'var(--brand)' }}/>
            My Requests
            {pendingReqs > 0 && <span style={{ background:'var(--brand)', color:'#fff', fontSize:10, fontWeight:700, borderRadius:'50%', width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center' }}>{pendingReqs}</span>}
          </button>
          <button onClick={() => { setShowSidebar(true); setSidebarTab('notif'); }}
            style={{ position:'relative', background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, padding:'8px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600 }}>
            <Bell size={15} style={{ color:'var(--brand)' }}/>
            Notifications
            {unreadNotifs > 0 && <span style={{ background:'var(--brand)', color:'#fff', fontSize:10, fontWeight:700, borderRadius:'50%', width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center' }}>{unreadNotifs}</span>}
          </button>
        </div>
      </div>

      {/* Notifications + Requests Sidebar */}
      {showSidebar && (
        <div style={{ position:'fixed', inset:0, zIndex:9000 }} onClick={() => setShowSidebar(false)}>
          <div style={{ position:'fixed', top:0, right:0, width:380, height:'100vh', background:'#fff', boxShadow:'-4px 0 24px rgba(0,0,0,0.12)', display:'flex', flexDirection:'column', zIndex:9001 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'18px 20px', borderBottom:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', gap:0, background:'#F3F4F6', borderRadius:8, padding:2 }}>
                {[{ key:'notif', label:'Notifications' }, { key:'requests', label:'My Requests' }].map(t => (
                  <button key={t.key} onClick={() => setSidebarTab(t.key)}
                    style={{ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                      background: sidebarTab===t.key ? 'var(--brand)' : 'transparent',
                      color: sidebarTab===t.key ? '#fff' : '#6B7280' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowSidebar(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#9CA3AF' }}><X size={18}/></button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
              {sidebarTab === 'notif' && (
                <>
                  {notifications.length === 0 && <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', paddingTop:40 }}>No notifications.</div>}
                  {notifications.map(n => (
                    <div key={n.id} onClick={() => markNotificationRead(n.id).then(() => setNotifications(prev => prev.map(x => x.id===n.id ? { ...x, read:true } : x)))}
                      style={{ padding:'10px 12px', borderRadius:10, marginBottom:8, cursor:'pointer',
                        background: n.read ? '#FAFBFC' : '#EFF6FF', border:`1px solid ${n.read ? '#E5E7EB' : '#BFDBFE'}` }}>
                      <div style={{ fontSize:13, fontWeight:n.read ? 400 : 700, color:'var(--text)', marginBottom:2 }}>{n.title}</div>
                      <div style={{ fontSize:12, color:'#6B7280' }}>{n.body}</div>
                    </div>
                  ))}
                </>
              )}
              {sidebarTab === 'requests' && (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>My Removal Requests</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/requests')}>View All </button>
                  </div>
                  {myRequests.length === 0 && <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', paddingTop:40 }}>No requests submitted.</div>}
                  {myRequests.map(req => {
                    const isPending = req.status === 'pending';
                    return (
                      <div key={req.id} style={{ padding:'12px', borderRadius:10, marginBottom:8, background:'#FAFBFC', border:'1px solid #E5E7EB' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                          <div style={{ fontSize:13, fontWeight:600 }}>{req.targetName}</div>
                          <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:600,
                            background: isPending ? '#FEF3C7' : req.status==='accepted' ? '#D1FAE5' : '#FEE2E2',
                            color: isPending ? '#92400E' : req.status==='accepted' ? '#065F46' : '#991B1B' }}>
                            {req.status}
                          </span>
                        </div>
                        <div style={{ fontSize:12, color:'#6B7280', marginBottom:8 }}>
                          {req.targetType} · {req.reason?.slice(0,80)}
                        </div>
                        {isPending && (
                          <button
                            disabled={reminding[req.id]}
                            onClick={async () => {
                              setReminding(p => ({ ...p, [req.id]: true }));
                              // Notify CEO
                              const ceoSnap = await getDocs(query(collection(db,'staffDirectory'), where('role','==','ceo')));
                              for (const ceoDoc of ceoSnap.docs) {
                                const ceo = ceoDoc.data();
                                if (ceo.email) await addNotification({
                                  toEmail: ceo.email, title: 'Reminder: Removal Request',
                                  body: `${profile?.name} is reminding you about their removal request from ${req.targetName}.`,
                                  type: 'removal_reminder', read: false,
                                });
                              }
                              setReminding(p => ({ ...p, [req.id]: false }));
                              setToast({ message: 'Reminder sent to CEO!', type: 'success' });
                            }}
                            style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #E5E7EB', background:'#fff', cursor:'pointer', fontWeight:500 }}>
                            {reminding[req.id] ? 'Sending...' : 'Remind CEO'}
                          </button>
                        )}
                        {req.status === 'accepted' && (
                          <div style={{ fontSize:11, color:'#10B981', fontWeight:600 }}>Approved — you have been removed.</div>
                        )}
                        {req.status === 'rejected' && (
                          <div style={{ fontSize:11, color:'#EF4444', fontWeight:600 }}>Request was declined by CEO.</div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 24 }}>
        {statCards.map(card => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              style={{ ...CARD, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onClick={() => navigate(card.link)}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = CARD.boxShadow}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{card.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: card.color, lineHeight: 1 }}>{card.value}</div>
                </div>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: card.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={20} style={{ color: card.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recently joined students in my batches (last 7 days) — always visible, below KPIs */}
      <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:14, padding:'16px 20px', marginBottom:20, boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <Users size={16} style={{ color:'var(--brand)' }}/>
          <h3 style={{ fontSize:15, fontWeight:700 }}>Recently Joined Students</h3>
          <span className="badge badge-green" style={{ marginLeft:2 }}>{newStudents.length} · last 7 days</span>
        </div>
        {newStudents.length === 0 ? (
          <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', padding:'24px 0' }}>
            No students joined in the last 7 days.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:280, overflowY:'auto', paddingRight:4 }}>
            {newStudents.map(s => (
              <div key={s.id} onClick={() => navigate(`/students/${s.id}`)}
                style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 12px', borderRadius:10, border:'1px solid #E5E7EB', cursor:'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background='#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                <div style={{ width:30, height:30, borderRadius:'50%', background:avatarColor(s.name||''), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(s.name||'?')}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{s.name || 'Unnamed'}</div>
                  <div style={{ fontSize:11.5, color:'#9CA3AF' }}>{s.batchName || '—'}{s.phone ? ` · ${s.phone}` : ''}</div>
                </div>
                <span style={{ fontSize:11, color:'#9CA3AF', whiteSpace:'nowrap' }}>{timeAgo(s.createdAt)}</span>
                <ChevronRight size={15} style={{ color:'#D1D5DB', flexShrink:0 }}/>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Batch Activity Hub ── */}
      {(() => {
        const kindColor = {
          schedule:   { bg: '#DBEAFE', color: '#1E40AF', dot: '#3B82F6' },
          assessment: { bg: '#D1FAE5', color: '#065F46', dot: '#10B981' },
          task:       { bg: '#FEF3C7', color: '#92400E', dot: '#F59E0B' },
        };
        // Derive dropdown options
        const courseOptions = [...new Set(hubItems.map(i => i._course).filter(Boolean))];
        const typeOptions = [...new Set(hubItems.filter(i => hubFilter === 'all' || i._kind === hubFilter).map(i => i._type).filter(Boolean))];

        // Apply all filters
        let list = hubItems;
        if (hubFilter !== 'all') list = list.filter(i => i._kind === hubFilter);
        if (hubTimeFilter === 'active')   list = list.filter(i => i._timeStatus === 'active');
        else if (hubTimeFilter === 'upcoming') list = list.filter(i => i._timeStatus === 'upcoming');
        else if (hubTimeFilter === 'past')     list = list.filter(i => i._timeStatus === 'past' || i._timeStatus === 'completed');
        // 'all' = no time filter
        if (hubCourse)           list = list.filter(i => i._course === hubCourse);
        if (hubTypeFilter)       list = list.filter(i => i._type === hubTypeFilter);
        if (hubSearch.trim())    list = list.filter(i => i._label.toLowerCase().includes(hubSearch.toLowerCase()) || (i._sub||'').toLowerCase().includes(hubSearch.toLowerCase()));

        const totalPages = Math.ceil(list.length / HUB_PAGE);
        const pageList   = list.slice(hubPage * HUB_PAGE, (hubPage + 1) * HUB_PAGE);

        return (
          <div style={{ ...CARD, marginBottom: 20 }}>
            {/* Title + batch chips row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Batch Activity Hub <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>(active only)</span></h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {myBatches.map(b => (
                  <button key={b.id} onClick={() => { setHubBatch(prev => prev === b.id ? '' : b.id); setHubFilter('all'); setHubTypeFilter(''); setHubSearch(''); setHubPage(0); }}
                    style={{ padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                      background: hubBatch === b.id ? 'var(--brand)' : '#F3F4F6',
                      color:      hubBatch === b.id ? '#fff'    : '#374151' }}>
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter bar */}
            {hubBatch && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 12px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E5E7EB' }}>
                {/* Type dropdown */}
                <select value={hubFilter} onChange={e => { setHubFilter(e.target.value); setHubTypeFilter(''); setHubPage(0); }}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, fontWeight: 600, background: '#fff', color: '#374151', cursor: 'pointer' }}>
                  <option value="all">All types</option>
                  <option value="schedule">Classes</option>
                  <option value="assessment">Assessments</option>
                  <option value="task">Assignments</option>
                </select>

                {/* When dropdown */}
                <select value={hubTimeFilter} onChange={e => { setHubTimeFilter(e.target.value); setHubPage(0); }}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, fontWeight: 600, background: '#fff', color: '#374151', cursor: 'pointer' }}>
                  <option value="active">Active</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="past">Past</option>
                  <option value="all">All time</option>
                </select>

                {/* Course dropdown */}
                {courseOptions.length > 0 && (
                  <select value={hubCourse} onChange={e => { setHubCourse(e.target.value); setHubPage(0); }}
                    style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, background: '#fff', color: '#374151' }}>
                    <option value="">All Courses</option>
                    {courseOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}

                {/* Subject/type dropdown */}
                {typeOptions.length > 0 && (
                  <select value={hubTypeFilter} onChange={e => { setHubTypeFilter(e.target.value); setHubPage(0); }}
                    style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, background: '#fff', color: '#374151' }}>
                    <option value="">All {hubFilter === 'schedule' ? 'Types' : 'Subjects'}</option>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}

                {/* Search */}
                <input
                  placeholder="Search…"
                  value={hubSearch}
                  onChange={e => { setHubSearch(e.target.value); setHubPage(0); }}
                  style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, background: '#fff', minWidth: 120, flex: 1 }}
                />

                {/* Clear */}
                {(hubSearch || hubTypeFilter || hubCourse || hubFilter !== 'all' || hubTimeFilter !== 'active') && (
                  <button onClick={() => { setHubFilter('all'); setHubTypeFilter(''); setHubCourse(''); setHubSearch(''); setHubTimeFilter('active'); setHubPage(0); }}
                    style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 11, background: '#fff', cursor: 'pointer', color: 'var(--brand)', fontWeight: 600 }}>
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            {!hubBatch && (
              <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '28px 0', fontSize: 13 }}>
                {myBatches.length === 0 ? 'No batches assigned yet.' : 'Select a batch above to view its classes, assessments and tasks.'}
              </div>
            )}
            {hubBatch && hubLoading && (
              <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '20px 0', fontSize: 13 }}>Loading…</div>
            )}
            {hubBatch && !hubLoading && (
              <>
                {/* Count row */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: '#6B7280', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{list.length} item{list.length !== 1 ? 's' : ''}</span>
                  <span>{hubItems.filter(i=>i._kind==='schedule').length} classes</span>
                  <span>{hubItems.filter(i=>i._kind==='assessment').length} assessments</span>
                  <span>{hubItems.filter(i=>i._kind==='task').length} assignments</span>
                </div>

                {pageList.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '20px 0', fontSize: 13 }}>No active items match your filters.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                    {pageList.map((item, i) => {
                      const c = kindColor[item._kind] || kindColor.task;
                      const tab = item._kind === 'assessment' ? 'assessments' : 'tasks';
                      return (
                        <div key={item.id || i} onClick={() => item._kind === 'schedule' ? navigate('/schedule') : navigate('/batches', { state: { batchId: hubBatch, tab } })}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid #E5E7EB', borderLeft: item._needsCompletion ? '3px solid #F59E0B' : '1px solid #E5E7EB', cursor: 'pointer', background: item._needsCompletion ? '#FEF3C7' : '#fff', transition: 'background 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = item._needsCompletion ? '#FEF3C7' : '#fff'}>
                          <div style={{ width: 9, height: 9, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item._label}</div>
                            {item._sub && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>{item._sub}</div>}
                          </div>
                          {item._needsCompletion && (
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F59E0B', color: '#fff', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>Not marked</span>
                          )}
                          {item._type && (
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#374151', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{item._type}</span>
                          )}
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: c.bg, color: c.color, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {item._kind === 'schedule' ? 'Class' : item._kind === 'assessment' ? 'Assessment' : 'Assignment'}
                          </span>
                          <span style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0 }}></span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>
                    <button className="btn btn-ghost btn-sm" disabled={hubPage === 0} onClick={() => setHubPage(p => p - 1)}>Prev</button>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>Page {hubPage + 1} of {totalPages} · {list.length} items</span>
                    <button className="btn btn-ghost btn-sm" disabled={hubPage >= totalPages - 1} onClick={() => setHubPage(p => p + 1)}>Next </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* My Batches */}
        <div style={CARD}>
          {sHead('My Batches', '/batches', 'Manage all')}
          {myBatches.length === 0 && (
            <p style={{ fontSize: 13, color: '#9CA3AF' }}>No batches assigned yet.</p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Batch', 'Course', 'Status'].map(h => (
                    <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #F3F4F6' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myBatches.map((batch, idx) => (
                  <tr
                    key={batch.id}
                    style={{ cursor: 'pointer', transition: 'background 0.12s', background: idx % 2 === 0 ? '#fff' : '#FAFBFC' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F0F4FF'}
                    onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#FAFBFC'}
                    onClick={() => navigate('/batches', { state: { batchId: batch.id, tab: 'students' } })}
                  >
                    <td style={{ padding: '9px 8px', fontWeight: 600 }}>{batch.name}</td>
                    <td style={{ padding: '9px 8px', color: '#6B7280' }}>{batch.course || '—'}</td>
                    <td style={{ padding: '9px 8px' }}>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                        background: batch.status === 'active' ? '#D1FAE5' : batch.status === 'upcoming' ? '#DBEAFE' : '#F3F4F6',
                        color: batch.status === 'active' ? '#065F46' : batch.status === 'upcoming' ? '#1E40AF' : '#374151',
                      }}>{batch.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Recent Activity</h3>
            <div style={{ display: 'inline-flex', background: 'var(--surface-sunken, #F3F4F6)', borderRadius: 9, padding: 3, gap: 2 }}>
              {[
                { key: 'all',      label: 'All'        },
                { key: 'followup', label: 'Follow-ups' },
                { key: 'task',     label: 'Tasks'      },
              ].map(f => (
                <button key={f.key} onClick={() => setActFilter(f.key)} style={{
                  padding: '5px 12px', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: actFilter === f.key ? '#fff' : 'transparent',
                  color:      actFilter === f.key ? 'var(--text)' : '#6B7280',
                  boxShadow:  actFilter === f.key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredActivity.length === 0 && (
              <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>No activity yet.</div>
            )}
            {filteredActivity.map((item, i) => {
              const isFollowup = item._type === 'followup';
              return (
                <div key={item.id || i}
                  onClick={() => navigate(isFollowup ? '/followups' : '/tasks')}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 10, borderRadius: 10, cursor: 'pointer', transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isFollowup ? 'var(--teal-soft, #CCFBF1)' : 'var(--amber-soft, #FEF3C7)' }}>
                    {isFollowup
                      ? <Phone size={15} style={{ color: 'var(--teal-ink, #0F766E)' }} />
                      : <CheckSquare size={15} style={{ color: 'var(--amber-ink, #92400E)' }} />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isFollowup ? (item.studentName || 'Unknown student') : `Task · ${item.title || 'Task'}`}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#9CA3AF', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isFollowup ? item.note : `${item.status === 'completed' ? 'Completed' : item.status === 'in-progress' ? 'In progress' : 'To do'}${item.dueDate ? ` · Due ${item.dueDate}` : ''}`}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>
                    {timeAgo(item.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* At-Risk Students in My Batches */}
        <div style={CARD}>
          {sHead('At-Risk Students', '/students', 'View all')}
          {atRisk.length === 0 ? (
            <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No at-risk students in your batches.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
              {atRisk.map(s => (
                <div
                  key={s.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FFF8F8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={() => navigate(`/students/${s.id}`)}
                >
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--brand)', flexShrink: 0 }}>
                    {(s.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>{s.batchName || '—'}</div>
                  </div>
                  <ChevronRight size={13} style={{ color: '#D1D5DB', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open Follow-Ups */}
        <div style={CARD}>
          {sHead('Open Follow-Ups', '/followups', 'View all')}
          {pendingFollowups.length === 0 && (
            <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: '20px 0' }}>No open follow-ups.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
            {pendingFollowups.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8, transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#10B981', flexShrink: 0 }}>
                  <Activity size={13} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.studentName}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{f.note}</div>
                </div>
                {f.priority === 'high' && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#FEE2E2', color: '#991B1B', fontWeight: 600, flexShrink: 0 }}>Urgent</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
