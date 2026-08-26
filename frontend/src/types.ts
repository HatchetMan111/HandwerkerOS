export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  permissions: string[];
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  note?: string;
  updated_at?: string;
}

export interface Project {
  id: string;
  customer_id: string | null;
  name: string;
  location: string;
  status: string;
  description?: string;
  updated_at?: string;
}

export interface FormField {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  unit?: string;
  default?: unknown;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
}

export interface FormVersion {
  id: string;
  form_template_id: string;
  version: number;
  schema?: FormSchema;
  created_at?: string;
}

export interface FormTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  latest_version: number | null;
  versions?: FormVersion[];
  updated_at?: string;
}

export type InspectionStatus = "draft" | "in_progress" | "completed" | "reviewed" | "archived";

export interface Inspection {
  id: string;
  project_id: string;
  form_template_id: string;
  form_version_id: string;
  status: InspectionStatus;
  data: Record<string, unknown>;
  version: number;
  device_id?: string | null;
  created_by?: string | null;
  created_at?: string;
  completed_at?: string | null;
  updated_at?: string;
}

export interface Defect {
  id: string;
  project_id: string;
  inspection_id: string | null;
  description: string;
  priority: "low" | "medium" | "high";
  status: "open" | "resolved";
  version: number;
  created_by?: string | null;
  updated_at?: string;
}

export interface Attachment {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  field_id: string | null;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string;
  url: string;
  captured_at?: string | null;
  created_at?: string;
}

export type TimeEntryStatus = "draft" | "submitted" | "approved" | "rejected";

export interface TimeEntry {
  id: string;
  project_id: string;
  user_id: string;
  work_date: string;
  hours: number;
  activity: string;
  status: TimeEntryStatus;
  version: number;
  unsynced?: boolean;
  updated_at?: string;
}

export interface MaterialItem {
  id: string;
  article_number?: string;
  name: string;
  unit: string;
  price_cents: number;
}

export interface MaterialUsage {
  id: string;
  project_id: string;
  material_id?: string | null;
  name: string;
  unit: string;
  quantity: number;
  price_cents: number;
  work_date: string;
  note?: string;
  version: number;
  unsynced?: boolean;
  updated_at?: string;
}

export type AssignmentStatus = "planned" | "confirmed" | "done" | "canceled";

export interface Assignment {
  id: string;
  project_id: string;
  user_id: string;
  work_date: string;
  hours_planned?: number | null;
  note?: string;
  status: AssignmentStatus;
  updated_at?: string;
}

export type InvoiceLineType = "labor" | "material" | "custom";

export interface InvoiceLine {
  type: InvoiceLineType;
  ref_id?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  total_cents: number;
}

export type InvoiceStatus = "draft" | "final" | "cancelled";

export interface Invoice {
  id: string;
  number: string;
  project_id: string;
  customer_name: string;
  project_name: string;
  hourly_rate_cents: number;
  tax_percent: number;
  lines: InvoiceLine[];
  labor_hours: number;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  status: InvoiceStatus;
  created_at?: string;
}
