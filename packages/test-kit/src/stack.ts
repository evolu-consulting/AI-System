// TK1 · bootStack: DB từ template -> (fixture) -> app in-process (Bun.serve cổng 0). Kit không biết app nào: test truyền `createApp`.
// Ổn định khi tải cao (TECH-DEBT #208): mọi tài nguyên đã mở được đóng ở `close()` kể cả khi bước sau ném lỗi giữa chừng;
// `close()` idempotent; thứ tự đóng ngược thứ tự mở.
import { cloneDb, openOwner, type Sql, type Template } from "./db";

type Fetcher = { fetch: (req: Request) => Response | Promise<Response> };

export type StackOpts<A extends Fetcher> = {
  template?: Template;
  /** Dựng dữ liệu nền bằng owner, chạy sau clone. */
  fixture?: (owner: Sql) => Promise<void>;
  /** Dựng app. Trả thêm `stop` nếu app giữ tài nguyên (pool, redis, AbortController). */
  createApp?: () =>
    | Promise<{ app: A; stop?: () => Promise<void> }>
    | { app: A; stop?: () => Promise<void> };
  ownerPool?: number;
};

export type Stack<A extends Fetcher = Fetcher> = {
  owner: Sql;
  /** Gốc URL của app (có khi truyền `createApp`). */
  base: string;
  app: A | undefined;
  /** Gọi app không qua mạng. */
  call: (
    method: string,
    path: string,
    init?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<{
    status: number;
    headers: Headers;
    text: string;
    json: unknown;
  }>;
  close: () => Promise<void>;
};

export async function bootStack<A extends Fetcher = Fetcher>(
  o: StackOpts<A> = {},
): Promise<Stack<A>> {
  const closers: Array<() => Promise<void>> = [];
  const close = async (): Promise<void> => {
    for (const c of closers.splice(0).reverse()) await c().catch(() => undefined);
  };
  try {
    await cloneDb(o.template ?? "full");
    const owner = openOwner(o.ownerPool ?? 4, o.template ?? "full");
    closers.push(() => owner.end({ timeout: 2 }));
    if (o.fixture) await o.fixture(owner);
    let app: A | undefined;
    let base = "";
    if (o.createApp) {
      const made = await o.createApp();
      app = made.app;
      if (made.stop) closers.push(made.stop);
      const server = Bun.serve({ port: 0, fetch: made.app.fetch, idleTimeout: 0 });
      closers.push(async () => {
        await server.stop(true);
      });
      base = `http://localhost:${server.port}`;
    }
    const call: Stack<A>["call"] = async (method, path, init = {}) => {
      if (!app) throw new Error("bootStack: chưa truyền createApp");
      const headers = new Headers(init.headers);
      if (init.token) headers.set("authorization", `Bearer ${init.token}`);
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      if (body !== undefined) headers.set("content-type", "application/json");
      const res = await app.fetch(
        new Request(`http://localhost${path}`, { method, headers, body }),
      );
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, headers: res.headers, text, json };
    };
    let closed: Promise<void> | undefined;
    return { owner, base, app, call, close: () => (closed ??= close()) };
  } catch (e) {
    await close();
    throw e;
  }
}
