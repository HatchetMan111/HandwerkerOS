import { useCallback, useEffect, useState } from "react";
import type { MaterialItem, MaterialUsage, Project } from "../types";
import { apiX as api, notify } from "../api";
import {
  cachePut,
  cacheDelete,
  getMaterialCatalog,
  getMaterialUsagesLocal,
  getCachedProjects,
  subscribe,
  pendingCount
} from "../idb";

function eur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

interface Props {
  canManageCatalog: boolean;
}

export default function Materials({ canManageCatalog }: Props) {
  const [usages, setUsages] = useState<MaterialUsage[]>([]);
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pending, setPending] = useState(0);
  const [form, setForm] = useState({
    project_id: "",
    material_id: "",
    name: "",
    quantity: "1",
    price_eur: "",
    note: ""
  });
  const [catalogForm, setCatalogForm] = useState({
    article_number: "",
    name: "",
    unit: "Stk",
    price_eur: ""
  });

  const load = useCallback(async () => {
    setPending(await pendingCount());
    let rows = await getMaterialUsagesLocal();
    if (!rows.length && navigator.onLine) {
      try {
        rows = await api.listUsages();
        for (const row of rows) await cachePut("material_usage", row.id, row);
      } catch (error) {
        notify(String(error), true);
      }
    }
    setUsages(rows);
    let cat = await getMaterialCatalog();
    if (!cat.length && navigator.onLine) {
      try {
        cat = await api.listMaterials();
        for (const item of cat) await cachePut("material", item.id, item);
      } catch (error) {
        notify(String(error), true);
      }
    }
    setCatalog(cat);
    setProjects(await getCachedProjects());
  }, []);

  useEffect(() => {
    void load();
    return subscribe(() => void load());
  }, [load]);

  function selectMaterial(materialId: string) {
    const item = catalog.find((m) => m.id === materialId);
    setForm({
      ...form,
      material_id: materialId,
      name: item?.name ?? form.name,
      price_eur: item ? (item.price_cents / 100).toFixed(2).replace(".", ",") : form.price_eur
    });
  }

  async function addUsage(event: React.FormEvent) {
    event.preventDefault();
    if (!form.project_id || (!form.name && !form.material_id)) {
      notify("Baustelle und Material/Name ausfuellen", true);
      return;
    }
    const usageId =
      crypto.randomUUID ? crypto.randomUUID() : `mu-${Date.now()}-${Math.random()}`;
    const workDate = new Date().toISOString().slice(0, 10);
    const priceCents = Math.round(
      parseFloat(form.price_eur.replace(",", ".") || "0") * 100
    );
    const selected = catalog.find((m) => m.id === form.material_id);
    const optimistic: MaterialUsage = {
      id: usageId,
      project_id: form.project_id,
      material_id: form.material_id || null,
      name: form.name || selected?.name || "",
      unit: selected?.unit ?? "Stk",
      quantity: Number(form.quantity),
      price_cents: priceCents || selected?.price_cents || 0,
      work_date: workDate,
      note: form.note,
      version: 1,
      unsynced: !navigator.onLine
    };
    await cachePut("material_usage", usageId, optimistic);
    const payload = {
      project_id: optimistic.project_id,
      work_date: workDate,
      material_id: optimistic.material_id,
      name: optimistic.name || undefined,
      quantity: optimistic.quantity,
      price_cents: optimistic.price_cents,
      note: optimistic.note
    };
    try {
      if (navigator.onLine) {
        await api.createUsage(payload);
        await cachePut("material_usage", usageId, { ...optimistic, unsynced: false });
        notify("Verbrauch erfasst");
      } else {
        throw new TypeError("offline");
      }
    } catch {
      const { enqueue } = await import("../idb");
      await enqueue("material_usage", usageId, "create", payload);
      notify("Offline erfasst - sync automatisch");
    }
    setForm({ ...form, material_id: "", name: "", quantity: "1", note: "" });
    void load();
  }

  async function removeUsage(usage: MaterialUsage) {
    if (!window.confirm(`"${usage.name}" entfernen?`)) return;
    try {
      if (navigator.onLine) {
        await api.deleteUsage(usage.id);
      } else {
        const { enqueue } = await import("../idb");
        await enqueue("material_usage", usage.id, "delete", {});
      }
      await cacheDelete("material_usage", usage.id);
      void load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function addToCatalog(event: React.FormEvent) {
    event.preventDefault();
    const priceCents = Math.round(parseFloat(catalogForm.price_eur.replace(",", ".") || "0") * 100);
    try {
      const created = await api.createMaterial({
        article_number: catalogForm.article_number,
        name: catalogForm.name,
        unit: catalogForm.unit,
        price_cents: priceCents
      });
      await cachePut("material", created.id, created);
      setCatalogForm({ article_number: "", name: "", unit: "Stk", price_eur: "" });
      notify("Artikel im Katalog");
      void load();
    } catch (error) {
      notify(`${error} (Katalog braucht Internet)`, true);
    }
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={addUsage}>
        <h2>Materialverbrauch erfassen</h2>
        <div className="field">
          <label htmlFor="mat-project">Baustelle *</label>
          <select
            id="mat-project"
            required
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          >
            <option value="">-- waehlen --</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="two-col">
          <div className="field">
            <label htmlFor="mat-catalog">Aus Katalog</label>
            <select id="mat-catalog" value={form.material_id} onChange={(e) => selectMaterial(e.target.value)}>
              <option value="">-- Freitext --</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({eur(item.price_cents)}/{item.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mat-name">Bezeichnung *</label>
            <input
              id="mat-name"
              required={!form.material_id}
              placeholder={form.material_id ? "(aus Katalog)" : "z.B. Leitungsschutzrohr"}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
        </div>
        <div className="two-col">
          <div className="field">
            <label htmlFor="mat-qty">Menge *</label>
            <input
              id="mat-qty"
              type="number"
              step="any"
              min="0.01"
              required
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="mat-price">Einzelpreis EUR</label>
            <input
              id="mat-price"
              type="text"
              inputMode="decimal"
              placeholder="z.B. 3,45"
              value={form.price_eur}
              onChange={(e) => setForm({ ...form, price_eur: e.target.value })}
            />
          </div>
        </div>
        <button className="btn btn-primary btn-lg" type="submit">
          {navigator.onLine ? "Erfassen" : "Offline erfassen"}
        </button>
        <p className="muted">{pending} Aenderungen warten auf Synchronisation.</p>
      </form>

      <section className="card">
        <h2>Letzter Verbrauch ({usages.length})</h2>
        <ul className="list">
          {usages.slice(0, 40).map((usage) => (
            <li key={usage.id} className="list-item static">
              <span>
                {usage.name} · {usage.quantity} {usage.unit} ×{" "}
                {eur(usage.price_cents)} ={" "}
                <b>{eur(Math.round(usage.quantity * usage.price_cents))}</b>
                {usage.unsynced ? " ⚡" : ""}
                <br />
                <span className="muted">
                  {projectName(usage.project_id)} · {usage.work_date}
                </span>
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => removeUsage(usage)}>
                ✕
              </button>
            </li>
          ))}
          {usages.length === 0 ? (
            <li className="muted list-item static">Noch kein Verbrauch erfasst.</li>
          ) : null}
        </ul>
      </section>

      {canManageCatalog ? (
        <form className="card form-row" onSubmit={addToCatalog}>
          <h2>Katalog erweitern</h2>
          <div className="two-col">
            <div className="field">
              <label htmlFor="cat-art">Artikel-Nr</label>
              <input
                id="cat-art"
                value={catalogForm.article_number}
                onChange={(e) => setCatalogForm({ ...catalogForm, article_number: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cat-unit">Einheit</label>
              <select
                id="cat-unit"
                value={catalogForm.unit}
                onChange={(e) => setCatalogForm({ ...catalogForm, unit: e.target.value })}
              >
                {["Stk", "m", "m²", "kg", "Pkg", "Std"].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="cat-name">Name *</label>
            <input
              id="cat-name"
              required
              minLength={2}
              value={catalogForm.name}
              onChange={(e) => setCatalogForm({ ...catalogForm, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="cat-price">Preis EUR netto *</label>
            <input
              id="cat-price"
              required
              inputMode="decimal"
              placeholder="z.B. 18,90"
              value={catalogForm.price_eur}
              onChange={(e) => setCatalogForm({ ...catalogForm, price_eur: e.target.value })}
            />
          </div>
          <button className="btn btn-secondary" type="submit">
            In Katalog aufnehmen
          </button>
        </form>
      ) : null}
    </div>
  );
}
