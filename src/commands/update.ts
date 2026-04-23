import { defineCommand } from "citty";
import { spawn } from "node:child_process";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { PKG_NAME, PKG_VERSION } from "../lib/pkg.ts";

const REGISTRY_BASE = "https://registry.npmjs.org";

export const updateCmd = defineCommand({
  meta: {
    name: "update",
    description:
      "Check npm for a newer release and, with confirmation, run `npm install -g` to upgrade. User-initiated; never runs in the background.",
  },
  args: {
    json: { type: "boolean", default: true },
    pretty: { type: "boolean" },
    quiet: { type: "boolean" },
    check: { type: "boolean", description: "Only compare versions; don't install." },
    yes: { type: "boolean", description: "Skip the confirmation prompt (non-interactive use)." },
    "dist-tag": {
      type: "string",
      description: "Which npm dist-tag to target (default: latest). Use 'beta' for pre-releases.",
      default: "latest",
    },
  },
  async run({ args }) {
    const distTag = (args["dist-tag"] as string) || "latest";
    const remote = await fetchLatest(distTag);
    const current = PKG_VERSION;
    const upToDate = compareSemver(current, remote) >= 0;

    const report = {
      package: PKG_NAME,
      current,
      latest: remote,
      dist_tag: distTag,
      up_to_date: upToDate,
      update_command: `npm install -g ${PKG_NAME}@${remote}`,
    };

    if (args.check || upToDate) {
      printJson(report, Boolean(args.pretty));
      return;
    }

    if (!args.yes && !process.stdin.isTTY) {
      printJson(
        { ...report, ok: false, error: "Re-run with --yes to install (stdin is not a TTY)." },
        Boolean(args.pretty),
      );
      process.exit(ExitCode.UserError);
    }

    if (!args.yes) {
      const confirmed = await promptYesNo(
        `Upgrade ${PKG_NAME} ${current} → ${remote}? [y/N]: `,
      );
      if (!confirmed) {
        printJson({ ...report, ok: false, error: "Aborted by user." }, Boolean(args.pretty));
        process.exit(ExitCode.UserError);
      }
    }

    const code = await runNpmInstall(remote);
    if (code !== 0) {
      throw new CliError(
        `npm install exited with code ${code}. If this is a permissions error, retry with sudo or use a node version manager that doesn't need it.`,
        ExitCode.ApiError,
      );
    }
    printJson({ ...report, ok: true, installed: remote }, Boolean(args.pretty));
  },
});

async function fetchLatest(distTag: string): Promise<string> {
  const url = `${REGISTRY_BASE}/${encodeURIComponent(PKG_NAME)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new CliError(
      `Failed to query npm registry (${res.status}). Network blocked, or the package isn't published yet.`,
      ExitCode.NetworkError,
    );
  }
  const json = (await res.json()) as { "dist-tags"?: Record<string, string> };
  const tag = json["dist-tags"]?.[distTag];
  if (!tag) {
    throw new CliError(
      `No dist-tag '${distTag}' found. Available tags: ${Object.keys(json["dist-tags"] ?? {}).join(", ") || "(none)"}`,
      ExitCode.UserError,
    );
  }
  return tag;
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // Pre-release: 1.0.0-beta < 1.0.0
  const prA = a.includes("-") ? a.split("-", 2)[1]! : "";
  const prB = b.includes("-") ? b.split("-", 2)[1]! : "";
  if (prA === prB) return 0;
  if (!prA) return 1;
  if (!prB) return -1;
  return prA < prB ? -1 : 1;
}

function parseSemver(v: string): number[] {
  const core = v.split("-", 1)[0] ?? v;
  return core.split(".").map((x) => Number.parseInt(x, 10) || 0);
}

function runNpmInstall(version: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", `${PKG_NAME}@${version}`], {
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(127));
  });
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const answer = buf.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
