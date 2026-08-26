import { useEffect, useState } from "react";
import type { Customer } from "../types";
import { api, notify } from "../api";

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setCustomers(await api.listCustomers());
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
      await api.createCustomer({ name: name.trim(), address });
      setName("");
      setAddress("");
      notify("Kunde angelegt");
      await reload();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={create}>
        <h2>Kunde anlegen</h2>
        <div className="field">
          <label htmlFor="cust-name">Name *</label>
          <input id="cust-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cust-address">Adresse</label>
          <input id="cust-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Speichern
        </button>
      </form>

      <section className="card">
        <h2>Kunden ({customers.length})</h2>
        <ul className="list">
          {customers.map((customer) => (
            <li key={customer.id} className="list-item static">
              <span>{customer.name}</span>
              <span className="muted">{customer.address || "-"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
