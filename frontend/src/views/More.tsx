import { useCallback, useEffect, useState } from "react";
import { apiX as api, formatDate, notify } from "../api";
import { kvGet, pendingCount, subscribe, syncNow } from "../idb";
import type { User } from "../types";

interface Props {
  user: User;
  go: (target: string) => void;
}

interface Card {
  target: string;
  label: string;
  desc: string;
}

export default function More({ user, go }: Props) {
  const [pending, setPending] = useState(0);
  const [lastPull, setLastPull] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<Record<string, unknown>>>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setPending(await pendingCount());
    setLastPull(await kvGet<string>("last_pull"));
    setProblems((await kvGet<Array<Record<string, unknown>>>("last_problems")) ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribe(() => void refresh());
  }, [refresh]);

  async function manualSync() {
    setSyncing(true);
    try {
      const result = await syncNow(true);
      notify(
        result.pulled
          ? `Synchronisiert (${result.applied} gesendet, Stand aktualisiert)`
          : "Offline - Daten lokal sicher"
      );
    } catch (error) {
      notify(String(error), true);
    } finally {
      setSyncing(false);
      void refresh();
    }
  }

  const cards: Card[] = [
    { target: "projects", label: "Projekte / Baustellen", desc: "Kunden anlegen, Standorte pflegen" },
    { target: "customers", label: "Kunden", desc: "Stammdaten der Auftraggeber" },
    { target: "forms", label: "Formular-Builder", desc: "Checklisten visuell erstellen + Versionen" },
    { target: "planung", label: "Einsatzplanung", desc: "Wer ist wann auf welcher Baustelle?" },
    ...(user.permissions.includes("reports.create")
      ? [{ target: "invoices", label: "Rechnungen", desc: "Zeit × Material -> Rechnung mit Druckansicht" }]
      : []),
    { target: "gewaehr", label: "Gewährleistung", desc: "Zustandsfotos pro Baustelle" },
    ...(user.permissions.includes("users.manage")
      ? [{ target: "admin", label: "Admin / Benutzer", desc: "Rollen, Passwoerter, Accounts" }]
      : [])
  ];

  return (
    <div className="stack">
      <section className="card">
        <h2>Synchronisations-Status</h2>
        <p className="progress-line">
          {pending > 0 ? (
            <span className="warn-text">
              ⚡ {pending} Aenderungen offline gesichert - warten auf Synchronisation
            </span>
          ) : (
            "✓ Alles synchronisiert"
          )}
        </p>
        <p className="muted">Letzter Server-Abgleich: {lastPull ? formatDate(lastPull) : "noch nie"}</p>
        <button className="btn btn-primary" onClick={manualSync} disabled={syncing}>
          {syncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
        </button>
        {problems.length > 0 ? (
          <details className="problems-box">
            <summary>{problems.length} Hinweise aus dem letzten Sync</summary>
            <pre className="schema-view">{JSON.stringify(problems, null, 2)}</pre>
          </details>
        ) : null}
        <p className="muted">
          Offline funktionieren: Stundenzettel, Materialverbrauch, erfasste Pruefungen (gelesen),
          Einsatzplan. Fotos benoetigen aktuell noch Netz.
        </p>
      </section>

      <div className="quick-grid">
        {cards.map((card) => (
          <button key={card.target} className="card more-card" onClick={() => go(card.target)}>
            <b>{card.label}</b>
            <span className="muted">{card.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
