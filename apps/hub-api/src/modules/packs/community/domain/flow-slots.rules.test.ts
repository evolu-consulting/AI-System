// CR-120 · cr120-community-flows · unit cho SlotSpec 3 khe Community: khung bước cố định, chỉ đổi tên/giờ nhắc.
import { describe, expect, it } from "bun:test";
import { SLOT_JOIN, SLOT_MODERATION, SLOT_REPORT } from "./flow.rules";
import { communitySlotSpecs, compileSlotBody, validateSlotBody } from "./flow-slots.rules";

const mod = () => ({
  steps: [
    { key: "screen", kind: "agent", name: "Sàng lọc" },
    { key: "review", kind: "review", name: "Duyệt", remind_every_h: 12, escalate_after_h: 48 },
    { key: "publish", kind: "set", name: "Đăng" },
  ],
});
const join = () => ({
  steps: [
    { key: "apply", kind: "form", name: "Form" },
    { key: "review", kind: "review", name: "Duyệt" },
    { key: "link", kind: "set", name: "Liên kết" },
  ],
});
const report = () => ({
  steps: [
    { key: "triage", kind: "agent", name: "Phân loại" },
    { key: "review", kind: "review", name: "Xử lý" },
    { key: "action", kind: "set", name: "Hành động" },
  ],
});

describe("validateSlotBody", () => {
  it("khung chuẩn của 3 khe hợp lệ", () => {
    expect(validateSlotBody(SLOT_MODERATION, mod())).toEqual([]);
    expect(validateSlotBody(SLOT_JOIN, join())).toEqual([]);
    expect(validateSlotBody(SLOT_REPORT, report())).toEqual([]);
  });
  it("khe lạ / sai hình ⇒ SLOT_UNKNOWN / SLOT_SHAPE", () => {
    expect(validateSlotBody("x.y", mod())).toEqual([{ path: "", rule: "SLOT_UNKNOWN" }]);
    expect(validateSlotBody(SLOT_MODERATION, { steps: "no" })).toEqual([
      { path: "steps", rule: "SLOT_SHAPE" },
    ]);
    expect(validateSlotBody(SLOT_MODERATION, null)).toEqual([
      { path: "steps", rule: "SLOT_SHAPE" },
    ]);
  });
  it("thêm/bớt bước ⇒ SLOT_STEPS_FIXED, đổi key/kind ⇒ SLOT_STEPS_FIXED tại bước đó", () => {
    const more = mod();
    more.steps.push({ key: "x", kind: "set", name: "x" });
    expect(validateSlotBody(SLOT_MODERATION, more)).toEqual([
      { path: "steps", rule: "SLOT_STEPS_FIXED" },
    ]);
    const bad = mod();
    (bad.steps[1] as { kind: string }).kind = "form";
    expect(validateSlotBody(SLOT_MODERATION, bad)).toEqual([
      { path: "steps.1", rule: "SLOT_STEPS_FIXED" },
    ]);
  });
  it("tên rỗng/quá dài ⇒ NAME_INVALID, giờ ngoài 1..168 hoặc không nguyên ⇒ HOURS_INVALID", () => {
    const b = mod();
    (b.steps[0] as { name: string }).name = " ";
    (b.steps[1] as { remind_every_h: number }).remind_every_h = 0;
    (b.steps[2] as { name: string }).name = "x".repeat(201);
    expect(validateSlotBody(SLOT_MODERATION, b).map((i) => i.rule)).toEqual([
      "NAME_INVALID",
      "HOURS_INVALID",
      "NAME_INVALID",
    ]);
    const c = mod();
    (c.steps[1] as { escalate_after_h: number }).escalate_after_h = 1.5;
    expect(validateSlotBody(SLOT_MODERATION, c)[0]?.rule).toBe("HOURS_INVALID");
  });
});

describe("compileSlotBody", () => {
  it("dựng stages: tool khoá của khe, input theo khe, bước duyệt có group community-admin + nhắc", () => {
    const st = compileSlotBody(SLOT_MODERATION, mod()) as {
      key: string;
      executor: { tool_key: string; args: Record<string, unknown> };
      after: { kind: string; remind_every_h?: number | null; group_key?: string };
      slot: { agent_key?: string };
    }[];
    expect(st.map((s) => s.executor.tool_key)).toEqual([
      "community-screen",
      "community-moderate",
      "community-publish",
    ]);
    expect(st[0]?.executor.args).toEqual({ post_id: { from: "input", key: "post-id" } });
    expect(st[0]?.slot.agent_key).toBe("community-screen");
    expect(st[1]?.after).toMatchObject({
      kind: "review",
      remind_every_h: 12,
      group_key: "community-admin",
    });
    expect(st[2]?.after.kind).toBe("auto");
  });
  it("body sai ⇒ ném (không biên dịch)", () => {
    expect(() => compileSlotBody(SLOT_REPORT, { steps: [] })).toThrow();
    expect(() => compileSlotBody("x.y", report())).toThrow();
  });
});

describe("communitySlotSpecs", () => {
  it("đủ 3 khe gói community, input bắt buộc + nhóm duyệt community-admin", () => {
    const s = communitySlotSpecs();
    expect(s.map((x) => x.key).sort()).toEqual([SLOT_JOIN, SLOT_MODERATION, SLOT_REPORT].sort());
    for (const x of s) {
      expect(x.packKey).toBe("community");
      expect(x.groupKeys?.({} as never)).toEqual([]); // người duyệt do gói quyết, không đòi Group khi gán
      expect(x.requiredInputs).toHaveLength(1);
    }
  });
});
