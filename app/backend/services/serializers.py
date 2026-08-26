from typing import Any

from app.backend.models.attachment import Attachment
from app.backend.models.customer import Customer
from app.backend.models.device import Device
from app.backend.models.form import FormTemplate, FormVersion
from app.backend.models.inspection import Defect, Inspection
from app.backend.models.project import Project
from app.backend.models.user import User
from app.backend.timeutil import iso_z


def serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "permissions": sorted(user.permissions),
        "created_at": iso_z(user.created_at),
    }


def serialize_device(device: Device) -> dict[str, Any]:
    return {
        "id": device.id,
        "user_id": device.user_id,
        "name": device.name,
        "platform": device.platform,
        "app_version": device.app_version,
        "status": device.status,
        "last_seen": iso_z(device.last_seen),
        "last_sync": iso_z(device.last_sync),
    }


def serialize_customer(customer: Customer) -> dict[str, Any]:
    return {
        "id": customer.id,
        "name": customer.name,
        "address": customer.address,
        "note": customer.note,
        "updated_at": iso_z(customer.updated_at),
    }


def serialize_project(project: Project) -> dict[str, Any]:
    return {
        "id": project.id,
        "customer_id": project.customer_id,
        "name": project.name,
        "location": project.location,
        "status": project.status,
        "description": project.description,
        "updated_at": iso_z(project.updated_at),
    }


def serialize_form_version(version: FormVersion, *, include_schema: bool = True) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": version.id,
        "form_template_id": version.form_template_id,
        "version": version.version,
        "created_at": iso_z(version.created_at),
    }
    if include_schema:
        data["schema"] = version.schema_json
    return data


def serialize_form_template(
    template: FormTemplate, versions: list[FormVersion], *, include_schema: bool = False
) -> dict[str, Any]:
    return {
        "id": template.id,
        "name": template.name,
        "category": template.category,
        "description": template.description,
        "latest_version": max((v.version for v in versions), default=None),
        "versions": [
            serialize_form_version(v, include_schema=include_schema) for v in versions
        ],
        "updated_at": iso_z(template.updated_at),
    }


def serialize_inspection(inspection: Inspection) -> dict[str, Any]:
    return {
        "id": inspection.id,
        "project_id": inspection.project_id,
        "form_template_id": inspection.form_template_id,
        "form_version_id": inspection.form_version_id,
        "status": inspection.status,
        "data": inspection.data_json or {},
        "version": inspection.version,
        "device_id": inspection.device_id,
        "created_by": inspection.created_by,
        "created_at": iso_z(inspection.created_at),
        "device_created_at": iso_z(inspection.device_created_at),
        "completed_at": iso_z(inspection.completed_at),
        "updated_at": iso_z(inspection.updated_at),
    }


def serialize_defect(defect: Defect) -> dict[str, Any]:
    return {
        "id": defect.id,
        "project_id": defect.project_id,
        "inspection_id": defect.inspection_id,
        "description": defect.description,
        "priority": defect.priority,
        "status": defect.status,
        "version": defect.version,
        "created_by": defect.created_by,
        "updated_at": iso_z(defect.updated_at),
    }


def serialize_attachment(attachment: Attachment) -> dict[str, Any]:
    return {
        "id": attachment.id,
        "kind": attachment.kind,
        "entity_type": attachment.entity_type,
        "entity_id": attachment.entity_id,
        "field_id": attachment.field_id,
        "filename": attachment.filename,
        "mime_type": attachment.mime_type,
        "size": attachment.size,
        "sha256": attachment.sha256,
        "url": f"/api/files/{attachment.id}",
        "captured_at": iso_z(attachment.device_created_at),
        "created_at": iso_z(attachment.created_at),
    }
