from typing import Any

from app.backend.models.form import FIELD_TYPES


def validate_schema(schema: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(schema, dict):
        return ["schema muss ein Objekt sein"]
    sections = schema.get("sections")
    if not isinstance(sections, list) or not sections:
        return ["schema.sections muss eine nicht-leere Liste sein"]
    seen_fields: set[str] = set()
    for s_idx, section in enumerate(sections):
        if not isinstance(section, dict):
            errors.append(f"sections[{s_idx}] muss ein Objekt sein")
            continue
        if not str(section.get("title", "")).strip():
            errors.append(f"sections[{s_idx}].title fehlt")
        fields = section.get("fields", [])
        if not isinstance(fields, list):
            errors.append(f"sections[{s_idx}].fields muss eine Liste sein")
            continue
        for f_idx, field in enumerate(fields):
            label = f"sections[{s_idx}].fields[{f_idx}]"
            if not isinstance(field, dict):
                errors.append(f"{label} muss ein Objekt sein")
                continue
            field_id = str(field.get("id", "")).strip()
            if not field_id:
                errors.append(f"{label}.id fehlt")
            elif field_id in seen_fields:
                errors.append(f"{label}.id dupliziert: {field_id}")
            else:
                seen_fields.add(field_id)
            if field.get("type") not in FIELD_TYPES:
                errors.append(f"{label}.type ungueltig: {field.get('type')}")
            if not str(field.get("label", "")).strip():
                errors.append(f"{label}.label fehlt")
            if field.get("type") in ("choice", "multichoice"):
                options = field.get("options")
                if not isinstance(options, list) or len(options) < 2:
                    errors.append(f"{label}.options braucht mindestens 2 Eintraege")
    return errors


def iter_fields(schema: dict[str, Any]):
    for section in schema.get("sections", []):
        for field in section.get("fields", []):
            yield field


def missing_required(schema: dict[str, Any], data: dict[str, Any]) -> list[dict[str, str]]:
    missing: list[dict[str, str]] = []
    for field in iter_fields(schema):
        if not field.get("required"):
            continue
        value = data.get(field["id"])
        empty = value is None or value == "" or value == []
        if isinstance(value, bool):
            empty = False
        if empty:
            missing.append({"id": field["id"], "label": field.get("label", field["id"])})
    return missing
