// HUB-FR-67 · HUB-FR-69 · AC-H4b2-03 · AC-H4b2-07 (vế Studio `active_step`) · spec H4b2 §3 B · plan §3.3 · test-plan H4b2
// §3 P01–P14: CRUD model profile qua hub-api thật — thứ tự bước lưu đúng, lỗi bước (not_found/readonly/duplicate), 1..5
// bước, KEY_TAKEN, key bất biến, VERSION_CONFLICT, steps giống hệt ⇒ không bump, PROFILE_IN_USE, list thêm `version`,
// `active_step` (= pickStep theo `enabled` + `provider_state` lúc đọc), `all_subscription`, `agent_count`.
// Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PROFILE } from "../H1/_hub";
import {
  apiBody,
  auditMax,
  auditSince,
  type Ctx,
  cfgState,
  clearState,
  errOf,
  expectSchema,
  hubConfigChange,
  type Json,
  mkProfile,
  mkProvider,
  NONE,
  pa,
  pathsOf,
  profileRow,
  type Res,
  SEC,
  setState,
  startH4b2,
  step,
  subBody,
  versionOf,
} from "./_h4b2";

let x: Ctx;
beforeAll(async () => {
  x = await startH4b2();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

async function noWrite(f: () => Promise<Res>, status: number, code: string): Promise<Res> {
  const s0 = await cfgState(x.sql);
  const r = await f();
  expect([r.status, errOf(r).code]).toEqual([status, code]);
  expect(await cfgState(x.sql)).toEqual(s0);
  return r;
}
const listItem = async (key: string): Promise<Json> => {
  const r = await pa(x, "GET", "/model-profiles");
  expect(r.status).toBe(200);
  return r.json.items.find((i: Json) => i.key === key);
};
const FUT = "2099-01-01T00:00:00Z";

describe("P01–P05 · tạo + sửa thứ tự [AC-H4b2-03 · spec §3 B]", () => {
  it("HUB-FR-67 · AC-H4b2-03 · P01 · POST 2 bước ⇒ 201 ModelProfile v1, steps đúng thứ tự, all_subscription, agent_count 0, used_by_agents []; audit create + version +1", async () => {
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    const steps = [step("claude-sub", ["quota", "error"], "claude-sonnet"), step("fake-cli")];
    const r = await pa(x, "POST", "/model-profiles", { key: "qc-p01", steps });
    expect(r.status).toBe(201);
    await expectSchema("ModelProfileSchema", r.json);
    expect(r.json).toMatchObject({
      key: "qc-p01",
      steps,
      version: 1,
      all_subscription: true,
      agent_count: 0,
      used_by_agents: [],
      active_step: 0,
    });
    expect((await profileRow(x.sql, "qc-p01"))?.steps).toEqual(steps);
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    const [a] = await auditSince(x.sql, m, { entityId: r.json.id });
    expect(a).toMatchObject({ entity: "model_profile", action: "create", entity_name: "qc-p01" });
  });

  it("HUB-FR-67 · AC-H4b2-03 · P02 · PUT đảo thứ tự (kéo-thả / Lên-Xuống) ⇒ v2, GET :id + DB đúng thứ tự mới; audit update before/after steps", async () => {
    const a = step("claude-sub", ["quota"]);
    const b = step("fake-cli", ["error"]);
    const p = await mkProfile(x, "qc-p02", [a, b]);
    const m = await auditMax(x.sql);
    const r = await pa(x, "PUT", `/model-profiles/${p.id}`, { version: 1, steps: [b, a] });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ version: 2, steps: [b, a] });
    expect((await pa(x, "GET", `/model-profiles/${p.id}`)).json?.steps).toEqual([b, a]);
    expect((await profileRow(x.sql, "qc-p02"))?.steps).toEqual([b, a]);
    const [u] = await auditSince(x.sql, m, { entityId: p.id, action: "update" });
    expect(u?.before?.steps).toEqual([a, b]);
    expect(u?.after?.steps).toEqual([b, a]);
  });

  it("HUB-FR-67 · P03 · PUT steps giống hệt ⇒ 200 cùng version; không bump, không audit", async () => {
    const steps = [step("fake-cli")];
    const p = await mkProfile(x, "qc-p03", steps);
    const s0 = await cfgState(x.sql);
    const r = await pa(x, "PUT", `/model-profiles/${p.id}`, { version: 1, steps });
    expect([r.status, r.json?.version]).toEqual([200, 1]);
    expect(await cfgState(x.sql)).toEqual(s0);
  });

  it("HUB-FR-67 · P04 · PUT version cũ ⇒ 409 VERSION_CONFLICT{current, updated_at}; PUT có key ⇒ 400; id lạ ⇒ 404; 0 ghi", async () => {
    const p = await mkProfile(x, "qc-p04", [step("fake-cli")]);
    expect(
      (await pa(x, "PUT", `/model-profiles/${p.id}`, { version: 1, steps: [step("claude-sub")] }))
        .status,
    ).toBe(200);
    const r = await noWrite(
      () => pa(x, "PUT", `/model-profiles/${p.id}`, { version: 1, steps: [step("fake-cli")] }),
      409,
      "VERSION_CONFLICT",
    );
    expect(errOf(r).details?.current).toMatchObject({ id: p.id, version: 2 });
    expect(typeof errOf(r).details?.updated_at).toBe("string");
    await noWrite(
      () =>
        pa(x, "PUT", `/model-profiles/${p.id}`, {
          version: 2,
          key: "qc-p04-x",
          steps: [step("fake-cli")],
        }),
      400,
      "VALIDATION_ERROR",
    );
    await noWrite(
      () => pa(x, "PUT", `/model-profiles/${NONE}`, { version: 1, steps: [step("fake-cli")] }),
      404,
      "NOT_FOUND",
    );
  });

  it("HUB-FR-67 · P05 · provider đang tắt vẫn chọn được làm bước ⇒ 201", async () => {
    const d = await mkProvider(x, subBody("qc-p05-off", { enabled: false }));
    expect(d.enabled).toBe(false);
    await mkProfile(x, "qc-p05", [step("qc-p05-off", ["error"]), step("fake-cli")]);
  });
});

