import type {
  Assignment,
  Customer,
  Defect,
  FormTemplate,
  Inspection,
  MaterialItem,
  MaterialUsage,
  Project,
  TimeEntry,
  User
} from "./types";

const DB_NAME = "handwerkeros";
const DB_VERSION = 1;
const STORE_KV = "kv";
const STORE_QUEUE = "queue";
const STORE_CACHE = "cache";

type CacheRow = { key: string; entity: string; id: string; data: unknown };
export type QueuedOp = {
  op_id: string;
  entity: string;
  entity_id: string;
  operation: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  base_version?: number;
  created_at: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_QUEUE))
        db.createObjectStore(STORE_QUEUE, { keyPath: "op_id" });
      if (!db.objectStoreNames.contains(STORE_CACHE))
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    const request = fn(objectStore);
    transaction.oncomplete = () => {
      db.close();
      resolve((request as IDBRequest)?.result as T);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return tx<T>(STORE_KV, "readonly", (s) => s.get(key));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await tx(STORE_KV, "readwrite", (s) => s.put(value, key));
}

export async function cachePut(entity: string, id: string, data: unknown): Promise<void> {
  await tx(STORE_CACHE, "readwrite", (s) =>
    s.put({ key: `${entity}:${id}`, entity, id, data } satisfies CacheRow)
  );
}

export async function cachePutMany(rows: Array<{ entity: string; id: string; data: unknown }>) {
  await tx(STORE_CACHE, "readwrite", (store) => {
    for (const row of rows) {
      store.put({ key: `${row.entity}:${row.id}`, ...row });
    }
  });
}

export async function cacheGetAll(entity: string): Promise<unknown[]> {
  const rows = await tx<CacheRow[]>(STORE_CACHE, "readonly", (s) => s.getAll());
  return (rows ?? []).filter((r) => r.entity === entity).map((r) => r.data);
}

export async function cacheDelete(entity: string, id: string): Promise<void> {
  await tx(STORE_CACHE, "readwrite", (s) => s.delete(`${entity}:${id}`));
}

function newUuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await kvGet<string>("device_id");
  if (existing) return existing;
  const deviceId = `web-${newUuid().slice(0, 8)}`;
  await kvSet("device_id", deviceId);
  return deviceId;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let lastPending = 0;

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function pendingCount(): Promise<number> {
  const rows = await tx<QueuedOp[]>(STORE_QUEUE, "readonly", (s) => s.getAll());
  lastPending = (rows ?? []).length;
  return lastPending;
}

export async function enqueue(
  entity: string,
  entity_id: string,
  operation: QueuedOp["operation"],
  payload: Record<string, unknown>,
  base_version?: number
): Promise<QueuedOp> {
  const op: QueuedOp = {
    op_id: newUuid(),
    entity,
    entity_id,
    operation,
    payload,
    base_version,
    created_at: new Date().toISOString()
  };
  await tx(STORE_QUEUE, "readwrite", (s) => s.put(op));
  notifyListeners();
  return op;
}

interface PullResponse {
  server_time: string;
  customers: Customer[];
  projects: Project[];
  form_templates: FormTemplate[];
  inspections: Inspection[];
  defects: Defect[];
  time_entries: TimeEntry[];
  material_usages: MaterialUsage[];
  assignments: Assignment[];
  materials: MaterialItem[];
  users?: User[];
}

async function flushQueueOnce(syncBatch: (ops: QueuedOp[]) => Promise<{ done: Set<string>; remaining: QueuedOp[] }>): Promise<number> {
  const ops = await tx<QueuedOp[]>(STORE_QUEUE, "readonly", (s) => s.getAll());
  if (!ops?.length) return 0;
  const { done, remaining } = await syncBatch(ops);
  for (const opId of done) {
    await tx(STORE_QUEUE, "readwrite", (s) => s.delete(opId));
  }
  if (remaining.length) {
    await tx(STORE_QUEUE, "readwrite", (s) => {
      s.clear();
      for (const op of remaining) s.put(op);
    });
  }
  notifyListeners();
  return done.size;
}

import { apiX as api } from "./api";

