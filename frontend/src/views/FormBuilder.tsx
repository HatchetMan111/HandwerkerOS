import { useState } from "react";
import type { FormField, FormSchema } from "../types";
import { api, notify } from "../api";

const FIELD_TYPES: Array<{ value: string; label: string }> = [
  { value: "yes_no", label: "Ja / Nein (Taster)" },
  { value: "yes_no_na", label: "Ja / Nein / N.A." },
  { value: "text", label: "Text" },
  { value: "textarea", label: "Mehrzeiliger Text" },
  { value: "number", label: "Zahl" },
  { value: "measurement", label: "Messwert" },
  { value: "date", label: "Datum" },
  { value: "time", label: "Uhrzeit" },
  { value: "datetime", label: "Datum + Uhrzeit" },
  { value: "choice", label: "Auswahl" },
  { value: "multichoice", label: "Mehrfachauswahl" },
  { value: "checkbox", label: "Checkbox" },
  { value: "photo", label: "Foto" },
  { value: "file", label: "Datei" },
  { value: "signature", label: "Unterschrift" },
  { value: "location", label: "Ort" }
];

const HAS_DEFAULT = new Set([
  "text",
  "textarea",
  "number",
  "measurement",
  "date",
  "time",
  "datetime",
  "checkbox",
  "location"
]);

let tempIdCounter = 0;
function tempField(type: string): FormField {
  tempIdCounter += 1;
  return {
    id: `neu_${Date.now().toString(36)}_${tempIdCounter}`,
    type,
    label: "",
    required: false
  };
}

interface Section {
  id: string;
  title: string;
  fields: FormField[];
}

interface Props {
  initial?:
    | {
      templateId: string | null;
      name: string;
      category: string;
      schema: FormSchema;
      nextVersion: number | null;
    }
    | undefined;
  onDone: () => void;
}

