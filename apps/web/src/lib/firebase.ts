import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

/**
 * Firebase web config. These values are public by design (they identify the project);
 * access is controlled by firestore.rules and Firebase Auth, not by hiding them.
 * Override with VITE_FIREBASE_* variables for another project.
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyA_7OZFBLLvcm61zSsJt-cBF74Oqe_Gf1E',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'fundanii-ai.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'fundanii-ai',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'fundanii-ai.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '613367943903',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:613367943903:web:3e8b371d28e464a034cf6a',
}

export const useEmulator = import.meta.env.VITE_USE_EMULATOR === '1'

/** Firestore database name. Production uses the "gymli-admin" database; the emulator uses "(default)". */
export const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID ?? 'gymli-admin'

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  // Offline cache keeps the members list instant on reload and saves reads.
  localCache: useEmulator ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, databaseId)

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
