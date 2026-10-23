import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "The registry D1 binding `DB` is unavailable. Build and migrate the isolated local database, or configure a separate production database before using the registry."
    );
  }

  return drizzle(env.DB, { schema });
}
