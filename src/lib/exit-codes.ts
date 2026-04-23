import { logger } from "./logger.ts";

export const ExitCode = {
  Success: 0,
  UserError: 1,
  ApiError: 2,
  RateLimited: 3,
  AuthExpired: 4,
  NetworkError: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
  constructor(
    message: string,
    public code: ExitCodeValue,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function exitWith(code: ExitCodeValue, err?: unknown): never {
  if (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
  }
  process.exit(code);
}
