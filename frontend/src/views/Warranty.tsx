import { useCallback, useEffect, useState } from "react";
import type { Project } from "../types";
import { apiX as api } from "../api";
import AttachmentImage from "../components/AttachmentImage";
import type { Attachment } from "../types";

export default function Warranty() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .catch(() => undefined);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const { api: client } = await import("../api");
      const list = await (client as unknown as { listProjects(): Promise<Project[]> }).listProjects();
      setProjects(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
    } catch {
      notifyOffline();
    }
  }, [selectedId]);

  function notifyOffline() {
    import("../api").then(({ notify }) => notify("Keine Verbindung - bitte online oeffnen", true));
  }

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadAttachments = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      if (!selectedId) return;
      const rows = await api.listAttachments("project", selectedId);
      setAttachments(rows);
    } catch {
      notifyOffline();
    }
  }, [selectedId]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  async function upload(files: FileList | File[]) {
    if (!selectedId) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const meta = {
          entityType: "project",
          entityId: selectedId,
          kind: file.type.startsWith("image/") ? ("photo" as const) : ("document" as const)
        };
        try {
          if (!navigator.onLine) throw new TypeError("offline");
          await api.uploadAttachment(file, meta);
        } catch (error) {
          const { enqueuePhoto } = await import("../idb");
          await enqueuePhoto({
            entity_type: meta.entityType,
            entity_id: meta.entityId,
            kind: meta.kind,
            field_id: null,
            filename: file.name,
            mime: file.type || "application/octet-stream",
            blob: file
          });
          import("../api").then(({ notify }) =>
            notify("Offline gesichert - laedt spaeter automatisch hoch")
          );
        }
      }
      window.dispatchEvent(new CustomEvent("hwe-attachments-changed"));
      await loadAttachments();
    } catch (error) {
      import("../api").then(({ notify }) => notify(String(error), true));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Gewaehrleistung - Fotos & Dokumente</h2>
        <p className="muted">
          Zustandsfotos zu Baustellen dokumentieren und spaeter beweissicher vorfinden.
          Alles direkt am Projekt abgelegt.
        </p>
        <div className="field">
          <label htmlFor="wr-project">Baustelle *</label>
          <select id="wr-project" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {selectedId ? (
          <>
            <label className={`btn btn-primary file-label ${busy ? "btn-busy" : ""}`}>
              {busy ? "Lade hoch..." : "Kamera / Foto hinzufuegen"}
              <input
                type="file"
                hidden
                multiple
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  if (files?.length) void upload(files);
                }}
              />
            </label>
            <div
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
              }}
            >
              oder Dateien hierher ziehen
            </div>
            <div className="thumb-row warranty-grid">
              {attachments.map((attachment) => (
                <figure key={attachment.id} className="warranty-item">
                  <AttachmentImage attachment={attachment} />
                  <figcaption className="muted">{formatShort(attachment.created_at)}</figcaption>
                </figure>
              ))}
              {attachments.length === 0 ? (
                <p className="muted">Noch keine Anhaenge fuer diese Baustelle.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function formatShort(value?: string): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("de-DE");
}
