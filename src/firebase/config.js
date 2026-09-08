import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyCj95Mv7stlz-owyiaj4yo_0DH3qzS4l0E",
  authDomain: "isc-sms-test.firebaseapp.com",
  projectId: "isc-sms-test",
  storageBucket: "isc-sms-test.firebasestorage.app",
  messagingSenderId: "4958345315",
  appId: "1:4958345315:web:77c9a7543fb5ae31f74056",
  measurementId: "G-KMM31KQ5BF"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);

// ── Local Emulator mode (opt-in) ───────────────────────────────
// When VITE_USE_EMULATOR=true (dev only), point Auth/Firestore/Storage at the
// local Firebase Emulator Suite instead of the live project. All reads/writes
// then stay on your machine — you can add/delete students, edit fields, etc.
// without ever touching production data. Load real data in with
// `npm run seed:emulator`. Default (flag unset) keeps hitting the live project.
export const USING_EMULATOR =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true';

if (USING_EMULATOR) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
    // eslint-disable-next-line no-console
    console.info('%c[Firebase] Emulator mode — writes stay local, production is safe.', 'color:#0F9E8E;font-weight:bold');
  } catch (err) {
    import.meta.env.DEV && console.error('Emulator connect failed:', err);
  }
}

// FCM — only initialise when the browser supports it
export const getMessagingInstance = async () => {
  const supported = await isSupported();
  if (!supported) return null;
  return getMessaging(app);
};

export default app;
