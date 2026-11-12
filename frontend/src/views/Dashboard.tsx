import { useEffect, useState } from "react";
import type { Inspection, Project } from "../types";
import { api, formatDate } from "../api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  in_progress: "In Bearbeitung",
  completed: "Abgeschlossen",
  reviewed: "Geprueft",
  archived: "Archiviert"
};

export default function Dashboard({ go }: { go: (view: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openInspections, setOpenInspections] = useState<Inspection[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [defectsOpen, setDefectsOpen] = useState(0);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined);
    Promise.all([
      api.listInspections(undefined, "draft"),
      api.listInspections(undefined, "in_progress")
    ])
      .then(([drafts, running]) => {
        const open = [...drafts, ...running];
        setOpenCount(open.length);
        setOpenInspections(open.slice(0, 6));
      })
      .catch(() => undefined);
    api
      .listDefects()
      .then((all) => setDefectsOpen(all.filter((d) => d.status === "open").length))
      .catch(() => undefined);
  }, []);

  return (
    <div className="stack">
      <section className="card">
        <h2>Schnellerfassung</h2>
        <div className="quick-grid">
          <button className="btn btn-primary btn-lg" onClick={() => go("time")}>
            ⏱ Stunden erfassen
          </button>
          <button className="btn btn-primary btn-lg" onClick={() => go("material")}>
            🔨 Material verbrauchen
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => go("inspections")}>
            ✓ Checkliste starten
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => go("planung")}>
            📅 Einsatzplan
          </button>
        </div>
      </section>

      <div className="stat-grid">
        <button className="card stat stat-tappable" onClick={() => go("projects")}>
          <span className="stat-icon">🏗</span>
          <span className="stat-value">{projects.length}</span>
          <span className="stat-label">Projekte</span>
        </button>
        <button className="card stat stat-tappable" onClick={() => go("inspections")}>
          <span className="stat-icon">📋</span>
          <span className="stat-value">{openCount}</span>
          <span className="stat-label">Offene Pruefungen</span>
        </button>
        <button className="card stat stat-tappable" onClick={() => go("gewaehr")}>
          <span className="stat-icon">⚠️</span>
          <span className={`stat-value ${defectsOpen > 0 ? "warn-text" : ""}`}>{defectsOpen}</span>
          <span className="stat-label">Offene Maengel</span>
        </button>
      </div>

      <section className="card">
        <h2>Zuletzt bearbeitete Entwuerfe</h2>
        {openInspections.length === 0 ? (
          <p className="muted">Keine offenen Pruefungen.</p>
        ) : (
          <ul className="list">
            {openInspections.map((inspection) => (
              <li key={inspection.id}>
                <button className="list-item" onClick={() => go(`inspection:${inspection.id}`)}>
                  <span className="list-title">
                    <span className={`badge badge-${inspection.status}`}>
                      {STATUS_LABELS[inspection.status]}
                    </span>{" "}
                    Pruefung
                  </span>
                  <span className="muted">{formatDate(inspection.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
