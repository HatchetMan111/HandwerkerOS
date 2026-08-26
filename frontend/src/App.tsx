import { useEffect, useState } from "react";
import type { FormTemplate, User } from "./types";
import { api, clearToken, getToken, notify } from "./api";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";
import Customers from "./views/Customers";
import Projects from "./views/Projects";
import Forms from "./views/Forms";
import FormBuilder from "./views/FormBuilder";
import Inspections from "./views/Inspections";
import InspectionDetail from "./views/InspectionDetail";
import Admin from "./views/Admin";
import Timesheets from "./views/Timesheets";
import Materials from "./views/Materials";
import Planning from "./views/Planning";
import Invoices from "./views/Invoices";
import Warranty from "./views/Warranty";
import More from "./views/More";
import { pendingCount, subscribe } from "./idb";

type View =
  | { name: "dashboard" }
  | { name: "customers" }
  | { name: "projects" }
  | { name: "forms" }
  | { name: "builder"; template: FormTemplate | null }
  | { name: "inspections" }
  | { name: "inspection"; id: string }
  | { name: "time" }
  | { name: "material" }
  | { name: "planung" }
  | { name: "invoices" }
  | { name: "gewaehr" }
  | { name: "more" }
  | { name: "admin" };

interface Toast {
  message: string;
  isError: boolean;
  key: number;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function Toaster({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toaster">
      {toasts.map((toast) => (
        <div key={toast.key} className={`toast ${toast.isError ? "toast-error" : ""}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const online = useOnline();
  const [pendingOps, setPendingOps] = useState(0);

  useEffect(() => {
    void pendingCount().then(setPendingOps);
    return subscribe(() => void pendingCount().then(setPendingOps));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoadingUser(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoadingUser(false));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; isError: boolean }>).detail;
      const toast = { ...detail, key: Date.now() + Math.random() };
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(
        () => setToasts((current) => current.filter((t) => t.key !== toast.key)),
        detail.isError ? 6000 : 3000
      );
    };
    window.addEventListener("hwe-toast", handler);
    return () => window.removeEventListener("hwe-toast", handler);
  }, []);

  if (loadingUser) {
    return <div className="boot">HandwerkerOS wird geladen...</div>;
  }

  if (!user) {
    return (
      <>
        <Login onLogin={() => api.me().then(setUser).catch(() => undefined)} />
        <Toaster toasts={toasts} />
      </>
    );
  }

  const canManageUsers = user.permissions.includes("users.manage");

  const tabs: Array<{ view: View; label: string; icon: string; badge?: number }> = [
    { view: { name: "dashboard" }, label: "Start", icon: "\u2302" },
    { view: { name: "time" }, label: "Zeit", icon: "\u23F1" },
    { view: { name: "material" }, label: "Material", icon: "\uD83D\uDD28" },
    { view: { name: "inspections" }, label: "Pruefungen", icon: "\u2713" },
    { view: { name: "more" }, label: "Mehr", icon: "\u2261" }
  ];

  const activeTabName =
    view.name === "inspection" || view.name === "builder"
      ? view.name === "inspection"
        ? "inspections"
        : "forms"
      : (view.name as string);

  function go(target: string) {
    const [kind, id] = target.split(":");
    if (kind === "inspection" && id) setView({ name: "inspection", id });
    else if (
      ["dashboard", "customers", "projects", "forms", "inspections", "time", "material", "planung", "invoices", "gewaehr", "more", "admin"].includes(
        kind
      )
    )
      setView({ name: kind } as View);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="logo-dot" /> HandwerkerOS
        </span>
        <button
          className={`sync-badge ${online && pendingOps === 0 ? "online" : "offline"}`}
          onClick={() => setView({ name: "more" })}
          title="Sync-Status"
        >
          {!online
            ? `\u25CB Offline${pendingOps ? ` \u26A1${pendingOps}` : ""}`
            : pendingOps > 0
              ? `\u25CF Online \u00B7 ${pendingOps} offen`
              : "\u25CF Sync OK"}
        </button>
        <span className="user-chip" title={user.email}>
          {user.name}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            clearToken();
            setUser(null);
            setView({ name: "dashboard" });
          }}
        >
          Abmelden
        </button>
      </header>

      <main className={`content ${view.name === "inspection" ? "detail-view" : ""}`}>
        {view.name === "dashboard" ? <Dashboard go={go} /> : null}
        {view.name === "customers" ? <Customers /> : null}
        {view.name === "projects" ? <Projects /> : null}
        {view.name === "forms" ? (
          <Forms openBuilder={(template) => setView({ name: "builder", template })} />
        ) : null}
        {view.name === "builder" ? (
          <FormBuilder
            initial={
              view.template
                ? {
                    templateId: view.template.id,
                    name: view.template.name,
                    category: view.template.category,
                    schema:
                      view.template.versions?.[view.template.versions.length - 1]?.schema ?? {
                        sections: []
                      },
                    nextVersion: (view.template.latest_version ?? 0) + 1
                  }
                : undefined
            }
            onDone={() => setView({ name: "forms" })}
          />
        ) : null}
        {view.name === "inspections" ? (
          <Inspections openInspection={(id) => setView({ name: "inspection", id })} />
        ) : null}
        {view.name === "time" ? (
          <Timesheets userId={user.id} canApprove={user.permissions.includes("reports.create")} />
        ) : null}
        {view.name === "material" ? (
          <Materials canManageCatalog={user.permissions.includes("projects.write")} />
        ) : null}
        {view.name === "planung" ? (
          <Planning userId={user.id} isPlanner={user.permissions.includes("projects.write")} />
        ) : null}
        {view.name === "invoices" ? <Invoices /> : null}
        {view.name === "gewaehr" ? <Warranty /> : null}
        {view.name === "more" ? <More user={user} go={go} /> : null}
        {view.name === "inspection" ? (
          <InspectionDetail
            inspectionId={view.id}
            userName={user.name}
            onBack={() => setView({ name: "inspections" })}
          />
        ) : null}
        {view.name === "admin" ? <Admin currentUser={user} /> : null}
      </main>

      <nav className="tabbar">
        {tabs.map((tab) => (
          <button
            key={tab.view.name}
            className={`tab ${activeTabName === tab.view.name ? "active" : ""}`}
            onClick={() => setView(tab.view)}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <Toaster toasts={toasts} />
    </div>
  );
}
