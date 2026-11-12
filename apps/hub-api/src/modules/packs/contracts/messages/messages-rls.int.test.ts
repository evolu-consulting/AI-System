// CR-132 M1 · HD-MSG-01..12 · RLS của 4 bảng tin nhắn (DB thật, role gói `contracts_rw`, migration 0107): (1) công ty khác không thấy / không ghi chéo;
// (2) nhân viên CÙNG công ty nhưng NGOÀI hội thoại không thấy / không ghi / không tự chèn mình lại; (3) user ngoài (external) không thấy dù có hàng
// thành viên; cộng đường tạo hội thoại hợp lệ + xoá hội thoại rỗng (msg_drop_if_empty) để M3 biết khuôn ghi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, inPackAsRollback, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

let o: Sql;
let T = "";
let T2 = "";
let U1 = ""; // chủ nhóm C1
let U2 = ""; // thành viên C1
let U3 = ""; // cùng công ty, ngoài C1
let V1 = ""; // công ty khác
let X = ""; // user ngoài (external) của T
const ORG = "7e5d0132-0000-4000-8000-000000000001";
const C1 = "c1320000-0000-4000-8000-000000000001"; // nhóm U1 + U2 (T)
const C2 = "c1320000-0000-4000-8000-000000000002"; // nhóm V1 (T2)
const C3 = "c1320000-0000-4000-8000-000000000003"; // nhóm U1 + X (T): X là external nhưng có hàng thành viên
const F1 = "f1320000-0000-4000-8000-000000000001";
const CL = (n: number) => `c1320000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const counts = (tx: Sql) => tx`select
  (select count(*) from contracts.msg_conversations)::int as conv,
  (select count(*) from contracts.msg_members)::int as mem,
  (select count(*) from contracts.msg_messages)::int as msg,
  (select count(*) from contracts.msg_files)::int as fil`;
const ZERO = { conv: 0, mem: 0, msg: 0, fil: 0 };

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 9341)) as [string, string];
  [U1, U2, U3] = (await users(o, T, 3, { from: 9341 })) as [string, string, string];
  [V1] = (await users(o, T2, 1, { from: 9344 })) as [string];
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T}, 'Đối tác RLS tin nhắn')`;
  X = "e1320000-0000-4000-8000-000000000001";
  await o`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, kind, external_org_id)
    values (${X}, ${T}, 'ext9350', 'ext9350@kit.test', 'kit-placeholder-hash', 'Khách ngoài', 'external', ${ORG})`;
  // Nội dung: C1 (T) 2 người + 1 tin kèm 1 tệp; C2 (T2) 1 người + 1 tin; C3 (T) U1 + X.
  await o`insert into contracts.msg_conversations (tenant_id, id, kind, title, created_by, last_seq) values
    (${T}, ${C1}, 'group', 'Mua hàng', ${U1}, 1), (${T2}, ${C2}, 'group', 'Kho T2', ${V1}, 1), (${T}, ${C3}, 'group', 'Có khách ngoài', ${U1}, 0)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role) values
    (${T}, ${C1}, ${U1}, 'owner'), (${T}, ${C1}, ${U2}, 'member'), (${T2}, ${C2}, ${V1}, 'owner'),
    (${T}, ${C3}, ${U1}, 'owner'), (${T}, ${C3}, ${X}, 'member')`;
  await o`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body) values
    (${T}, ${C1}, 1, ${U1}, ${Bun.randomUUIDv7()}, 'xin chào'), (${T2}, ${C2}, 1, ${V1}, ${Bun.randomUUIDv7()}, 'tin T2')`;
  await o`insert into contracts.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${F1}, ${T}, ${`t_${T}`}, 'fb-1', 'bao-gia.pdf', 'application/pdf', 10, ${U1})`;
  await o`insert into contracts.msg_files (tenant_id, file_id, conversation_id, seq, uploaded_by) values (${T}, ${F1}, ${C1}, 1, ${U1})`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-132 M1 · RLS tin nhắn — đường hợp lệ (thành viên)", () => {
  it("thành viên thấy đúng hội thoại của mình (4 bảng); người ngoài công ty / ngoài hội thoại / user ngoài thấy 0", async () => {
    expect(await inPackAs("contracts", T, U2, async (tx) => (await counts(tx))[0])).toEqual({
      conv: 1,
      mem: 2,
      msg: 1,
      fil: 1,
    });
    expect(await inPackAs("contracts", T, U1, async (tx) => (await counts(tx))[0])).toEqual({
      conv: 2,
      mem: 4,
      msg: 1,
      fil: 1,
    });
    // (3) user ngoài có hàng thành viên ở C3 nhưng không thấy gì
    expect(await inPackAs("contracts", T, X, async (tx) => (await counts(tx))[0])).toEqual(ZERO);
  });

  it("tạo hội thoại: id sinh phía app, chèn KHÔNG RETURNING, rồi lô thành viên đầu (người tạo chưa là thành viên); chèn tin; người tạo đã rời không tự chèn lại", async () => {
    const out = await inPackAsRollback("contracts", T, U3, async (tx) => {
      await tx`insert into contracts.msg_conversations (tenant_id, id, kind, title) values (${T}, ${CL(1)}, 'group', 'Nhóm U3')`;
      await tx`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role)
        values (${T}, ${CL(1)}, ${U3}, 'owner'), (${T}, ${CL(1)}, ${U1}, 'member')`;
      await tx`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
        values (${T}, ${CL(1)}, 1, ${U3}, ${Bun.randomUUIDv7()}, 'chào nhóm')`;
      const upd =
        await tx`update contracts.msg_conversations set last_seq = 1 where id = ${CL(1)} returning id`;
      const mine =
        await tx`select count(*)::int as n from contracts.msg_members where conversation_id = ${CL(1)}`;
      // U3 rời (xoá hàng của mình) rồi thử chèn lại mình: created_by = U3 nhưng hội thoại đã có thành viên ⇒ chặn
      await tx`delete from contracts.msg_members where conversation_id = ${CL(1)} and user_id = ${U3}`;
      return { upd: upd.length, members: mine[0]?.n };
    });
    expect(out).toEqual({ upd: 1, members: 2 });
    const rejoin = await pgCode(() =>
      inPackAsRollback("contracts", T, U1, async (tx) => {
        // U1 (người tạo C1) rời C1 rồi tự chèn lại ⇒ 42501 (hội thoại còn U2 ⇒ không còn «trống»)
        await tx`delete from contracts.msg_members where conversation_id = ${C1} and user_id = ${U1}`;
        await tx`insert into contracts.msg_members (tenant_id, conversation_id, user_id) values (${T}, ${C1}, ${U1})`;
      }),
    );
    expect(rejoin).toBe("42501");
  });

  it("người cuối rời ⇒ msg_drop_if_empty xoá hội thoại + đánh dấu xoá tệp; còn thành viên ⇒ false", async () => {
    const out = await inPackAsRollback("contracts", T, U1, async (tx) => {
      const busy = await tx`select contracts.msg_drop_if_empty(${C1}) as r`;
      await tx`delete from contracts.msg_members where conversation_id = ${C1}`; // U1 + U2 (cả hai thấy trong C1 qua policy thành viên)
      const dropped = await tx`select contracts.msg_drop_if_empty(${C1}) as r`;
      const left =
        await tx`select count(*)::int as n from contracts.msg_conversations where id = ${C1}`;
      const file =
        await tx`select deleted_at is not null as gone from contracts.files where id = ${F1}`;
      return {
        busy: busy[0]?.r,
        dropped: dropped[0]?.r,
        left: left[0]?.n,
        fileGone: file[0]?.gone,
      };
    });
    expect(out).toEqual({ busy: false, dropped: true, left: 0, fileGone: true });
    // không DELETE trực tiếp bảng hội thoại / tin / tệp: 0 hàng bị xoá (policy USING false)
    const del = await inPackAsRollback("contracts", T, U1, async (tx) => ({
      conv: (await tx`delete from contracts.msg_conversations where id = ${C1} returning id`)
        .length,
      msg: (
        await tx`delete from contracts.msg_messages where conversation_id = ${C1} returning seq`
      ).length,
      fil: (
        await tx`delete from contracts.msg_files where conversation_id = ${C1} returning file_id`
      ).length,
    }));
    expect(del).toEqual({ conv: 0, msg: 0, fil: 0 });
  });
});

