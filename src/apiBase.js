export const API_BASE = import.meta.env.DEV
  ? "http://localhost:4000"
  : import.meta.env.VITE_API_BASE_URL;