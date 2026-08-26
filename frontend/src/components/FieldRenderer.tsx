import type { Attachment, FormField } from "../types";
import SignaturePad from "./SignaturePad";
import AttachmentImage from "./AttachmentImage";
import { api, notify } from "../api";

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  entityType?: string;
  entityId?: string;
  attachments?: Attachment[];
}

const CHOICE_TYPES = new Set(["yes_no", "yes_no_na", "choice"]);

function optionsFor(field: FormField): string[] {
  if (field.type === "yes_no") return ["ja", "nein"];
  if (field.type === "yes_no_na") return ["ja", "nein", "n/a"];
  return field.options ?? [];
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export default function FieldRenderer({
  field,
  value,
  onChange,
  disabled,
  entityType = "inspection",
  entityId = "",
  attachments = []
}: FieldRendererProps) {
  const inputId = `f_${field.id}`;
  const common = { id: inputId, disabled };
  const relevant = attachments.filter((a) => a.field_id === field.id);

  let control: JSX.Element;

  switch (field.type) {
    case "textarea":
      control = (
        <textarea
          {...common}
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "number":
    case "measurement":
      control = (
        <div className="input-suffix">
          <input
            {...common}
            type="number"
            inputMode="decimal"
            step="any"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
          {field.unit ? <span className="suffix">{field.unit}</span> : null}
        </div>
      );
      break;
    case "date":
      control = <input {...common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "time":
      control = <input {...common} type="time" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "datetime":
      control = (
        <input {...common} type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "checkbox":
      control = (
        <label className="check-row" htmlFor={inputId}>
          <input
            {...common}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>Ja</span>
        </label>
      );
      break;
    case "signature":
      control = (
        <>
          <SignaturePad
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            disabled={disabled}
          />
          {isFilled(value) ? <img className="thumb" src={String(value)} alt="Unterschrift" /> : null}
        </>
      );
      break;
    case "photo":
    case "file":
      control = (
        <div className="attach-block">
          {!disabled && entityId ? (
            <label className="btn btn-secondary btn-sm file-label">
              {field.type === "photo" ? "Foto aufnehmen / hochladen" : "Datei anhaengen"}
              <input
                type="file"
                hidden
                accept={field.type === "photo" ? "image/*" : undefined}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !entityId) return;
                  try {
                    await api.uploadAttachment(file, {
                      entityType,
                      entityId,
                      kind:
                        field.type === "photo" && (file.type.startsWith("image/") || !file.type)
                          ? "photo"
                          : "document",
                      fieldId: field.id
                    });
                    window.dispatchEvent(new CustomEvent("hwe-attachments-changed"));
                  } catch (error) {
                    notify(String(error), true);
                  }
                }}
              />
            </label>
          ) : null}
          <div className="thumb-row">
            {relevant.map((attachment) => (
              <AttachmentImage key={attachment.id} attachment={attachment} />
            ))}
          </div>
        </div>
      );
      break;
    default:
      if (CHOICE_TYPES.has(field.type)) {
        control = (
          <select {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">-- bitte waehlen --</option>
            {optionsFor(field).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      } else if (field.type === "multichoice") {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        control = (
          <div className="multichoice">
            {optionsFor(field).map((option) => (
              <label key={option} className="check-row">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.includes(option)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...selected, option] : selected.filter((s) => s !== option)
                    )
                  }
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        );
      } else if (field.type === "auto_user") {
        control = <input {...common} type="text" value={String(value ?? "")} readOnly />;
      } else if (field.type === "auto_datetime") {
        control = <input {...common} type="text" value={String(value ?? "")} readOnly />;
      } else {
        control = (
          <input
            {...common}
            type="text"
            placeholder={field.type === "location" ? "Ort / Position" : undefined}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
  }

  return (
    <div className={`field ${field.required && !isFilled(value) ? "field-missing" : ""}`}>
      <label htmlFor={inputId}>
        {field.label}
        {field.required ? <span className="req"> *</span> : null}
        {field.unit && field.type !== "measurement" ? <span className="unit"> [{field.unit}]</span> : null}
      </label>
      {control}
    </div>
  );
}
