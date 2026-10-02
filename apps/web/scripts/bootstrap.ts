/**
 * Creates the FIRST manager login on the real Firebase project. Works once only:
 * after that, managers add staff in Settings.
 *
 *   npm run bootstrap -- "Grace Venter" grace@yourgym.co.za 'a-strong-password'
 *
 * Needs: Email/Password sign-in switched on in the Firebase console
 * (Authentication → Sign-in method), and firestore.rules deployed.
 */
import { initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getFirestore, serverTimestamp, writeBatch } from 'firebase/firestore'

const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyA_7OZFBLLvcm61zSsJt-cBF74Oqe_Gf1E',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'fundanii-ai.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID ?? 'fundanii-ai',
  appId: process.env.VITE_FIREBASE_APP_ID ?? '1:613367943903:web:3e8b371d28e464a034cf6a',
}
const databaseId = process.env.VITE_FIREBASE_DATABASE_ID ?? 'gymli-admin'

async function main() {
  const [name, email, password] = process.argv.slice(2)
  if (!name || !email || !password || password.length < 8) {
    console.error('Usage: npm run bootstrap -- "Full Name" email password(8+ characters)')
    process.exit(1)
  }
  const app = initializeApp(config)
  const auth = getAuth(app)
  const db = getFirestore(app, databaseId)
  let uid: string
  try {
    uid = (await createUserWithEmailAndPassword(auth, email, password)).user.uid
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (code !== 'auth/email-already-in-use') {
      const hint: Record<string, string> = {
        'auth/operation-not-allowed': 'Email/Password sign-in is off. Firebase console → Authentication → Sign-in method → Email/Password → Enable.',
        'auth/admin-restricted-operation': 'Sign-up is switched off. Firebase console → Authentication → Settings → User actions → tick "Enable create (sign-up)".',
        'auth/weak-password': 'Use a password of at least 8 characters.',
        'auth/invalid-email': 'That email address is not valid.',
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The API key is restricted too far; it needs Identity Toolkit API and Token Service API.',
      }
      console.error(`Could not create the login (${code || (e as Error).message}). ${hint[code] ?? ''}`)
      process.exit(1)
    }
    try {
      uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid
    } catch {
      console.error('This email already has a login with a different password. Use that password, or delete the user in Firebase console → Authentication → Users and run this again.')
      process.exit(1)
    }
  }
  const b = writeBatch(db)
  b.set(doc(db, 'staff', uid), { name, email: email.toLowerCase(), role: 'manager', active: true, createdAt: serverTimestamp() })
  b.set(doc(db, 'config', 'bootstrap'), { uid, at: serverTimestamp() })
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000))
  try {
    await Promise.race([b.commit(), timeout])
  } catch (e) {
    if ((e as Error).message === 'timeout') {
      console.error(`No answer from Firestore after 20 s. Check that the database "${databaseId}" exists in the Firebase console
(Build → Firestore Database) for project ${config.projectId}, then run: firebase deploy --only firestore`)
    } else {
      console.error('Refused: a first manager already exists. Ask them to add you in Settings.')
    }
    process.exit(1)
  }
  console.log(`${name} is now a manager on ${config.projectId}. Sign in at your Gymli web address.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
