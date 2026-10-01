// ADM-FR-62, ADM-BR-09 · API thành viên group (M3-AC02; M3-R03, R05, R23; test-plan I-M).
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset); không `it` nào đọc kết quả của `it` khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GroupMemberListResponseSchema, GroupMembersAddResponseSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  ID3,
  type M3Env,
  num,
  TENANT_ID,
  USER_ID,
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

const KT = ID3.group.acmeKeToan;
const KD = ID3.group.acmeKinhDoanh;
const members = async (call: typeof admin, gid: string, qs = "") => {
  const res = await call("GET", `/admin/groups/${gid}/members${qs}`);
  expect(res.status).toBe(200);
  return GroupMemberListResponseSchema.parse(res.json);
};
const add = (call: typeof admin, gid: string, body: unknown) =>
  call("POST", `/admin/groups/${gid}/members`, body);
const addOk = async (call: typeof admin, gid: string, body: unknown) => {
  const res = await add(call, gid, body);
  expect(res.status).toBe(200);
  return GroupMembersAddResponseSchema.parse(res.json);
};
const nMembers = (gid: string) =>
  num(env.owner, `select count(*)::int as n from admin.group_members where group_id = '${gid}'`);
const names = (b: { items: { username: string }[] }) => b.items.map((m) => m.username);

