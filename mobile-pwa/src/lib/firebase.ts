import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:000:web:000",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

export async function signInWithEmail(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { data: userCredential, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signUpWithEmail(email: string, password: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return { data: userCredential, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signInWithMagicLink(email: string) {
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      handleCodeInApp: true,
    });
    return { data: { message: "Magic link sent" }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signOut() {
  try {
    await firebaseSignOut(auth);
    return { error: null };
  } catch (error) {
    return { error };
  }
}

export async function getSession() {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    return { session: { user, token }, error: null };
  }
  return { session: null, error: null };
}

export async function getUser(): Promise<{ user: User | null; error: unknown }> {
  return { user: auth.currentUser, error: null };
}