export async function syncNow(forcePull = false): Promise<{ applied: number; pulled: boolean }> {
  const deviceId = await ensureDeviceId();
  let applied = 0;
  for (let round = 0; round < 3; round += 1) {
    const n = await flushQueueOnce(async (ops) => {
      const response = await api.postSyncBatch(
        deviceId,
        ops.map((op) => ({
          operation_id: op.op_id,
          entity: op.entity,
          entity_id: op.entity_id,
          operation: op.operation,
          payload: op.payload,
          base_version: op.base_version,
          client_updated_at: op.created_at
        }))
      );
      const done = new Set<string>();
      const failed: QueuedOp[] = [];
      for (const result of response.results) {
        const original = ops.find((o) => o.op_id === result.operation_id);
        if (!original) continue;
        if (
          result.status === "conflict" ||
          result.status === "rejected"
        ) {
          const report = (await kvGet<Array<Record<string, unknown>>>("last_problems")) ?? [];
          report.unshift({
            at: new Date().toISOString(),
            entity: result.entity,
            entity_id: result.entity_id,
            status: result.status,
            error: result.error ?? result.conflict
          });
          await kvSet("last_problems", report.slice(0, 10));
          done.add(result.operation_id);
        } else if (result.replayed || result.status === "applied" || result.status === "duplicate") {
          done.add(result.operation_id);
        }
        if (!done.has(result.operation_id)) failed.push(original);
      }
      return { done, remaining: failed };
    }).catch((error) => {
      if (String(error).includes("Sitzung")) throw error;
      return 0;
    });
    applied += n;
    if (n === 0) break;
  }
  const hasNetwork = navigator.onLine;
  if (hasNetwork && (forcePull || applied > 0 || (await kvGet<string>("last_pull")) === null)) {
    await pullAll();
  }
  notifyListeners();
  return { applied, pulled: hasNetwork };
}

export async function pullAll(): Promise<void> {
  const data = await api.syncChangesFull<PullResponse>(500);
  const rows: Array<{ entity: string; id: string; data: unknown }> = [];
  const pushEntity = (entity: string, items: Array<{ id: string }> | undefined) => {
    for (const item of items ?? []) rows.push({ entity, id: item.id, data: item });
  };
  pushEntity("customer", data.customers);
  pushEntity("project", data.projects);
  pushEntity("form_template", data.form_templates);
  pushEntity("inspection", data.inspections);
  pushEntity("defect", data.defects);
  pushEntity("time_entry", data.time_entries);
  pushEntity("material_usage", data.material_usages);
  pushEntity("assignment", data.assignments);
  pushEntity("material", data.materials);
  if (data.users) await kvSet("users_index", data.users);
  await cachePutMany(rows);
  await kvSet("last_pull", new Date().toISOString());
  await kvSet("server_time", data.server_time);
  notifyListeners();
}

export async function getCachedProjects(): Promise<Project[]> {
  return (await cacheGetAll("project")) as Project[];
}

export async function getCachedUsersIndex(): Promise<Record<string, string>> {
  const index = (await kvGet<Array<{ id: string; name: string }>>("users_index")) ?? [];
  return Object.fromEntries(index.map((u) => [u.id, u.name]));
}

export async function getTimeEntriesLocal(): Promise<TimeEntry[]> {
  const rows = (await cacheGetAll("time_entry")) as TimeEntry[];
  return rows.sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
}

export async function getMaterialUsagesLocal(): Promise<MaterialUsage[]> {
  const rows = (await cacheGetAll("material_usage")) as MaterialUsage[];
  return rows.sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
}

export async function getMaterialCatalog(): Promise<MaterialItem[]> {
  const rows = (await cacheGetAll("material")) as MaterialItem[];
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAssignmentsLocal(): Promise<Assignment[]> {
  const rows = (await cacheGetAll("assignment")) as Assignment[];
  return rows.sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
}

let initialized = false;

export function initOffline(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener("online", () => {
    void syncNow(true).catch(() => undefined);
  });
  if (navigator.onLine) {
    setTimeout(() => {
      void syncNow(false).catch(() => undefined);
    }, 1500);
  }
}
