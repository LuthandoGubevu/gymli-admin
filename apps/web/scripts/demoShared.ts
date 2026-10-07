/**
 * Shared by the presentation scripts (demo.ts, demo-busy.ts): which Firebase project to use,
 * and how to write an audit entry. Every write goes through firestore.rules.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { collection, connectFirestoreEmulator, doc, getFirestore, serverTimestamp, type Firestore } from 'firebase/firestore'

/** Sample amounts (cents) for the demo payments */
export const DEMO_PRICES = { day: 8000, m1: 45000, m3: 125000, m6: 240000, m12: 450000 }

export const emulator = process.env.GYMLI_EMULATOR === '1'
export const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyA_7OZFBLLvcm61zSsJt-cBF74Oqe_Gf1E',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'fundanii-ai.firebaseapp.com',
  projectId: emulator ? 'demo-gymli' : (process.env.VITE_FIREBASE_PROJECT_ID ?? 'fundanii-ai'),
  appId: process.env.VITE_FIREBASE_APP_ID ?? '1:613367943903:web:3e8b371d28e464a034cf6a',
}
export const databaseId = emulator ? '(default)' : (process.env.VITE_FIREBASE_DATABASE_ID ?? 'gymli-admin')

export interface Who {
  uid: string
  name: string
  role: 'manager' | 'device'
}

export function connect(name: string): { app: FirebaseApp; auth: Auth; db: Firestore } {
  const app = initializeApp(config, name)
  const auth = getAuth(app)
  const db = getFirestore(app, databaseId)
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  return { app, auth, db }
}

export function audit(db: Firestore, tx: { set: (ref: ReturnType<typeof doc>, data: object) => unknown }, who: Who, action: string, entity: string, entityId: string, summary: string) {
  const ref = doc(collection(db, 'audit'))
  tx.set(ref, { at: serverTimestamp(), actor: { uid: who.uid, name: who.name, role: who.role }, action, entity, entityId, summary, before: null, after: null })
  return ref.id
}