describe("CR-132 M1 · chặn đọc/ghi chéo công ty", () => {
  it("công ty khác: 0 hàng ở cả 4 bảng (kể cả khi GUC tenant trỏ sang T), không chèn tin/thành viên vào hội thoại của T", async () => {
    expect(await inPackAs("contracts", T2, V1, async (tx) => (await counts(tx))[0])).toEqual({
      conv: 1,
      mem: 1,
      msg: 1,
      fil: 0,
    }); // chỉ của T2
    expect(await inPackAs("contracts", T, V1, async (tx) => (await counts(tx))[0])).toEqual(ZERO); // V1 không là thành viên ở T
    const ins = (tid: string) =>
      pgCode(() =>
        inPackAsRollback(
          "contracts",
          T2,
          V1,
          (tx) =>
            tx`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
            values (${tid}, ${C1}, 2, ${V1}, ${Bun.randomUUIDv7()}, 'xâm nhập')`,
        ),
      );
    expect(await ins(T)).toBe("42501"); // tenant_id ≠ GUC
    expect(await ins(T2)).toBe("42501"); // đúng tenant nhưng hội thoại không phải của mình (FK/ policy thành viên)
    // phía T cũng không thấy hàng của T2
    expect(
      await inPackAs(
        "contracts",
        T,
        U1,
        async (tx) =>
          (
            await tx`select count(*)::int as n from contracts.msg_conversations where id = ${C2}`
          )[0],
      ),
    ).toEqual({ n: 0 });
  });
});

