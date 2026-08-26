import { useCallback, useEffect, useState } from "react";
import type { Invoice } from "../types";
import { apiX as api, formatDate, notify } from "../api";

function eur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function printInvoice(invoice: Invoice) {
  const rows = invoice.lines
    .map(
      (line) => `<tr>
        <td>${line.description}</td>
        <td style="text-align:right">${line.quantity.toLocaleString("de-DE")} ${line.unit}</td>
        <td style="text-align:right">${eur(line.unit_price_cents)}</td>
        <td style="text-align:right"><b>${eur(line.total_cents)}</b></td>
      </tr>`
    )
    .join("");
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <title>Rechnung ${invoice.number}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:2.5rem;color:#111}
    h1{margin-bottom:0.1rem}
    .meta{color:#555;font-size:0.9rem;margin-bottom:1.5rem}
    table{width:100%;border-collapse:collapse;margin-top:1rem}
    th,td{border-bottom:1px solid #ddd;padding:0.45rem 0.4rem;text-align:left;font-size:0.92rem}
    th{background:#f4f5f7}
    tfoot td{font-size:0.95rem}
    .sumrow td{text-align:right}
    .grand{font-weight:700;font-size:1.05rem}
  </style></head><body>
  <h1>Rechnung ${invoice.number}</h1>
  <div class="meta">
    ${invoice.customer_name ? `${invoice.customer_name}<br/>` : ""}
    Baustelle: ${invoice.project_name}
    <br/>Erstellt: ${formatDate(invoice.created_at)}
  </div>
  <table>
    <thead><tr><th>Position</th><th style="text-align:right">Menge</th><th style="text-align:right">Einzelpreis</th><th style="text-align:right">Summe</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="sumrow"><td colspan="3">Netto</td><td style="text-align:right">${eur(invoice.subtotal_cents)}</td></tr>
      <tr class="sumrow"><td colspan="3">USt ${invoice.tax_percent} %</td><td style="text-align:right">${eur(invoice.vat_cents)}</td></tr>
      <tr class="sumrow grand"><td colspan="3">Gesamt</td><td style="text-align:right">${eur(invoice.total_cents)}</td></tr>
    </tfoot>
  </table>
  <p class="meta">Erstellt mit HandwerkerOS - Grundlage: freigegebene Zeiten (${invoice.labor_hours.toFixed(2)} Std) und Materialverbrauch.</p>
  </body></html>`;
  const win = window.open("", "_blank", "width=860,height=900");
  if (!win) {
    notify("Popup blockiert - bitte Popups erlauben", true);
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    project_id: "",
    rate_eur: "45",
    tax_percent: "19"
  });

  const load = useCallback(async () => {
    try {
      setInvoices(await api.listInvoices());
    } catch (error) {
      notify(String(error), true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  async function doPreview(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api.previewInvoice({
        project_id: form.project_id,
        hourly_rate_cents: Math.round(parseFloat(form.rate_eur.replace(",", ".")) * 100),
        tax_percent: Number(form.tax_percent)
      });
      setPreview(result);
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function create() {
    try {
      const invoice = await api.createInvoice({
        project_id: form.project_id,
        hourly_rate_cents: Math.round(parseFloat(form.rate_eur.replace(",", ".")) * 100),
        tax_percent: Number(form.tax_percent)
      });
      notify(`Rechnung ${invoice.number} erstellt`);
      setPreview(null);
      await load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function finalize(invoice: Invoice) {
    try {
      await api.patchInvoiceStatus(invoice.id, "final");
      notify("Rechnung finalisiert");
      await load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function remove(invoice: Invoice) {
    if (!window.confirm("Entwurf loeschen?")) return;
    try {
      await api.deleteInvoice(invoice.id);
      await load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  const previewLines = (preview?.lines ?? []) as Array<{
    description: string;
    quantity: number;
    unit: string;
    unit_price_cents: number;
    total_cents: number;
    type: string;
  }>;

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={doPreview}>
        <h2>Rechnung aus Zeit &times; Material</h2>
        <div className="field">
          <label htmlFor="inv-project">Baustelle *</label>
          <select
            id="inv-project"
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
            <label htmlFor="inv-rate">Stundensatz EUR netto *</label>
            <input
              id="inv-rate"
              required
              inputMode="decimal"
              value={form.rate_eur}
              onChange={(e) => setForm({ ...form, rate_eur: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="inv-tax">USt %</label>
            <input
              id="inv-tax"
              required
              type="number"
              min="0"
              max="25"
              value={form.tax_percent}
              onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
            />
          </div>
        </div>
        <button className="btn btn-secondary btn-lg" type="submit">
          Positionen sammeln (Vorschau)
        </button>
        <p className="muted">
          Grundlage: freigegebene Stunden des Projekts + kompletter Materialverbrauch.
        </p>
      </form>

      {preview ? (
        <section className="card">
          <h2>Vorschau</h2>
          <ul className="list">
            {previewLines.map((line, index) => (
              <li key={index} className="list-item static">
                <span>
                  {line.type === "labor" ? "⏱" : "🔩"} {line.description}
                  <br />
                  <span className="muted">
                    {line.quantity.toLocaleString("de-DE")} {line.unit} ×{" "}
                    {eur(line.unit_price_cents)}
                  </span>
                </span>
                <b>{eur(line.total_cents)}</b>
              </li>
            ))}
          </ul>
          <p className="progress-line">
            Netto {eur((preview.subtotal_cents ?? 0) as number)} · USt{" "}
            {eur((preview.vat_cents ?? 0) as number)} ·{" "}
            <b>Gesamt {eur((preview.total_cents ?? 0) as number)}</b>
          </p>
          <button className="btn btn-primary btn-lg" onClick={create}>
            Rechnung jetzt erstellen
          </button>
        </section>
      ) : null}

      <section className="card">
        <h2>Rechnungen ({invoices.length})</h2>
        <ul className="list">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="list-item static">
              <span>
                {invoice.number} · {invoice.project_name}
                <br />
                <span className="muted">
                  {formatDate(invoice.created_at)} · Status {invoice.status}
                </span>
              </span>
              <span className="btn-row user-actions">
                <b>{eur(invoice.total_cents)}</b>
                <button className="btn btn-sm btn-secondary" onClick={() => printInvoice(invoice)}>
                  Drucken/PDF
                </button>
                {invoice.status === "draft" ? (
                  <>
                    <button className="btn btn-sm btn-success" onClick={() => finalize(invoice)}>
                      Finalisieren
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(invoice)}>
                      ✕
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
          {invoices.length === 0 ? (
            <li className="muted list-item static">Noch keine Rechnungen.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
