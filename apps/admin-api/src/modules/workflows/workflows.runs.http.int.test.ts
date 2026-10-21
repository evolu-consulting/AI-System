// dify-workflows · int HTTP: GET /admin/workflows/:id/runs chỉ platform_admin (tenant_admin 403, chưa đăng nhập 401, trước khi
// parse); platform_admin → 200 đúng schema (DB mẫu Admin chưa có bảng Hub ⇒ available=false, không 500); PATCH/GET dify_app_id.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DifyRunsResponseSchema, WorkflowSchema } from "@ai/contracts";
import { ALL_CATALOG, ID } from "../../../../../tests/acceptance/M2/_data";
import { createM2Env, expectErr, type M2Env } from "../../../../../tests/acceptance/M2/_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});

const runs = `/admin/workflows/${ID.workflow}/runs`;

describe("dify-workflows · quyền và hợp đồng", () => {
  it("tenant_admin 403 (kể cả query sai), không token 401; platform_admin 200 DifyRunsResponse", async () => {
    expectErr(await env.get(runs, { token: await env.token("acme", "binh") }), "FORBIDDEN");
    expectErr(
      await env.get(`${runs}?limit=0`, { token: await env.token("acme", "binh") }),
      "FORBIDDEN",
    );
    expect((await env.get(runs)).status).toBe(401);
    const ok = await env.get(`${runs}?status=failed&limit=5`, { token: await env.admin() });
    expect(ok.status).toBe(200);
    expect(DifyRunsResponseSchema.parse(ok.json)).toEqual({
      items: [],
      total: 0,
      available: false,
    });
    expect((await env.get(`${runs}?limit=999`, { token: await env.admin() })).status).toBe(400);
  });

  it("dify_app_id: đặt/xoá qua PATCH, trả ở chi tiết; sai định dạng → 400; usage?workflow_id của tenant_admin → 403", async () => {
    const token = await env.admin();
    const w0 = WorkflowSchema.parse(
      (await env.get(`/admin/workflows/${ID.workflow}`, { token })).json,
    );
    const app = "0b9f2c1e-1111-4222-8333-444455556666";
    const set = await env.patch(`/admin/workflows/${ID.workflow}`, {
      token,
      body: { version: w0.version, dify_app_id: app },
    });
    expect(set.status).toBe(200);
    const w1 = WorkflowSchema.parse(set.json);
    expect(w1.dify_app_id).toBe(app);
    const bad = await env.patch(`/admin/workflows/${ID.workflow}`, {
      token,
      body: { version: w1.version, dify_app_id: "../x" },
    });
    expect(bad.status).toBe(400);
    const clear = await env.patch(`/admin/workflows/${ID.workflow}`, {
      token,
      body: { version: w1.version, dify_app_id: null },
    });
    expect(WorkflowSchema.parse(clear.json).dify_app_id).toBeNull();
    const usage = await env.get(`/admin/usage?workflow_id=${ID.workflow}`, {
      token: await env.token("acme", "binh"),
    });
    expectErr(usage, "FORBIDDEN");
  });
});
