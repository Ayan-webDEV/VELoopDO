import axios from "axios";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/+$/, "");

const TOKEN_KEY = "veloopdo_token";

export function getAuthToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    throw new Error(
      "Unable to access browser storage. Check your browser privacy settings.",
    );
  }
}

export function clearAuthToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage may be unavailable in restricted browser environments.
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url || "";
    const isAuthenticationRequest =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/change-password");

    if (status === 401 && !isAuthenticationRequest) {
      clearAuthToken();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("veloopdo:session-expired"));
      }
    }

    const serverMessage = error.response?.data?.message;

    const message =
      serverMessage ||
      (status === 401
        ? "Your session has expired. Please sign in again."
        : status === 403
          ? "You do not have permission to perform this action."
          : status === 404
            ? "The requested resource could not be found."
            : status >= 500
              ? "The server encountered an error. Please try again."
              : error.code === "ECONNABORTED"
                ? "The request timed out. Please try again."
                : !error.response
                  ? "Unable to connect to VELoopDO. Check that the backend is running."
                  : "Something went wrong. Please try again.");

    return Promise.reject(
      Object.assign(new Error(message), {
        status,
        data: error.response?.data,
        originalError: error,
      }),
    );
  },
);

export default api;
