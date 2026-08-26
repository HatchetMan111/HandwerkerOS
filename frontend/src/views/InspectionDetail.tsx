import { useCallback, useEffect, useState } from "react";
import type { Attachment, Defect, FormSchema, Inspection } from "../types";
import { api, formatDate, notify } from "../api";
import FieldRenderer from "../components/FieldRenderer";
import AttachmentImage from "../components/AttachmentImage";
import { computeDefaults, countProgress, isFilled } from "../utils/formDefaults";

const NEXT_STATUS: Record<string, string[]> = {
  draft: ["in_progress", "completed"],
  in_progress: ["completed"],
  completed: ["reviewed"],
  reviewed: ["archived"],
  archived: []
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  in_progress: "In Bearbeitung",
  completed: "Abgeschlossen",
  reviewed: "Geprueft",
  archived: "Archiviert"
};

interface ServerConflict {
  server_version: number;
  client_base_version: number;
  server_state?: { data?: Record<string, unknown>; version?: number };
}

interface Props {
  inspectionId: string;
  userName: string;
  onBack: () => void;
}

export default function InspectionDetail({ inspectionId, userName, onBack }: Props) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [defectText, setDefectText] = useState("");
  const [defectPriority, setDefectPriority] = useState("medium");
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [conflict, setConflict] = useState<ServerConflict | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadingMany, setUploadingMany] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const loaded = await api.getInspection(inspectionId);
      setInspection(loaded);
      const template = await api.getTemplate(loaded.form_template_id);
      const version = template.versions?.find((v) => v.id === loaded.form_version_id);
      const loadedSchema = version?.schema ?? null;
      setSchema(loadedSchema);
      const defaults = computeDefaults(loadedSchema);
      setValues({ ...defaults, ...(loaded.data ?? {}) });
      setAttachments(await api.listAttachments("inspection", loaded.id));
      if (loaded.id) setDefects(await api.listDefects(loaded.id));
      setDirty(false);
      setConflict(null);
    } catch (error) {
      notify(String(error), true);
    }
  }, [inspectionId]);

  useEffect(() => {
    void loadAll();
    const handler = () => void loadAll();
    window.addEventListener("hwe-attachments-changed", handler);
    return () => window.removeEventListener("hwe-attachments-changed", handler);
  }, [loadAll]);

  async function save() {
    if (!inspection) return;
    setBusy(true);
    try {
      const updated = await api.patchInspection(inspection.id, {
        data: values,
        base_version: inspection.version
      });
      setInspection(updated);
      setDirty(false);
      notify("Gespeichert");
    } catch (error) {
      notify(String(error), true);
      if (String(error).includes("Versionskonflikt")) {
        const fresh = await api
          .getInspection(inspection.id)
          .catch(() => null);
        if (fresh) {
          setConflict({
            server_version: fresh.version,
            client_base_version: inspection.version,
            server_state: { data: fresh.data, version: fresh.version }
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!inspection) return;
    setBusy(true);
    try {
      await api.completeInspection(inspection.id);
      notify("Pruefung abgeschlossen");
      await loadAll();
    } catch (error) {
      const message = String(error);
      notify(message, true);
      if (message.startsWith("Pflichtfelder fehlen")) {
        setMissingRequired(message.replace("Pflichtfelder fehlen: ", "").split(", "));
      }
    } finally {
      setBusy(false);
    }
  }

  async function transition(status: string) {
    if (!inspection) return;
    setBusy(true);
    try {
      await api.transitionInspection(inspection.id, status);
      await loadAll();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function addDefect(event: React.FormEvent) {
    event.preventDefault();
    if (!inspection || !defectText.trim()) return;
    try {
      await api.createDefect({
        project_id: inspection.project_id,
        description: defectText.trim(),
        priority: defectPriority,
        inspection_id: inspection.id
      });
      setDefectText("");
      setDefects(await api.listDefects(inspection.id));
      notify("Mangel erfasst");
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function resolveDefect(defect: Defect) {
    try {
      await api.patchDefect(defect.id, { base_version: defect.version, status: "resolved" });
      if (inspection) setDefects(await api.listDefects(inspection.id));
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function uploadGeneral(files: FileList | File[]) {
    if (!inspection) return;
    setUploadingMany(true);
    try {
      for (const file of Array.from(files)) {
        await api.uploadAttachment(file, {
          entityType: "inspection",
          entityId: inspection.id,
          kind: file.type.startsWith("image/") ? "photo" : "document"
        });
      }
      window.dispatchEvent(new CustomEvent("hwe-attachments-changed"));
    } catch (error) {
      notify(String(error), true);
    } finally {
      setUploadingMany(false);
    }
  }

  function loadServerState() {
    if (!conflict?.server_state?.data) return;
    setValues(conflict.server_state.data);
    setDirty(true);
    setConflict(null);
    notify("Server-Stand geladen - bitte pruefen und speichern");
  }

  async function overwriteServer() {
    if (!inspection) return;
    setBusy(true);
    try {
      const updated = await api.patchInspection(inspection.id, {
        data: values,
        base_version: conflict?.server_version ?? inspection.version
      });
      setInspection(updated);
      setDirty(false);
      setConflict(null);
      notify("Ueberschrieben und gespeichert");
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  if (!inspection) return <p className="muted">Lade Pruefung...</p>;

  const locked = !["draft", "in_progress"].includes(inspection.status);
  const progress = countProgress(schema, values);

  return (
    <div className="stack">
      <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
        &larr; Zurueck
      </button>

      <section className="card">
        <h2>
          Pruefung{" "}
          <span className={`badge badge-${inspection.status}`}>{STATUS_LABELS[inspection.status]}</span>
        </h2>
        <p className="muted">
          Version {inspection.version} · aktualisiert {formatDate(inspection.updated_at)}
          {inspection.completed_at ? ` · abgeschlossen ${formatDate(inspection.completed_at)}` : ""}
        </p>
        {!locked ? (
          <>
            <p className="progress-line">
              Checkliste erledigt:{" "}
              <b>{progress.filled}/{progress.total}</b> Felder
              {missingRequired.length > 0 ? (
                <span className="warn-text"> · fehlen: {missingRequired.join(", ")}</span>
              ) : null}
            </p>
            <div className="btn-row">
              <button className="btn btn-success btn-lg" onClick={complete} disabled={busy}>
                Abschliessen &amp; abgeben
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Status gesperrt - Aenderungen nur ueber naechste Workflow-Stufe.</p>
        )}
        {NEXT_STATUS[inspection.status]?.length && locked ? (
          <div className="btn-row">
            {NEXT_STATUS[inspection.status].map((status) => (
              <button key={status} className="btn btn-secondary" disabled={busy} onClick={() => transition(status)}>
                &rarr; {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {conflict ? (
        <section className="card conflict-card">
          <h2>Versionskonflikt</h2>
          <p>
            Server-Version {conflict.server_version}, dein Stand basiert auf Version{" "}
            {conflict.client_base_version}.
          </p>
          <pre className="schema-view">{JSON.stringify(conflict.server_state?.data ?? {}, null, 2)}</pre>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={loadServerState}>
              Server-Stand laden
            </button>
            <button className="btn btn-danger" onClick={overwriteServer} disabled={busy}>
              Ueberschreiben (mein Stand)
            </button>
          </div>
        </section>
      ) : null}

      {schema?.sections.map((section, sectionIndex) => {
        const sectionFields = section.fields ?? [];
        const sectionFilled = sectionFields.filter(
          (f) => f.type.startsWith("auto_") || isFilled(values[f.id])
        ).length;
        return (
          <details className="card collapsible" open={sectionIndex === 0 || !locked} key={section.id}>
            <summary className="collapsible-summary">
              <b>{section.title}</b>
              <span className={`chip ${sectionFilled === sectionFields.length ? "chip-done" : ""}`}>
                {sectionFilled}/{sectionFields.length}
              </span>
            </summary>
            {sectionFields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(v) => {
                  setValues((current) => ({ ...current, [field.id]: v }));
                  setDirty(true);
                  setMissingRequired([]);
                }}
                disabled={locked}
                entityType="inspection"
                entityId={inspection.id}
                attachments={attachments}
              />
            ))}
          </details>
        );
      })}

      <section className="card">
        <h3>Mängel an dieser Prüfung</h3>
        {!locked ? (
          <form className="form-row" onSubmit={addDefect}>
            <div className="field">
              <label htmlFor="defect-text">Beschreibung *</label>
              <textarea
                id="defect-text"
                rows={2}
                required
                minLength={3}
                value={defectText}
                onChange={(e) => setDefectText(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="defect-prio">Prioritaet</label>
              <select id="defect-prio" value={defectPriority} onChange={(e) => setDefectPriority(e.target.value)}>
                <option value="low">Niedrig</option>
                <option value="medium">Mittel</option>
                <option value="high">Hoch</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit">
              Mangel erfassen
            </button>
          </form>
        ) : null}
        <ul className="list">
          {defects.map((defect) => (
            <li key={defect.id} className="list-item static defect-item">
              <span>
                <span className={`badge prio-${defect.priority}`}>{defect.priority}</span> {defect.description}
              </span>
              <span>
                {defect.status === "open" ? (
                  <button className="btn btn-sm btn-secondary" onClick={() => resolveDefect(defect)}>
                    Erledigt
                  </button>
                ) : (
                  <span className="muted">erledigt</span>
                )}
              </span>
            </li>
          ))}
          {defects.length === 0 ? <li className="muted list-item static">Keine Maengel erfasst.</li> : null}
        </ul>
      </section>

      <section className="card">
        <h3>Anhaenge (allgemein)</h3>
        <div
          className={`dropzone big ${uploadingMany ? "busy" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length && !locked) void uploadGeneral(e.dataTransfer.files);
          }}
        >
          {uploadingMany ? "Lade hoch..." : "Fotos / Dokumente hierher ziehen"}
        </div>
        {!locked ? (
          <label className="btn btn-secondary btn-sm file-label general-upload">
            Kamera / Dateiauswahl
            <input
              type="file"
              hidden
              multiple
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = "";
                if (files?.length) void uploadGeneral(files);
              }}
            />
          </label>
        ) : null}
        <div className="thumb-row">
          {attachments
            .filter((attachment) => !attachment.field_id)
            .map((attachment) => (
              <AttachmentImage key={attachment.id} attachment={attachment} />
            ))}
        </div>
      </section>

      {dirty && !locked ? (
        <div className="floating-save">
          <span className="chip">{progress.filled}/{progress.total}</span>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            Aenderungen speichern
          </button>
        </div>
      ) : null}
    </div>
  );
}