describe("P06–P09 · lỗi bước [spec §3 B stepsProblem · Q8]", () => {
  it("HUB-FR-67 · P06 · provider không có ⇒ 400 INVALID_REFERENCE{steps, index 1, not_found}; dify ⇒ {index 0, readonly}; 0 ghi", async () => {
    const a = await noWrite(
      () =>
        pa(x, "POST", "/model-profiles", {
          key: "qc-p06-a",
          steps: [step("fake-cli"), step("khong-co")],
        }),
      400,
      "INVALID_REFERENCE",
    );
    expect(errOf(a).details).toMatchObject({ field: "steps", index: 1, reason: "not_found" });
    const b = await noWrite(
      () =>
        pa(x, "POST", "/model-profiles", {
          key: "qc-p06-b",
          steps: [step("dify"), step("fake-cli")],
        }),
      400,
      "INVALID_REFERENCE",
    );
    expect(errOf(b).details).toMatchObject({ field: "steps", index: 0, reason: "readonly" });
  });

  it("HUB-FR-67 · P07 · trùng (provider, model) ⇒ 400 VALIDATION_ERROR path steps.1; `on` trùng ⇒ path steps.0; 0 ghi", async () => {
    const a = await noWrite(
      () =>
        pa(x, "POST", "/model-profiles", {
          key: "qc-p07-a",
          steps: [step("fake-cli", [], "m1"), step("fake-cli", [], "m1")],
        }),
      400,
      "VALIDATION_ERROR",
    );
    expect(pathsOf(a)).toEqual(["steps.1"]);
    const b = await noWrite(
      () =>
        pa(x, "POST", "/model-profiles", {
          key: "qc-p07-b",
          steps: [step("claude-sub", ["quota", "quota"]), step("fake-cli")],
        }),
      400,
      "VALIDATION_ERROR",
    );
    expect(pathsOf(b)[0]).toMatch(/^steps\.0/);
  });

  it("HUB-FR-67 · P08 · 0 bước / 6 bước / key sai ⇒ 400; key đã có (fake-1) ⇒ 409 KEY_TAKEN; 0 ghi", async () => {
    const six = ["fake-cli", "claude-sub"].flatMap((p) =>
      ["m1", "m2", "m3"].map((mm) => step(p, [], mm)),
    );
    for (const body of [
      { key: "qc-p08-a", steps: [] },
      { key: "qc-p08-b", steps: six },
      { key: "QC P08", steps: [step("fake-cli")] },
    ])
      await noWrite(() => pa(x, "POST", "/model-profiles", body), 400, "VALIDATION_ERROR");
    await noWrite(
      () => pa(x, "POST", "/model-profiles", { key: "fake-1", steps: [step("fake-cli")] }),
      409,
      "KEY_TAKEN",
    );
  });

  it("HUB-FR-67 · P09 · DELETE profile agent đang dùng (fake-1) ⇒ 409 PROFILE_IN_USE{agents:[{id,key}]}; profile rảnh ⇒ 204 + audit delete", async () => {
    const r = await noWrite(
      () => pa(x, "DELETE", `/model-profiles/${PROFILE.fake}?version=1`),
      409,
      "PROFILE_IN_USE",
    );
    const keys = ((errOf(r).details?.agents ?? []) as { key: string }[]).map((a) => a.key);
    expect(keys).toContain("hoadon");
    const p = await mkProfile(x, "qc-p09", [step("fake-cli")]);
    const m = await auditMax(x.sql);
    expect((await pa(x, "DELETE", `/model-profiles/${p.id}?version=1`)).status).toBe(204);
    expect(await profileRow(x.sql, "qc-p09")).toBeUndefined();
    expect((await auditSince(x.sql, m, { entityId: p.id })).map((a) => a.action)).toEqual([
      "delete",
    ]);
    await noWrite(() => pa(x, "DELETE", `/model-profiles/${NONE}?version=1`), 404, "NOT_FOUND");
  });
});

