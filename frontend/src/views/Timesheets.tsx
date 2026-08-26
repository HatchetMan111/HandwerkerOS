import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, TimeEntry } from "../types";
import { apiX as api, formatDate, notify } from "../api";
import {
  cachePut,
  cacheDelete,
  getCachedProjects,
  pendingCount,
  subscribe,
  syncNow,
  getTimeEntriesLocal
} from "../idb";

function mondayOf(date: Date): string {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

interface Props {
  userId: string;
  canApprove: boolean;
}

export default function Timesheets({ userId, canApprove }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [pending, setPending] = useState(0);
  const [form, setForm] = useState({
    project_id: "",
    hours: "8",
    activity: ""
  });
  const [submittedEntries, setSubmittedEntries] = useState<TimeEntry[]>([]);

  const weekStartBase = new Date();
  weekStartBase.setDate(weekStartBase.getDate() + weekOffset * 7);
  const weekStart = mondayOf(weekStartBase);
  const weekEnd = (() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  })();

  const load = useCallback(async () => {
    setPending(await pendingCount());
    let rows = await getTimeEntriesLocal();
    if (!rows.length && navigator.onLine) {
      try {
        rows = await api.listTimeEntries();
        for (const row of rows) await cachePut("time_entry", row.id, row);
      } catch (error) {
        notify(String(error), true);
      }
    }
    setEntries(rows);
    setProjects(await getCachedProjects());
  }, []);

  useEffect(() => {
    void load();
    return subscribe(() => void load());
  }, [load]);

  useEffect(() => {
    if (canApprove && navigator.onLine) {
      api
        .listTimeEntries("submitted")
        .then(setSubmittedEntries)
        .catch(() => undefined);
    }
  }, [canApprove]);

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    const projectId = form.project_id;
    if (!projectId || Number(form.hours) <= 0) {
      notify("Projekt und Stunden ausfuellen", true);
      return;
    }
    const entryId =
      crypto.randomUUID ? crypto.randomUUID() : `te-${Date.now()}-${Math.random()}`;
    const workDate = new Date().toISOString().slice(0, 10);
    const optimistic: TimeEntry = {
      id: entryId,
      project_id: projectId,
      user_id: userId,
      work_date: workDate,
      hours: Number(form.hours),
      activity: form.activity,
      status: "draft",
      version: 1,
      unsynced: !navigator.onLine
    };
    await cachePut("time_entry", entryId, optimistic);
    const payload = {
      project_id: projectId,
      work_date: workDate,
      hours: Number(form.hours),
      activity: form.activity
    };
    try {
      if (navigator.onLine) {
        await api.createTimeEntry(payload);
        await cachePut("time_entry", entryId, { ...optimistic, unsynced: false });
        notify("Stunden erfasst");
      } else {
        throw new TypeError("offline");
      }
    } catch {
      const { enqueue } = await import("../idb");
      await enqueue("time_entry", entryId, "create", payload);
      notify(`Offline gespeichert - wird automatisch synchronisiert`);
    }
    setForm({ ...form, activity: "" });
    void load();
  }

  async function submitEntry(entry: TimeEntry) {
    try {
      if (navigator.onLine) {
        await api.patchTimeEntry(entry.id, {
          base_version: entry.version,
          status: "submitted"
        });
      } else {
        const { enqueue } = await import("../idb");
        await enqueue(
          "time_entry",
          entry.id,
          "update",
          { status: "submitted" },
          entry.version
        );
      }
      await cachePut("time_entry", entry.id, {
        ...entry,
        status: "submitted",
        version: entry.version + 1,
        unsynced: !navigator.onLine
      });
      notify("Abgegeben");
      void load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function deleteEntry(entry: TimeEntry) {
    if (!window.confirm("Eintrag loeschen?")) return;
    try {
      if (navigator.onLine) {
        await api.deleteTimeEntry(entry.id);
      } else {
        const { enqueue } = await import("../idb");
        await enqueue("time_entry", entry.id, "delete", {});
      }
      await cacheDelete("time_entry", entry.id);
      void load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  async function approve(entry: TimeEntry, status: "approved" | "rejected") {
    try {
      await api.patchTimeEntry(entry.id, {
        base_version: entry.version,
        status
      });
      notify(status === "approved" ? "Freigegeben" : "Abgelehnt");
      setSubmittedEntries((current) => current.filter((e) => e.id !== entry.id));
      await cachePut("time_entry", entry.id, { ...entry, status });
    } catch (error) {
      notify(String(error), true);
    }
  }

  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (entry.user_id !== userId && !canApprove) return false;
        return entry.work_date >= weekStart && entry.work_date <= weekEnd;
      }),
    [entries, userId, canApprove, weekStart, weekEnd]
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of visible) {
      const list = groups.get(entry.work_date) ?? [];
      list.push(entry);
      groups.set(entry.work_date, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "?";
  const weekTotal = visible.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="stack">
      <form className="card form-row" onSubmit={addEntry}>
        <h2>Stundenzettel - schneller Eintrag</h2>
        <div className="field">
          <label htmlFor="ts-project">Baustelle *</label>
          <select
            id="ts-project"
            required
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          >
            <option value="">-- waehlen --</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="two-col">
          <div className="field">
            <label htmlFor="ts-hours">Stunden *</label>
            <input
              id="ts-hours"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              required
              inputMode="decimal"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Taetigkeit</label>
            <input
              value={form.activity}
              placeholder="z.B. Zählerplatz verkabelt"
              onChange={(e) => setForm({ ...form, activity: e.target.value })}
            />
          </div>
        </div>
        <button className="btn btn-primary btn-lg" type="submit">
          {navigator.onLine ? "Erfassen" : "Offline erfassen"}
        </button>
        <p className="muted">
          Funktioniert ohne Empfang - Eintraege landen lokal und synchronisieren automatisch.
        </p>
      </form>

      <div className="toolbar week-nav">
        <button className="btn btn-secondary" onClick={() => setWeekOffset(weekOffset - 1)}>
          &larr;
        </button>
        <span className="week-label">
          Woche {weekStart.slice(8)}.–{weekEnd.slice(8)}. · Summe {weekTotal.toFixed(2)} h ·{" "}
          {pending} offen zu sync
        </span>
        <button className="btn btn-secondary" onClick={() => setWeekOffset(weekOffset + 1)}>
          &rarr;
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void syncNow(true).then(() => load())}>
          Sync jetzt
        </button>
      </div>

      {byDay.map(([day, list]) => (
        <section className="card" key={day}>
          <h3>
            {new Date(day).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit"
            })}
          </h3>
          <ul className="list">
            {list.map((entry) => (
              <li key={entry.id} className="list-item static">
                <span>
                  {projectName(entry.project_id)} · <b>{entry.hours} h</b>
                  {entry.activity ? ` · ${entry.activity}` : ""}
                  {entry.unsynced ? " ⚡" : ""}
                  <br />
                  <span className="muted">Status: {entry.status}</span>
                </span>
                <span className="btn-row user-actions">
                  {entry.status === "draft" ? (
                    <button className="btn btn-sm btn-primary" onClick={() => submitEntry(entry)}>
                      Abgeben
                    </button>
                  ) : null}
                  {entry.status !== "approved" ? (
                    <button className="btn btn-sm btn-ghost" onClick={() => deleteEntry(entry)}>
                      ✕
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {visible.length === 0 ? (
        <section className="card">
          <p className="muted">Keine Eintraege in dieser Woche.</p>
        </section>
      ) : null}

      {canApprove ? (
        <section className="card">
          <h2>Freigaben ({submittedEntries.length})</h2>
          <p className="muted">Abgegebene Zeiten aus dem Team pruefen.</p>
          <ul className="list">
            {submittedEntries.map((entry) => (
              <li key={entry.id} className="list-item static">
                <span>
                  {formatDate(entry.updated_at)} · {entry.hours} h · {entry.activity}
                </span>
                <span className="btn-row user-actions">
                  <button className="btn btn-sm btn-success" onClick={() => approve(entry, "approved")}>
                    Freigeben
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => approve(entry, "rejected")}>
                    Ablehnen
                  </button>
                </span>
              </li>
            ))}
            {submittedEntries.length === 0 ? (
              <li className="muted list-item static">Nichts ausstehend.</li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
