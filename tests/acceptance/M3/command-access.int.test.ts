// ADM-FR-24 · tab "Ai dùng được" phần group/grant: groups[], group_count, visible_user_count (M3-AC10; M3-R14; test-plan I-CA).
// Số liệu: test-plan §3. Trường mới đọc qua `newField` (typecheck xanh trước T6); `CommandAccessResponseSchema.parse` kiểm
// strict lúc chạy. Mỗi `it` tự dựng lại dữ liệu (beforeEach reset).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CommandAccessResponseSchema } from "@ai/contracts";
import {
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  newField,
  TENANT_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type GroupItem = { key: string; is_beta: boolean; feature: { key: string } };
const access = async (cid: string, qs = "") => {
  const res = await admin("GET", `/admin/commands/${cid}/access${qs}`);
  expect(res.status).toBe(200);
  return CommandAccessResponseSchema.parse(res.json);
};
const tenant = (a: Awaited<ReturnType<typeof access>>, key: string) => {
  const t = a.items.find((i) => i.tenant_key === key);
  if (!t) throw new Error(`thiếu tenant ${key}`);
  return t;
};
const groupsOf = (t: unknown) => newField<GroupItem[]>(t, "groups");
const pairs = (t: unknown) => groupsOf(t).map((g) => `${g.key}·${g.feature.key}`);
const visibleOf = (t: unknown) => newField<number>(t, "visible_user_count");
const countOf = (t: unknown) => newField<number>(t, "group_count");

describe("ADM-FR-24 · groups[] và group_count (M3-R14)", () => {
  it("ADM-FR-24 · M3-R14 · /kiemtra-hoadon: chỉ tenant acme (globex đã thu hồi); groups [ke-toan·ke-toan, is_beta false], group_count 1, visible_user_count 2, active_user_count 6", async () => {
    const a = await access(ID.command.kiemtraHoadon);
    expect(a.items.map((i) => i.tenant_key)).toEqual(["acme"]);
    const t = tenant(a, "acme");
    expect(pairs(t)).toEqual(["ke-toan·ke-toan"]);
    expect(groupsOf(t)[0]?.is_beta).toBe(false);
    expect(countOf(t)).toBe(1);
    expect(visibleOf(t)).toBe(2);
    expect(t.active_user_count).toBe(6);
  });

  it("ADM-FR-24 · M3-R14 · /dich (core): groups [], group_count 0; visible_user_count platform 2 · acme 6 · globex 3 · zeta 0; active_user_count giữ nghĩa M2", async () => {
    const a = await access(ID.command.dich);
    expect(
      a.items.map((i) => [
        i.tenant_key,
        newField<number>(i, "visible_user_count"),
        i.active_user_count,
      ]),
    ).toEqual([
      ["acme", 6, 6],
      ["globex", 3, 3],
      ["platform", 2, 2],
      ["zeta", 0, 0],
    ]);
    for (const t of a.items) expect([groupsOf(t), countOf(t)]).toEqual([[], 0]);
  });

  it("ADM-FR-24 · M3-R14 · /xuat-bao-cao: groups [beta-testers·bao-cao, is_beta true], group_count 1, visible 0 (command tắt)", async () => {
    const t = tenant(await access(ID.command.xuatBaoCao), "acme");
    expect(pairs(t)).toEqual(["beta-testers·bao-cao"]);
    expect(groupsOf(t)[0]?.is_beta).toBe(true);
    expect([countOf(t), visibleOf(t)]).toEqual([1, 0]);
  });

  it("ADM-FR-24 · M3-R14 · /tr-nhanh: grant cho USER (G3) không tính vào groups[]; group_count 0, visible 0 (command tắt)", async () => {
    const t = tenant(await access(ID.command.trNhanh), "acme");
    expect([groupsOf(t), countOf(t), visibleOf(t)]).toEqual([[], 0, 0]);
  });

  it("ADM-FR-24 · M3-R14 · trần 20: 25 group thêm cùng được cấp ke-toan → groups.length 20, group_count 26, sắp group key rồi feature key", async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `gz${String(i + 1).padStart(2, "0")}`);
    await env.owner`insert into admin.groups (tenant_id, key, name)
      select ${TENANT_ID.acme}, k, '{"vi":"x"}'::jsonb from unnest(${keys}::text[]) as k`;
    await env.owner`insert into admin.feature_grants (tenant_id, feature_id, group_id)
      select ${TENANT_ID.acme}, ${ID.feature.keToan}, id from admin.groups where key like 'gz%'`;
    const t = tenant(await access(ID.command.kiemtraHoadon), "acme");
    expect(groupsOf(t)).toHaveLength(20);
    expect(countOf(t)).toBe(26);
    expect(groupsOf(t).map((g) => g.key)).toEqual(keys.slice(0, 20));
  });

  it("ADM-FR-24 · M3-R14 · chỉ cặp (group, feature) của feature on|beta có entitlement chưa thu hồi: feature off không vào groups[]", async () => {
    await env.owner`insert into admin.feature_commands (feature_id, command_id) values (${ID.feature.thuNghiem}, ${ID.command.kiemtraHoadon})`;
    await env.owner`insert into admin.feature_grants (tenant_id, feature_id, group_id)
      values (${TENANT_ID.acme}, ${ID.feature.thuNghiem}, ${ID3.group.acmeKinhDoanh})`;
    const t = tenant(await access(ID.command.kiemtraHoadon), "acme");
    expect(pairs(t)).toEqual(["ke-toan·ke-toan"]);
    expect(countOf(t)).toBe(1);
  });

  it("ADM-FR-24 · M3-R22 · thu hồi entitlement acme ke-toan (API) → tenant biến khỏi danh sách (kéo theo groups); cấp lại → trở lại cùng groups", async () => {
    const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
    await admin("DELETE", url);
    expect((await access(ID.command.kiemtraHoadon)).items).toEqual([]);
    await admin("PUT", url);
    expect(pairs(tenant(await access(ID.command.kiemtraHoadon), "acme"))).toEqual([
      "ke-toan·ke-toan",
    ]);
  });
});

