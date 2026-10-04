// HUB-FR-40 · H1-R03 · parse request ở biên bằng zod (C1 plan §2.4): VALIDATION_ERROR có `details.issues`;
// `:id` không phải uuid → NOT_FOUND giống hệt id không tồn tại; `tenant_id`/`user_id` trong query bị bỏ (A7).
// Cùng cách làm `apps/admin-api/src/lib/http.ts` (chép, không import chéo app).
import { UuidSchema } from "@ai/contracts";
import type { Context } from "hono";
import type { z } from "zod";
import { appError } from "./errors";

export type Issue = { path: (string | number)[]; code: string; message: string };

/** Khoá phạm vi chỉ lấy từ JWT (H1-R03): có trong query thì bỏ qua, có trong body thì schema strict trả 400. */
const SCOPE_QUERY_KEYS = new Set(["tenant_id", "user_id"]);

const toPath = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map((p) => (typeof p === "number" ? p : String(p)));

export function validationError(issues: Issue[]) {
  return appError("VALIDATION_ERROR", { issues });
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw validationError(
    r.error.issues.map((i) => ({ path: toPath(i.path), code: i.code, message: i.message })),
  );
}

/** Body JSON; rỗng = `{}`. JSON hỏng → issue `invalid_json`. */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError([{ path: [], code: "invalid_json", message: "Malformed JSON body" }]);
  }
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  return parseWith(schema, await readJson(c));
}

/** Query bỏ `tenant_id`/`user_id` (thuần, để test). */
export function withoutScopeKeys(q: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter(([k]) => !SCOPE_QUERY_KEYS.has(k)));
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseWith(schema, withoutScopeKeys(c.req.query()));
}

export function parseIdParam(c: Context, name = "id"): string {
  const id = c.req.param(name);
  if (!UuidSchema.safeParse(id).success) throw appError("NOT_FOUND");
  return id as string;
}
