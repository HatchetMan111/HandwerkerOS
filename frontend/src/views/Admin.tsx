import { useEffect, useState } from "react";
import type { User } from "../types";
import { api, notify } from "../api";

const ROLES: Array<{ value: string; label: string }> = [
  { value: "admin", label: "Administrator" },
  { value: "manager", label: "Betriebsleiter" },
  { value: "foreman", label: "Bauleiter" },
  { value: "worker", label: "Mitarbeiter" },
  { value: "viewer", label: "Leser" }
];

function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

export default function Admin({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "worker" });
  const canManage = currentUser.permissions.includes("users.manage");

  async function reload() {
    try {
      setUsers(await api.listUsers());
    } catch (error) {
      notify(String(error), true);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function changeOwnPassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      notify("Neues Passwort braucht mindestens 8 Zeichen", true);
      return;
    }
    if (newPassword !== newPassword2) {
      notify("Passwoerter stimmen nicht ueberein", true);
      return;
    }
    try {
      await api.patchUser(currentUser.id, { password: newPassword });
      setNewPassword("");
      setNewPassword2("");
      notify("Passwort geaendert");
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    if (form.password.length < 8) {
      notify("Passwort braucht mindestens 8 Zeichen", true);
      return;
    }
    try {
      await api.createUser({ ...form, email: form.email.trim() });
      setForm({ email: "", name: "", password: "", role: "worker" });
      notify("Benutzer angelegt");
      await reload();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function changeRole(user: User, role: string) {
    try {
      await api.patchUser(user.id, { role });
      notify(`Rolle von ${user.name} -> ${roleLabel(role)}`);
      await reload();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function resetPassword(user: User) {
    const input = window.prompt(`Neues Passwort fuer ${user.name} (min. 8 Zeichen):`);
    if (!input) return;
    if (input.length < 8) {
      notify("Passwort braucht mindestens 8 Zeichen", true);
      return;
    }
    try {
      await api.patchUser(user.id, { password: input });
      notify(`Passwort fuer ${user.name} zurueckgesetzt`);
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function toggleActive(user: User) {
    try {
      await api.patchUser(user.id, { is_active: !user.is_active });
      await reload();
    } catch (error) {
      notify(String(error), true);
    }
  }

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={changeOwnPassword}>
        <h2>Mein Passwort aendern</h2>
        <div className="field">
          <label htmlFor="pw1">Neues Passwort</label>
          <input
            id="pw1"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pw2">Wiederholen</label>
          <input
            id="pw2"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword2}
            onChange={(e) => setNewPassword2(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Passwort aendern
        </button>
      </form>

      {canManage ? (
        <>
          <form className="card form-row" onSubmit={createUser}>
            <h2>Benutzer anlegen</h2>
            <div className="field">
              <label htmlFor="u-email">Benutzername (oder E-Mail) *</label>
              <input
                id="u-email"
                type="text"
                autoCapitalize="none"
                minLength={3}
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="u-name">Name *</label>
              <input
                id="u-name"
                required
                minLength={2}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="u-role">Rolle</label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="u-password">Passwort * (min. 8)</label>
              <input
                id="u-password"
                type="text"
                autoComplete="off"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Anlegen
            </button>
          </form>

          <section className="card">
            <h2>Benutzer ({users.length})</h2>
            <ul className="list">
              {users.map((user) => (
                <li key={user.id} className={`list-item static ${user.is_active ? "" : "inactive-user"}`}>
                  <span>
                    {user.name}
                    <br />
                    <span className="muted">
                      {user.email} · {roleLabel(user.role)}
                      {user.is_active ? "" : " · deaktiviert"}
                    </span>
                  </span>
                  <span className="btn-row user-actions">
                    <select
                      aria-label={`Rolle von ${user.name}`}
                      value={user.role}
                      onChange={(e) => changeRole(user, e.target.value)}
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm btn-secondary" onClick={() => resetPassword(user)}>
                      Passwort
                    </button>
                    {user.id !== currentUser.id ? (
                      <button className="btn btn-sm btn-secondary" onClick={() => toggleActive(user)}>
                        {user.is_active ? "Deaktivieren" : "Aktivieren"}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
