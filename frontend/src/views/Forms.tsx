import { useEffect, useState } from "react";
import type { FormTemplate } from "../types";
import { api, notify } from "../api";

const STARTER_SCHEMA = {
  sections: [
    {
      id: "allgemein",
      title: "Allgemein",
      fields: [
        { id: "baustelle", type: "text", label: "Baustelle", required: true },
        { id: "datum", type: "date", label: "Datum", required: true }
      ]
    },
    {
      id: "pruefung",
      title: "Pruefung",
      fields: [
        { id: "fluchtwege", type: "yes_no", label: "Sind Fluchtwege frei?", required: true },
        { id: "bemerkung", type: "textarea", label: "Bemerkungen" }
      ]
    },
    {
      id: "abschluss",
      title: "Abschluss",
      fields: [{ id: "unterschrift", type: "signature", label: "Unterschrift Kunde", required: true }]
    }
  ]
};

export default function Forms() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [openId, setOpenId] = useState<string>("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("elektro");
  const [schemaText, setSchemaText] = useState(JSON.stringify(STARTER_SCHEMA, null, 2));
  const [versionTexts, setVersionTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const list = await api.listTemplates();
      setTemplates(list);
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
        setVersionTexts((current) => ({ ...current, [template.id]: "" }));
      } catch (error) {
        notify(String(error), true);
      }
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    let schema: object;
    try {
      schema = JSON.parse(schemaText);
    } catch {
      notify("Schema ist kein gueltiges JSON", true);
      return;
    }
    setBusy(true);
    try {
      await api.createTemplate({ name: name.trim(), category, schema });
      setName("");
      notify("Formularvorlage erstellt");
      await reload();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function addVersion(template: FormTemplate) {
    const text = versionTexts[template.id];
    if (!text?.trim()) return;
    try {
      await api.createFormVersion(template.id, JSON.parse(text));
      setVersionTexts((current) => ({ ...current, [template.id]: "" }));
      notify(`Neue Version fuer "${template.name}" erstellt`);
      await reload();
      setOpenId("");
    } catch (error) {
      notify(String(error), true);
    }
  }

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={create}>
        <h2>Neue Formularvorlage</h2>
        <p className="muted">
          Sektionen und Felder als JSON. Feldtypen: text, textarea, number, date, time, datetime,
          yes_no, yes_no_na, choice, multichoice, checkbox, measurement (mit unit), photo, file,
          signature, location.
        </p>
        <div className="field">
          <label htmlFor="tpl-name">Name *</label>
          <input id="tpl-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tpl-category">Kategorie</label>
          <input id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tpl-schema">Schema (JSON)</label>
          <textarea
            id="tpl-schema"
            rows={12}
            spellCheck={false}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Vorlage erstellen
        </button>
      </form>

      <section className="card">
        <h2>Vorlagen ({templates.length})</h2>
        <ul className="list">
          {templates.map((template) => (
            <li key={template.id}>
              <button className="list-item" onClick={() => toggleDetails(template)}>
                <span>{template.name}</span>
                <span className="muted">
                  {template.category || "allgemein"} · Version {template.latest_version ?? "-"}
                </span>
              </button>
              {openId === template.id && template.versions ? (
                <div className="details">
                  {template.versions.map((version) => (
                    <details key={version.id} open={version.version === template.versions?.length}>
                      <summary>
                        Version {version.version}
                        {version.created_at ? ` · ${new Date(version.created_at).toLocaleDateString("de-DE")}` : ""}
                      </summary>
                      <pre className="schema-view">
                        {JSON.stringify(version.schema, null, 2)}
                      </pre>
                    </details>
                  ))}
                  <textarea
                    className="schema-edit"
                    rows={6}
                    placeholder="Neues Schema als JSON fuer die naechste Version..."
                    spellCheck={false}
                    value={versionTexts[template.id] ?? ""}
                    onChange={(e) =>
                      setVersionTexts((current) => ({ ...current, [template.id]: e.target.value }))
                    }
                  />
                  <button className="btn btn-secondary btn-sm" onClick={() => addVersion(template)}>
                    Neue Version anlegen
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
