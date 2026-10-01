// ADM-FR-50, ADM-BR-04, ADM-BR-14 · /admin/secrets* (spec M2 §3). Chỉ platform_admin (kiểm role trước khi parse/tra).
// `VALIDATION_ERROR` ở đây dùng message TĨNH theo `code` (G12): không bao giờ echo input hay tên khoá lạ.
import {
  SecretCreateRequestSchema,
  SecretListQuerySchema,
  SecretNoteRequestSchema,
  SecretReplaceRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { type Issue, parseNameParam, readJson, validationError } from "../../lib/http";
import {
  type Call,
  createSecret,
  deleteSecret,
  listSecrets,
  replaceSecret,
  type SecretsCtx,
  updateSecretNote,
} from "./secrets.service";

function staticIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) =>
    i.code === "unrecognized_keys"
      ? { path: [], code: i.code, message: "unrecognized keys" }
      : {
          path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
          code: i.code,
          message: i.code.replace(/_/g, " "),
        },
  );
}

function parseSecret<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(staticIssues(r.error));
  return r.data;
}

const parseSecretBody = async <S extends z.ZodType>(c: Context, schema: S) =>
  parseSecret(schema, await readJson(c));

export function secretsRoutes(d: AuthDeps & SecretsCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) =>
    c.json(await listSecrets(call(c), parseSecret(SecretListQuerySchema, c.req.query()))),
  );
  r.post("/", async (c) => {
    const input = await parseSecretBody(c, SecretCreateRequestSchema);
    return c.json(await createSecret(call(c), input), 201);
  });
  r.put("/:name", async (c) => {
    const name = parseNameParam(c);
    const { value } = await parseSecretBody(c, SecretReplaceRequestSchema);
    return c.json(await replaceSecret(call(c), name, value));
  });
  r.patch("/:name", async (c) => {
    const name = parseNameParam(c);
    const input = await parseSecretBody(c, SecretNoteRequestSchema);
    return c.json(await updateSecretNote(call(c), name, input));
  });
  r.delete("/:name", async (c) => {
    await deleteSecret(call(c), parseNameParam(c));
    return c.body(null, 204);
  });
  return r;
}
