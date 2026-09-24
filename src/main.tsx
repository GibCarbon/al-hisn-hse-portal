import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { AuthProvider, useAuth } from './lib/auth';
import { principal as resolvePrincipal } from './lib/api';
import { db, firebaseConfigured } from './lib/firebase';
import Portal from './App';
import './globals.css';

function NotConfigured() {
  return (
    <div className="startup">
      <div className="startup-logo">
        <img src="brands/nh.png" alt="National Holding" />
      </div>
      <h1>Al Hisn</h1><p className="muted" style={{marginTop:-8}}>National Holding HSE Governance &amp; Assurance Platform</p>
      <p className="error">
        Firebase is not configured yet. Copy <code>.env.example</code> to <code>.env</code>, fill in your Firebase
        project's web config, and rebuild. See <code>SETUP.md</code> for the exact steps.
      </p>
    </div>
  );
}

function SignIn() {
  const { signIn, registerBootstrap, error } = useAuth();
  const [fresh, setFresh] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (!db) return setFresh(false);
        const snap = await getDocs(query(collection(db, 'members'), limit(1)));
        setFresh(snap.empty);
      } catch {
        setFresh(false);
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      if (fresh) await registerBootstrap(name, email, password);
      else await signIn(email, password);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="startup">
      <div className="startup-logo">
        <img src="brands/nh.png" alt="National Holding" />
      </div>
      <h1>Al Hisn</h1><p className="muted" style={{marginTop:-8}}>National Holding HSE Governance &amp; Assurance Platform</p>
      <p>National Holding · Group Sustainability and HSE</p>
      {fresh === true && (
        <p className="muted">
          No accounts exist yet on this deployment. Create the first account — it becomes the Group Head of
          Sustainability and HSE administrator.
        </p>
      )}
      <form onSubmit={submit} style={{ maxWidth: 360, margin: '24px auto', textAlign: 'left' }}>
        {fresh && (
          <>
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', marginBottom: 12 }} />
          </>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', marginBottom: 12 }} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={{ width: '100%', marginBottom: 16 }} />
        {(formError || error) && <p className="error">{formError || error}</p>}
        <button className="primary" type="submit" disabled={busy || fresh === null} style={{ width: '100%' }}>
          {busy ? 'Please wait…' : fresh ? 'Create administrator account' : 'Sign in'}
        </button>
      </form>
      <p className="muted">Real named accounts only — no demo logins. Ask the Group Head of Sustainability and HSE to invite you if you don't have access yet.</p>
    </div>
  );
}

function Pending() {
  const { signOut, error } = useAuth();
  return (
    <div className="startup">
      <div className="startup-logo">
        <img src="brands/nh.png" alt="National Holding" />
      </div>
      <h1>Access pending</h1>
      <p className="error">{error || 'Your account is signed in but not yet provisioned.'}</p>
      <button className="button" onClick={() => signOut()}>Sign out</button>
    </div>
  );
}

function Gate() {
  const { ready, configured, user, member } = useAuth();
  const [principal, setPrincipal] = useState<any>(null);

  useEffect(() => {
    if (member) resolvePrincipal(member).then(setPrincipal);
    else setPrincipal(null);
  }, [member]);

  if (!configured) return <NotConfigured />;
  if (!ready) return null;
  if (!user) return <SignIn />;
  if (!member) return <Pending />;
  if (!principal) return null;
  return <Portal principal={principal} />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </React.StrictMode>
);
