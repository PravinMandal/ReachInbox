/** Vercel serverless entry — re-exports the Express app (no `app.listen`). */
import app from "./index.js";
import { initSearch } from "./app.js";

initSearch();

export default app;
