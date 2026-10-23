import vinext from "vinext";
import { defineConfig } from "vite";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";

// Local-only binding. Provision a separate database before any external deployment.
export default defineConfig(async () => {
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    server: { host: "127.0.0.1" },
    plugins: [vinext(), cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, inspectorPort: false,
      config: {
        name: "entitywiki-registry-staging",
        main: "./worker/index.ts",
        compatibility_date: "2026-10-23",
        compatibility_flags: ["nodejs_compat"],
        observability: { enabled: true, traces: { enabled: true } },
        d1_databases: [{ binding: "DB", database_name: "entitywiki-registry-local", database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: "./drizzle" }],
      },
    })],
  };
});
