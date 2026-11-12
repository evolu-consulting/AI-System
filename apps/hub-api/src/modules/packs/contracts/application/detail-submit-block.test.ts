// CR-127 · NF1: `submit_block` của chi tiết HĐ — chỉ DRAFT bản hiện hành mới hỏi quy trình; không khớp ⇒ 'no_flow' + `can.submit = false`.
import { describe, expect, it } from "bun:test";
import { withSubmitBlock } from "./detail-submit-block";

const can = {
  submit: true,
  withdraw: false,
  recreate: false,
  new_version: false,
  hold: false,
  release: false,
};
const who = { tenantId: "t", userId: "u" };
const of = (status: string, superseded = false) => ({
  id: "c1",
  status,
  superseded,
  can,
  submit_block: undefined as "no_flow" | null | undefined,
});

function run(c: ReturnType<typeof of> | null, open: boolean) {
  const asked: string[] = [];
  const g = withSubmitBlock(
    async () => c,
    async (_w, id) => {
      asked.push(id);
      return open;
    },
  );
  return { out: g(who, "c1"), asked };
}

describe("CR-127 NF1 withSubmitBlock", () => {
  it("DRAFT không quy trình khớp ⇒ no_flow + không bấm được Gửi", async () => {
    const { out, asked } = run(of("draft"), false);
    expect(await out).toMatchObject({ submit_block: "no_flow", can: { submit: false } });
    expect(asked).toEqual(["c1"]);
  });
  it("DRAFT có quy trình ⇒ null, giữ can.submit", async () => {
    const { out } = run(of("draft"), true);
    expect(await out).toMatchObject({ submit_block: null, can: { submit: true } });
  });
  it("không phải DRAFT / bản bị thay thế ⇒ null, không hỏi quy trình", async () => {
    for (const c of [of("processing"), of("draft", true)]) {
      const { out, asked } = run(c, false);
      expect((await out)?.submit_block).toBeNull();
      expect(asked).toEqual([]);
    }
  });
  it("NF1b · tra quy trình lỗi (engine giữ DB đã đóng) ⇒ không ném, submit_block null, giữ can.submit", async () => {
    const errs: unknown[] = [];
    const g = withSubmitBlock(
      async () => of("draft"),
      async () => {
        throw new Error("write CONNECTION_ENDED");
      },
      (e) => errs.push(e),
    );
    expect(await g(who, "c1")).toMatchObject({ submit_block: null, can: { submit: true } });
    expect(errs).toHaveLength(1);
  });
  it("không thấy HĐ ⇒ null", async () => {
    expect(await run(null, false).out).toBeNull();
  });
});
