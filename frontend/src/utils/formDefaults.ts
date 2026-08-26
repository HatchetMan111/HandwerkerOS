import type { FormField, FormSchema } from "../types";

export function isFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function computeDefaults(schema: FormSchema | null): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (!schema) return defaults;
  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      const fallback = defaultFor(field);
      if (fallback !== null && fallback !== undefined) {
        defaults[field.id] = fallback;
      }
    }
  }
  return defaults;
}

function defaultFor(field: FormField): unknown {
  if (field.default !== undefined && field.default !== null && field.default !== "") {
    return field.default;
  }
  if (field.type === "auto_datetime") {
    return new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }
  return null;
}

export function countProgress(
  schema: FormSchema | null,
  values: Record<string, unknown>
): { filled: number; total: number; missingRequired: string[] } {
  let filled = 0;
  let total = 0;
  const missingRequired: string[] = [];
  if (!schema) return { filled, total, missingRequired };
  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      total += 1;
      if (field.type.startsWith("auto_") || isFilled(values[field.id])) {
        filled += 1;
      } else if (field.required) {
        missingRequired.push(field.label);
      }
    }
  }
  return { filled, total, missingRequired };
}