describe("CR-132 M1 · chặn người cùng công ty NGOÀI hội thoại + user ngoài", () => {
  it("U3 (cùng T, không ở C1): 0 hàng, không chèn tin / tự thêm mình / sửa / xoá thành viên; thành viên không giả mạo người gửi", async () => {
    expect(await inPackAs("contracts", T, U3, async (tx) => (await counts(tx))[0])).toEqual(ZERO);
    expect(
      await inPackAs(
        "contracts",
        T,
        U3,
        async (tx) => (await tx`select contracts.msg_my_conversations() as a`)[0],
      ),
    ).toEqual({ a: [] });
    const code = (fn: (tx: Sql) => Promise<unknown>, who = U3) =>
      pgCode(() => inPackAsRollback("contracts", T, who, fn));
    expect(
      await code(
        (
          tx,
        ) => tx`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
        values (${T}, ${C1}, 2, ${U3}, ${Bun.randomUUIDv7()}, 'lén')`,
      ),
    ).toBe("42501");
    expect(
      await code(
        (tx) =>
          tx`insert into contracts.msg_members (tenant_id, conversation_id, user_id) values (${T}, ${C1}, ${U3})`,
      ),
    ).toBe("42501");
    expect(
      await code(
        (tx) =>
          tx`insert into contracts.msg_files (tenant_id, file_id, conversation_id, uploaded_by) values (${T}, ${F1}, ${C1}, ${U3})`,
      ),
    ).toBe("42501");
    // U2 là thành viên nhưng không đứng tên người khác
    expect(
      await code(
        (
          tx,
        ) => tx`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
          values (${T}, ${C1}, 2, ${U1}, ${Bun.randomUUIDv7()}, 'giả mạo')`,
        U2,
      ),
    ).toBe("42501");
    const rows = await inPackAsRollback("contracts", T, U3, async (tx) => ({
      upd: (
        await tx`update contracts.msg_conversations set title = 'hack' where id = ${C1} returning id`
      ).length,
      updMsg: (
        await tx`update contracts.msg_messages set deleted_at = now() where conversation_id = ${C1} returning seq`
      ).length,
      del: (
        await tx`delete from contracts.msg_members where conversation_id = ${C1} returning user_id`
      ).length,
      drop: (await tx`select contracts.msg_drop_if_empty(${C1}) as r`)[0]?.r,
    }));
    expect(rows).toEqual({ upd: 0, updMsg: 0, del: 0, drop: false });
    // thu hồi tin: chỉ người gửi (U2 là thành viên nhưng không phải người gửi tin seq 1 ⇒ 0 hàng); U1 (người gửi) thu hồi được
    const revoke = (who: string) =>
      inPackAsRollback(
        "contracts",
        T,
        who,
        async (tx) =>
          (
            await tx`update contracts.msg_messages set body = '', deleted_at = now() where conversation_id = ${C1} and seq = 1 returning seq`
          ).length,
      );
    expect(await revoke(U2)).toBe(0);
    expect(await revoke(U1)).toBe(1);
  });

  it("user ngoài (external): 0 hàng dù có hàng thành viên; không chèn tin, không tạo hội thoại, không drop", async () => {
    expect(await inPackAs("contracts", T, X, async (tx) => (await counts(tx))[0])).toEqual(ZERO);
    const code = (fn: (tx: Sql) => Promise<unknown>) =>
      pgCode(() => inPackAsRollback("contracts", T, X, fn));
    expect(
      await code(
        (
          tx,
        ) => tx`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
        values (${T}, ${C3}, 1, ${X}, ${Bun.randomUUIDv7()}, 'tin của khách ngoài')`,
      ),
    ).toBe("42501");
    expect(
      await code(
        (tx) =>
          tx`insert into contracts.msg_conversations (tenant_id, id, kind, title) values (${T}, ${CL(2)}, 'group', 'Ngoài')`,
      ),
    ).toBe("42501");
    expect(
      await inPackAsRollback(
        "contracts",
        T,
        X,
        async (tx) => (await tx`select contracts.msg_drop_if_empty(${C3}) as r`)[0],
      ),
    ).toEqual({ r: false });
  });

  it("ràng buộc dạng: 1-1 phải có dm_key và không tên; nhóm phải có tên 1..80; trùng dm_key bị chặn; tin ≤ 4000 ký tự", async () => {
    const owner = (q: Promise<unknown>) => pgCode(() => q);
    expect(
      await owner(
        o`insert into contracts.msg_conversations (tenant_id, kind, created_by) values (${T}, 'direct', ${U1})`,
      ),
    ).toBe("23514");
    expect(
      await owner(
        o`insert into contracts.msg_conversations (tenant_id, kind, title, created_by) values (${T}, 'group', '', ${U1})`,
      ),
    ).toBe("23514");
    const key = `${U1}:${U2}`;
    await o`insert into contracts.msg_conversations (tenant_id, kind, dm_key, created_by) values (${T}, 'direct', ${key}, ${U1})`;
    expect(
      await owner(
        o`insert into contracts.msg_conversations (tenant_id, kind, dm_key, created_by) values (${T}, 'direct', ${key}, ${U2})`,
      ),
    ).toBe("23505");
    expect(
      await owner(o`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
        values (${T}, ${C1}, 9, ${U1}, ${Bun.randomUUIDv7()}, ${"x".repeat(4001)})`),
    ).toBe("23514");
  });
});
