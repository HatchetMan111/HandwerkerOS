import { useState } from "react";
import { api } from "../api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.login(email.trim(), password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>
          <span className="logo-dot" /> HandwerkerOS
        </h1>
        <p className="muted">Anmeldung</p>
        <p className="muted login-hint">Standard-Zugang: <b>admin</b> / <b>admin</b> (im Admin-Tab aendern)</p>
        <div className="field">
          <label htmlFor="login-email">E-Mail</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Passwort</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
          {busy ? "Anmelden..." : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
