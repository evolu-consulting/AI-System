// ADM-NFR-06 · drizzle-kit chỉ sinh migration cho schema `admin`; `hub` do Agent Hub sở hữu.
import { defineConfig } from "drizzle-kit";
import { loadDbEnv } from "./src/env";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/schema/admin.ts",
    "./src/schema/permissions.ts",
    "./src/schema/ops.ts",
    "./src/schema/totp.ts",
  ],
  out: "./migrations",
  schemaFilter: ["admin"],
  dbCredentials: { url: loadDbEnv(process.env).DATABASE_URL },
});