export default function FormBuilder({ initial, onDone }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [sections, setSections] = useState<Section[]>(
    initial?.schema?.sections?.length
      ? JSON.parse(JSON.stringify(initial.schema.sections))
      : [{ id: `s_${Date.now()}`, title: "Allgemein", fields: [tempField("yes_no")] }]
  );
  const [busy, setBusy] = useState(false);

  function update() {
    setSections(JSON.parse(JSON.stringify(sections)));
  }

  function moveItem<T>(list: T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const copy = [...list];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    return copy;
  }

  function patchField(sectionIndex: number, fieldIndex: number, patch: Partial<FormField>) {
    sections[sectionIndex].fields[fieldIndex] = {
      ...sections[sectionIndex].fields[fieldIndex],
      ...patch
    };
    update();
  }

  async function save(asNewVersion: boolean) {
    if (!name.trim()) {
      notify("Name fehlt", true);
      return;
    }
    const schema: FormSchema = { sections };
    for (const section of sections) {
      if (!section.title.trim()) {
        notify("Jede Sektion braucht einen Titel", true);
        return;
      }
      for (const field of section.fields) {
        if (!field.label.trim()) {
          notify(`Feld ohne Beschriftung in Sektion "${section.title}"`, true);
          return;
        }
        if ((field.type === "choice" || field.type === "multichoice") && (field.options?.length ?? 0) < 2) {
          notify(`Auswahlfeld "${field.label}" braucht mindestens 2 Optionen`, true);
          return;
        }
      }
    }
    setBusy(true);
    try {
      if (asNewVersion && initial?.templateId) {
        await api.createFormVersion(initial.templateId, schema);
        notify(`Neue Version fuer "${name}" gespeichert`);
      } else {
        await api.createTemplate({ name: name.trim(), category, schema });
        notify(`Vorlage "${name}" erstellt`);
      }
      onDone();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  function defaultValueInput(field: FormField, onChange: (value: unknown) => void): JSX.Element | null {
    switch (field.type) {
      case "number":
      case "measurement":
        return (
          <input
            type="number"
            step="any"
            placeholder="Standardwert"
            value={field.default === null || field.default === undefined ? "" : String(field.default)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        );
      case "checkbox":
        return (
          <select
            value={field.default === true ? "1" : ""}
            onChange={(e) => onChange(e.target.value === "1")}
          >
            <option value="">leer</option>
            <option value="1">vorausgefuellt: Ja</option>
          </select>
        );
      case "choice": {
        return (
          <select value={String(field.default ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">kein Standard</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      }
      case "yes_no":
      case "yes_no_na":
        return (
          <select value={String(field.default ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">kein Standard</option>
            {optionsFor(field).map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </select>
        );
      default:
        if (!HAS_DEFAULT.has(field.type)) return null;
        return (
          <input
            type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
            placeholder="Vorausfuellung (fuer Mitarbeiter)"
            value={String(field.default ?? "")}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        );
    }
  }

  function optionsFor(field: FormField): string[] {
    if (field.type === "yes_no") return ["ja", "nein"];
    if (field.type === "yes_no_na") return ["ja", "nein", "n/a"];
    return field.options ?? [];
  }

  return (
    <div className="stack">
      <button className="btn btn-ghost btn-sm back-btn" onClick={onDone}>
        &larr; Zurueck zu den Vorlagen
      </button>

      <section className="card">
        <h2>{initial?.templateId ? `Vorlage bearbeiten -> neue Version V${initial.nextVersion}` : "Neue Formularvorlage"}</h2>
        <div className="builder-grid">
          <div className="field">
            <label htmlFor="fb-name">Name *</label>
            <input id="fb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Baustellenkontrolle Elektro" />
          </div>
          <div className="field">
            <label htmlFor="fb-cat">Kategorie</label>
            <input id="fb-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="elektro" disabled={Boolean(initial?.templateId)} />
          </div>
        </div>
      </section>

      {sections.map((section, sectionIndex) => (
        <section className="card builder-section" key={section.id}>
          <div className="builder-section-head">
            <input
              className="section-title-input"
              value={section.title}
              placeholder="Sektionstitel (z.B. Allgemein)"
              onChange={(e) => {
                section.title = e.target.value;
                update();
              }}
            />
            <span className="chip">{section.fields.length} Felder</span>
            <button className="btn-icon" title="Nach oben" onClick={() => setSections(moveItem(sections, sectionIndex, -1))}>↑</button>
            <button className="btn-icon" title="Nach unten" onClick={() => setSections(moveItem(sections, sectionIndex, 1))}>↓</button>
            <button
              className="btn-icon danger"
              title="Sektion loeschen"
              onClick={() => setSections(sections.filter((_, i) => i !== sectionIndex))}
            >
              ✕
            </button>
          </div>

          {section.fields.map((field, fieldIndex) => (
            <div className="builder-field" key={field.id}>
              <div className="builder-field-row">
                <input
                  className="field-label-input"
                  placeholder="Frage / Beschriftung *"
                  value={field.label}
                  onChange={(e) => patchField(sectionIndex, fieldIndex, { label: e.target.value })}
                />
                <select
                  className="field-type-select"
                  value={field.type}
                  onChange={(e) =>
                    patchField(sectionIndex, fieldIndex, {
                      type: e.target.value,
                      options:
                        e.target.value === "choice" || e.target.value === "multichoice"
                          ? (field.options ?? ["Option A", "Option B"])
                          : undefined
                    })
                  }
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <label className="check-row req-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(field.required)}
                    onChange={(e) => patchField(sectionIndex, fieldIndex, { required: e.target.checked })}
                  />
                  <span>Pflicht</span>
                </label>
                <button className="btn-icon" title="Nach oben" onClick={() => {
                  section.fields = moveItem(section.fields, fieldIndex, -1);
                  update();
                }}>↑</button>
                <button className="btn-icon" title="Nach unten" onClick={() => {
                  section.fields = moveItem(section.fields, fieldIndex, 1);
                  update();
                }}>↓</button>
                <button
                  className="btn-icon danger"
                  title="Feld loeschen"
                  onClick={() => {
                    section.fields = section.fields.filter((_, i) => i !== fieldIndex);
                    update();
                  }}
                >
                  ✕
                </button>
              </div>

              {(field.type === "choice" || field.type === "multichoice") ? (
                <input
                  className="options-input"
                  placeholder="Optionen, getrennt durch Komma"
                  value={(field.options ?? []).join(", ")}
                  onChange={(e) =>
                    patchField(sectionIndex, fieldIndex, {
                      options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                    })
                  }
                />
              ) : null}
              {field.type === "measurement" ? (
                <input
                  className="options-input"
                  placeholder="Einheit (z.B. V, A, °C)"
                  value={field.unit ?? ""}
                  onChange={(e) => patchField(sectionIndex, fieldIndex, { unit: e.target.value || undefined })}
                />
              ) : null}
              {!["signature", "photo", "file", "textarea"].includes(field.type) ? (
                <div className="default-value-row">
                  <span className="muted">Vorausfuellung:</span>
                  {defaultValueInput(field, (value) => patchField(sectionIndex, fieldIndex, { default: value }))}
                </div>
              ) : null}
            </div>
          ))}

          <div className="btn-row">
            <button className="btn btn-secondary btn-sm" onClick={() => { section.fields.push(tempField("yes_no")); update(); }}>
              + Feld
            </button>
          </div>
        </section>
      ))}

      <button
        className="btn btn-secondary add-section-btn"
        onClick={() => setSections([...sections, { id: `s_${Date.now()}`, title: "", fields: [] }])}
      >
        + Sektion hinzufuegen
      </button>

      <div className="save-bar-space" />
      <div className={`save-bar ${busy ? "busy" : ""}`}>
        <button className="btn btn-primary" onClick={() => save(Boolean(initial?.templateId))} disabled={busy}>
          {initial?.templateId ? `Als Version V${initial.nextVersion} speichern` : "Vorlage speichern"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Abbrechen</button>
      </div>
    </div>
  );
}