describe("P10–P14 · list: version, agent_count, all_subscription, active_step [spec §3 B · AC-H4b2-07]", () => {
  it("HUB-FR-67 · P10 · fake-1: version ≥ 1, agent_count = số agent trỏ tới, all_subscription true; hợp ModelProfileListSchema", async () => {
    const r = await pa(x, "GET", "/model-profiles");
    await expectSchema("ModelProfileListSchema", r.json);
    const [n] = await x.sql<{ n: number }[]>`select count(*)::int as n from hub.agents
      where profile_id = ${PROFILE.fake}`;
    expect(await listItem("fake-1")).toMatchObject({
      agent_count: n?.n ?? -1,
      all_subscription: true,
    });
    expect((await listItem("fake-1"))?.version).toBeGreaterThanOrEqual(1);
  });

  it("HUB-FR-67 · P11 · profile có bước api ⇒ all_subscription false", async () => {
    await mkProvider(x, apiBody("qc-p11-api", { secret_id: SEC.ok }));
    await mkProfile(x, "qc-p11", [step("claude-sub", ["quota"]), step("qc-p11-api")]);
    expect((await listItem("qc-p11"))?.all_subscription).toBe(false);
  });

  it("HUB-FR-67 · AC-H4b2-07 · P12 · active_step: không state ⇒ 0; bước 0 cooldown + on [quota] ⇒ 1; on [] ⇒ null", async () => {
    await mkProvider(x, subBody("qc-p12-a"));
    await mkProvider(x, subBody("qc-p12-b"));
    await mkProfile(x, "qc-p12-skip", [step("qc-p12-a", ["quota"]), step("qc-p12-b")]);
    await mkProfile(x, "qc-p12-stop", [step("qc-p12-a"), step("qc-p12-b")]);
    expect((await listItem("qc-p12-skip"))?.active_step).toBe(0);
    await setState(x.sql, "qc-p12-a", { status: "cooldown", cooldown: FUT });
    try {
      expect((await listItem("qc-p12-skip"))?.active_step).toBe(1);
      expect((await listItem("qc-p12-stop"))?.active_step).toBeNull();
    } finally {
      await clearState(x.sql, "qc-p12-a");
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · P13 · active_step: bước 0 provider tắt ⇒ 1 (vô điều kiện); bước 0 logged_out + on [error] ⇒ 1", async () => {
    const off = await mkProvider(x, subBody("qc-p13-off"));
    await mkProvider(x, subBody("qc-p13-lo"));
    await mkProfile(x, "qc-p13-a", [step("qc-p13-off"), step("fake-cli")]);
    await mkProfile(x, "qc-p13-b", [step("qc-p13-lo", ["error"]), step("fake-cli")]);
    expect(
      (await pa(x, "PATCH", `/providers/${off.id}/enabled`, { version: 1, enabled: false })).status,
    ).toBe(200);
    await setState(x.sql, "qc-p13-lo", { status: "logged_out" });
    expect((await listItem("qc-p13-a"))?.active_step).toBe(1);
    expect((await listItem("qc-p13-b"))?.active_step).toBe(1);
  });

  it("HUB-FR-67 · P14 · GET :id: used_by_agents ≤ 50 {id,key} của agent trỏ tới; id lạ ⇒ 404", async () => {
    const [ag] = await x.sql<{ id: string }[]>`select id from hub.agents where key = 'hoadon'`;
    const p = await mkProfile(x, "qc-p14", [step("fake-cli")]);
    await hubConfigChange(
      x.sql,
      (tx) => tx`update hub.agents set profile_id = ${p.id} where id = ${ag?.id ?? NONE}`,
    );
    try {
      const r = await pa(x, "GET", `/model-profiles/${p.id}`);
      expect(r.json).toMatchObject({
        agent_count: 1,
        used_by_agents: [{ id: ag?.id, key: "hoadon" }],
      });
    } finally {
      await hubConfigChange(
        x.sql,
        (tx) => tx`update hub.agents set profile_id = ${PROFILE.fake} where id = ${ag?.id ?? NONE}`,
      );
    }
    expect((await pa(x, "GET", `/model-profiles/${NONE}`)).status).toBe(404);
  });
});
