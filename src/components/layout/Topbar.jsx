import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import NotifBell from '../ui/NotifBell';
import { Search, ChevronRight, Menu } from 'lucide-react';
import { useState } from 'react';

const BREADCRUMBS = {
  '/':            ['Overview',    'Dashboard'],
  '/students':    ['Overview',    'All Students'],
  '/followups':   ['Overview',    'Follow-Ups'],
  '/concerns':    ['Academic',    'Concerns'],
  '/assessments': ['Academic',    'Assessments'],
  '/batches':     ['Academic',    'Batches'],
  '/leaderboard': ['Academic',    'Leaderboard'],
  '/tasks':       ['Operations',  'Staff Tasks'],
  '/reports':     ['Operations',  'Daily Reports'],
  '/leads':       ['Operations',  'Lead Pipeline'],
  '/documents':   ['Operations',  'Documents'],
  '/schedule':    ['Operations',  'Schedule'],
  '/staff':       ['Management',  'Staff Management'],
  '/requests':    ['Management',  'Staff Requests'],
  '/trash':       ['Management',  'Trash'],
  '/bulk-import': ['Operations',  'Bulk Import'],
};

const ACCENTS = ['#E81620','#F4683B','#F5A623','#16A974','#11B4C6','#3B6EF6','#6366F1','#8B5CF6','#EC4899','#6E7488'];
function avatarColor(name = '') { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACCENTS[h % ACCENTS.length]; }
function initials(name = '') { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }

export default function Topbar({ onMenu = () => {} }) {
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const [searchVal, setSearchVal] = useState('');

  const key = pathname.startsWith('/students/') ? '/students' : pathname;
  const [section, page] = BREADCRUMBS[key] || ['ISC', 'Dashboard'];

  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: '0 clamp(12px, 3vw, 26px)',
      height: 56,
      display: 'flex', alignItems: 'center', gap: 14,
      flexShrink: 0, zIndex: 20,
    }}>
      {/* Hamburger — mobile only (CSS-gated) */}
      <button className="menu-btn" onClick={onMenu} aria-label="Open menu" style={{
        background: 'transparent', border: '1px solid var(--border)', borderRadius: 9,
        width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: 'var(--text-sub)', flexShrink: 0,
      }}>
        <Menu size={18} />
      </button>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span className="topbar-crumb-section" style={{ color: 'var(--muted)', fontWeight: 500 }}>{section}</span>
        <ChevronRight className="topbar-crumb-section" size={14} style={{ color: 'var(--faint)' }} />
        <span style={{ color: 'var(--ink)', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-.01em' }}>{page}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Search */}
      <div className="topbar-search" style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: 300, height: 40,
        padding: '0 13px',
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--surface-2)',
        transition: 'border-color .15s',
      }}
        onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent)'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        <Search size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          value={searchVal}
          onChange={e => setSearchVal(e.target.value)}
          placeholder="Search students, tasks…"
          style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: 'var(--text)', flex: 1, fontFamily: 'var(--font-body)' }}
        />
      </div>

      {/* Notif bell */}
      <NotifBell />

      {/* Divider */}
      <div className="topbar-divider" style={{ width: 1, height: 26, background: 'var(--border)' }} />

      {/* User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: avatarColor(profile?.name || ''),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#fff',
        }}>{initials(profile?.name || 'U')}</div>
        <div className="topbar-user-info" style={{ lineHeight: 1.3 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{profile?.name || 'User'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{profile?.role || 'staff'}</div>
        </div>
      </div>
    </header>
  );
}
