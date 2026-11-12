// CR-127 · SG1 · `GET /obligations` gắn `task.claimed_by_name`: MỘT lần tra tên cho cả danh sách; không có người giữ việc ⇒ 0 lần tra.
import { describe, expect, it } from "bun:test";
import { withClaimerNames } from "./ledger.routes";

const who = { tenantId: "t", userId: "u" };
const row = (id: string, by: string | null) => ({
  id,
  task:
    by === null
      ? null
      : {
          task_id: `k${id}`,
          state: "claimed" as const,
          claimed_by: by,
          claimed_by_name: undefined as string | null | undefined,
        },
});

describe("withClaimerNames", () => {
  it("một lần tra cho nhiều mốc; tên lạ ⇒ null; mốc không có việc giữ nguyên", async () => {
    let calls = 0;
    const names = async () => {
      calls++;
      return new Map([["a", "Nguyễn A"]]);
    };
    const out = await withClaimerNames(
      [row("1", "a"), row("2", "a"), row("3", "zz"), row("4", null)],
      who,
      names,
    );
    expect(calls).toBe(1);
    expect(out.map((o) => o.task?.claimed_by_name ?? null)).toEqual([
      "Nguyễn A",
      "Nguyễn A",
      null,
      null,
    ]);
    expect(out[3]?.task).toBeNull();
  });

  it("không ai giữ việc ⇒ không tra tên", async () => {
    let calls = 0;
    const out = await withClaimerNames([row("1", null)], who, async () => {
      calls++;
      return new Map();
    });
    expect(calls).toBe(0);
    expect(out).toHaveLength(1);
  });
});