describe("M3-AC10 · visible_user_count khớp effective-access (M3-R11, R14)", () => {
  /** Đếm user của tenant thấy `name` bằng cách gọi effective-access từng user (nguồn đối chiếu độc lập với SQL đếm). */
  async function viaEffectiveAccess(name: string): Promise<Record<string, number>> {
    const users = await env.owner<
      { id: string; key: string }[]
    >`select u.id, t.key from admin.users u
      join admin.tenants t on t.id = u.tenant_id order by t.key, u.username`;
    const out: Record<string, number> = {};
    for (const u of users) {
      const res = await admin("GET", `/admin/users/${u.id}/effective-access?command=${name}`);
      expect(res.status).toBe(200);
      const cmds = (res.json as { commands: { name: string; visible: boolean }[] }).commands;
      if (cmds.some((c) => c.name === name && c.visible)) out[u.key] = (out[u.key] ?? 0) + 1;
    }
    return out;
  }

  it("M3-AC10 · ADM-FR-24 · /dich: visible_user_count từng tenant = số user có dich visible trong effective-access", async () => {
    const a = await access(ID.command.dich);
    const counted = await viaEffectiveAccess("dich");
    for (const t of a.items)
      expect([t.tenant_key, visibleOf(t)]).toEqual([t.tenant_key, counted[t.tenant_key] ?? 0]);
  });

  it("M3-AC10 · ADM-FR-24 · /kiemtra-hoadon: acme = 2 = số user thấy theo effective-access; thêm an vào ke-toan (API) → 3 ở cả hai nguồn", async () => {
    expect(visibleOf(tenant(await access(ID.command.kiemtraHoadon), "acme"))).toBe(2);
    expect((await viaEffectiveAccess("kiemtra-hoadon")).acme).toBe(2);
    expect(
      (await binh("POST", `/admin/groups/${ID3.group.acmeKeToan}/members`, { usernames: ["an"] }))
        .status,
    ).toBe(200);
    expect(visibleOf(tenant(await access(ID.command.kiemtraHoadon), "acme"))).toBe(3);
    expect((await viaEffectiveAccess("kiemtra-hoadon")).acme).toBe(3);
  });
});

describe("ADM-FR-24 · phạm vi và tương thích M2 (M3-R14)", () => {
  it("ADM-FR-24 · M3-R14 · chỉ platform_admin: tenant_admin → 403 FORBIDDEN; id lạ/abc → 404", async () => {
    expectErr(await binh("GET", `/admin/commands/${ID.command.dich}/access`), "FORBIDDEN");
    expectErr(await admin("GET", `/admin/commands/${ID3.unknown}/access`), "NOT_FOUND");
    expectErr(await admin("GET", "/admin/commands/abc/access"), "NOT_FOUND");
  });

  it("ADM-FR-24 · M3-R14 · phân trang/lọc của M2 giữ nguyên: limit=2&offset=2 → [platform, zeta], total 4; q=ac → acme; vẫn có command_active", async () => {
    const p = await access(ID.command.dich, "?limit=2&offset=2");
    expect(p.items.map((i) => i.tenant_key)).toEqual(["platform", "zeta"]);
    expect(p.total).toBe(4);
    expect((await access(ID.command.dich, "?q=ac")).items.map((i) => i.tenant_key)).toEqual([
      "acme",
    ]);
    expect(p.command_active).toBe(true);
  });
});
