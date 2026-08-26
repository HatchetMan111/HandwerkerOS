import { useEffect, useState } from "react";
import type { Inspection, Project } from "../types";
import { api, formatDate } from "../api";

export default function Dashboard({ go }: { go: (view: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openInspections, setOpenInspections] = useState<Inspection[]>([]);
  const [defectsOpen, setDefectsOpen] = useState(0);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined);
    api
      .listInspections(undefined, "draft")
      .then((items) => setOpenInspections(items.slice(0, 6)))
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
          <button className="btn btn-primary btn-lg" onClick={() => go("inspections")}>
            Pruefung starten
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => go("inspections")}>
            Mangel erfassen
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => go("projects")}>
            Projekte / Baustellen
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => go("forms")}>
            Formulare
          </button>
        </div>
      </section>

      <div className="stat-grid">
        <div className="card stat">
          <span className="stat-value">{projects.length}</span>
          <span className="stat-label">Projekte</span>
        </div>
        <div className="card stat">
          <span className="stat-value">{openInspections.length}</span>
          <span className="stat-label">Offene Pruefungen</span>
        </div>
        <div className="card stat">
          <span className={`stat-value ${defectsOpen > 0 ? "warn-text" : ""}`}>{defectsOpen}</span>
          <span className="stat-label">Offene Maengel</span>
        </div>
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
                  <span>Pruefung</span>
                  <span className="muted">
                    {inspection.status} · {formatDate(inspection.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
