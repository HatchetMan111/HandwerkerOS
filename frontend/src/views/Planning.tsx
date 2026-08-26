import { useCallback, useEffect, useMemo, useState } from "react";
import type { Assignment, Project } from "../types";
import { apiX as api, notify } from "../api";
import {
  cachePut,
  getCachedProjects,
  getAssignmentsLocal,
  kvGet,
  subscribe
} from "../idb";

const STATUS_LABELS: Record<string, string> = {
  planned: "Geplant",
  confirmed: "Zugesagt",
  done: "Erledigt",
  canceled: "Abgesagt"
};

function mondayOf(date: Date): string {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const d = new Date(date);
  d.setDate(date.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

interface Props {
  userId: string;
  isPlanner: boolean;
}

export default function Planning({ userId, isPlanner }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [usersIndex, setUsersIndex] = useState<Record<string, string>>({});
  const [weekOffset, setWeekOffset] = useState(0);
  const [form, setForm] = useState({
    project_id: "",
    user_id: "",
    work_date: "",
    hours: "8",
    note: ""
  });

  const base = new Date();
  base.setDate(base.getDate() + weekOffset * 7);
  const weekStart = mondayOf(base);

  const load = useCallback(async () => {
    let rows = await getAssignmentsLocal();
    if (navigator.onLine) {
      try {
        rows = await api.listAssignments(weekStart);
        for (const row of rows) await cachePut("assignment", row.id, row);
      } catch (error) {
        notify(String(error), true);
      }
    }
    setAssignments(rows);
    setProjects(await getCachedProjects());
    setUsersIndex((await kvGet<Record<string, string>>("users_index")) ?? {});
  }, [weekStart]);

  useEffect(() => {
    void load();
    return subscribe(() => void load());
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api.createAssignment({
        project_id: form.project_id,
        user_id: form.user_id,
        work_date: form.work_date || weekStart,
        hours_planned: Number(form.hours) || null,
        note: form.note
      });
      setForm({ ...form, note: "", hours: "8" });
      notify("Einsatz geplant");
      void load();
    } catch (error) {
      notify(String(error), true);
    }
  }

  const visible = useMemo(
    () =>
      assignments.filter(
        (a) => (isPlanner ? true : a.user_id === userId)
      ),
    [assignments, userId, isPlanner]
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
    const start = new Date(weekStart);
    for (let i = 0; i < 7; i += 1) {
      const iso = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      groups.set(iso, []);
    }
    for (const row of visible) {
      groups.get(row.work_date)?.push(row);
    }
    return [...groups.entries()];
  }, [visible, weekStart]);

  return (
    <div className="stack">
      <div className="toolbar week-nav">
        <button className="btn btn-secondary" onClick={() => setWeekOffset(weekOffset - 1)}>
          &larr;
        </button>
        <span className="week-label">Woche ab {weekStart.slice(8)}. ({new Date(weekStart).toLocaleDateString("de-DE", { month: "2-digit" })}.)</span>
        <button className="btn btn-secondary" onClick={() => setWeekOffset(weekOffset + 1)}>
          &rarr;
        </button>
      </div>

      {isPlanner ? (
        <form className="card form-row" onSubmit={create}>
          <h2>Mitarbeiter einteilen</h2>
          <div className="two-col">
            <div className="field">
              <label htmlFor="pl-project">Baustelle *</label>
              <select
                id="pl-project"
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
            <div className="field">
              <label htmlFor="pl-user">Mitarbeiter *</label>
              <select
                id="pl-user"
                required
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
              >
                <option value="">-- waehlen --</option>
                {Object.entries(usersIndex).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label htmlFor="pl-date">Datum *</label>
              <input
                id="pl-date"
                type="date"
                required
                value={form.work_date}
                onChange={(e) => setForm({ ...form, work_date: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="pl-hours">Soll-Stunden</label>
              <input
                id="pl-hours"
                type="number"
                step="0.5"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </div>
          </div>
          <button className="btn btn-primary" type="submit">
            Einteilen
          </button>
        </form>
      ) : null}

      {byDay.map(([day, list]) => (
        <section className={`card ${list.length ? "" : "dimmed-day"}`} key={day}>
          <h3>
            {new Date(day).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit"
            })}
          </h3>
          {list.length === 0 ? (
            <p className="muted">-</p>
          ) : (
            <ul className="list">
              {list.map((row) => (
                <li key={row.id} className="list-item static">
                  <span>
                    {projects.find((p) => p.id === row.project_id)?.name ?? "?"}
                    {row.hours_planned ? ` · ${row.hours_planned} h geplant` : ""}
                    {row.note ? ` · ${row.note}` : ""}
                    <br />
                    <span className="muted">
                      {(usersIndex[row.user_id] ?? "?")} · {STATUS_LABELS[row.status]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {!isPlanner ? (
        <p className="muted">Deine Einteilung wird automatisch offline verfuegbar gehalten.</p>
      ) : null}
    </div>
  );
}
