import { useState, type FormEvent } from 'react';
import { useAuth } from '../components/auth';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="panel login" onSubmit={submit}>
        <div className="brand"><span className="logo" aria-hidden="true" /><span>WA Broadcaster</span></div>
        <h1>Sign in</h1>
        <label className="field">
          <span>Username</span>
          <input type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        <p className="err" role="alert">{error}</p>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
