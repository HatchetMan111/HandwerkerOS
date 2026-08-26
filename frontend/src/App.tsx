import { useEffect, useState } from "react";
import type { User } from "./types";
import { api, clearToken, getToken, notify } from "./api";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";
import Customers from "./views/Customers";
import Projects from "./views/Projects";
import Forms from "./views/Forms";
import Inspections from "./views/Inspections";
import InspectionDetail from "./views/InspectionDetail";

type View =
  | { name: "dashboard" }
  | { name: "customers" }
  | { name: "projects" }
  | { name: "forms" }
  | { name: "inspections" }
  | { name: "inspection"; id: string };

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

const TABS: Array<{ name: View["name"]; label: string; icon: string }> = [
  { name: "dashboard", label: "Start", icon: "\u2302" },
  { name: "projects", label: "Projekte", icon: "\u2692" },
  { name: "inspections", label: "Pruefungen", icon: "\u2713" },
  { name: "forms", label: "Formulare", icon: "\u25A6" },
  { name: "customers", label: "Kunden", icon: "\u260E" }
];

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

  function go(target: string) {
    const [kind, id] = target.split(":");
    if (kind === "inspection" && id) setView({ name: "inspection", id });
    else if (["dashboard", "customers", "projects", "forms", "inspections"].includes(kind))
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
            notify("Abgemeldet");
          }}
        >
          Abmelden
        </button>
      </header>

      <main className="content">
        {view.name === "dashboard" ? <Dashboard go={go} /> : null}
        {view.name === "customers" ? <Customers /> : null}
        {view.name === "projects" ? <Projects /> : null}
        {view.name === "forms" ? <Forms /> : null}
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
      </main>

      <nav className="tabbar">
        {TABS.map((tab) => (
          <button
            key={tab.name}
            className={`tab ${view.name === tab.name ? "active" : ""}`}
            onClick={() => setView({ name: tab.name } as View)}
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
