import type { Attachment, Defect, FormSchema, Inspection } from "../types";
import { api } from "../api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  in_progress: "In Bearbeitung",
  completed: "Abgeschlossen",
  reviewed: "Geprueft",
  archived: "Archiviert"
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function renderValue(field: { id: string; type: string; unit?: string }, value: unknown): string {
  if (field.type === "yes_no" || field.type === "yes_no_na") {
    if (value === "ja") return '<span class="ok">&#10003; JA</span>';
    if (value === "nein") return '<span class="bad">&#10007; NEIN</span>';
    if (value === "n/a") return '<span class="muted">n/a</span>';
    return '<span class="muted">offen</span>';
  }
  if (field.type === "checkbox") {
    return value ? '<span class="ok">&#10003;</span>' : '<span class="muted">&#8211;</span>';
  }
  if (field.type === "signature" && typeof value === "string" && value.startsWith("data:image")) {
    return `<img class="sig" src="${value}" alt="Unterschrift"/>`;
  }
  if (value === undefined || value === null || value === "") {
    return '<span class="muted">&#8211;</span>';
  }
  if (Array.isArray(value)) {
    return escapeHtml(value.join(", "));
  }
  const text = escapeHtml(String(value));
  return field.type === "measurement" && field.unit ? `${text} ${escapeHtml(field.unit)}` : text;
}

export interface ReportInput {
  inspection: Inspection;
  schema: FormSchema | null;
  templateName: string;
  projectName: string;
  userName: string;
  values: Record<string, unknown>;
  defects: Defect[];
  attachments: Attachment[];
}

export async function printInspectionReport(input: ReportInput): Promise<void> {
  const { inspection, schema, values, defects, attachments } = input;

  const photoRows: string[] = [];
  const images = attachments.filter((a) => a.mime_type.startsWith("image/")).slice(0, 10);
  for (const attachment of images) {
    try {
      const blobUrl = await api.fetchAttachmentBlobUrl(attachment.url);
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      URL.revokeObjectURL(blobUrl);
      photoRows.push(
        `<figure><img src="${dataUrl}" alt="${escapeHtml(attachment.filename)}"/><figcaption>${escapeHtml(
          attachment.filename
        )} · ${fmtDate(attachment.created_at)}</figcaption></figure>`
      );
    } catch {
      photoRows.push(`<figure><figcaption>Foto fehlt: ${escapeHtml(attachment.filename)}</figcaption></figure>`);
    }
  }

  const sectionsHtml = (schema?.sections ?? [])
    .map(
      (section) => `
      <h2>${escapeHtml(section.title)}</h2>
      <table>
        <tbody>
          ${section.fields
            .map(
              (field) => `<tr>
                <td class="label">${escapeHtml(field.label)}${field.required ? ' <span class="req">*</span>' : ""}</td>
                <td>${renderValue(field, values[field.id])}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    )
    .join("");

  const defectsHtml = defects.length
    ? `<h2>Mängel</h2><table><thead><tr><th>Beschreibung</th><th>Priorität</th><th>Status</th></tr></thead>
       <tbody>${defects
         .map(
           (defect) => `<tr>
             <td>${escapeHtml(defect.description)}</td>
             <td>${escapeHtml(defect.priority)}</td>
             <td>${defect.status === "open" ? "offen" : "erledigt"}</td>
           </tr>`
         )
         .join("")}</tbody></table>`
    : "";

  const photosHtml = photoRows.length
    ? `<h2>Fotos (${attachments.filter((a) => a.mime_type.startsWith("image/")).length})</h2>
       <div class="photos">${photoRows.join("")}</div>`
    : "";

  const docs = attachments.filter((a) => !a.mime_type.startsWith("image/"));
  const docsHtml = docs.length
    ? `<h2>Angehängte Dokumente</h2><ul>${docs
        .map((doc) => `<li>${escapeHtml(doc.filename)} (${Math.round(doc.size / 1024)} KB)</li>`)
        .join("")}</ul>`
    : "";

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <title>Prüfbericht ${escapeHtml(input.templateName)}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:2rem;color:#111}
    h1{margin:0 0 0.2rem}
    h2{margin:1.4rem 0 0.4rem;font-size:1.05rem;border-bottom:2px solid #1a5fb4;padding-bottom:0.2rem}
    .meta{color:#555;font-size:0.9rem;margin-bottom:1.2rem}
    table{width:100%;border-collapse:collapse;margin:0.4rem 0 0.8rem}
    td,th{border-bottom:1px solid #ddd;padding:0.45rem 0.4rem;font-size:0.9rem;vertical-align:top}
    td.label{width:38%;color:#333;font-weight:600}
    .ok{color:#14683f;font-weight:700}
    .bad{color:#c01c28;font-weight:700}
    .muted{color:#999}
    .req{color:#c01c28}
    .sig{height:70px}
    .photos{display:flex;flex-wrap:wrap;gap:10px}
    figure{margin:0;max-width:240px}
    figure img{width:100%;border:1px solid #ddd;border-radius:6px}
    figcaption{font-size:0.72rem;color:#666}
    footer{margin-top:2rem;font-size:0.75rem;color:#888;border-top:1px solid #ddd;padding-top:0.5rem}
  </style></head><body>
  <h1>Prüfbericht – ${escapeHtml(input.templateName)}</h1>
  <div class="meta">
    ${input.projectName ? `Baustelle: <b>${escapeHtml(input.projectName)}</b><br/>` : ""}
    Status: ${STATUS_LABELS[inspection.status] ?? inspection.status} ·
    Erstellt: ${fmtDate(inspection.created_at)} ·
    ${inspection.completed_at ? `Abgeschlossen: ${fmtDate(inspection.completed_at)}<br/>` : "<br/>"}
    Ausgedruckt von: ${escapeHtml(input.userName)} am ${new Date().toLocaleString("de-DE")}
  </div>
  ${sectionsHtml}
  ${defectsHtml}
  ${photosHtml}
  ${docsHtml}
  <footer>HandwerkerOS · Prüf-ID ${escapeHtml(inspection.id)} · Formularversion ${escapeHtml(inspection.form_version_id)}</footer>
  </body></html>`;

  const win = window.open("", "_blank", "width=900,height=950");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
