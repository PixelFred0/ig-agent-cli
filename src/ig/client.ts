import { z } from "zod";
import { ExitCode, type ExitCodeValue } from "../lib/exit-codes.ts";
import { RateLimiter, backoff, perHour, systemClock, type Clock } from "../lib/rate-limit.ts";
import { GraphErrorSchema } from "./schemas.ts";

export const IG_GRAPH_BASE = "https://graph.instagram.com";
export const IG_OAUTH_BASE = "https://api.instagram.com";
export const IG_DIALOG_URL = "https://www.instagram.com/oauth/authorize";

export class IgApiError extends Error {
  constructor(
    message: string,
    public readonly exitCode: ExitCodeValue,
    public readonly graphCode?: number,
    public readonly subcode?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "IgApiError";
  }
}

type FetchFn = typeof fetch;

export interface IgClientOptions {
  token: string;
  accountKey?: string;
  fetchFn?: FetchFn;
  limiter?: RateLimiter;
  clock?: Clock;
  maxRetries?: number;
}

const RETRIABLE_GRAPH_CODES = new Set([4, 17, 32, 613]);

export class IgClient {
  private readonly fetchFn: FetchFn;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;

  constructor(private readonly opts: IgClientOptions) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.limiter = opts.limiter ?? new RateLimiter(perHour(200));
    this.clock = opts.clock ?? systemClock;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  get<T>(path: string, params: Record<string, string | number | undefined> = {}, schema?: z.ZodSchema<T>): Promise<T> {
    return this.request<T>("GET", path, params, schema);
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | undefined>,
    schema?: z.ZodSchema<T>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    const key = this.opts.accountKey ?? "global";

    let attempt = 0;
    for (;;) {
      await this.limiter.take(key);
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers: { Authorization: `Bearer ${this.opts.token}` },
        });
      } catch (e) {
        if (attempt >= this.maxRetries) {
          throw new IgApiError(
            `Network error: ${e instanceof Error ? e.message : String(e)}`,
            ExitCode.NetworkError,
          );
        }
        await backoff(attempt++, this.clock);
        continue;
      }

      if (res.ok) {
        const body = (await res.json()) as unknown;
        return schema ? schema.parse(body) : (body as T);
      }

      const errBody = await this.readErrorBody(res);
      const graph = errBody?.error;
      const graphCode = graph?.code;
      const subcode = graph?.error_subcode;
      const message = graph?.message ?? `HTTP ${res.status}`;

      if (res.status === 429 || (graphCode !== undefined && RETRIABLE_GRAPH_CODES.has(graphCode))) {
        if (attempt >= this.maxRetries) {
          throw new IgApiError(message, ExitCode.RateLimited, graphCode, subcode, res.status);
        }
        await backoff(attempt++, this.clock);
        continue;
      }

      if (res.status === 401 || graphCode === 190) {
        throw new IgApiError(message, ExitCode.AuthExpired, graphCode, subcode, res.status);
      }

      if (res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new IgApiError(message, ExitCode.NetworkError, graphCode, subcode, res.status);
        }
        await backoff(attempt++, this.clock);
        continue;
      }

      throw new IgApiError(message, ExitCode.ApiError, graphCode, subcode, res.status);
    }
  }

  private buildUrl(path: string, params: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : `${IG_GRAPH_BASE}${path.startsWith("/") ? "" : "/"}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async readErrorBody(res: Response): Promise<{ error?: import("./schemas.ts").GraphError } | null> {
    try {
      const body = (await res.json()) as unknown;
      const parsed = z.object({ error: GraphErrorSchema.optional() }).safeParse(body);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
