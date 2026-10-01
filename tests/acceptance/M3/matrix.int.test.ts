// ADM-FR-35, ADM-BR-12 · GET /admin/grants/matrix (M3-R09; test-plan I-MX). Số liệu: test-plan §3.
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset), kể cả ca chỉ đọc: không `it` nào phụ thuộc `it` khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GrantMatrixSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  TENANT_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;
let lan: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
  lan = callerOf(env, "acme", "lan");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

const F = ID.feature;
const KT = ID3.group.acmeKeToan;
const matrix = async (call: typeof admin, qs = "") => {
  const res = await call("GET", `/admin/grants/matrix${qs}`);
  expect(res.status).toBe(200);
  return GrantMatrixSchema.parse(res.json);
};
const row = (m: Awaited<ReturnType<typeof matrix>>, key: string) => {
  const r = m.features.find((f) => f.feature.key === key);
  if (!r) throw new Error(`thiếu hàng ${key}`);
  return r;
};

describe("ADM-FR-35 · ma trận acme (M3-R09)", () => {
  it("ADM-FR-35 · M3-R09 · features = MỌI feature catalog, core đầu rồi key; state [core, entitled, entitled, entitled, none, entitled]", async () => {
    const m = await matrix(binh);
    expect(m.tenant_id).toBe(TENANT_ID.acme);
    expect(m.features.map((f) => [f.feature.key, f.state])).toEqual([
      ["core", "core"],
      ["bao-cao", "entitled"],
      ["dich-thuat", "entitled"],
      ["ke-toan", "entitled"],
      ["phap-che", "none"],
      ["thu-nghiem", "entitled"],
    ]);
    expect(m.features[0]?.feature.is_core).toBe(true);
  });

  it("ADM-FR-35 · M3-R09 · groups [beta-testers, ke-toan, kinh-doanh] kèm member_count [1,3,0]; group_total 3", async () => {
    const m = await matrix(binh);
    expect(m.groups.map((g) => [g.key, g.member_count, g.is_beta])).toEqual([
      ["beta-testers", 1, true],
      ["ke-toan", 3, false],
      ["kinh-doanh", 0, false],
    ]);
    expect(m.group_total).toBe(3);
  });

  it("ADM-FR-35 · M3-R09 · granted_group_ids: ke-toan [ke-toan], bao-cao [beta-testers], dich-thuat [] (grant user G3 KHÔNG tính); command_names/command_count đúng", async () => {
    const m = await matrix(binh);
    const beta = await betaId(env.owner, "acme");
    expect(row(m, "ke-toan").granted_group_ids).toEqual([KT]);
    expect(row(m, "bao-cao").granted_group_ids).toEqual([beta]);
    expect(row(m, "dich-thuat").granted_group_ids).toEqual([]);
    expect(row(m, "ke-toan")).toMatchObject({
      command_names: ["kiemtra-hoadon"],
      command_count: 1,
    });
    expect(row(m, "core")).toMatchObject({ command_names: ["dich", "tom-tat"], command_count: 2 });
    expect(row(m, "phap-che")).toMatchObject({ command_names: [], command_count: 0 });
  });

  it("ADM-FR-35 · M3-R09 · command_names ≤ 10 sắp tăng và command_count thật (12 command gắn vào phap-che)", async () => {
    for (let i = 1; i <= 12; i++) {
      const id = `01900000-0000-7000-8000-0000000003${60 + i}`;
      const name = `ex${String(i).padStart(2, "0")}`;
      await env.owner`insert into admin.commands (id, name, description, workflow_id, output)
        values (${id}, ${name}, ${env.owner.json({ vi: "x" })}, ${ID.workflow.reportTax},
          ${env.owner.json({ field: "text", render: "text" })})`;
      await env.owner`insert into admin.command_names (name, command_id) values (${name}, ${id})`;
      await env.owner`insert into admin.feature_commands (feature_id, command_id) values (${ID3.feature.phapChe}, ${id})`;
    }
    const r = row(await matrix(binh), "phap-che");
    expect(r.command_count).toBe(12);
    expect(r.command_names).toEqual(
      Array.from({ length: 10 }, (_, i) => `ex${String(i + 1).padStart(2, "0")}`),
    );
  });
});

