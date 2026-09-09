import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotifProvider } from './context/NotifContext';
import Sidebar from './components/layout/Sidebar';
import Topbar  from './components/layout/Topbar';
import { Loading } from './components/ui/index.jsx';

import LoginPage       from './pages/Login';
import Dashboard       from './pages/Dashboard';
import StaffDashboard  from './pages/StaffDashboard';
import StudentsPage    from './pages/Students';
import StudentProfile  from './pages/StudentProfile';
import FollowUps       from './pages/FollowUps';
import Concerns        from './pages/Concerns';
import Assessments     from './pages/Assessments';
import Batches         from './pages/Batches';
import Leaderboard     from './pages/Leaderboard';
import Tasks           from './pages/Tasks';
import Reports         from './pages/Reports';
import Leads           from './pages/Leads';
import Fees            from './pages/Fees';
import Documents       from './pages/Documents';
import StaffManagement from './pages/StaffManagement';
import Trash           from './pages/Trash';
import Requests        from './pages/Requests';
import Schedule        from './pages/Schedule';
import Notifications   from './pages/Notifications';
import ErrorBoundary   from './components/ErrorBoundary';

const NAV_BY_ROLE = {
  ceo: [
    { section: 'OVERVIEW' },
    { to: '/',            label: 'Dashboard',        icon: 'LayoutDashboard' },
    { to: '/students',    label: 'All Students',      icon: 'Users'          },
    { to: '/followups',   label: 'Follow-Ups',        icon: 'PhoneCall'      },
    { to: '/batches',     label: 'Batches',           icon: 'School'         },
    { to: '/schedule',    label: 'Schedule',          icon: 'CalendarDays'   },
    { to: '/notifications', label: 'Notifications',   icon: 'Bell'           },
    { section: 'ACADEMIC' },
    { to: '/assessments', label: 'Assessments',       icon: 'ClipboardList'  },
    { to: '/concerns',    label: 'Concerns',          icon: 'AlertCircle'    },
    { to: '/leaderboard', label: 'Leaderboard',       icon: 'Trophy'         },
    { section: 'OPERATIONS' },
    { to: '/tasks',       label: 'Staff Tasks',       icon: 'CheckSquare'    },
    { to: '/reports',     label: 'Daily Reports',     icon: 'FileText'       },
    { to: '/leads',       label: 'Lead Pipeline',     icon: 'TrendingUp'     },
    { to: '/fees',        label: 'Fees',              icon: 'Wallet'         },
    { to: '/documents',   label: 'Documents',         icon: 'FolderOpen'     },
    { section: 'MANAGEMENT' },
    { to: '/staff',       label: 'Staff Management',  icon: 'UsersRound'     },
    { to: '/requests',    label: 'Staff Requests',    icon: 'Inbox', badge: 0 },
    { to: '/trash',       label: 'Trash',             icon: 'Trash2'         },
  ],
  staff: [
    { section: 'My Work' },
    { to: '/',            label: 'My Dashboard',     icon: 'LayoutDashboard' },
    { to: '/students',    label: 'My Students',      icon: 'Users'           },
    { to: '/batches',     label: 'Batches',          icon: 'School'          },
    { to: '/schedule',    label: 'Schedule',         icon: 'CalendarDays'    },
    { to: '/followups',   label: 'My Follow-Ups',    icon: 'PhoneCall'       },
    { to: '/tasks',       label: 'My Tasks',         icon: 'CheckSquare'     },
    { to: '/assessments', label: 'Assessments',      icon: 'ClipboardList'   },
    { to: '/concerns',    label: 'Concerns',         icon: 'AlertCircle'     },
    { to: '/notifications', label: 'Notifications',  icon: 'Bell'            },
    { section: 'Reports' },
    { to: '/reports',     label: 'Daily Report',     icon: 'FileText'        },
    { section: 'Resources' },
    { to: '/leaderboard', label: 'Leaderboard',      icon: 'Trophy'          },
    { to: '/documents',   label: 'Documents',        icon: 'FolderOpen'      },
  ],
};

function AppShell() {
  // Mobile: sidebar becomes an off-canvas drawer toggled from the topbar.
  const [navOpen, setNavOpen] = useState(false);
  const { user, profile, loading } = useAuth();
  if (loading) return <Loading text="Authenticating..." />;
  if (!user)   return <Navigate to="/login" replace />;

  const role     = profile?.role || 'staff';
  // Admin/Staff = CEO-level access, but without the Staff Requests and Daily
  // Reports pages. They carry role 'ceo' (so all permission checks pass) plus
  // access:'admin'; here we just trim those two items from the CEO nav.
  const isAdmin  = profile?.access === 'admin';
  const navItems = isAdmin
    ? NAV_BY_ROLE.ceo.filter(i => i.to !== '/requests' && i.to !== '/reports')
    : (NAV_BY_ROLE[role] || NAV_BY_ROLE.staff);

  return (
    <NotifProvider>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--canvas)' }}>
        <Sidebar navItems={navItems} open={navOpen} onClose={() => setNavOpen(false)} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <Topbar onMenu={() => setNavOpen(true)} />
          <main style={{ flex: 1, overflowY: 'auto', padding: 'var(--page-pad)' }}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </NotifProvider>
  );
}

function GuestGuard() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

// Blocks the Admin/Staff access tier from CEO-only pages (Staff Requests,
// Daily Reports) even via a direct URL — they're removed from the nav too.
function BlockAdmin({ children }) {
  const { profile } = useAuth();
  if (profile?.access === 'admin') return <Navigate to="/" replace />;
  return children;
}

function HomeDashboard() {
  const { profile } = useAuth();
  const role = profile?.role || 'staff';
  if (role === 'ceo') return <Dashboard />;
  return <StaffDashboard />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<GuestGuard />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<AppShell />}>
            <Route path="/"              element={<HomeDashboard />}   />
            <Route path="/students"      element={<StudentsPage />}    />
            <Route path="/students/:id"  element={<StudentProfile />}  />
            <Route path="/followups"     element={<FollowUps />}       />
            <Route path="/concerns"      element={<Concerns />}        />
            <Route path="/assessments"   element={<Assessments />}     />
            <Route path="/batches"       element={<Batches />}         />
            <Route path="/leaderboard"   element={<Leaderboard />}     />
            <Route path="/tasks"         element={<Tasks />}           />
            <Route path="/reports"       element={<BlockAdmin><Reports /></BlockAdmin>} />
            <Route path="/leads"         element={<Leads />}           />
            <Route path="/fees"          element={<Fees />}            />
            <Route path="/documents"     element={<Documents />}       />
            <Route path="/staff"         element={<StaffManagement />} />
            <Route path="/trash"         element={<Trash />}           />
            <Route path="/requests"      element={<BlockAdmin><Requests /></BlockAdmin>} />
            <Route path="/schedule"      element={<Schedule />}        />
            <Route path="/notifications" element={<Notifications />}    />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}