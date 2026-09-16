import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { drizzle as netlifyDrizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

// The database is Neon either way: Netlify's own driver injects its connection at
// runtime, and anywhere else — Vercel, a script, a test — reaches the same database
// through DATABASE_URL. Keeping both here is what lets a function run on either
// platform unchanged while the site moves across.
const url = process.env.DATABASE_URL;

export const db = url ? neonDrizzle(url, { schema }) : netlifyDrizzle({ schema });

/// Which connection answered, for the health check to report.
export const dbHost = url ? "neon" : "netlify";
