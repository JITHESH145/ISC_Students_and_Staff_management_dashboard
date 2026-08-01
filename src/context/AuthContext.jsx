import { createContext, useContext, useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

const AuthContext = createContext(null);

// Only company accounts may use the app. Checked at the login form,
// again here on every auth state change (kills any stray session),
// and at staff-account creation time.
export const ALLOWED_EMAIL_DOMAIN = 'internationalskillsclub.com';
export const isAllowedEmail = (email) =>
  typeof email === 'string' &&
  email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null); // { role: 'ceo' | 'staff', name, ... }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !isAllowedEmail(firebaseUser.email)) {
        // Non-company account somehow signed in — terminate the session.
        await signOut(auth).catch(() => {});
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setUser(firebaseUser);
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'staff', firebaseUser.uid));
        setProfile(snap.exists()
          ? { uid: firebaseUser.uid, ...snap.data() }
          : { uid: firebaseUser.uid, role: 'staff', name: firebaseUser.email });
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = (email, password) => {
    if (!isAllowedEmail(email)) {
      const err = new Error(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can sign in.`);
      err.code = 'auth/domain-not-allowed';
      return Promise.reject(err);
    }
    return signInWithEmailAndPassword(auth, email, password);
  };

  const logout = () => signOut(auth);

  const resetPassword = (email) => sendPasswordResetEmail(auth, email);

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
