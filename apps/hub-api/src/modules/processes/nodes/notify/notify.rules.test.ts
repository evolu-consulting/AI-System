// CR-121 D-6 · node `notify` — luật thuần: mẫu, người nhận, khoá chống trùng, kiểm def, .md cảnh báo.
import { describe, expect, it } from "bun:test";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import {
  NOTIFY_KIND_BELL,
  NOTIFY_KIND_MAIL,
  notifyDedupKey,
  notifyDefIssues,
  notifyKindOf,
  notifyOutputMd,
  notifyTargets,
  renderNotify,
} from "./notify.rules";

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";

describe("CR-121 D-6 · notify.rules", () => {
  it("mẫu thay biến input, biến lạ ⇒ rỗng, cắt trần", () => {
    expect(renderNotify("HĐ {contract-number}: {x}", { "contract-number": "HD-1" }, 200)).toBe(
      "HĐ HD-1:",
    );
    expect(renderNotify("{a}{a}", { a: "xyz" }, 4)).toBe("xyzx");
  });
  it("người nhận: starter + user ở input (sai dạng bỏ) + mã Group, không trùng", () => {
    const t = notifyTargets(
      {
        to: [
          { who: "starter" },
          { who: "input_user", input: "owner" },
          { who: "input_user", input: "bad" },
          { who: "group", group_key: "giam-doc" },
        ],
      },
      S,
      { owner: U.toUpperCase(), bad: "khong-phai-uuid" },
    );
    expect(t).toEqual({ userIds: [S, U], groupKeys: ["giam-doc"] });
  });
  it("khoá chống trùng theo (run, stage run, lần thử); kind theo kênh", () => {
    expect(notifyDedupKey("r", "s", 2)).toBe("pn:r:s:2");
    expect(notifyDedupKey("r", "s", 2)).not.toBe(notifyDedupKey("r", "s", 3));
    expect(notifyKindOf({ channels: ["bell"] })).toBe(NOTIFY_KIND_BELL);
    expect(notifyKindOf({ channels: ["bell", "email"] })).toBe(NOTIFY_KIND_MAIL);
  });
  it("người nhận rỗng ⇒ .md cảnh báo nói vì sao; chạy lại ⇒ ghi 'không gửi lại'", () => {
    expect(notifyOutputMd("Báo", { recipients: 0, inserted: 0, title: "t" })).toContain(
      "Cảnh báo: không có người nhận",
    );
    expect(notifyOutputMd("Báo", { recipients: 2, inserted: 0, title: "t" })).toContain(
      "không gửi lại",
    );
  });
  it("NOTIFY_INVALID: thiếu người nhận / kênh / tiêu đề / input người nhận chưa khai", () => {
    const d = {
      inputs: [],
      stages: [
        {
          executor: {
            kind: "notify",
            to: [{ who: "input_user", input: "owner" }],
            channels: [],
            title: " ",
            body: "",
          },
        },
        { executor: { kind: "notify", to: [], channels: ["bell"], title: "x", body: "" } },
      ],
    } as unknown as ProcessDefInput;
    expect(notifyDefIssues(d)).toEqual([
      { path: "stages.0.executor.to", rule: "NOTIFY_INVALID" },
      { path: "stages.0.executor.channels", rule: "NOTIFY_INVALID" },
      { path: "stages.0.executor.title", rule: "NOTIFY_INVALID" },
      { path: "stages.1.executor.to", rule: "NOTIFY_INVALID" },
    ]);
  });
});
