import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from '../context/AuthContext';
import { Eye, EyeOff, ShieldCheck, Lock, ArrowRight, Mail, ShieldAlert } from 'lucide-react';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECS = 5 * 60;

function getRemainingLockout() {
  try { const ts = Number(localStorage.getItem('isc_lockout_until') || 0); return Math.max(0, Math.ceil((ts - Date.now()) / 1000)); } catch { return 0; }
}
function getAttempts() { try { return Number(localStorage.getItem('isc_login_attempts') || 0); } catch { return 0; } }
function setAttempts(n) { try { localStorage.setItem('isc_login_attempts', String(n)); } catch {} }
function setLockout() { try { localStorage.setItem('isc_lockout_until', String(Date.now() + LOCKOUT_SECS * 1000)); } catch {} }
function clearAttempts() { try { localStorage.removeItem('isc_login_attempts'); localStorage.removeItem('isc_lockout_until'); } catch {} }

// Brand palette pulled from the ISC logo (red icon + black wordmark)
const BRAND = {
  red:      '#EB1E26',
  redDark:  '#C1121A',
  redDeep:  '#8E0B11',
  ink:      '#141417',
  panel:    'linear-gradient(165deg,#1B1B1F 0%,#141417 55%,#1E1114 130%)',
};

export default function LoginPage() {
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [error,      setError]      = useState('');
  const [domainErr,  setDomainErr]  = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [resetSent,  setResetSent]  = useState(false);
  const [lockoutRem, setLockoutRem] = useState(getRemainingLockout);
  const timerRef = useRef(null);
  const { login, resetPassword } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (lockoutRem <= 0) return;
    timerRef.current = setInterval(() => {
      const rem = getRemainingLockout();
      setLockoutRem(rem);
      if (rem <= 0) clearInterval(timerRef.current);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [lockoutRem]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setDomainErr(false);
    if (getRemainingLockout() > 0) return;
    const emailTrimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError('Please enter a valid email address.'); return; }
    // Company-domain rule: only ISC accounts may sign in. Rejected here
    // with a clear message and no attempt penalty.
    if (!isAllowedEmail(emailTrimmed)) {
      setDomainErr(true);
      setError(`Access restricted — only @${ALLOWED_EMAIL_DOMAIN} accounts can sign in.`);
      return;
    }
    setLoading(true);
    try {
      await login(emailTrimmed, password);
      clearAttempts();
      navigate('/');
    } catch {
      const attempts = getAttempts() + 1;
      setAttempts(attempts);
      if (attempts >= MAX_ATTEMPTS) {
        setLockout(); setLockoutRem(LOCKOUT_SECS);
        setError(`Too many failed attempts. Account locked for ${LOCKOUT_SECS / 60} minutes.`);
      } else {
        setError(`Invalid email or password. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts !== 1 ? 's' : ''} remaining.`);
      }
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    const emailTrimmed = email.trim().toLowerCase();
    if (!emailTrimmed) { setError('Enter your email first.'); return; }
    if (!isAllowedEmail(emailTrimmed)) {
      setDomainErr(true);
      setError(`Password resets are only available for @${ALLOWED_EMAIL_DOMAIN} accounts.`);
      return;
    }
    try { await resetPassword(emailTrimmed); setResetSent(true); setError(''); setDomainErr(false); }
    catch { setError('Could not send reset email. Check the address and try again.'); }
  };

  const locked = lockoutRem > 0;
  const mins = String(Math.floor(lockoutRem / 60)).padStart(2, '0');
  const secs = String(lockoutRem % 60).padStart(2, '0');

  return (
    <div className="login-page" style={{
      width: '100%', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      background: 'radial-gradient(120% 120% at 0% 0%,#F7EDEC 0%,#F4F4F6 45%,#EEEFF3 100%)',
      position: 'relative', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-16px)} }
        @keyframes fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @media (prefers-reduced-motion: reduce) {
          .login-page * { animation: none !important; }
        }
        .login-card { display: grid; grid-template-columns: 1.05fr 1fr; }
        .login-left { display: flex; }
        .login-brand-mobile { display: none; }
        @media (max-width: 860px) {
          .login-page { padding: 14px !important; align-items: flex-start !important; }
          .login-card { grid-template-columns: 1fr; margin-top: 4vh; }
          .login-left { display: none; }
          .login-brand-mobile { display: flex; }
          .login-form-panel { padding: 30px 24px 34px !important; }
        }
      `}</style>

      {/* Ambient blobs in brand tones */}
      <div style={{ position:'absolute', width:480, height:480, borderRadius:'50%', background:'radial-gradient(circle,rgba(235,30,38,.10),transparent 65%)', top:-160, left:-120, animation:'floaty 11s ease-in-out infinite', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', width:420, height:420, borderRadius:'50%', background:'radial-gradient(circle,rgba(20,20,23,.10),transparent 65%)', bottom:-160, right:-90, animation:'floaty 9s ease-in-out infinite', pointerEvents:'none' }}/>

      {/* Card */}
      <div className="login-card" style={{
        position:'relative', width:'min(980px,100%)',
        background:'#FFFFFF', border:'1px solid #ECECF1',
        borderRadius:20, overflow:'hidden',
        boxShadow:'0 40px 90px -34px rgba(20,20,23,.45)',
        animation:'fadein .4s ease',
      }}>

        {/* ── Left brand panel (hidden on mobile) ── */}
        <div className="login-left" style={{
          background: BRAND.panel,
          color:'#fff', padding:'46px 42px',
          flexDirection:'column', position:'relative', overflow:'hidden',
        }}>
          <div style={{ position:'absolute', width:380, height:380, borderRadius:'50%', background:`radial-gradient(circle,rgba(235,30,38,.16),transparent 60%)`, top:-130, right:-90, pointerEvents:'none' }}/>
          <div style={{ position:'absolute', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,255,255,.05),transparent 60%)', bottom:-110, left:-80, pointerEvents:'none' }}/>

          {/* Logo */}
          <div style={{ display:'flex', alignItems:'center', gap:13, position:'relative' }}>
            <div style={{ width:46, height:46, borderRadius:12, background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 10px 26px -8px rgba(235,30,38,.55)', flexShrink:0, overflow:'hidden', padding:5 }}>
              <img src="/logo.png" alt="International Skills Club logo" style={{ width:'100%', height:'100%', objectFit:'contain' }}
                onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='inline'; }} />
              <span style={{ display:'none', fontFamily:'var(--font-display)', fontWeight:800, fontSize:15, color:BRAND.red, letterSpacing:'-.03em' }}>ISC</span>
            </div>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, lineHeight:1.18, letterSpacing:'.01em', textTransform:'uppercase' }}>
              International<br/>Skills Club
            </div>
          </div>

          {/* Status pill */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:7, alignSelf:'flex-start', marginTop:36, padding:'6px 12px', borderRadius:9999, background:'rgba(255,255,255,.07)', border:'1px solid rgba(255,255,255,.13)', fontSize:11.5, fontWeight:600, letterSpacing:'.01em' }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:BRAND.red, boxShadow:'0 0 0 3px rgba(235,30,38,.28)', display:'inline-block' }}/>
            Student Management System
          </div>

          <h2 style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:30, lineHeight:1.14, letterSpacing:'-.02em', margin:'24px 0 12px', maxWidth:'14ch', color:'#fff' }}>
            Run your whole academy from one calm workspace.
          </h2>
          <p style={{ fontSize:13.5, lineHeight:1.65, color:'rgba(255,255,255,.62)', margin:0, maxWidth:'36ch' }}>
            Students, batches, schedules, assessments and tasks — tracked in real time, in one place.
          </p>

          <div style={{ flex:1 }}/>

          {/* Stat tiles */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginTop:30 }}>
            {[['248','Students'],['12','Batches'],['18','Staff']].map(([n,l]) => (
              <div key={l} style={{ padding:'14px', borderRadius:12, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.11)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:22, letterSpacing:'-.02em' }}>{n}</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,.55)', marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="login-form-panel" style={{ padding:'46px 44px', display:'flex', flexDirection:'column', justifyContent:'center', background:'#fff' }}>

          {/* Mobile-only brand header */}
          <div className="login-brand-mobile" style={{ alignItems:'center', flexDirection:'column', gap:12, marginBottom:26 }}>
            <img src="/logo-full.png" alt="International Skills Club"
              style={{ maxWidth:'min(280px,80%)', height:'auto' }}
              onError={e => { e.currentTarget.style.display='none'; }} />
          </div>

          {/* Badge */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:7, alignSelf:'flex-start', padding:'6px 12px', borderRadius:9999, background:'#FDECEC', color:BRAND.redDeep, fontSize:11.5, fontWeight:700, marginBottom:22 }}>
            <ShieldCheck size={13}/>
            @{ALLOWED_EMAIL_DOMAIN} accounts only
          </div>

          <h1 style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:30, letterSpacing:'-.03em', color:BRAND.ink, margin:'0 0 6px' }}>Welcome back</h1>
          <p style={{ fontSize:13.5, color:'#75757F', margin:'0 0 26px' }}>Sign in with your ISC work email.</p>

          {locked && (
            <div style={{ background:'#FDECEC', color:BRAND.redDeep, padding:'12px 14px', borderRadius:10, fontSize:13, marginBottom:20, display:'flex', alignItems:'center', gap:8 }}>
              <Lock size={14}/> Account locked. Try again in <strong style={{ marginLeft:4 }}>{mins}:{secs}</strong>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:18 }} autoComplete="on" noValidate>
            <div className="form-group">
              <label htmlFor="login-email" style={{ fontSize:11.5, fontWeight:700, letterSpacing:'.02em', color:'#55555E', textTransform:'uppercase', display:'block', marginBottom:8 }}>Email address</label>
              <div style={{ display:'flex', alignItems:'center', gap:10, height:48, padding:'0 14px', border:`1px solid ${domainErr ? BRAND.red : '#E3E3EA'}`, borderRadius:10, background:'#fff', transition:'border-color .15s' }}
                onFocusCapture={e => e.currentTarget.style.borderColor=BRAND.red}
                onBlurCapture={e => e.currentTarget.style.borderColor = domainErr ? BRAND.red : '#E3E3EA'}
              >
                <Mail size={16} style={{ color:'#9B9BA6', flexShrink:0 }}/>
                <input
                  id="login-email"
                  type="email" value={email} onChange={e => { setEmail(e.target.value); setDomainErr(false); }}
                  placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
                  autoComplete="email" required disabled={locked}
                  style={{ flex:1, minWidth:0, border:'none', outline:'none', fontSize:14, color:BRAND.ink, background:'transparent', fontFamily:'var(--font-body)' }}
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <label htmlFor="login-password" style={{ fontSize:11.5, fontWeight:700, letterSpacing:'.02em', color:'#55555E', textTransform:'uppercase' }}>Password</label>
                <button type="button" onClick={handleReset} disabled={locked}
                  style={{ background:'none', border:'none', color:BRAND.red, fontSize:12, cursor:'pointer', padding:0, fontWeight:600 }}>
                  Forgot?
                </button>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, height:48, padding:'0 14px', border:'1px solid #E3E3EA', borderRadius:10, background:'#fff', transition:'border-color .15s' }}
                onFocusCapture={e => e.currentTarget.style.borderColor=BRAND.red}
                onBlurCapture={e => e.currentTarget.style.borderColor='#E3E3EA'}
              >
                <Lock size={16} style={{ color:'#9B9BA6', flexShrink:0 }}/>
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password" required disabled={locked}
                  style={{ flex:1, minWidth:0, border:'none', outline:'none', fontSize:14, color:BRAND.ink, background:'transparent', letterSpacing:'.04em', fontFamily:'var(--font-body)' }}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={locked}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#9B9BA6', padding:2, display:'flex' }}>
                  {showPw ? <EyeOff size={17}/> : <Eye size={17}/>}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ background:'#FDECEC', color:BRAND.redDeep, padding:'10px 14px', borderRadius:10, fontSize:13, display:'flex', alignItems:'flex-start', gap:8 }}>
                {domainErr && <ShieldAlert size={15} style={{ flexShrink:0, marginTop:1 }}/>}
                <span>{error}</span>
              </div>
            )}
            {resetSent && <div style={{ background:'#E8F7EF', color:'#0B7150', padding:'10px 14px', borderRadius:10, fontSize:13 }}>Password reset email sent — check your inbox.</div>}

            <button
              type="submit" disabled={loading || locked}
              style={{ height:50, borderRadius:10, border:'none', cursor: loading || locked ? 'not-allowed' : 'pointer', background:`linear-gradient(135deg,#F4353C 0%,${BRAND.red} 45%,${BRAND.redDark} 120%)`, boxShadow:'0 10px 24px -10px rgba(235,30,38,.65)', color:'#fff', fontFamily:'var(--font-body)', fontSize:14.5, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:9, opacity: loading || locked ? 0.7 : 1, transition:'filter .15s' }}
              onMouseEnter={e => { if (!loading && !locked) e.currentTarget.style.filter='brightness(1.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.filter=''; }}
            >
              {loading ? 'Signing in…' : <><span>Sign In</span><ArrowRight size={17}/></>}
            </button>
          </form>

          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:24, paddingTop:18, borderTop:'1px solid #F0F0F4', color:'#A6A6B0', fontSize:11 }}>
            <Lock size={13}/>
            Unauthorised access attempts are logged and may be reported.
          </div>
        </div>
      </div>
    </div>
  );
}
