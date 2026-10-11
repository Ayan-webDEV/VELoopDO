import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Command,
  Eye,
  EyeOff,
  FileText,
  Filter,
  History,
  LayoutDashboard,
  Link as LinkIcon,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import api, { clearAuthToken, getAuthToken, setAuthToken } from "./lib/api";

const APP_NAME = import.meta.env.APP_NAME || "VELoopDO";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "daily", label: "Daily tasks", icon: CalendarDays },
  { id: "fixed", label: "Fixed tasks", icon: ListTodo },
  { id: "future", label: "Future tasks", icon: Clock3 },
  { id: "history", label: "Task history", icon: History },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

const CHART_COLORS = {
  completed: "#19a879",
  failed: "#e35b68",
  pending: "#8d80f4",
};

const EMPTY_TASK = {
  title: "",
  description: "",
  label: "",
  category: "fixed",
  priority: "medium",
  scheduledFor: "",
  dueAt: "",
  linkTitle: "",
  linkUrl: "",
  assignedTo: "",
};

function initials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "VL"
  );
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function toLocalInput(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toISOStringOrUndefined(value) {
  if (!value) return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getTaskId(task) {
  return task?._id || task?.id;
}

function unwrapList(response, key) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.[key])) return response[key];
  if (Array.isArray(response?.data?.[key])) return response.data[key];
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const priorityDifference =
      (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);

    if (priorityDifference !== 0) return priorityDifference;

    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
}

function categoryLabel(category) {
  return (
    {
      daily: "Daily",
      fixed: "Fixed",
      future: "Future",
    }[category] ||
    category ||
    "Task"
  );
}

function statusLabel(status) {
  return (
    {
      pending: "Pending",
      completed: "Completed",
      failed: "Failed",
      deleted: "Deleted",
    }[status] ||
    status ||
    "Unknown"
  );
}

function priorityClass(priority) {
  return `badge badge-${priority || "medium"}`;
}

function statusClass(status) {
  if (status === "completed") return "badge badge-success";
  if (status === "failed") return "badge badge-danger";
  if (status === "deleted") return "badge badge-neutral";
  return "badge badge-warning";
}

function getErrorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}

function isValidWebUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildTaskPayload(form) {
  const links = form.linkUrl.trim()
    ? [
        {
          title: form.linkTitle.trim() || "Open link",
          url: form.linkUrl.trim(),
        },
      ]
    : [];

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    label: form.label.trim(),
    category: form.category,
    priority: form.priority,
    links,
    ...(form.category === "future" && form.scheduledFor
      ? { scheduledFor: new Date(form.scheduledFor).toISOString() }
      : {}),
    ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {}),
    ...(form.assignedTo ? { assignedTo: form.assignedTo } : {}),
  };
}

