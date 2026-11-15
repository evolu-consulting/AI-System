// CR-147b · int (DB thật): hồ sơ người `hub.people_profiles` (0142) + `PeopleService`.
// (1) đường chính: tự đổi avatar/ảnh bìa, xoá (null), đọc thẻ người THEO LÔ (một câu) gồm chức vụ + phòng ban + avatar;
// (2) N2 · quyền: người KHÁC cùng công ty không ghi được hàng của tôi (RLS 42501 / 0 hàng) — kể cả khi gọi service với id của mình thì chỉ
//     đổi của mình; chức vụ (cột admin) hub_rw không ghi được; (3) chéo tenant: không đọc thẻ người tenant khác, id lạ bị bỏ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { department, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, type HubScopeArg, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { AuthUser } from "../../lib/auth.middleware";
import { PeopleService } from "./people.service";

const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(8)}AAAA`;
const T = { a: tenantId(1471), b: tenantId(1472) };
const U = {
  a1: userId(1471),
  a2: userId(1472),
  b1: userId(1473),
  e1: userId(1474),
  e2: userId(1475),
  e3: userId(1476),
};
const ORG = {
  x: "00000000-0000-4000-8000-0000000014a1",
  y: "00000000-0000-4000-8000-0000000014a2",
};
let o: Sql;
let db: Db;
let svc: PeopleService;
const au = (k: keyof typeof U, t: string): AuthUser =>
  ({ userId: U[k], tenantId: t, role: "member", userKind: "internal" }) as unknown as AuthUser;
const scope = (k: keyof typeof U, t: string): HubScopeArg => ({
  kind: "user",
  tenantId: t,
  userId: U[k],
});
const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    return x.code ?? x.cause?.code ?? "err";
  }
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 'p1471', 'P1471'), (${T.b}, 'p1472', 'P1472') on conflict do nothing`;
  await users(o, T.a, 2, { from: 1471 });
  await users(o, T.b, 1, { from: 1473 });
  await department(o, T.a, "sales", { head: null, members: [U.a2] });
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${ORG.x}, ${T.a}, 'NCC X'), (${ORG.y}, ${T.a}, 'NCC Y') on conflict do nothing`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id, must_change_password) values
    (${U.e1}, ${T.a}, 'ncc-e1', 'x', 'Đối tác E1', 'member', 'external', ${ORG.x}, false),
    (${U.e2}, ${T.a}, 'ncc-e2', 'x', 'Đối tác E2', 'member', 'external', ${ORG.x}, false),
    (${U.e3}, ${T.a}, 'ncc-e3', 'x', 'Đối tác E3', 'member', 'external', ${ORG.y}, false) on conflict do nothing`;
  db = createDb(urls().hubApi, { max: 2 });
  svc = new PeopleService(db);
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-147b · people_profiles", () => {
  it("tự đổi avatar + ảnh bìa, đọc lại, xoá bằng null", async () => {
    await svc.setMine(au("a1", T.a), "avatar", PNG);
    await svc.setMine(au("a1", T.a), "cover", PNG);
    expect(await svc.me(au("a1", T.a))).toEqual({ avatar: PNG, cover: PNG, job_title: null });
    await svc.setMine(au("a1", T.a), "avatar", null);
    expect((await svc.me(au("a1", T.a))).avatar).toBeNull();
    expect((await svc.me(au("a1", T.a))).cover).toBe(PNG);
  });

  it("đọc thẻ người theo lô: tên + chức vụ + avatar + phòng ban; id lạ/chéo tenant bị bỏ", async () => {
    await svc.setMine(au("a2", T.a), "avatar", PNG);
    await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${T.a}, ${U.a2}, 'Trưởng nhóm bán hàng')
      on conflict (tenant_id, user_id) do update set job_title = excluded.job_title`;
    const r = await svc.cards(au("a1", T.a), [
      U.a1,
      U.a2,
      U.b1,
      "00000000-0000-4000-8000-0000000000ff",
    ]);
    const by = new Map(r.items.map((x) => [x.user_id, x]));
    expect(by.size).toBe(2);
    expect(by.get(U.a2)).toMatchObject({
      job_title: "Trưởng nhóm bán hàng",
      avatar: PNG,
      department: { name: "sales" },
    });
    expect(by.get(U.a1)?.department).toBeNull();
    // Tenant B xin id của A ⇒ không thấy ai.
    expect((await svc.cards(au("b1", T.b), [U.a1, U.a2])).items).toEqual([]);
  });

  it("N2 · người khác cùng công ty không ghi được hàng của tôi; chéo tenant; hub_rw không ghi chức vụ", async () => {
    const as2 = scope("a2", T.a);
    expect(
      await code(() =>
        inHub(
          as2,
          (tx) =>
            tx`insert into hub.people_profiles (tenant_id, user_id, avatar) values (${T.a}, ${U.a1}, ${PNG})
            on conflict (tenant_id, user_id) do update set avatar = excluded.avatar`,
        ),
      ),
    ).toBe("42501");
    const upd = await inHub(
      as2,
      (tx) => tx`update hub.people_profiles set avatar = ${PNG} where user_id = ${U.a1}`,
    ).catch((e: { code?: string }) => e);
    expect(upd).toMatchObject({ count: 0 });
    expect(
      await code(() =>
        inHub(
          scope("b1", T.b),
          (tx) =>
            tx`insert into hub.people_profiles (tenant_id, user_id, avatar) values (${T.a}, ${U.a1}, ${PNG})`,
        ),
      ),
    ).toBe("42501");
    expect(
      await code(() =>
        inHub(
          scope("a1", T.a),
          (tx) => tx`update hub.people_profiles set job_title = 'Giám đốc' where user_id = ${U.a1}`,
        ),
      ),
    ).toBe("42501");
    // Hàng của tôi không đổi.
    expect(
      (await o`select avatar from hub.people_profiles where user_id = ${U.a1}`)[0]?.avatar,
    ).toBeNull();
  });

  it("luật ảnh (cùng CR-138): sai định dạng/quá lớn bị CHECK chặn", async () => {
    const big = `data:image/png;base64,${"A".repeat(2_900_000)}`;
    expect(
      await code(() => svc.setMine(au("a1", T.a), "avatar", "data:image/svg+xml;base64,AAAA")),
    ).toBe("23514");
    expect(await code(() => svc.setMine(au("a1", T.a), "avatar", big))).toBe("23514");
  });

  it("fix-review-r1 · avatar 200 KB bị CHECK 0144 chặn; 100 KB vẫn được", async () => {
    const kb200 = `data:image/webp;base64,${"A".repeat(273_000)}`;
    const kb100 = `data:image/webp;base64,${"A".repeat(136_000)}`;
    expect(await code(() => svc.setMine(au("a1", T.a), "avatar", kb200))).toBe("23514");
    expect(await code(() => svc.setMine(au("a1", T.a), "avatar", kb100))).toBe("ok");
  });

  it("fix-review-r1 · đối tác chỉ thấy thẻ người cùng tổ chức đối tác, không lộ nhân viên chủ quản (cờ lấy từ DB, không tin token)", async () => {
    await o`insert into hub.people_profiles (tenant_id, user_id, job_title, avatar) values (${T.a}, ${U.a2}, 'Trưởng nhóm bán hàng', ${PNG})
      on conflict (tenant_id, user_id) do update set job_title = excluded.job_title, avatar = excluded.avatar`;
    const ids = [U.a1, U.a2, U.e1, U.e2, U.e3, U.b1];
    const ext = { ...au("e1", T.a), userKind: "external" } as AuthUser;
    const r = await svc.cards(ext, ids);
    expect(r.items.map((x) => x.user_id).sort()).toEqual([U.e1, U.e2].sort());
    expect(JSON.stringify(r)).not.toContain("Trưởng nhóm");
    // Token khai "internal" nhưng DB là external ⇒ vẫn bị chặn như đối tác.
    expect((await svc.cards(au("e1", T.a), [U.a1, U.a2, U.e3])).items).toEqual([]);
    // Nhân viên vẫn thấy cả đối tác lẫn nhân viên (không đổi hành vi).
    expect((await svc.cards(au("a1", T.a), [U.a2, U.e1])).items.length).toBe(2);
    // Chéo tenant: đối tác của A xin id của B ⇒ rỗng.
    expect((await svc.cards(ext, [U.b1])).items).toEqual([]);
  });
});
