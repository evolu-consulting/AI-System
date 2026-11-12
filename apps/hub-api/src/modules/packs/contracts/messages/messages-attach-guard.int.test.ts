// SEC 2026-11-12 · CR-132 · int (DB thật, role gói `contracts_rw`, migration 0109): thành viên hội thoại KHÔNG gắn được tệp hợp đồng
// (dù chính mình tạo) vào `msg_files` — nếu gắn được, `files_msg_sel` (0108) giấu tệp HĐ với đồng nghiệp và Thu hồi tin xoá luôn tệp HĐ.
// Tệp mới tải lên (chưa dùng ở đâu) vẫn gắn được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAsRollback, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

let o: Sql;
let T = "";
let U1 = "";
const C1 = "c1320000-0000-4000-8000-0000000009a1";
const FK = "f1320000-0000-4000-8000-0000000009a1"; // tệp chính của HĐ, do U1 tạo
const FA = "f1320000-0000-4000-8000-0000000009a2"; // tệp kèm HĐ (contract_files), do U1 tạo
const FN = "f1320000-0000-4000-8000-0000000009a3"; // tệp mới tải lên tin nhắn
const K1 = "a1320000-0000-4000-8000-0000000009a1";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 9361)) as [string];
  [U1] = (await users(o, T, 1, { from: 9361 })) as [string];
  await o`insert into contracts.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by) values
    (${FK}, ${T}, ${`t_${T}`}, 'fb-k', 'hop-dong.pdf', 'application/pdf', 10, ${U1}),
    (${FA}, ${T}, ${`t_${T}`}, 'fb-a', 'phu-luc.pdf', 'application/pdf', 10, ${U1}),
    (${FN}, ${T}, ${`t_${T}`}, 'fb-n', 'bao-gia.pdf', 'application/pdf', 10, ${U1})`;
  await o`insert into contracts.contracts (id, tenant_id, title, created_by, file_id)
    values (${K1}, ${T}, 'HĐ bảo mật', ${U1}, ${FK})`;
  await o`insert into contracts.contract_files (tenant_id, contract_id, file_id, added_by)
    values (${T}, ${K1}, ${FA}, ${U1})`;
  await o`insert into contracts.msg_conversations (tenant_id, id, kind, title, created_by, last_seq)
    values (${T}, ${C1}, 'group', 'Nhóm', ${U1}, 0)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role) values (${T}, ${C1}, ${U1}, 'owner')`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const attach = (fid: string) =>
  pgCode(() =>
    inPackAsRollback(
      "contracts",
      T,
      U1,
      (
        tx,
      ) => tx`insert into contracts.msg_files (tenant_id, file_id, conversation_id, seq, uploaded_by)
        values (${T}, ${fid}, ${C1}, null, ${U1})`,
    ),
  );

describe("SEC · không gắn tệp hợp đồng vào tin nhắn", () => {
  it("tệp chính HĐ / tệp kèm HĐ ⇒ 42501; tệp mới tải lên ⇒ được", async () => {
    expect(await attach(FK)).toBe("42501");
    expect(await attach(FA)).toBe("42501");
    expect(await attach(FN)).toBeNull();
  });
});