function readTheme() {
  try {
    const saved = window.localStorage.getItem("veloopdo_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Use the default theme if storage is unavailable.
  }

  return "light";
}

function App() {
  const [theme, setTheme] = useState(readTheme);
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [activePage, setActivePage] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [historyTasks, setHistoryTasks] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [analyticsRange, setAnalyticsRange] = useState("week");

  const [modal, setModal] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [editingTask, setEditingTask] = useState(null);
  const [actionTask, setActionTask] = useState(null);
  const [actionReason, setActionReason] = useState("");
  const [actionPassword, setActionPassword] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, type = "success") => {
    const id = `${Date.now()}-${Math.random()}`;

    setToasts((current) => [...current, { id, message, type }].slice(-4));

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      window.localStorage.setItem("veloopdo_theme", theme);
    } catch {
      // The active theme still works for this session.
    }
  }, [theme]);

  const signOut = useCallback(
    async (notify = false) => {
      try {
        if (getAuthToken()) {
          await api.post("/auth/logout");
        }
      } catch {
        // Clear the local session even when the server is unreachable.
      } finally {
        clearAuthToken();
        setUser(null);
        setCompany(null);
        setTasks([]);
        setHistoryTasks([]);
        setAnalytics(null);
        setActivePage("dashboard");
        setDrawerOpen(false);
        setModal(null);

        if (notify) {
          pushToast("Your session has ended. Please sign in again.", "error");
        }
      }
    },
    [pushToast],
  );

  useEffect(() => {
    const handleExpiredSession = () => {
      clearAuthToken();
      setUser(null);
      setCompany(null);
      setTasks([]);
      setHistoryTasks([]);
      setAnalytics(null);
      setModal(null);
      setLoginError("Your session has expired. Please sign in again.");
    };

    window.addEventListener("veloopdo:session-expired", handleExpiredSession);

    return () => {
      window.removeEventListener(
        "veloopdo:session-expired",
        handleExpiredSession,
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!getAuthToken()) {
        setAuthChecking(false);
        return;
      }

      try {
        const response = await api.get("/auth/me");

        if (cancelled) return;

        setUser(response?.user || response?.data?.user || null);
        setCompany(response?.company || response?.data?.company || null);
      } catch {
        if (!cancelled) {
          clearAuthToken();
          setUser(null);
          setCompany(null);
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError("");

    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Enter your email address and password.");
      return;
    }

    setLoginLoading(true);

    try {
      const response = await api.post("/auth/login", {
        email: loginEmail.trim(),
        password: loginPassword,
      });

      const token = response?.token || response?.data?.token;
      const authenticatedUser = response?.user || response?.data?.user;

      if (!token || !authenticatedUser) {
        throw new Error("The server returned an incomplete login response.");
      }

      setAuthToken(token);
      setUser(authenticatedUser);
      setCompany(response?.company || response?.data?.company || null);
      setLoginPassword("");
      setLoginError("");
      setActivePage("dashboard");

      pushToast(`Welcome back, ${authenticatedUser.name || "there"}.`);
    } catch (error) {
      setLoginError(getErrorMessage(error));
    } finally {
      setLoginLoading(false);
    }
  };

  const loadWorkspace = useCallback(async () => {
    if (!getAuthToken()) return;

    setDataLoading(true);
    setDataError("");

    try {
      const [taskResult, historyResult, analyticsResult] =
        await Promise.allSettled([
          api.get("/tasks"),
          api.get("/tasks/history"),
          api.get("/analytics/overview", {
            params: { range: analyticsRange },
          }),
        ]);

      if (taskResult.status === "fulfilled") {
        setTasks(unwrapList(taskResult.value, "tasks"));
      } else {
        setDataError(getErrorMessage(taskResult.reason));
      }

      if (historyResult.status === "fulfilled") {
        setHistoryTasks(unwrapList(historyResult.value, "tasks"));
      }

      if (analyticsResult.status === "fulfilled") {
        setAnalytics(
          analyticsResult.value?.overview ||
            analyticsResult.value?.data?.overview ||
            analyticsResult.value,
        );
      }
    } finally {
      setDataLoading(false);
    }
  }, [analyticsRange]);

  useEffect(() => {
    if (!user) return;

    loadWorkspace();
  }, [user, loadWorkspace]);

  const members = useMemo(() => {
    const sources = [
      analytics?.members,
      analytics?.performance,
      analytics?.memberStats,
      analytics?.period?.members,
    ];

    const memberList = sources.find(Array.isArray) || [];

    const normalized = memberList
      .map((member) => ({
        _id: member._id || member.userId || member.id,
        name: member.name || member.user?.name || member.email || "Team member",
        email: member.email || member.user?.email || "",
        role: member.role || member.user?.role || "member",
        designation: member.designation || member.user?.designation || "",
      }))
      .filter((member) => member._id);

    if (user?._id && !normalized.some((member) => member._id === user._id)) {
      normalized.unshift({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
      });
    }

    return normalized;
  }, [analytics, user]);

  const visibleTasks = useMemo(() => {
    let result = tasks.filter((task) => {
      if (activePage === "daily") return task.category === "daily";
      if (activePage === "fixed") return task.category === "fixed";
      if (activePage === "future") return task.category === "future";
      return true;
    });

    if (priorityFilter !== "all" && activePage !== "history") {
      result = result.filter((task) => task.priority === priorityFilter);
    }

    const normalizedSearch = search.trim().toLowerCase();

    if (normalizedSearch) {
      result = result.filter((task) =>
        [
          task.title,
          task.description,
          task.label,
          task.category,
          task.priority,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(normalizedSearch),
        ),
      );
    }

    return sortTasks(result);
  }, [tasks, activePage, priorityFilter, search]);

  const visibleHistory = useMemo(() => {
    let result = historyTasks;

    if (historyStatus !== "all") {
      result = result.filter((task) => task.status === historyStatus);
    }

    const normalizedSearch = search.trim().toLowerCase();

    if (normalizedSearch) {
      result = result.filter((task) =>
        [
          task.title,
          task.description,
          task.label,
          task.category,
          task.status,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(normalizedSearch),
        ),
      );
    }

    return [...result].sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0) -
        new Date(a.updatedAt || a.createdAt || 0),
    );
  }, [historyTasks, historyStatus, search]);

  const overview = useMemo(() => {
    const source = analytics?.totals || analytics?.summary || {};

    const completed = Number(
      source.completed ??
        analytics?.completed ??
        historyTasks.filter((task) => task.status === "completed").length,
    );

    const failed = Number(
      source.failed ??
        analytics?.failed ??
        historyTasks.filter((task) => task.status === "failed").length,
    );

    const deleted = Number(
      source.deleted ??
        analytics?.deleted ??
        historyTasks.filter((task) => task.status === "deleted").length,
    );

    const pending = Number(
      source.pending ?? analytics?.pending ?? tasks.length,
    );

    return { completed, failed, deleted, pending };
  }, [analytics, tasks, historyTasks]);

  const chartData = useMemo(() => {
    const buckets = analytics?.buckets || analytics?.chart || [];

    if (!Array.isArray(buckets)) return [];

    return buckets.map((bucket) => ({
      name: bucket.label || bucket.name || bucket.key || "",
      completed: Number(bucket.completed || 0),
      failed: Number(bucket.failed || 0),
      pending: Number(bucket.pending || 0),
    }));
  }, [analytics]);

  const performance = useMemo(() => {
    const source =
      analytics?.performance ||
      analytics?.memberStats ||
      analytics?.members ||
      [];

    if (!Array.isArray(source)) return [];

    return source.map((member) => ({
      ...member,
      name: member.name || member.user?.name || "Team member",
      completed: Number(member.completed || member.completedCount || 0),
      failed: Number(member.failed || member.failedCount || 0),
    }));
  }, [analytics]);

  const openNewTask = (category = "fixed") => {
    setEditingTask(null);
    setTaskForm({ ...EMPTY_TASK, category });
    setActionError("");
    setModal("task");
  };

  const openEditTask = (task) => {
    setEditingTask(task);

    const firstLink = task.links?.[0];

    setTaskForm({
      ...EMPTY_TASK,
      title: task.title || "",
      description: task.description || "",
      label: task.label || "",
      category: task.category || "fixed",
      priority: task.priority || "medium",
      scheduledFor: toLocalInput(task.scheduledFor),
      dueAt: toLocalInput(task.dueAt),
      linkTitle: firstLink?.title || "",
      linkUrl: firstLink?.url || "",
      assignedTo:
        typeof task.assignedTo === "object"
          ? task.assignedTo?._id || ""
          : task.assignedTo || "",
    });

    setActionError("");
    setModal("task");
  };

  const updateTaskField = (field, value) => {
    setTaskForm((current) => ({ ...current, [field]: value }));
  };

  const handleSaveTask = async (event) => {
    event.preventDefault();
    setActionError("");

    if (!taskForm.title.trim()) {
      setActionError("A task title is required.");
      return;
    }

    if (taskForm.category === "future" && !taskForm.scheduledFor) {
      setActionError("Choose a date and time for future work.");
      return;
    }

    if (!isValidWebUrl(taskForm.linkUrl.trim())) {
      setActionError("Links must use a valid HTTP or HTTPS URL.");
      return;
    }

    if (
      taskForm.category === "future" &&
      new Date(taskForm.scheduledFor).getTime() < Date.now()
    ) {
      setActionError("The future task must be scheduled in the future.");
      return;
    }

    setActionLoading(true);

    try {
      const payload = buildTaskPayload(taskForm);

      if (editingTask) {
        await api.patch(`/tasks/${getTaskId(editingTask)}`, payload);
        pushToast("Task updated successfully.");
      } else {
        await api.post("/tasks", payload);
        pushToast("Task created successfully.");
      }

      setModal(null);
      setEditingTask(null);
      await loadWorkspace();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const openTaskAction = (type, task) => {
    setActionTask(task);
    setActionReason("");
    setActionPassword("");
    setActionError("");
    setModal(type);
  };

  const handleTaskAction = async (event) => {
    event?.preventDefault();
    if (!actionTask) return;

    setActionLoading(true);
    setActionError("");

    const taskId = getTaskId(actionTask);

    try {
      if (modal === "complete") {
        await api.post(`/tasks/${taskId}/complete`);
        pushToast("Task marked as completed.");
      } else if (modal === "fail") {
        await api.post(`/tasks/${taskId}/fail`, {
          reason: actionReason.trim(),
        });
        pushToast("Task marked as failed.", "error");
      } else if (modal === "delete") {
        if (!actionPassword) {
          setActionError("Enter your account password to delete this task.");
          setActionLoading(false);
          return;
        }

        await api.delete(`/tasks/${taskId}`, {
          data: {
            password: actionPassword,
            reason: actionReason.trim(),
          },
        });

        pushToast("Task moved to deleted history.");
      } else if (modal === "restore") {
        await api.post(`/tasks/${taskId}/restore`);
        pushToast("Task restored.");
      } else if (modal === "reopen") {
        await api.post(`/tasks/${taskId}/reopen`);
        pushToast("Task reopened.");
      }

      setModal(null);
      setActionTask(null);
      setActionPassword("");
      setActionReason("");
      await loadWorkspace();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const changePage = (page) => {
    setActivePage(page);
    setDrawerOpen(false);
    setSearch("");
    setPriorityFilter("all");
  };

  if (authChecking) {
    return (
      <div className="loading-state" style={{ minHeight: "100vh" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
          <div className="brand-mark">
            <Command size={23} />
          </div>
          <div className="spinner" />
          <span className="text-secondary">Preparing your workspace…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-layout">
        <section className="auth-brand-panel">
          <div className="brand">
            <div className="brand-mark">
              <Command size={23} />
            </div>
            <div>
              <p className="brand-name">{APP_NAME}</p>
              <p className="brand-caption">Your work. In sync.</p>
            </div>
          </div>

          <div className="auth-pitch">
            <h1>Great work starts with clarity.</h1>
            <p>
              Keep daily responsibilities, important deliverables, and future
              plans in one focused workspace built for your team.
            </p>

            <div className="auth-feature-list">
              <div className="auth-feature">
                <CheckCircle2 />
                One shared source of truth for tasks
              </div>
              <div className="auth-feature">
                <ShieldCheck />
                Private, authenticated team access
              </div>
              <div className="auth-feature">
                <TrendingUp />
                Progress tracking and performance insights
              </div>
            </div>
          </div>

          <div className="auth-footer">
            © {new Date().getFullYear()} VELoop · Private workspace
          </div>
        </section>

        <section className="auth-form-panel">
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="stat-icon" style={{ marginBottom: 22 }}>
              <LockKeyhole size={21} />
            </div>

            <h2>Welcome back</h2>
            <p className="auth-form-description">
              Sign in with your authorised VELoopDO account.
            </p>

            {loginError && (
              <div
                className="alert alert-error"
                role="alert"
                style={{ marginBottom: 18 }}
              >
                <AlertCircle size={17} />
                <span>{loginError}</span>
              </div>
            )}

            <label className="form-field">
              <span className="form-label">Email address</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
              />
            </label>

            <label className="form-field">
              <span className="form-label">Password</span>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={showLoginPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  required
                  style={{ paddingRight: 45 }}
                />
                <button
                  type="button"
                  className="button-icon"
                  aria-label={
                    showLoginPassword ? "Hide password" : "Show password"
                  }
                  onClick={() => setShowLoginPassword((value) => !value)}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 39,
                    height: 39,
                    border: 0,
                  }}
                >
                  {showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            <button
              className="button button-primary"
              type="submit"
              disabled={loginLoading}
            >
              {loginLoading ? (
                <>
                  <LoaderCircle className="spinner" size={17} />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in securely
                  <ArrowUpRight size={17} />
                </>
              )}
            </button>

            <div className="auth-security-note">
              <ShieldCheck size={17} />
              <span>
                Private access only. Accounts are provisioned by your workspace
                administrator; public registration is not available.
              </span>
            </div>

            <button
              type="button"
              className="button button-ghost"
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              style={{ marginTop: 15, width: "100%" }}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              Switch to {theme === "dark" ? "light" : "dark"} theme
            </button>
          </form>
        </section>
      </div>
    );
  }

  const currentPage = NAV_ITEMS.find((item) => item.id === activePage);

  return (
    <div className="app-shell">
      <div className="app-layout">
        {drawerOpen && (
          <button
            className="drawer-backdrop"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="brand-mark">
              <Command size={23} />
            </div>
            <div>
              <p className="brand-name">{APP_NAME}</p>
              <p className="brand-caption">Work, organised.</p>
            </div>
          </div>

          <p className="sidebar-label">Workspace</p>

          <nav className="nav-list" aria-label="Main navigation">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={`nav-item ${activePage === id ? "active" : ""}`}
                onClick={() => changePage(id)}
              >
                <Icon />
                <span className="nav-item-label">{label}</span>

                {id === "daily" && (
                  <span className="nav-count">
                    {tasks.filter((task) => task.category === "daily").length}
                  </span>
                )}

                {id === "history" && historyTasks.length > 0 && (
                  <span className="nav-count">{historyTasks.length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-spacer" />

          <div className="workspace-card">
            <p className="workspace-label">Current workspace</p>
            <p className="workspace-name">{company?.name || "VELoop"}</p>
            <span className="workspace-plan">
              <CheckCircle2 size={14} />
              {company?.plan ? `${company.plan} plan` : "Private workspace"}
            </span>
          </div>

          <button
            type="button"
            className="nav-item"
            style={{ marginTop: 10 }}
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            <span className="nav-item-label">
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </span>
          </button>

          <button type="button" className="nav-item" onClick={() => signOut()}>
            <LogOut />
            <span className="nav-item-label">Sign out</span>
          </button>
        </aside>

        <main className="app-main">
          <header className="topbar">
            <div className="topbar-left">
              <button
                type="button"
                className="button-icon mobile-menu-button"
                aria-label="Open navigation"
                onClick={() => setDrawerOpen(true)}
              >
                <Menu size={19} />
              </button>

              <div>
                <p className="topbar-title">
                  {currentPage?.label || "Dashboard"}
                </p>
                <p className="topbar-subtitle">
                  {new Date().toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
            </div>

            <div className="topbar-right">
              <button
                type="button"
                className="button-icon"
                title="Refresh workspace"
                aria-label="Refresh workspace"
                onClick={loadWorkspace}
                disabled={dataLoading}
              >
                <RefreshCw size={17} className={dataLoading ? "spinner" : ""} />
              </button>

              <div className="avatar" title={user.name}>
                {initials(user.name)}
              </div>

              <div className="user-summary">
                <span className="user-summary-name">{user.name}</span>
                <span className="user-summary-role">
                  {user.designation || user.role || "Team member"}
                </span>
              </div>
            </div>
          </header>

          <div className="page-container">
            {dataError && (
              <div
                className="alert alert-error"
                role="alert"
                style={{ marginBottom: 20 }}
              >
                <AlertCircle size={18} />
                <div style={{ flex: 1 }}>{dataError}</div>
                <button
                  type="button"
                  className="button button-sm button-secondary"
                  onClick={loadWorkspace}
                >
                  Retry
                </button>
              </div>
            )}

            {activePage === "dashboard" && (
              <DashboardPage
                user={user}
                overview={overview}
                tasks={tasks}
                chartData={chartData}
                performance={performance}
                analyticsRange={analyticsRange}
                setAnalyticsRange={setAnalyticsRange}
                dataLoading={dataLoading}
                onNavigate={changePage}
                onNewTask={() => openNewTask("fixed")}
                onComplete={(task) => openTaskAction("complete", task)}
                onEdit={openEditTask}
                onRefresh={loadWorkspace}
              />
            )}

            {["daily", "fixed", "future"].includes(activePage) && (
              <TasksPage
                page={activePage}
                tasks={visibleTasks}
                search={search}
                setSearch={setSearch}
                priorityFilter={priorityFilter}
                setPriorityFilter={setPriorityFilter}
                dataLoading={dataLoading}
                onNewTask={() => openNewTask(activePage)}
                onEdit={openEditTask}
                onComplete={(task) => openTaskAction("complete", task)}
                onFail={(task) => openTaskAction("fail", task)}
                onDelete={(task) => openTaskAction("delete", task)}
                onRefresh={loadWorkspace}
              />
            )}

            {activePage === "history" && (
              <HistoryPage
                tasks={visibleHistory}
                search={search}
                setSearch={setSearch}
                historyStatus={historyStatus}
                setHistoryStatus={setHistoryStatus}
                dataLoading={dataLoading}
                onRestore={(task) => openTaskAction("restore", task)}
                onReopen={(task) => openTaskAction("reopen", task)}
                onActivity={(task) => {
                  setActionTask(task);
                  setModal("activity");
                }}
              />
            )}

            {activePage === "analytics" && (
              <AnalyticsPage
                overview={overview}
                chartData={chartData}
                performance={performance}
                analyticsRange={analyticsRange}
                setAnalyticsRange={setAnalyticsRange}
                dataLoading={dataLoading}
                historyTasks={historyTasks}
              />
            )}
          </div>
        </main>
      </div>

      {modal === "task" && (
        <Modal
          title={editingTask ? "Edit task" : "Create a task"}
          subtitle={
            editingTask
              ? "Update the task details and save your changes."
              : "Add work to your shared VELoop workspace."
          }
          onClose={() => {
            setModal(null);
            setActionError("");
          }}
          wide
        >
          <form onSubmit={handleSaveTask}>
            {actionError && (
              <div className="alert alert-error mb-4">{actionError}</div>
            )}

            <div className="form-grid">
              <label className="form-field full-width">
                <span className="form-label">Task title *</span>
                <input
                  className="input"
                  value={taskForm.title}
                  onChange={(event) =>
                    updateTaskField("title", event.target.value)
                  }
                  placeholder="e.g. Review this week's campaign performance"
                  maxLength={180}
                  required
                />
              </label>

              <label className="form-field full-width">
                <span className="form-label">Description</span>
                <textarea
                  className="textarea"
                  value={taskForm.description}
                  onChange={(event) =>
                    updateTaskField("description", event.target.value)
                  }
                  placeholder="Describe the expected outcome, context, or steps…"
                  maxLength={5000}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Task category *</span>
                <select
                  className="select"
                  value={taskForm.category}
                  onChange={(event) =>
                    updateTaskField("category", event.target.value)
                  }
                >
                  <option value="daily">Daily recurring work</option>
                  <option value="fixed">Fixed / one-time work</option>
                  <option value="future">Future scheduled work</option>
                </select>
              </label>

              <label className="form-field">
                <span className="form-label">Priority *</span>
                <select
                  className="select"
                  value={taskForm.priority}
                  onChange={(event) =>
                    updateTaskField("priority", event.target.value)
                  }
                >
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
              </label>

              <label className="form-field">
                <span className="form-label">Label</span>
                <input
                  className="input"
                  value={taskForm.label}
                  onChange={(event) =>
                    updateTaskField("label", event.target.value)
                  }
                  placeholder="e.g. Marketing, Operations"
                  maxLength={80}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Assign to</span>
                <select
                  className="select"
                  value={taskForm.assignedTo}
                  onChange={(event) =>
                    updateTaskField("assignedTo", event.target.value)
                  }
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member._id} value={member._id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <span className="form-hint">
                  Assignments are optional. Tasks remain in the shared
                  workspace.
                </span>
              </label>

              {taskForm.category === "future" && (
                <label className="form-field">
                  <span className="form-label">Scheduled date and time *</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={taskForm.scheduledFor}
                    onChange={(event) =>
                      updateTaskField("scheduledFor", event.target.value)
                    }
                    required
                  />
                </label>
              )}

              <label className="form-field">
                <span className="form-label">Due date (optional)</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={taskForm.dueAt}
                  onChange={(event) =>
                    updateTaskField("dueAt", event.target.value)
                  }
                />
              </label>

              <label className="form-field">
                <span className="form-label">Reference link title</span>
                <input
                  className="input"
                  value={taskForm.linkTitle}
                  onChange={(event) =>
                    updateTaskField("linkTitle", event.target.value)
                  }
                  placeholder="e.g. Project brief"
                  maxLength={120}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Reference URL</span>
                <input
                  className="input"
                  type="url"
                  value={taskForm.linkUrl}
                  onChange={(event) =>
                    updateTaskField("linkUrl", event.target.value)
                  }
                  placeholder="https://example.com"
                />
                <span className="form-hint">Use an HTTP or HTTPS link.</span>
              </label>
            </div>

            {taskForm.category === "daily" && (
              <div className="alert" style={{ marginTop: 18 }}>
                <RefreshCw size={17} />
                <span>
                  Daily tasks are configured as recurring templates. The backend
                  generates the daily occurrence for tracking completion.
                </span>
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setModal(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="button button-primary"
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <LoaderCircle size={17} />
                ) : editingTask ? (
                  <Check size={17} />
                ) : (
                  <Plus size={17} />
                )}
                {editingTask ? "Save changes" : "Create task"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {["complete", "fail", "delete", "restore", "reopen"].includes(modal) && (
        <Modal
          title={
            {
              complete: "Complete task",
              fail: "Mark task as failed",
              delete: "Delete task",
              restore: "Restore task",
              reopen: "Reopen task",
            }[modal]
          }
          subtitle={actionTask?.title}
          onClose={() => {
            setModal(null);
            setActionError("");
          }}
        >
          <form onSubmit={handleTaskAction}>
            {actionError && (
              <div
                className="alert alert-error"
                role="alert"
                style={{ marginBottom: 17 }}
              >
                <AlertCircle size={17} />
                {actionError}
              </div>
            )}

            <div className="alert" style={{ marginBottom: 18 }}>
              {modal === "complete" ? (
                <CircleCheck size={18} />
              ) : modal === "fail" ? (
                <CircleAlert size={18} />
              ) : modal === "delete" ? (
                <Trash2 size={18} />
              ) : (
                <RefreshCw size={18} />
              )}

              <span>
                {modal === "complete" &&
                  "Record this task as completed. The completion will be included in task history and performance records."}
                {modal === "fail" &&
                  "Record this task as failed. You can optionally add a reason for the history record."}
                {modal === "delete" &&
                  "This moves the task to deleted history rather than permanently removing its record. Your account password is required."}
                {modal === "restore" &&
                  "Restore this task from deleted history to the pending task list."}
                {modal === "reopen" &&
                  "Reopen this task so it can be worked on again."}
              </span>
            </div>

            {(modal === "fail" || modal === "delete") && (
              <label className="form-field" style={{ marginBottom: 18 }}>
                <span className="form-label">
                  {modal === "fail"
                    ? "Reason (optional)"
                    : "Deletion reason (optional)"}
                </span>
                <textarea
                  className="textarea"
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  placeholder={
                    modal === "fail"
                      ? "Explain what prevented completion…"
                      : "Why is this task being deleted?"
                  }
                  maxLength={1000}
                />
              </label>
            )}

            {modal === "delete" && (
              <label className="form-field" style={{ marginBottom: 18 }}>
                <span className="form-label">Confirm with your password *</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                  placeholder="Enter your account password"
                  required
                />
              </label>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setModal(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>

              <button
                type="submit"
                className={`button ${
                  modal === "delete" || modal === "fail"
                    ? "button-danger"
                    : "button-primary"
                }`}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <LoaderCircle size={17} />
                ) : modal === "complete" ? (
                  <Check size={17} />
                ) : modal === "delete" ? (
                  <Trash2 size={17} />
                ) : (
                  <RefreshCw size={17} />
                )}
                Confirm
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "activity" && actionTask && (
        <ActivityModal
          task={actionTask}
          onClose={() => {
            setModal(null);
            setActionTask(null);
          }}
        />
      )}

      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div className="toast" key={toast.id} role="status">
            {toast.type === "error" ? (
              <AlertCircle className="text-danger" size={19} />
            ) : (
              <CheckCircle2 className="text-success" size={19} />
            )}

            <div className="toast-message">{toast.message}</div>

            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ title, subtitle, onClose, wide = false, children }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title" id="modal-title">
              {title}
            </h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>

          <button
            type="button"
            className="button-icon"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone, footnote }) {
  return (
    <article className="stat-card">
      <div className="stat-topline">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone || ""}`}>
          <Icon size={19} />
        </span>
      </div>

      <div className="stat-value">{value}</div>

      <p className="stat-footnote">{footnote}</p>
    </article>
  );
}

function DashboardPage({
  user,
  overview,
  tasks,
  chartData,
  performance,
  analyticsRange,
  setAnalyticsRange,
  dataLoading,
  onNavigate,
  onNewTask,
  onComplete,
  onEdit,
  onRefresh,
}) {
  const recentTasks = sortTasks(tasks)
    .filter((task) => task.status === "pending")
    .slice(0, 5);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Good to see you, {user.name?.split(" ")[0] || "there"}.</h1>
          <p className="page-description">
            Here's what's happening in your workspace. Focus on the work that
            matters most.
          </p>
        </div>

        <button className="button button-primary" onClick={onNewTask}>
          <Plus size={18} />
          New task
        </button>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Pending tasks"
          value={overview.pending}
          icon={Clock3}
          tone="orange"
          footnote="Awaiting completion"
        />
        <StatCard
          label="Completed"
          value={overview.completed}
          icon={CheckCircle2}
          tone="green"
          footnote="Recorded in task history"
        />
        <StatCard
          label="Failed"
          value={overview.failed}
          icon={CircleAlert}
          tone="red"
          footnote="Review outcomes in history"
        />
        <StatCard
          label="Deleted"
          value={overview.deleted}
          icon={Trash2}
          footnote="Kept in deleted history"
        />
      </div>

      <section className="card" style={{ marginBottom: 22 }}>
        <div className="card-header">
          <div>
            <h2 className="card-title">Task performance</h2>
            <p className="card-description">
              Track completions, failures, and pending work over time.
            </p>
          </div>

          <select
            className="select"
            style={{ width: "auto", minWidth: 125 }}
            value={analyticsRange}
            onChange={(event) => setAnalyticsRange(event.target.value)}
            aria-label="Analytics time range"
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="3m">Last 3 months</option>
            <option value="6m">Last 6 months</option>
            <option value="12m">Last 12 months</option>
          </select>
        </div>

        <div className="chart-legend" style={{ marginBottom: 18 }}>
          <span className="legend-item">
            <span className="legend-dot green" />
            Completed
          </span>
          <span className="legend-item">
            <span className="legend-dot red" />
            Failed
          </span>
          <span className="legend-item">
            <span className="legend-dot" />
            Pending
          </span>
        </div>

        {dataLoading && chartData.length === 0 ? (
          <div className="loading-state">
            <div className="spinner" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <BarChart3 />
            </div>
            <p className="empty-title">Your progress will appear here</p>
            <p className="empty-description">
              Start recording task outcomes to build your performance history.
            </p>
          </div>
        ) : (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={12}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    color: "var(--text)",
                  }}
                />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill={CHART_COLORS.completed}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="failed"
                  name="Failed"
                  fill={CHART_COLORS.failed}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="pending"
                  name="Pending"
                  fill={CHART_COLORS.pending}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="analytics-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Priority work</h2>
              <p className="card-description">
                Your highest-priority pending tasks come first.
              </p>
            </div>

            <button
              className="button button-secondary button-sm"
              onClick={() => onNavigate("daily")}
            >
              View tasks
              <ArrowUpRight size={15} />
            </button>
          </div>

          {recentTasks.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 180 }}>
              <div className="empty-icon">
                <Target />
              </div>
              <p className="empty-title">You're all caught up</p>
              <p className="empty-description">
                Create a task when new work comes in.
              </p>
              <button className="button button-primary" onClick={onNewTask}>
                <Plus size={16} />
                Add a task
              </button>
            </div>
          ) : (
            <div className="task-list">
              {recentTasks.map((task) => (
                <div className="task-card" key={getTaskId(task)}>
                  <div className="task-main">
                    <div className="task-content">
                      <p className="task-title">{task.title}</p>
                      <div className="task-meta">
                        <span className={priorityClass(task.priority)}>
                          {task.priority || "medium"}
                        </span>
                        <span className="badge badge-category">
                          {categoryLabel(task.category)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="task-footer">
                    <span className="text-muted">
                      {task.dueAt
                        ? `Due ${formatDate(task.dueAt)}`
                        : "No due date"}
                    </span>

                    <div className="task-actions">
                      <button
                        className="button button-secondary button-sm"
                        onClick={() => onEdit(task)}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button
                        className="button button-success button-sm"
                        onClick={() => onComplete(task)}
                      >
                        <Check size={14} />
                        Complete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Team performance</h2>
              <p className="card-description">
                Completed and failed tasks by team member.
              </p>
            </div>
            <Users size={20} className="text-muted" />
          </div>

          {performance.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 180 }}>
              <div className="empty-icon">
                <Users />
              </div>
              <p className="empty-title">No performance data yet</p>
              <p className="empty-description">
                Team activity will appear as tasks are completed or marked
                failed.
              </p>
            </div>
          ) : (
            <div className="member-list">
              {performance.map((member, index) => {
                const total = member.completed + member.failed;
                const rate = total
                  ? Math.round((member.completed / total) * 100)
                  : 0;

                return (
                  <div
                    className="member-row"
                    key={member._id || member.userId || index}
                  >
                    <div className="avatar">{initials(member.name)}</div>

                    <div className="member-details">
                      <div className="member-name">{member.name}</div>
                      <div className="member-role">
                        {member.role || "Team member"} · {member.completed}{" "}
                        completed
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </div>

                    <div className="member-score">
                      {rate}%
                      <div className="member-role">{member.failed} failed</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <hr className="divider" style={{ marginBlock: 22 }} />

          <button
            className="button button-secondary w-full"
            onClick={() => onNavigate("analytics")}
          >
            <BarChart3 size={17} />
            Explore analytics
          </button>

          <button
            className="button button-ghost w-full"
            onClick={onRefresh}
            style={{ marginTop: 8 }}
          >
            <RefreshCw size={16} />
            Refresh performance
          </button>
        </section>
      </div>
    </>
  );
}

function TasksPage({
  page,
  tasks,
  search,
  setSearch,
  priorityFilter,
  setPriorityFilter,
  dataLoading,
  onNewTask,
  onEdit,
  onComplete,
  onFail,
  onDelete,
  onRefresh,
}) {
  const pageDetails = {
    daily: {
      title: "Daily tasks",
      description:
        "Recurring responsibilities, tracked one occurrence at a time.",
      emptyTitle: "No daily tasks yet",
      emptyDescription:
        "Create a recurring task to establish your daily workflow.",
    },
    fixed: {
      title: "Fixed tasks",
      description:
        "One-time deliverables such as designs, videos, reviews, and projects.",
      emptyTitle: "No fixed tasks yet",
      emptyDescription: "Add a one-time task when a new deliverable arrives.",
    },
    future: {
      title: "Future work",
      description: "Plan upcoming work with a scheduled date and time.",
      emptyTitle: "Nothing scheduled yet",
      emptyDescription:
        "Schedule future work so your upcoming priorities stay visible.",
    },
  }[page];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{pageDetails.title}</h1>
          <p className="page-description">{pageDetails.description}</p>
        </div>

        <button className="button button-primary" onClick={onNewTask}>
          <Plus size={17} />
          New task
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-field">
            <Search size={17} />
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
            />
          </div>

          <label className="sr-only" htmlFor="task-priority-filter">
            Filter by priority
          </label>
          <select
            id="task-priority-filter"
            className="select"
            style={{ width: "auto", minWidth: 145 }}
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
        </div>

        <div className="toolbar-right">
          <span className="text-muted">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </span>
          <button
            className="button button-secondary button-sm"
            onClick={onRefresh}
            disabled={dataLoading}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {dataLoading && tasks.length === 0 ? (
        <div className="loading-state">
          <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
            <div className="spinner" />
            Loading tasks…
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            <div className="empty-icon">
              {page === "daily" ? (
                <CalendarDays />
              ) : page === "future" ? (
                <Clock3 />
              ) : (
                <FileText />
              )}
            </div>
            <p className="empty-title">{pageDetails.emptyTitle}</p>
            <p className="empty-description">{pageDetails.emptyDescription}</p>
            <button className="button button-primary" onClick={onNewTask}>
              <Plus size={17} />
              Create task
            </button>
          </div>
        </section>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <TaskCard
              task={task}
              key={getTaskId(task)}
              onEdit={onEdit}
              onComplete={onComplete}
              onFail={onFail}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TaskCard({ task, onEdit, onComplete, onFail, onDelete }) {
  const assignedName =
    typeof task.assignedTo === "object"
      ? task.assignedTo?.name
      : task.assignedToName;

  const creatorName =
    typeof task.createdBy === "object"
      ? task.createdBy?.name
      : task.createdByName;

  return (
    <article className="task-card">
      <div className="task-main">
        <div className="task-content">
          <p className="task-title">{task.title}</p>

          {task.description && (
            <p className="task-description">{task.description}</p>
          )}

          <div className="task-meta">
            <span className={priorityClass(task.priority)}>
              {task.priority || "medium"} priority
            </span>

            <span className="badge badge-category">
              {categoryLabel(task.category)}
            </span>

            {task.label && <span className="badge">{task.label}</span>}

            {task.isRecurringTemplate && (
              <span className="badge">
                <RefreshCw size={12} />
                Recurring template
              </span>
            )}
          </div>

          {task.links?.length > 0 && (
            <div className="task-links">
              {task.links.map((link, index) => (
                <a
                  className="task-link"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={`${link.url}-${index}`}
                >
                  <LinkIcon />
                  {link.title || "Open link"}
                </a>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="button-icon"
          title="Edit task"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit(task)}
        >
          <Pencil size={16} />
        </button>
      </div>

      <div className="task-footer">
        <div className="task-meta">
          {assignedName && (
            <span className="text-muted">
              <UserRound
                size={14}
                style={{ display: "inline", verticalAlign: "middle" }}
              />{" "}
              {assignedName}
            </span>
          )}

          {task.scheduledFor && (
            <span className="text-muted">
              <CalendarDays
                size={14}
                style={{ display: "inline", verticalAlign: "middle" }}
              />{" "}
              {formatDate(task.scheduledFor, true)}
            </span>
          )}

          {task.dueAt && (
            <span className="text-muted">
              Due {formatDate(task.dueAt, true)}
            </span>
          )}

          {creatorName && (
            <span className="text-muted">Created by {creatorName}</span>
          )}
        </div>

        <div className="task-actions">
          <button
            type="button"
            className="button button-success button-sm"
            onClick={() => onComplete(task)}
            disabled={task.isRecurringTemplate}
            title={
              task.isRecurringTemplate
                ? "Complete today's occurrence instead"
                : "Mark completed"
            }
          >
            <Check size={14} />
            Complete
          </button>

          <button
            type="button"
            className="button button-secondary button-sm"
            onClick={() => onFail(task)}
            disabled={task.isRecurringTemplate}
          >
            <XCircle size={14} />
            Failed
          </button>

          <button
            type="button"
            className="button button-ghost button-sm"
            aria-label={`Delete ${task.title}`}
            title="Delete task"
            onClick={() => onDelete(task)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function HistoryPage({
  tasks,
  search,
  setSearch,
  historyStatus,
  setHistoryStatus,
  dataLoading,
  onRestore,
  onReopen,
  onActivity,
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Task history</h1>
          <p className="page-description">
            Review completed, failed, and deleted tasks, including their
            recorded outcomes.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-field">
            <Search size={17} />
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search task history…"
              aria-label="Search task history"
            />
          </div>

          <select
            className="select"
            style={{ width: "auto", minWidth: 145 }}
            value={historyStatus}
            onChange={(event) => setHistoryStatus(event.target.value)}
            aria-label="Filter history by status"
          >
            <option value="all">All outcomes</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>

        <span className="text-muted">
          {tasks.length} record{tasks.length === 1 ? "" : "s"}
        </span>
      </div>

      {dataLoading && tasks.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
        </div>
      ) : tasks.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <History />
            </div>
            <p className="empty-title">No matching history</p>
            <p className="empty-description">
              Task outcomes and deleted records will appear here when recorded.
            </p>
          </div>
        </section>
      ) : (
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Category</th>
                  <th>Outcome</th>
                  <th>Recorded</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {tasks.map((task) => (
                  <tr key={getTaskId(task)}>
                    <td>
                      <div style={{ minWidth: 160 }}>
                        <div style={{ color: "var(--text)", fontWeight: 700 }}>
                          {task.title}
                        </div>
                        <div
                          className="text-muted"
                          style={{ fontSize: 11, marginTop: 4 }}
                        >
                          {task.completedBy?.name &&
                            `Completed by ${task.completedBy.name}`}
                          {task.failedBy?.name &&
                            `Failed by ${task.failedBy.name}`}
                          {task.deletedBy?.name &&
                            `Deleted by ${task.deletedBy.name}`}
                        </div>
                      </div>
                    </td>

                    <td>{categoryLabel(task.category)}</td>

                    <td>
                      <span className={statusClass(task.status)}>
                        {statusLabel(task.status)}
                      </span>
                    </td>

                    <td>
                      {formatDate(
                        task.updatedAt ||
                          task.completedAt ||
                          task.failedAt ||
                          task.deletedAt,
                        true,
                      )}
                    </td>

                    <td>
                      <div className="task-actions">
                        <button
                          className="button button-secondary button-sm"
                          title="View activity"
                          aria-label={`View activity for ${task.title}`}
                          onClick={() => onActivity(task)}
                        >
                          <Activity size={14} />
                        </button>

                        {task.status === "deleted" && (
                          <button
                            className="button button-secondary button-sm"
                            onClick={() => onRestore(task)}
                          >
                            <RefreshCw size={14} />
                            Restore
                          </button>
                        )}

                        {(task.status === "completed" ||
                          task.status === "failed") && (
                          <button
                            className="button button-secondary button-sm"
                            onClick={() => onReopen(task)}
                          >
                            <RefreshCw size={14} />
                            Reopen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function AnalyticsPage({
  overview,
  chartData,
  performance,
  analyticsRange,
  setAnalyticsRange,
  dataLoading,
  historyTasks,
}) {
  const totalOutcomes = overview.completed + overview.failed;
  const completionRate = totalOutcomes
    ? Math.round((overview.completed / totalOutcomes) * 100)
    : 0;

  const categoryStats = overview.categories || overview.categoryStats || [];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Analytics</h1>
          <p className="page-description">
            Understand task outcomes, workload trends, and individual
            contributions.
          </p>
        </div>

        <select
          className="select"
          style={{ width: "auto", minWidth: 145 }}
          value={analyticsRange}
          onChange={(event) => setAnalyticsRange(event.target.value)}
          aria-label="Analytics time range"
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="3m">Last 3 months</option>
          <option value="6m">Last 6 months</option>
          <option value="12m">Last 12 months</option>
        </select>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Completion rate"
          value={`${completionRate}%`}
          icon={TrendingUp}
          tone="green"
          footnote="Based on completed and failed outcomes"
        />
        <StatCard
          label="Completed"
          value={overview.completed}
          icon={CheckCircle2}
          tone="green"
          footnote="Recorded completions"
        />
        <StatCard
          label="Failed"
          value={overview.failed}
          icon={CircleAlert}
          tone="red"
          footnote="Recorded failures"
        />
        <StatCard
          label="Pending"
          value={overview.pending}
          icon={Clock3}
          tone="orange"
          footnote="Current pending workload"
        />
      </div>

      <section className="card" style={{ marginBottom: 22 }}>
        <div className="card-header">
          <div>
            <h2 className="card-title">Outcome trends</h2>
            <p className="card-description">
              Historical task outcomes grouped by the selected period.
            </p>
          </div>
          <BarChart3 size={20} className="text-muted" />
        </div>

        {dataLoading && chartData.length === 0 ? (
          <div className="loading-state">
            <div className="spinner" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <BarChart3 />
            </div>
            <p className="empty-title">Not enough data yet</p>
            <p className="empty-description">
              Your chart will populate as your team records task outcomes.
            </p>
          </div>
        ) : (
          <div className="chart-container" style={{ height: 330 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -18, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    color: "var(--text)",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill={CHART_COLORS.completed}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="failed"
                  name="Failed"
                  fill={CHART_COLORS.failed}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="pending"
                  name="Pending"
                  fill={CHART_COLORS.pending}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="analytics-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Member performance</h2>
              <p className="card-description">
                Compare completion and failure counts by member.
              </p>
            </div>
            <Users size={20} className="text-muted" />
          </div>

          {performance.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 170 }}>
              <div className="empty-icon">
                <Users />
              </div>
              <p className="empty-title">No member breakdown yet</p>
              <p className="empty-description">
                Member performance appears when the API returns individual
                activity.
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Completed</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((member, index) => (
                    <tr key={member._id || member.userId || index}>
                      <td>
                        {member.name || member.user?.name || "Team member"}
                      </td>
                      <td>
                        <span className="text-success font-bold">
                          {member.completed ?? member.completedCount ?? 0}
                        </span>
                      </td>
                      <td>
                        <span className="text-danger font-bold">
                          {member.failed ?? member.failedCount ?? 0}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Category overview</h2>
              <p className="card-description">Current workload by task type.</p>
            </div>
            <Filter size={20} className="text-muted" />
          </div>

          {categoryStats.length > 0 ? (
            <div className="member-list">
              {categoryStats.map((item, index) => {
                const category =
                  item.category || item._id?.category || item._id || "Task";
                const pending = Number(item.pending || 0);
                const completed = Number(item.completed || 0);
                const failed = Number(item.failed || 0);
                const total = pending + completed + failed;

                return (
                  <div key={`${category}-${index}`}>
                    <div className="member-row">
                      <div className="stat-icon">
                        {category === "daily" ? (
                          <CalendarDays size={18} />
                        ) : category === "future" ? (
                          <Clock3 size={18} />
                        ) : (
                          <FileText size={18} />
                        )}
                      </div>
                      <div className="member-details">
                        <div className="member-name">
                          {categoryLabel(category)}
                        </div>
                        <div className="member-role">
                          {pending} pending · {completed} completed · {failed}{" "}
                          failed
                        </div>
                      </div>
                      <div className="member-score">{total}</div>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${total ? Math.round((completed / total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ minHeight: 170 }}>
              <div className="empty-icon">
                <ListTodo />
              </div>
              <p className="empty-title">No category summary available</p>
              <p className="empty-description">
                The category breakdown will appear when the analytics API
                returns category statistics.
              </p>
            </div>
          )}

          <hr className="divider" style={{ marginBlock: 20 }} />

          <div className="member-row">
            <div className="stat-icon green">
              <History size={18} />
            </div>
            <div className="member-details">
              <div className="member-name">History records loaded</div>
              <div className="member-role">
                Completed, failed, and deleted tasks
              </div>
            </div>
            <div className="member-score">{historyTasks.length}</div>
          </div>
        </section>
      </div>
    </>
  );
}

function ActivityModal({ task, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      setLoading(true);
      setError("");

      try {
        const response = await api.get(`/tasks/${getTaskId(task)}/activity`);
        const list = unwrapList(response, "events");

        if (!cancelled) setEvents(list);
      } catch (requestError) {
        if (!cancelled) setError(getErrorMessage(requestError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [task]);

  return (
    <Modal title="Task activity" subtitle={task.title} onClose={onClose} wide>
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <AlertCircle size={17} />
          {error}
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 160 }}>
          <div className="empty-icon">
            <Activity />
          </div>
          <p className="empty-title">No activity records returned</p>
          <p className="empty-description">
            Activity appears here when the backend records task changes.
          </p>
        </div>
      ) : (
        <div className="member-list">
          {events.map((event, index) => (
            <div className="member-row" key={event._id || event.id || index}>
              <div className="stat-icon">
                <Activity size={17} />
              </div>
              <div className="member-details">
                <div className="member-name">
                  {String(event.action || "Task activity").replaceAll(".", " ")}
                </div>
                <div className="member-role">
                  {event.actor?.name || event.actorName || "Workspace member"}
                  {event.summary ? ` · ${event.summary}` : ""}
                </div>
                {Array.isArray(event.changes) && event.changes.length > 0 && (
                  <div className="member-role" style={{ marginTop: 5 }}>
                    {event.changes
                      .map(
                        (change) =>
                          `${change.field}: ${change.before ?? "—"} → ${change.after ?? "—"}`,
                      )
                      .join(" · ")}
                  </div>
                )}
              </div>
              <span className="text-muted" style={{ fontSize: 11 }}>
                {formatDate(event.occurredAt || event.createdAt, true)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default App;
