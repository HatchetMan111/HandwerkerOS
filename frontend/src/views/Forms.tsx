import { useEffect, useState } from "react";
import type { FormTemplate } from "../types";
import { api, formatDate, notify } from "../api";

interface Props {
  openBuilder: (template: FormTemplate | null) => void;
}

export default function Forms({ openBuilder }: Props) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [openId, setOpenId] = useState<string>("");

  async function reload() {
    try {
      setTemplates(await api.listTemplates());
    } catch (error) {
      notify(String(error), true);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function toggleDetails(template: FormTemplate) {
    if (openId === template.id) {
      setOpenId("");
      return;
    }
    setOpenId(template.id);
    if (!template.versions) {
      try {
        const full = await api.getTemplate(template.id);
        setTemplates((current) => current.map((t) => (t.id === template.id ? full : t)));
      } catch (error) {
        notify(String(error), true);
      }
    }
  }

  return (
    <div className="stack">
      <button className="btn btn-primary btn-lg" onClick={() => openBuilder(null)}>
        + Neue Formularvorlage erstellen
      </button>

      <section className="card">
        <h2>Vorlagen ({templates.length})</h2>
        {templates.length === 0 ? (
          <p className="muted">
            Noch keine Vorlagen. Erstelle eine Checkliste, die deine Mitarbeiter auf der Baustelle
            durcharbeiten - mit Vorausfuellungen, Fotos und Unterschriften.
          </p>
        ) : (
          <ul className="list">
            {templates.map((template) => (
              <li key={template.id}>
                <button className="list-item" onClick={() => toggleDetails(template)}>
                  <span>{template.name}</span>
                  <span className="muted">
                    {template.category || "allgemein"} · Version {template.latest_version ?? "-"} ·{" "}
                    {formatDate(template.updated_at)}
                  </span>
                </button>
                {openId === template.id && template.versions ? (
                  <div className="details">
                    <div className="btn-row details-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => openBuilder(template)}
                      >
                        Bearbeiten / neue Version
                      </button>
                    </div>
                    {template.versions.slice().reverse().map((version) => (
                      <details key={version.id} open={version.version === template.latest_version}>
                        <summary>Version {version.version}</summary>
                        <pre className="schema-view">{JSON.stringify(version.schema, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
