// ADM-FR-01 · parse request ở biên bằng zod (spec M1 §3 "Quy ước chung"): VALIDATION_ERROR có `details.issues`,
// `:id` không phải uuid → NOT_FOUND giống hệt id không tồn tại. Tự viết thay @hono/zod-validator (spec §9).
import { SECRET_NAME_RE, UuidSchema, X_CLIENT_EXTENSION, X_CLIENT_HEADER } from "@ai/contracts";
import type { Context } from "hono";
import type { z } from "zod";
import { appError } from "./errors";

export type Issue = { path: (string | number)[]; code: string; message: string };
export type ClientKind = "web" | "extension";

const toPath = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map((p) => (typeof p === "number" ? p : String(p)));

export function validationError(issues: Issue[]) {
  return appError("VALIDATION_ERROR", { issues });
}

export function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({ path: toPath(i.path), code: i.code, message: i.message }));
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(zodIssues(r.error));
  return r.data;
}

/** Đọc body JSON; rỗng = `{}` (POST hành động không body). JSON hỏng → issue `invalid_json`. */
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

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}

export function parseIdParam(c: Context, name = "id"): string {
  const id = c.req.param(name);
  if (!UuidSchema.safeParse(id).success) throw appError("NOT_FOUND");
  return id as string;
}

/** `:name` của secret khớp `SECRET_NAME_RE` nguyên văn (không chuẩn hoá); sai dạng → NOT_FOUND như tên lạ (M2 §3). */
export function parseNameParam(c: Context, name = "name"): string {
  const v = c.req.param(name);
  if (typeof v !== "string" || !SECRET_NAME_RE.test(v)) throw appError("NOT_FOUND");
  return v;
}

/** Chỉ đúng chuỗi `extension` (phân biệt hoa thường, không trim) mới là extension (plan §10 G10). */
export function clientKind(c: Context): ClientKind {
  return c.req.header(X_CLIENT_HEADER) === X_CLIENT_EXTENSION ? "extension" : "web";
}
