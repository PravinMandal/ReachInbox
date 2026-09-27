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
    const msg = err?.response?.data?.error?.message ?? err.message ?? "Request failed";
    return Promise.reject(new Error(msg));
  },
);
