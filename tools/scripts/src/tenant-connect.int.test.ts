// CR-161 · tenant-connect trên DB thật: kết nối hai chiều qua cc_invite + partner_link_accept; chạy lại không đổi;
// thiếu Danh bạ / thiếu người Toàn quyền ⇒ báo lỗi rõ và không ghi; chỉ đụng đúng 2 công ty.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { needsProdFlag, run } from "./tenant-connect";

const T = [1, 2, 3, 4, 5].map((n) => tenantId(1700 + n)) as [
  string,
  string,
  string,
  string,
  string,
];
const [A, B, C, D, E] = T;
let o: Sql;
const links = async () => [...(await linksRaw())];
const linksRaw = () =>
  o<{ f: string; t: string; ok: boolean }[]>`select from_tenant as f, to_tenant as t,
    (accepted_at is not null and blocked_at is null and connect_requested_at is null) as ok
    from hub.partner_links where from_tenant = any(${T}::uuid[]) or to_tenant = any(${T}::uuid[])
    order by 1, 2`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed) values
    (${A}, 'tc-a', 'A', 'Evolu', '0200000001', true), (${B}, 'tc-b', 'B', 'NitiGroup', '0200000002', true),
    (${C}, 'tc-c', 'C', 'Công ty Ba', '0200000003', true), (${D}, 'tc-d', 'D', 'Chưa Danh bạ', null, false),
    (${E}, 'tc-e', 'E', 'Không Toàn quyền', '0200000005', true)`;
  for (const [i, t] of T.entries()) await users(o, t, 1, { from: 1700 + i });
  const g = await enablePack(o, [A, B, C, D], "contracts");
  for (const [i, t] of [A, B, C, D].entries())
    await members(o, t, g.get(t)?.owner as string, [userId(1700 + i)]);
}, 60_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-161 · tenant-connect", () => {
  it("chạy thử không ghi, kết nối hai chiều, chạy lại already, công ty thứ ba không bị đụng", async () => {
    expect(await run(o, "tc-a", "tc-b", true)).toBe("would-connect");
    expect(await links()).toHaveLength(0);
    expect(await run(o, "tc-a", "tc-b")).toBe("connected");
    const l = await links();
    expect(l).toEqual([
      { f: A, t: B, ok: true },
      { f: B, t: A, ok: true },
    ]);
    const bell = await o`select count(*)::int as n from hub.notifications where tenant_id = ${C}`;
    expect(bell[0]?.n).toBe(0);
    expect(await run(o, "tc-b", "tc-a")).toBe("already");
    expect(await run(o, "tc-a", "tc-b")).toBe("already");
    expect(await links()).toEqual(l);
  });

  it("thiếu Danh bạ, thiếu người Toàn quyền, thiếu công ty ⇒ báo lỗi rõ, không ghi", async () => {
    const before = await links();
    await expect(run(o, "tc-a", "tc-d")).rejects.toThrow("chưa bật Danh bạ");
    await expect(run(o, "tc-a", "tc-e")).rejects.toThrow("chưa có người Toàn quyền");
    await expect(run(o, "tc-a", "khong-co")).rejects.toThrow("không có công ty");
    await expect(run(o, "tc-a", "tc-a")).rejects.toThrow("phải khác nhau");
    expect(await links()).toEqual(before);
  });

  it("guard prod: DB ngoài máy dev/test hoặc APP_ENV=production cần --i-know-prod", () => {
    expect(needsProdFlag("postgres://u@localhost/db", {})).toBe(false);
    expect(needsProdFlag("postgres://u@pg-prod.example.com/db", {})).toBe(true);
    expect(needsProdFlag("postgres://u@localhost/db", { APP_ENV: "production" })).toBe(true);
  });
});