describe("ADM-BR-12 · ma trận globex và trạng thái thu hồi (M3-R09, R10)", () => {
  it("ADM-BR-12 · M3-R09 · globex: ke-toan 'revoked' (còn grant G4), bao-cao/dich-thuat/phap-che/thu-nghiem 'none'; groups [beta-testers, ke-toan]", async () => {
    const m = await matrix(admin, `?tenant_id=${TENANT_ID.globex}`);
    expect(m.features.map((f) => [f.feature.key, f.state])).toEqual([
      ["core", "core"],
      ["bao-cao", "none"],
      ["dich-thuat", "none"],
      ["ke-toan", "revoked"],
      ["phap-che", "none"],
      ["thu-nghiem", "none"],
    ]);
    expect(row(m, "ke-toan").granted_group_ids).toEqual([ID3.group.globexKeToan]);
    expect(m.groups.map((g) => g.key)).toEqual(["beta-testers", "ke-toan"]);
  });

  it("ADM-BR-12 · M3-R09 · thu hồi entitlement acme ke-toan bằng API → state 'revoked' (còn grant); cấp lại → 'entitled'", async () => {
    const url = `/admin/features/${F.keToan}/entitlements/${TENANT_ID.acme}`;
    expect((await admin("DELETE", url)).status).toBe(204);
    expect(row(await matrix(binh), "ke-toan")).toMatchObject({
      state: "revoked",
      granted_group_ids: [KT],
    });
    expect((await admin("PUT", url)).status).toBe(200);
    expect(row(await matrix(binh), "ke-toan").state).toBe("entitled");
  });

  it("ADM-BR-12 · M3-R09 · thu hồi feature không có grant (thu-nghiem) → 'none' (không hiện hàng thu hồi)", async () => {
    expect(
      (await admin("DELETE", `/admin/features/${F.thuNghiem}/entitlements/${TENANT_ID.acme}`))
        .status,
    ).toBe(204);
    expect(row(await matrix(binh), "thu-nghiem").state).toBe("none");
  });
});

describe("ADM-FR-35 · tham số và phạm vi (M3-R06, R09)", () => {
  it("ADM-FR-35 · M3-R09 · ?group_id=<ke-toan> → đúng một cột; granted_group_ids chỉ tính trong số group trả về (bao-cao [] vì beta không có mặt)", async () => {
    const m = await matrix(binh, `?group_id=${KT}`);
    expect(m.groups.map((g) => g.key)).toEqual(["ke-toan"]);
    expect(row(m, "ke-toan").granted_group_ids).toEqual([KT]);
    expect(row(m, "bao-cao").granted_group_ids).toEqual([]);
  });

  it("ADM-BR-09 · M3-R06 · group_id lạ hoặc của tenant khác → 404; platform thiếu tenant_id → 400 TENANT_REQUIRED; tenant lạ → 404", async () => {
    expectErr(await binh("GET", `/admin/grants/matrix?group_id=${ID3.unknown}`), "NOT_FOUND");
    expectErr(await hoa("GET", `/admin/grants/matrix?group_id=${KT}`), "NOT_FOUND");
    expectErr(await admin("GET", "/admin/grants/matrix"), "TENANT_REQUIRED");
    expectErr(await admin("GET", `/admin/grants/matrix?tenant_id=${ID3.unknown}`), "NOT_FOUND");
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin bỏ qua ?tenant_id của tenant khác (vẫn ma trận acme)", async () => {
    const m = await matrix(binh, `?tenant_id=${TENANT_ID.globex}`);
    expect(m.tenant_id).toBe(TENANT_ID.acme);
  });

  it("ADM-FR-35 · M3-R09 · q lọc GROUP theo key/tên: 'kinh' → [kinh-doanh]; 'BETA' → [beta-testers]", async () => {
    expect((await matrix(binh, "?q=kinh")).groups.map((g) => g.key)).toEqual(["kinh-doanh"]);
    expect((await matrix(binh, "?q=BETA")).groups.map((g) => g.key)).toEqual(["beta-testers"]);
  });

  it("ADM-FR-35 · M3-R09 · 205 group thêm: mặc định groups = 200 và group_total = 208; limit/offset cắt đúng; limit=201 → 400", async () => {
    const keys = Array.from({ length: 205 }, (_, i) => `gr${String(i).padStart(3, "0")}`);
    await env.owner`insert into admin.groups (tenant_id, key, name)
      select ${TENANT_ID.acme}, k, '{"vi":"x"}'::jsonb from unnest(${keys}::text[]) as k`;
    const all = await matrix(binh);
    expect(all.groups).toHaveLength(200);
    expect(all.group_total).toBe(208);
    expect(all.groups[0]?.key).toBe("beta-testers");
    const page = await matrix(binh, "?limit=10&offset=5");
    expect(page.groups).toHaveLength(10);
    expect(page.groups[0]?.key).toBe(all.groups[5]?.key as string);
    expectErr(await binh("GET", "/admin/grants/matrix?limit=201"), "VALIDATION_ERROR");
  });

  it("ADM-BR-09 · M3-R06 · member → 403; không token → 401; tham số lạ → 400", async () => {
    expectErr(await lan("GET", "/admin/grants/matrix"), "FORBIDDEN");
    expectErr(await env.call("GET", "/admin/grants/matrix"), "UNAUTHORIZED");
    expectErr(await binh("GET", "/admin/grants/matrix?foo=1"), "VALIDATION_ERROR");
  });
});
