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

type View =
  | { name: "dashboard" }
  | { name: "customers" }
  | { name: "projects" }
  | { name: "forms" }
  | { name: "builder"; template: FormTemplate | null }
  | { name: "inspections" }
  | { name: "inspection"; id: string }
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

  const tabs: Array<{ view: View; label: string; icon: string }> = [
    { view: { name: "dashboard" }, label: "Start", icon: "\u2302" },
    { view: { name: "projects" }, label: "Projekte", icon: "\u2692" },
    { view: { name: "inspections" }, label: "Pruefungen", icon: "\u2713" },
    { view: { name: "forms" }, label: "Formulare", icon: "\u25A6" },
    ...(canManageUsers ? [{ view: { name: "admin" } as View, label: "Admin", icon: "\u2699" }] : [])
  ];

  const activeTabName =
    view.name === "inspection" || view.name === "builder" ? null : (view.name as string);

  function go(target: string) {
    const [kind, id] = target.split(":");
    if (kind === "inspection" && id) setView({ name: "inspection", id });
    else if (["dashboard", "customers", "projects", "forms", "inspections", "admin"].includes(kind))
      setView({ name: kind } as View);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="logo-dot" /> HandwerkerOS
        </span>
        <span className={`sync-badge ${online ? "online" : "offline"}`}>
          {online ? "\u25CF Online" : "\u25CB Offline"}
        </span>
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

      <main className={`content ${view.name === "inspection" && user.permissions.includes("users.manage") === false ? "" : ""}`}>
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