describe("ADM-FR-62 · danh sách thành viên (M3-R03)", () => {
  it("ADM-FR-62 · M3-R03 · list ke-toan → {items,total} sắp username [em, lan, thu]; em (inactive) vẫn là thành viên; trường GroupMember đủ", async () => {
    const b = await members(binh, KT);
    expect(names(b)).toEqual(["em", "lan", "thu"]);
    expect(b.total).toBe(3);
    const em = b.items[0];
    expect(em).toMatchObject({
      user_id: USER_ID.em,
      status: "locked",
      role: "member",
      locked_by_tenant: false,
    });
    expect(b.items.every((m) => m.added_at.length > 0)).toBe(true);
  });

  it("ADM-FR-62 · M3-R03 · other_groups (≤ 3, beta đầu, không gồm group đang xem) + other_groups_total: thu [beta-testers] total 1; lan [] total 0", async () => {
    const b = await members(binh, KT);
    const thu = b.items.find((m) => m.username === "thu");
    const lanM = b.items.find((m) => m.username === "lan");
    expect(thu?.other_groups.map((g) => [g.key, g.is_beta])).toEqual([["beta-testers", true]]);
    expect(thu?.other_groups_total).toBe(1);
    expect(lanM?.other_groups).toEqual([]);
    expect(lanM?.other_groups_total).toBe(0);
  });

  it("ADM-FR-62 · M3-R03 · other_groups tối đa 3 và total thật: user ở 5 group khác → 3 phần tử (beta trước, rồi key), total 5", async () => {
    for (const k of ["g-aa", "g-bb", "g-cc", "g-dd"]) {
      const [g] = await env.owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
        values (${TENANT_ID.acme}, ${k}, '{"vi":"x"}'::jsonb) returning id`;
      await env.owner`insert into admin.group_members (tenant_id, group_id, user_id)
        values (${TENANT_ID.acme}, ${g?.id as string}, ${USER_ID.thu})`;
    }
    const thu = (await members(binh, KT)).items.find((m) => m.username === "thu");
    expect(thu?.other_groups_total).toBe(5);
    expect(thu?.other_groups.map((g) => g.key)).toEqual(["beta-testers", "g-aa", "g-bb"]);
  });

  it("ADM-FR-62 · M3-R23 · q khớp username/display_name; limit/offset/total", async () => {
    expect(names(await members(binh, KT, "?q=tran"))).toEqual(["lan"]);
    expect(names(await members(binh, KT, "?q=TH"))).toEqual(["thu"]);
    const p = await members(binh, KT, "?limit=1&offset=1");
    expect(names(p)).toEqual(["lan"]);
    expect(p.total).toBe(3);
    expectErr(await binh("GET", `/admin/groups/${KT}/members?limit=201`), "VALIDATION_ERROR");
  });

  it("ADM-BR-09 · M3-R06 · group tenant khác → 404; group lạ → 404; member → 403; không token → 401", async () => {
    expectErr(await hoa("GET", `/admin/groups/${KT}/members`), "NOT_FOUND");
    expectErr(await admin("GET", `/admin/groups/${ID3.unknown}/members`), "NOT_FOUND");
    expectErr(await lan("GET", `/admin/groups/${KT}/members`), "FORBIDDEN");
    expectErr(await env.call("GET", `/admin/groups/${KT}/members`), "UNAUTHORIZED");
  });
});

describe("M3-AC02 · thêm thành viên, dán danh sách (M3-R03)", () => {
  it("M3-AC02 · ADM-FR-62 · 5 username (1 không tồn tại, 1 đã có, 1 thuộc tenant khác, 2 mới) → 200 {added:[dung,an], not_found:[ghost,khang], already:[lan]} theo thứ tự gửi; 2 người được thêm", async () => {
    const r = await addOk(binh, KT, { usernames: ["dung", "lan", "ghost", "khang", "an"] });
    expect(r).toEqual({ added: ["dung", "an"], not_found: ["ghost", "khang"], already: ["lan"] });
    expect(await nMembers(KT)).toBe(5);
    const b = await members(binh, KT);
    expect(names(b)).toEqual(["an", "dung", "em", "lan", "thu"]);
    expect(b.items.find((m) => m.username === "an")?.added_by).toBe("binh");
  });

  it("ADM-FR-62 · M3-R03 · thêm trùng lần hai → toàn already (không đổi gì)", async () => {
    await addOk(binh, KD, { usernames: ["an", "dung"] });
    const again = await addOk(binh, KD, { usernames: ["an", "dung"] });
    expect(again).toEqual({ added: [], not_found: [], already: ["an", "dung"] });
    expect(await nMembers(KD)).toBe(2);
  });

  it("ADM-FR-62 · M3-R03 · chuẩn hoá: ' LAN ' → lan; trùng trong request ['lan','LAN'] → một phần tử", async () => {
    expect(await addOk(binh, KT, { usernames: [" LAN "] })).toEqual({
      added: [],
      not_found: [],
      already: ["lan"],
    });
    expect(await addOk(binh, KT, { usernames: ["lan", "LAN"] })).toEqual({
      added: [],
      not_found: [],
      already: ["lan"],
    });
  });

  it("ADM-FR-62 · M3-R03 · username sai định dạng vào not_found (KHÔNG 400); ['x y'] là MỘT phần tử (server không tách khoảng trắng) → not_found", async () => {
    const r = await addOk(binh, KD, { usernames: ["a", "x y", "ab!", "an"] });
    expect(r).toEqual({ added: ["an"], not_found: ["a", "x y", "ab!"], already: [] });
  });

  it("ADM-FR-62 · M3-R03 · user bị khoá (zed@zeta, locked_by_tenant) và user inactive (em) thêm được → nằm trong added", async () => {
    const betaZeta = await betaId(env.owner, "zeta");
    expect(await addOk(admin, betaZeta, { usernames: ["zed"] })).toEqual({
      added: ["zed"],
      not_found: [],
      already: [],
    });
    expect(await addOk(binh, KD, { usernames: ["em"] })).toEqual({
      added: ["em"],
      not_found: [],
      already: [],
    });
  });

  it("ADM-FR-62 · M3-R03 · 500 username → 200 (chỉ 2 hợp lệ vào added, 498 not_found); 501 username khác nhau → 400 VALIDATION_ERROR, không ghi", async () => {
    const ghosts = (n: number) =>
      Array.from({ length: n }, (_, i) => `ghost${String(i).padStart(3, "0")}`);
    const r = await addOk(binh, KD, { usernames: ["dung", "an", ...ghosts(498)] });
    expect(r.added).toEqual(["dung", "an"]);
    expect(r.not_found).toHaveLength(498);
    const before = await nMembers(KD);
    expectErr(await add(binh, KD, { usernames: ["lan", ...ghosts(500)] }), "VALIDATION_ERROR");
    expect(await nMembers(KD)).toBe(before);
  });

  it("ADM-FR-62 · M3-R03 · dữ liệu sai → 400: mảng rỗng, phần tử 65 ký tự, thiếu usernames, khoá lạ, dry_run không boolean", async () => {
    for (const body of [
      { usernames: [] },
      { usernames: ["x".repeat(65)] },
      {},
      { usernames: ["an"], extra: 1 },
      { usernames: ["an"], dry_run: "yes" },
    ]) {
      expectErr(await add(binh, KD, body), "VALIDATION_ERROR");
    }
    expect(await nMembers(KD)).toBe(0);
  });

  it("ADM-FR-62 · M3-R03 · dry_run: trả cùng kết quả {added, not_found, already} nhưng KHÔNG ghi (owner đếm), group.version không đổi", async () => {
    const vBefore = await num(
      env.owner,
      `select version::int as n from admin.groups where id = '${KD}'`,
    );
    const r = await addOk(binh, KD, { usernames: ["dung", "ghost"], dry_run: true });
    expect(r).toEqual({ added: ["dung"], not_found: ["ghost"], already: [] });
    expect(await nMembers(KD)).toBe(0);
    expect(
      await num(env.owner, `select version::int as n from admin.groups where id = '${KD}'`),
    ).toBe(vBefore);
  });

  it("ADM-BR-09 · M3-R03 · tenant_admin thêm user tenant khác bằng username → not_found; group tenant khác → 404; thêm vào beta-testers được", async () => {
    expect(await addOk(hoa, ID3.group.globexKeToan, { usernames: ["binh", "hoa"] })).toEqual({
      added: ["hoa"],
      not_found: ["binh"],
      already: [],
    });
    expectErr(await add(hoa, KT, { usernames: ["an"] }), "NOT_FOUND");
    expectErr(await add(admin, ID3.unknown, { usernames: ["an"] }), "NOT_FOUND");
    const beta = await betaId(env.owner, "acme");
    expect(await addOk(binh, beta, { usernames: ["an"] })).toEqual({
      added: ["an"],
      not_found: [],
      already: [],
    });
  });

  it("ADM-FR-62 · M3-R05 · response chỉ có added/not_found/already (không version); member → 403 trước khi parse", async () => {
    const res = await add(binh, KD, { usernames: ["an"] });
    expect(Object.keys(res.json as Record<string, unknown>).sort()).toEqual([
      "added",
      "already",
      "not_found",
    ]);
    expectErr(await add(lan, KD, { sai: 1 }), "FORBIDDEN");
  });
});

describe("ADM-FR-62 · bớt thành viên (M3-R03, R05)", () => {
  const del = (call: typeof admin, gid: string, uid: string) =>
    call("DELETE", `/admin/groups/${gid}/members/${uid}`);

  it("ADM-FR-62 · M3-R03 · DELETE thành viên → 204, hàng mất; lần hai (không còn là thành viên) → 204; uuid hợp lệ nhưng lạ → 204", async () => {
    expect((await del(binh, KT, USER_ID.lan)).status).toBe(204);
    expect(await nMembers(KT)).toBe(2);
    expect((await del(binh, KT, USER_ID.lan)).status).toBe(204);
    expect((await del(binh, KT, ID3.unknown)).status).toBe(204);
    expect(await nMembers(KT)).toBe(2);
  });

  it("ADM-FR-62 · M3-R03 · :user_id không phải uuid → 404; group lạ → 404; group tenant khác → 404; member → 403", async () => {
    expectErr(await del(binh, KT, "abc"), "NOT_FOUND");
    expectErr(await del(admin, ID3.unknown, USER_ID.lan), "NOT_FOUND");
    expectErr(await del(hoa, KT, USER_ID.lan), "NOT_FOUND");
    expectErr(await del(lan, KT, USER_ID.lan), "FORBIDDEN");
    expect(await nMembers(KT)).toBe(3);
  });

  it("ADM-FR-62 · M3-R03 · Hoàn tác = POST lại: bớt rồi thêm lại → added", async () => {
    await del(binh, KT, USER_ID.thu);
    expect(await addOk(binh, KT, { usernames: ["thu"] })).toEqual({
      added: ["thu"],
      not_found: [],
      already: [],
    });
    expect(await nMembers(KT)).toBe(3);
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin globex không thấy/không sửa group acme (list/POST/DELETE → 404), dữ liệu không đổi", async () => {
    expectErr(await hoa("GET", `/admin/groups/${KT}/members`), "NOT_FOUND");
    expectErr(await add(hoa, KT, { usernames: ["khang"] }), "NOT_FOUND");
    expectErr(await del(hoa, KT, USER_ID.lan), "NOT_FOUND");
    expect(await nMembers(KT)).toBe(3);
  });
});
