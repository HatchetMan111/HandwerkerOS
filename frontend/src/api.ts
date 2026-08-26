const TOKEN_KEY = "handwerkeros_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function detailToMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === "string") return d.message;
    if (Array.isArray(d.missing_required)) {
      const missing = d.missing_required as Array<{ label?: string }>;
      return "Pflichtfelder fehlen: " + missing.map((m) => m.label).join(", ");
    }
    if (Array.isArray(d.schema_errors)) return "Schema-Fehler: " + (d.schema_errors as string[]).join("; ");
    return JSON.stringify(detail);
  }
  return "Unbekannter Fehler";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Sitzung abgelaufen");
  }
  if (!response.ok) {
    let detail: unknown = null;
    try {
      const body = await response.json();
      detail = body?.detail ?? body;
    } catch {
      detail = response.statusText;
    }
    throw new Error(detailToMessage(detail));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export const api = {
  async login(email: string, password: string) {
    const data = await request<{ access_token: string; user: import("./types").User }>(
      "/api/auth/login",
      jsonBody({ email, password })
    );
    setToken(data.access_token);
    return data.user;
  },
  me: () => request<import("./types").User>("/api/auth/me"),

  listCustomers: () => request<import("./types").Customer[]>("/api/customers"),
  createCustomer: (body: { name: string; address?: string; note?: string }) =>
    request<import("./types").Customer>("/api/customers", jsonBody(body)),

  listUsers: () => request<import("./types").User[]>("/api/users"),
  createUser: (body: { email: string; name: string; password: string; role: string }) =>
    request<import("./types").User>("/api/users", jsonBody(body)),
  patchUser: (
    id: string,
    body: { name?: string; role?: string; is_active?: boolean; password?: string }
  ) =>
    request<import("./types").User>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  listProjects: () => request<import("./types").Project[]>("/api/projects"),
  createProject: (body: { name: string; customer_id?: string | null; location?: string }) =>
    request<import("./types").Project>("/api/projects", jsonBody(body)),

  listTemplates: () => request<import("./types").FormTemplate[]>("/api/forms/templates"),
  getTemplate: (id: string) =>
    request<import("./types").FormTemplate>(`/api/forms/templates/${id}`),
  createTemplate: (body: { name: string; category?: string; schema: object }) =>
    request<import("./types").FormTemplate>("/api/forms/templates", jsonBody(body)),
  createFormVersion: (templateId: string, schema: object) =>
    request<import("./types").FormVersion>(
      `/api/forms/templates/${templateId}/versions`,
      jsonBody({ schema })
    ),

  listInspections: (projectId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (status) params.set("status_filter", status);
    const query = params.toString();
    return request<import("./types").Inspection[]>(`/api/inspections${query ? "?" + query : ""}`);
  },
  getInspection: (id: string) =>
    request<import("./types").Inspection>(`/api/inspections/${id}`),
  createInspection: (body: {
    project_id: string;
    form_template_id: string;
    form_version_id?: string | null;
    data?: Record<string, unknown>;
  }) => request<import("./types").Inspection>("/api/inspections", jsonBody(body)),
  patchInspection: (
    id: string,
    body: { data: Record<string, unknown>; base_version: number }
  ) =>
    request<import("./types").Inspection>(`/api/inspections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  completeInspection: (id: string) =>
    request<import("./types").Inspection>(`/api/inspections/${id}/complete`, jsonBody({})),
  transitionInspection: (id: string, status: string) =>
    request<import("./types").Inspection>(
      `/api/inspections/${id}/transition`,
      jsonBody({ status })
    ),

  listDefects: (inspectionId?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (inspectionId) params.set("inspection_id", inspectionId);
    if (projectId) params.set("project_id", projectId);
    const query = params.toString();
    return request<import("./types").Defect[]>(`/api/defects${query ? "?" + query : ""}`);
  },
  createDefect: (body: {
    project_id: string;
    description: string;
    priority?: string;
    inspection_id?: string | null;
  }) => request<import("./types").Defect>("/api/defects", jsonBody(body)),
  patchDefect: (
    id: string,
    body: { base_version: number; status?: string; priority?: string; description?: string }
  ) =>
    request<import("./types").Defect>(`/api/defects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  listAttachments: (entityType: string, entityId: string) =>
    request<import("./types").Attachment[]>(
      `/api/files?entity_type=${entityType}&entity_id=${entityId}`
    ),
  uploadAttachment: (
    file: File,
    meta: { entityType: string; entityId: string; kind: string; fieldId?: string | null }
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity_type", meta.entityType);
    form.append("entity_id", meta.entityId);
    form.append("kind", meta.kind);
    if (meta.fieldId) form.append("field_id", meta.fieldId);
    return request<import("./types").Attachment>("/api/files", {
      method: "POST",
      body: form
    });
  },
  fetchAttachmentBlobUrl: async (urlPath: string): Promise<string> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(urlPath, { headers });
    if (!response.ok) throw new Error("Datei konnte nicht geladen werden");
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

  syncChanges: () =>
    request<{ server_time: string }>("/api/sync/changes?limit=1")
};

export function notify(message: string, isError = false): void {
  window.dispatchEvent(new CustomEvent("hwe-toast", { detail: { message, isError } }));
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}
