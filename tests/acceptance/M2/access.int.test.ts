// ADM-FR-24, ADM-BR-10, ADM-BR-12 · GET /admin/commands/:id/access — tab "Ai dùng được", phần tenant
// (test-plan A; M2-R22, M2-R23, M2-R24). Dữ liệu: fixture đầy đủ (test-plan §3).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CommandAccessResponseSchema } from "@ai/contracts";
import { ALL_CATALOG, ID } from "./_data";
import { createM2Env, expectErr, type Json, type M2Env, type Res, TENANT_ID } from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const access = async (cid: string, qs = "") => {
  const res = await as("GET", `/admin/commands/${cid}/access${qs}`);
  expect(res.status).toBe(200);
  return CommandAccessResponseSchema.parse(res.json);
};
const keys = (a: { items: { tenant_key: string }[] }) => a.items.map((i) => i.tenant_key);

describe("ADM-FR-24 · Ai dùng được (M2-R23)", () => {
  it("ADM-FR-24 · M2-R23 · /dich (feature core) → MỌI tenant, sắp tenant_key; active_user_count platform 2 / acme 6 / globex 3 / zeta 0; tenant_active zeta=false; command_active=true", async () => {
    const a = await access(ID.command.dich);
    expect(keys(a)).toEqual(["acme", "globex", "platform", "zeta"]);
    expect(a.total).toBe(4);
    expect(a.command_active).toBe(true);
    const by = Object.fromEntries(a.items.map((i) => [i.tenant_key, i]));
    expect([by.acme?.active_user_count, by.globex?.active_user_count]).toEqual([6, 3]);
    expect([by.platform?.active_user_count, by.zeta?.active_user_count]).toEqual([2, 0]);
    expect([by.zeta?.tenant_active, by.acme?.tenant_active]).toEqual([false, true]);
    for (const i of a.items) expect(i.features.map((f) => f.key)).toEqual(["core"]);
  });

  it("ADM-FR-24 · M2-R23 · /tr-nhanh (dich-thuat, entitlement acme; command TẮT) → chỉ acme; command_active=false", async () => {
    const a = await access(ID.command.trNhanh);
    expect(keys(a)).toEqual(["acme"]);
    expect(a.command_active).toBe(false);
    expect(a.items[0]?.features.map((f) => f.key)).toEqual(["dich-thuat"]);
  });

  it("ADM-FR-24 · M2-R22 · /kiemtra-hoadon (ke-toan: acme còn, globex ĐÃ THU HỒI) → chỉ acme", async () => {
    const a = await access(ID.command.kiemtraHoadon);
    expect(keys(a)).toEqual(["acme"]);
    expect(a.total).toBe(1);
  });

  it("ADM-FR-24 · M2-R24 · /xuat-bao-cao (bao-cao = BETA, entitlement acme; workflow tắt) → acme (beta tính hiệu lực), command_active=false", async () => {
    const a = await access(ID.command.xuatBaoCao);
    expect(keys(a)).toEqual(["acme"]);
    expect(a.command_active).toBe(false);
  });

  it("ADM-FR-24 · M2-R24 · command chỉ thuộc feature OFF (thu-nghiem, entitlement acme) → items rỗng, total 0", async () => {
    const cid = "01900000-0000-7000-8000-0000000002b1";
    await env.owner`insert into admin.commands (id, name, description, workflow_id, output)
      values (${cid}, 'thu-cmd', ${env.owner.json({ vi: "Thử" })}, ${ID.workflow.summarize},
        ${env.owner.json({ field: "text", render: "text" })})`;
    await env.owner`insert into admin.command_names (name, command_id) values ('thu-cmd', ${cid})`;
    await env.owner`insert into admin.feature_commands (feature_id, command_id) values (${ID.feature.thuNghiem}, ${cid})`;
    const a = await access(cid);
    expect(a).toMatchObject({ items: [], total: 0 });
  });

  it("ADM-FR-24 · M2-R23 · command trong core và ke-toan → acme có CẢ HAI feature; globex chỉ core", async () => {
    await env.owner`insert into admin.feature_commands (feature_id, command_id) values (${ID.feature.keToan}, ${ID.command.dich})`;
    const a = await access(ID.command.dich);
    const by = Object.fromEntries(a.items.map((i) => [i.tenant_key, i]));
    expect(by.acme?.features.map((f) => f.key).sort()).toEqual(["core", "ke-toan"]);
    expect(by.globex?.features.map((f) => f.key)).toEqual(["core"]);
  });

  it("ADM-FR-24 · M2-R22 · thu hồi entitlement → tenant biến mất, cấp lại → xuất hiện; tắt feature → biến mất, bật lại → trở lại; KHÔNG đổi enabled của command", async () => {
    const f = ID.feature.keToan;
    const url = `/admin/features/${f}/entitlements/${TENANT_ID.acme}`;
    expect((await as("DELETE", url)).status).toBe(204);
    expect((await access(ID.command.kiemtraHoadon)).total).toBe(0);
    expect((await as("PUT", url)).status).toBe(200);
    expect(keys(await access(ID.command.kiemtraHoadon))).toEqual(["acme"]);
    const feature = (await as("GET", `/admin/features/${f}`)).json;
    const off = await as("PATCH", `/admin/features/${f}`, {
      version: feature.version,
      status: "off",
    });
    expect(off.status).toBe(200);
    expect((await access(ID.command.kiemtraHoadon)).total).toBe(0);
    const on = await as("PATCH", `/admin/features/${f}`, {
      version: off.json.version,
      status: "on",
    });
    expect(on.status).toBe(200);
    expect(keys(await access(ID.command.kiemtraHoadon))).toEqual(["acme"]);
    const [c] =
      await env.owner`select enabled from admin.commands where id = ${ID.command.kiemtraHoadon}`;
    expect(c?.enabled).toBe(true);
  });

  it("ADM-FR-24 · M2-R26 · phân trang/lọc: limit=2&offset=2 → [platform, zeta], total 4; q=ac → acme; limit=201 / offset=-1 → 400; :id lạ/abc → 404; response strict (không có khoá groups/grants)", async () => {
    const page = await access(ID.command.dich, "?limit=2&offset=2");
    expect(keys(page)).toEqual(["platform", "zeta"]);
    expect(page.total).toBe(4);
    expect(keys(await access(ID.command.dich, "?q=ac"))).toEqual(["acme"]);
    expectErr(
      await as("GET", `/admin/commands/${ID.command.dich}/access?limit=201`),
      "VALIDATION_ERROR",
    );
    expectErr(
      await as("GET", `/admin/commands/${ID.command.dich}/access?offset=-1`),
      "VALIDATION_ERROR",
    );
    expectErr(await as("GET", `/admin/commands/${ID.unknown}/access`), "NOT_FOUND");
    expectErr(await as("GET", "/admin/commands/abc/access"), "NOT_FOUND");
    const raw = (await as("GET", `/admin/commands/${ID.command.dich}/access`)).json as Json;
    expect(Object.keys(raw).sort()).toEqual(["command_active", "items", "total"]);
  });

  it("ADM-FR-24 · M2-R23 · không có endpoint Hub: GET /admin/commands/:id/effective → 404", async () => {
    expect((await as("GET", `/admin/commands/${ID.command.dich}/effective`)).status).toBe(404);
  });
});
