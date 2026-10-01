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

async function main() {
  const [name, email, password] = process.argv.slice(2)
  if (!name || !email || !password || password.length < 8) {
    console.error('Usage: npm run bootstrap -- "Full Name" email password(8+ characters)')
    process.exit(1)
  }
  const app = initializeApp(config)
  const auth = getAuth(app)
  const db = getFirestore(app)
  let uid: string
  try {
    uid = (await createUserWithEmailAndPassword(auth, email, password)).user.uid
  } catch {
    uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid
  }
  const b = writeBatch(db)
  b.set(doc(db, 'staff', uid), { name, email: email.toLowerCase(), role: 'manager', active: true, createdAt: serverTimestamp() })
  b.set(doc(db, 'config', 'bootstrap'), { uid, at: serverTimestamp() })
  try {
    await b.commit()
  } catch {
    console.error('Refused: a first manager already exists. Ask them to add you in Settings.')
    process.exit(1)
  }
  console.log(`${name} is now a manager on ${config.projectId}. Sign in at your Gymli web address.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
