import { defineCommand, runCommand, showUsage } from "citty";
import { authCmd } from "./commands/auth.ts";
import { accountCmd } from "./commands/account.ts";
import { mediaCmd } from "./commands/media.ts";
import { insightsCmd } from "./commands/insights.ts";
import { syncCmd } from "./commands/sync.ts";
import { exportCmd } from "./commands/export.ts";
import { cacheCmd } from "./commands/cache.ts";
import { CliError, ExitCode, type ExitCodeValue } from "./lib/exit-codes.ts";
import { IgApiError } from "./ig/client.ts";
import { redactTokens, setQuiet, logger } from "./lib/logger.ts";
import { updateCmd } from "./commands/update.ts";
import { PKG_NAME, PKG_VERSION } from "./lib/pkg.ts";

const pkgVersion = PKG_VERSION;

const main = defineCommand({
  meta: {
    name: PKG_NAME,
    version: pkgVersion,
    description: "Read-only Instagram CLI (graph.instagram.com) for AI agents.",
  },
  args: {
    quiet: { type: "boolean", description: "Suppress log output (stderr)" },
  },
  subCommands: {
    auth: authCmd,
    account: accountCmd,
    media: mediaCmd,
    insights: insightsCmd,
    sync: syncCmd,
    export: exportCmd,
    cache: cacheCmd,
    update: updateCmd,
  },
});

process.on("unhandledRejection", (err) => {
  handleError(err);
});

process.on("uncaughtException", (err) => {
  handleError(err);
});

function handleError(err: unknown): never {
  let code: ExitCodeValue = ExitCode.ApiError;
  let message: string;
  if (err instanceof CliError) {
    code = err.code;
    message = err.message;
  } else if (err instanceof IgApiError) {
    code = err.exitCode;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(message)) code = ExitCode.NetworkError;
  } else {
    message = String(err);
  }
  logger.error(redactTokens(message));
  process.exit(code);
}

if (process.argv.includes("--quiet")) setQuiet(true);

const rawArgs = process.argv.slice(2);

async function resolveSubCommand(cmd: any, args: string[]): Promise<{ cmd: any; parent: any }> {
  let current = cmd;
  let parent = cmd;
  for (const token of args) {
    if (token.startsWith("-")) break;
    const subs = typeof current.subCommands === "function" ? await current.subCommands() : current.subCommands;
    if (!subs || !subs[token]) break;
    parent = current;
    current = typeof subs[token] === "function" ? await subs[token]() : subs[token];
  }
  return { cmd: current, parent };
}

if (rawArgs.length === 0) {
  await showUsage(main, undefined);
  process.exit(0);
}

if (rawArgs[0] === "--version" || rawArgs[0] === "-v") {
  process.stdout.write(pkgVersion + "\n");
  process.exit(0);
}

if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  const resolved = await resolveSubCommand(main, rawArgs);
  await showUsage(resolved.cmd, resolved.cmd === main ? undefined : resolved.parent);
  process.exit(0);
}

try {
  await runCommand(main, { rawArgs, showUsage: false });
} catch (err) {
  handleError(err);
}
