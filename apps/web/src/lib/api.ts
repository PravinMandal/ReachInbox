import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // No response at all (API down, proxy dead): say so plainly instead of a
    // cryptic 500 from the dev proxy — this exact case bit us in testing.
    if (!err?.response) return Promise.reject(new Error("Server unreachable — is the API running?"));
    const msg = err?.response?.data?.error?.message ?? err.message ?? "Request failed";
    return Promise.reject(new Error(msg));
  },
);
