// Real Firebase Authentication — no demo/seeded accounts.
//
// First sign-in ever on a fresh Firebase project becomes the Group Head of
// Sustainability and HSE (bootstrap admin), matching how the original app's
// BOOTSTRAP_EMAIL worked. After that, only an existing 'group' member can add
// further named accounts (Administration screen) — someone must be invited
// (a members/{uid} document must exist) before they can use the portal, and
// they authenticate with their own real email + password via Firebase Auth.
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from './firebase';
import { ROLES, TITLE, now } from './engine';

export type Member = {
  id: string;
  email: string;
  name: string;
  role: string;
  entity: string;
  designation: string;
  active: boolean;
  expires?: string | null;
  assignments?: string[];
};

type AuthState = {
  ready: boolean;
  configured: boolean;
  user: User | null;
  member: Member | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  registerBootstrap: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) {
      setReady(true);
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      setUser(u);
      if (!u) {
        setMember(null);
        setReady(true);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'members', u.uid));
        if (snap.exists()) {
          const m = snap.data() as Member;
          if (!m.active || (m.expires && m.expires < now())) {
            setError('Your access has expired or been revoked. Contact the Group Head of Sustainability and HSE.');
            setMember(null);
          } else {
            setMember({ ...m, id: u.uid });
          }
        } else {
          setMember(null);
          setError('No active portal membership for this account. Ask the Group Head of Sustainability and HSE to add you from Administration.');
        }
      } catch (e: any) {
        setError(e.message);
      }
      setReady(true);
    });
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase is not configured. See SETUP.md.');
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  // Only usable when NO members exist yet anywhere in this Firebase project —
  // i.e. a genuinely fresh deployment. Creates the first real 'group' admin.
  const registerBootstrap = async (name: string, email: string, password: string) => {
    if (!auth || !db) throw new Error('Firebase is not configured. See SETUP.md.');
    const existing = await getDocs(query(collection(db, 'members'), limit(1)));
    if (!existing.empty) throw new Error('This portal already has accounts. Ask an existing administrator to add you.');
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const m: Member = {
      id: cred.user.uid,
      email: email.trim().toLowerCase(),
      name,
      role: 'group',
      entity: 'group',
      designation: TITLE,
      active: true,
      assignments: [],
    };
    await setDoc(doc(db, 'members', cred.user.uid), m);
    setMember(m);
  };

  const signOut = async () => {
    if (auth) await fbSignOut(auth);
  };

  return (
    <Ctx.Provider value={{ ready, configured: firebaseConfigured, user, member, error, signIn, registerBootstrap, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}

export { ROLES };
