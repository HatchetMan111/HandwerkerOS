import { useEffect, useState } from "react";
import type { FormTemplate, Inspection, Project } from "../types";
import { api, formatDate, notify } from "../api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  in_progress: "In Bearbeitung",
  completed: "Abgeschlossen",
  reviewed: "Geprueft",
  archived: "Archiviert"
};

interface Props {
  openInspection: (id: string) => void;
}

export default function Inspections({ openInspection }: Props) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [newTemplate, setNewTemplate] = useState("");

  useEffect(() => {
    Promise.all([api.listProjects(), api.listTemplates()])
      .then(([projectList, templateList]) => {
        setProjects(projectList);
        setTemplates(templateList);
      })
      .catch((error) => notify(String(error), true));
  }, []);

  useEffect(() => {
    api
      .listInspections(projectFilter || undefined, statusFilter || undefined)
      .then(setInspections)
      .catch((error) => notify(String(error), true));
  }, [projectFilter, statusFilter]);

  async function create() {
    if (!newProject || !newTemplate) return;
    try {
      const inspection = await api.createInspection({
        project_id: newProject,
        form_template_id: newTemplate,
        data: {}
      });
      setShowCreate(false);
      notify("Pruefung erstellt");
      openInspection(inspection.id);
    } catch (error) {
      notify(String(error), true);
    }
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="stack">
      <div className="toolbar">
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">Alle Projekte</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Alle Status</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          + Pruefung
        </button>
      </div>

      {showCreate ? (
        <form
          className="card form-row"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h2>Neue Pruefung</h2>
          <div className="field">
            <label htmlFor="insp-project">Projekt *</label>
            <select id="insp-project" required value={newProject} onChange={(e) => setNewProject(e.target.value)}>
              <option value="">-- waehlen --</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="insp-template">Formularvorlage *</label>
            <select id="insp-template" required value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
              <option value="">-- waehlen --</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} (V{template.latest_version})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={!newProject || !newTemplate}>
            Anlegen & oeffnen
          </button>
        </form>
      ) : null}

      <section className="card">
        <h2>Pruefungen ({inspections.length})</h2>
        {inspections.length === 0 ? (
          <p className="muted">Noch keine Pruefungen.</p>
        ) : (
          <ul className="list">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <button className="list-item" onClick={() => openInspection(inspection.id)}>
                  <span>
                    {projectName(inspection.project_id)} · {STATUS_LABELS[inspection.status]}
                  </span>
                  <span className="muted">V{inspection.version} · {formatDate(inspection.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
