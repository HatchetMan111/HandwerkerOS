import { useState } from "react";
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

const BIG_TOGGLE_TYPES = new Set(["yes_no", "yes_no_na"]);

function optionsFor(field: FormField): string[] {
  if (field.type === "yes_no") return ["ja", "nein"];
  if (field.type === "yes_no_na") return ["ja", "nein", "n/a"];
  return field.options ?? [];
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
  const [uploading, setUploading] = useState(false);
  const inputId = `f_${field.id}`;
  const common = { id: inputId, disabled };
  const relevant = attachments.filter((a) => a.field_id === field.id);

  async function uploadFiles(files: FileList | File[]) {
    if (!entityId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await api.uploadAttachment(file, {
          entityType,
          entityId,
          kind:
            field.type !== "file" && file.type.startsWith("image/")
              ? "photo"
              : "document",
          fieldId: field.id
        });
      }
      window.dispatchEvent(new CustomEvent("hwe-attachments-changed"));
    } catch (error) {
      notify(String(error), true);
    } finally {
      setUploading(false);
    }
  }

  function bigToggle() {
    const options = optionsFor(field);
    return (
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`seg ${value === option ? "seg-active" : ""} ${
              option === "ja" ? "seg-yes" : option === "nein" ? "seg-no" : ""
            }`}
            onClick={() => onChange(option)}
          >
            {option.toUpperCase()}
          </button>
        ))}
        {!disabled && value ? (
          <button type="button" className="seg seg-reset" onClick={() => onChange("")}>
            &times;
          </button>
        ) : null}
      </div>
    );
  }

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
          {value ? <img className="thumb" src={String(value)} alt="Unterschrift" /> : null}
        </>
      );
      break;
    case "photo":
    case "file": {
      const accept = field.type === "photo" ? "image/*" : undefined;
      control = (
        <div className="attach-block">
          {!disabled && entityId ? (
            <>
              <label className={`btn btn-secondary btn-sm file-label ${uploading ? "btn-busy" : ""}`}>
                {uploading ? "Lade hoch..." : field.type === "photo" ? "Kamera / Foto" : "Datei anhaengen"}
                <input
                  type="file"
                  hidden
                  multiple={field.type === "photo"}
                  accept={accept}
                  capture={field.type === "photo" ? "environment" : undefined}
                  onChange={(e) => {
                    const files = e.target.files;
                    e.target.value = "";
                    if (files?.length) void uploadFiles(files);
                  }}
                />
              </label>
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!disabled && e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
                }}
              >
                oder Bilder hierher ziehen
              </div>
            </>
          ) : null}
          <div className="thumb-row">
            {relevant.map((attachment) => (
              <AttachmentImage key={attachment.id} attachment={attachment} />
            ))}
          </div>
        </div>
      );
      break;
    }
    default:
      if (BIG_TOGGLE_TYPES.has(field.type)) {
        control = bigToggle();
      } else if (field.type === "choice") {
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
      } else if (field.type.startsWith("auto_")) {
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
    <div className={`field ${field.required && (value === undefined || value === null || value === "") ? "field-missing" : ""}`}>
      <label htmlFor={inputId}>
        {field.label}
        {field.required ? <span className="req"> *</span> : null}
        {field.unit && field.type !== "measurement" ? <span className="unit"> [{field.unit}]</span> : null}
      </label>
      {control}
    </div>
  );
}
