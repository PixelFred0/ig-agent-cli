import { defineCommand } from "citty";
import { existsSync, unlinkSync } from "node:fs";
import { defaultDbPath, openDb } from "../cache/db.ts";
import { printJson } from "../output/json.ts";

const globalArgs = {
  json: { type: "boolean", default: true },
  pretty: { type: "boolean" },
  config: { type: "string" },
  quiet: { type: "boolean" },
} as const;

const clearCmd = defineCommand({
  meta: {
    name: "clear",
    description:
      "Delete all cached media, insights, and sync state. Satisfies Meta's 'delete when no longer needed' data-retention clause.",
  },
  args: {
    ...globalArgs,
    "db-path": { type: "string" },
    confirm: { type: "boolean", description: "Required. Protects against accidental deletion." },
  },
  run({ args }) {
    if (!args.confirm) {
      printJson(
        {
          ok: false,
          error: "Refused: add --confirm to actually delete the cache.",
          db_path: (args["db-path"] as string | undefined) ?? defaultDbPath(),
        },
        Boolean(args.pretty),
      );
      process.exit(1);
    }
    const dbPath = (args["db-path"] as string | undefined) ?? defaultDbPath();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = dbPath + suffix;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    printJson({ ok: true, deleted: dbPath }, Boolean(args.pretty));
  },
});

const statsCmd = defineCommand({
  meta: { name: "stats", description: "Report cache size (row counts + file path)." },
  args: { ...globalArgs, "db-path": { type: "string" } },
  run({ args }) {
    const dbPath = (args["db-path"] as string | undefined) ?? defaultDbPath();
    if (!existsSync(dbPath)) {
      printJson({ exists: false, path: dbPath }, Boolean(args.pretty));
      return;
    }
    const db = openDb({ path: dbPath });
    const counts = {
      accounts: (db.prepare("SELECT COUNT(*) as n FROM accounts").get() as { n: number }).n,
      media: (db.prepare("SELECT COUNT(*) as n FROM media").get() as { n: number }).n,
      insights: (db.prepare("SELECT COUNT(*) as n FROM insights").get() as { n: number }).n,
    };
    db.close();
    printJson({ exists: true, path: dbPath, counts }, Boolean(args.pretty));
  },
});

export const cacheCmd = defineCommand({
  meta: { name: "cache", description: "Inspect or wipe the local SQLite cache." },
  subCommands: { clear: clearCmd, stats: statsCmd },
});
