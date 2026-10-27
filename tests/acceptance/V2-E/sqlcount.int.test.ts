// V2-E · Luật 4c: bảng điểm v2 / chi tiết / lịch sử giữ SỐ CÂU SQL CỐ ĐỊNH (không theo số đối tác, mốc, việc). Đếm câu pool hub
// gửi (`captureSql` của HD1: trừ BEGIN/COMMIT, tính `set_config` đầu mỗi tx).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql } from "../HD1/_support/hd1";
import { seedBoard } from "./_support/seed";
import { arrangeV2e, type CtxN1, call, ok, P, R, startHd1, T } from "./_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const count = async (fn: () => Promise<unknown>) => (await captureSql(c, fn)).queries.length;
const party = "tax:0500000002";

async function counts() {
  const list = () => ok(call(c, P.hoa, "GET", `${R}/partners`));
  const one = () =>
    ok(call(c, P.hoa, "GET", `${R}/partner?party=${encodeURIComponent(party)}&role=customer`));
  const hist = () =>
    ok(
      call(
        c,
        P.hoa,
        "GET",
        `${R}/history?party=${encodeURIComponent(party)}&role=customer&months=12`,
      ),
    );
  // ấm: kế hoạch truy vấn, cache quyền, kết nối pool mới (đọc song song mở thêm kết nối)
  for (const f of [list, one, hist, list, one, hist]) await f();
  return { list: await count(list), one: await count(one), hist: await count(hist) };
}

describe("V2-E · số câu SQL cố định (Luật 4c)", () => {
  it("5 đối tác × 2 mốc ⇒ 200 đối tác × 8 mốc: cùng số câu; bảng điểm = 4 tx × (set_config + 1) (REP-v3: + câu cờ đỏ U2 song song)", async () => {
    await arrangeV2e(c);
    await seedBoard(c.sql, T.acme, 5, 2);
    const small = await counts();
    await arrangeV2e(c);
    await seedBoard(c.sql, T.acme, 200, 8);
    const big = await counts();
    console.log(`V2-E số câu SQL: nhỏ ${JSON.stringify(small)} · lớn ${JSON.stringify(big)}`);
    expect(big).toEqual(small);
    expect(big.list).toBe(8); // REP-v3 · CR-101b: 3 tx chấm/cấu hình + 1 tx cờ đỏ U2 (song song, số câu cố định)
    const rows = await ok(call(c, P.hoa, "GET", `${R}/partners`));
    expect(rows.length).toBe(600);
  }, 120_000);
});
