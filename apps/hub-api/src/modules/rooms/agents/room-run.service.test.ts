// X2b review-2 #N2 · D15 nhánh lỗi (review-1 #4): E15 lỗi không ném, writer tự kết thúc `cancelled`, mọi lỗi chỉ log.
import { describe, expect, it } from "bun:test";
import type { AuthUser } from "../../../lib/auth.middleware";
import { cancelDeclined } from "./room-run.service";

const U: AuthUser = {
  userId: "a2bb0000-0000-4000-8000-000000000001",
  tenantId: "a2bb0000-0000-4000-8000-000000000002",
  role: "member",
};
const RUN = "a2bb0000-0000-4000-8000-000000000003";

function harness(o: { cancelFails?: boolean; finishFails?: boolean }) {
  const warns: string[] = [];
  const finished: unknown[] = [];
  const d = {
    cancel: {
      cancel: async () => {
        if (o.cancelFails) throw new Error("e15");
      },
    },
    log: { warn: (msg: string) => warns.push(msg) },
  };
  const writer = {
    finish: async (x: unknown) => {
      finished.push(x);
      if (o.finishFails) throw new Error("finish");
      return true;
    },
  };
  return { d, writer, warns, finished };
}

describe("cancelDeclined · D15", () => {
  it("E15 thành công ⇒ không đụng writer, không log", async () => {
    const h = harness({});
    await cancelDeclined(h.d, U, RUN, h.writer);
    expect({ finished: h.finished, warns: h.warns }).toEqual({ finished: [], warns: [] });
  });

  it("E15 ném ⇒ không ném, writer kết thúc `CANCELLED`, log cancel-failed", async () => {
    const h = harness({ cancelFails: true });
    await cancelDeclined(h.d, U, RUN, h.writer);
    expect(h.finished).toEqual([{ kind: "failed", code: "CANCELLED" }]);
    expect(h.warns).toEqual(["room-decline-cancel-failed"]);
  });

  it("E15 và writer cùng ném ⇒ vẫn không ném, log cả hai", async () => {
    const h = harness({ cancelFails: true, finishFails: true });
    await cancelDeclined(h.d, U, RUN, h.writer);
    expect(h.warns).toEqual(["room-decline-cancel-failed", "room-decline-finish-failed"]);
  });

  it("E15 ném, không có writer ⇒ chỉ log", async () => {
    const h = harness({ cancelFails: true });
    await cancelDeclined(h.d, U, RUN, undefined);
    expect(h.warns).toEqual(["room-decline-cancel-failed"]);
  });
});
