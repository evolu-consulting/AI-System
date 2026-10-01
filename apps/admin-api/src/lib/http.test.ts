// ADM-FR-01 · parse ở biên: VALIDATION_ERROR có issues, JSON hỏng, uuid sai → 404, X-Client đúng chuỗi.
import { describe, expect, test } from "bun:test";
import type { ErrorResponse } from "@ai/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, toErrorBody } from "./errors";
import { clientKind, parseIdParam, parseJson, parseQuery } from "./http";

function app() {
  const a = new Hono();
  a.onError((e, c) =>
    e instanceof AppError
      ? c.json(toErrorBody(e.code, e.message, e.details), e.status)
      : c.text("x", 500),
  );
  a.post("/j", async (c) => c.json(await parseJson(c, z.strictObject({ n: z.number() }))));
  a.get("/q", (c) => c.json(parseQuery(c, z.strictObject({ a: z.string().optional() }))));
  a.get("/i/:id", (c) => c.text(parseIdParam(c)));
  a.get("/x", (c) => c.text(clientKind(c)));
  return a;
}

describe("ADM-FR-01 · lib/http", () => {
  test("ADM-FR-01 · body hợp lệ / trường lạ / JSON hỏng", async () => {
    const a = app();
    const post = (body: string) => a.request("/j", { method: "POST", body });
    expect(await (await post(JSON.stringify({ n: 1 }))).json()).toEqual({ n: 1 });
    const extra = (await (await post(JSON.stringify({ n: 1, z: 2 }))).json()) as ErrorResponse;
    const issues = (extra.error.details as { issues: { code: string }[] }).issues;
    expect(extra.error.code).toBe("VALIDATION_ERROR");
    expect(issues[0]?.code).toBe("unrecognized_keys");
    const bad = (await (await post("{x")).json()) as ErrorResponse;
    expect((bad.error.details as { issues: unknown }).issues).toEqual([
      { path: [], code: "invalid_json", message: "Malformed JSON body" },
    ]);
  });

  test("ADM-FR-01 · query strict; id sai uuid → 404 giống notFound", async () => {
    const a = app();
    expect((await a.request("/q?b=1")).status).toBe(400);
    const nf = await a.request("/i/abc");
    expect(nf.status).toBe(404);
    expect(await nf.text()).toBe(JSON.stringify(toErrorBody("NOT_FOUND", "Not found")));
    const id = "01900000-0000-7000-8000-000000000001";
    expect(await (await a.request(`/i/${id}`)).text()).toBe(id);
  });

  test("ADM-FR-02 · X-Client chỉ đúng chuỗi extension", async () => {
    const a = app();
    const kind = async (v?: string) =>
      (await a.request("/x", { headers: v === undefined ? {} : { "X-Client": v } })).text();
    expect(await kind("extension")).toBe("extension");
    for (const v of ["Extension", "web", undefined]) expect(await kind(v)).toBe("web");
  });
});
