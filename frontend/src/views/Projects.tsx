import { useEffect, useState } from "react";
import type { Customer, Project } from "../types";
import { api, formatDate, notify } from "../api";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [projectList, customerList] = await Promise.all([api.listProjects(), api.listCustomers()]);
      setProjects(projectList);
      setCustomers(customerList);
    } catch (error) {
      notify(String(error), true);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createProject({
        name: name.trim(),
        location,
        customer_id: customerId || null
      });
      setName("");
      setLocation("");
      setCustomerId("");
      notify("Projekt angelegt");
      await reload();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  const customerName = (id: string | null) =>
    customers.find((c) => c.id === id)?.name ?? "-";

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={create}>
        <h2>Baustelle / Projekt anlegen</h2>
        <div className="field">
          <label htmlFor="proj-name">Name *</label>
          <input id="proj-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="proj-customer">Kunde</label>
          <select id="proj-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">-- ohne Kunden --</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="proj-location">Ort / Adresse</label>
          <input id="proj-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Speichern
        </button>
      </form>

      <section className="card">
        <h2>Projekte ({projects.length})</h2>
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id} className="list-item static">
              <span>{project.name}</span>
              <span className="muted">
                {customerName(project.customer_id)} · {project.location || "-"} · {project.status} ·{" "}
                {formatDate(project.updated_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
