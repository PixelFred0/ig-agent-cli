import { createConsola } from "consola";

export const logger = createConsola({
  stdout: process.stderr,
  stderr: process.stderr,
  level: 3,
});

export function setQuiet(quiet: boolean): void {
  logger.level = quiet ? 0 : 3;
}

const PATTERNS: Array<[RegExp, string]> = [
  [/(EAA|IGAA|IGQ)[A-Za-z0-9_-]{20,}/g, "[REDACTED_TOKEN]"],
  [/(access_token|client_secret|appsecret_proof|fb_exchange_token|ig_exchange_token|ig_refresh_token)=[^&\s"'`]+/gi, "$1=[REDACTED]"],
  [/("access_token"|"client_secret")\s*:\s*"[^"]+"/gi, '$1:"[REDACTED]"'],
  [/[A-Za-z0-9_-]{80,}/g, "[REDACTED]"],
];

export function redactTokens(input: string): string {
  let out = input;
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out;
}
