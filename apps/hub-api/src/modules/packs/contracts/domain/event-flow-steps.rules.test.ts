// CR-125 · S2 · stage của flow theo sự kiện ⇒ bước hiển thị ở Cài đặt (cùng flow tab Quy trình).
import { describe, expect, it, test } from "bun:test";
import { stepsOfStages } from "./event-flow-steps.rules";

const approve = (name: string, step: number, after: Record<string, unknown>) => ({
  name,
  step,
  executor: { kind: "approve" },
  after: { kind: "review", ...after },
});

it("Duyệt 2 cấp: hai bước duyệt + ký số + thông báo, bỏ Chờ ký xong / Kết thúc, theo thứ tự step", () => {
  const stages = [
    { name: "Kết thúc · Đã duyệt", step: 5, executor: { kind: "set" }, outcome: "approved" },
    approve("Giám đốc duyệt", 1, { group_key: "giam-doc", group_id: null }),
    approve("Trưởng phòng duyệt", 0, { group_id: "g-1", group_key: null }),
    { name: "Ký số", step: 2, executor: { kind: "tool", tool_key: "contracts-esign-send" } },
    { name: "Chờ ký xong", step: 3, executor: { kind: "wait_event" } },
    { name: "Báo người tạo", step: 4, executor: { kind: "notify" } },
  ];
  const r = stepsOfStages(stages);
  expect(r.branches).toBe(false);
  expect(r.steps.map((s) => [s.name, s.kind, s.groupId, s.groupKey])).toEqual([
    ["Trưởng phòng duyệt", "review", "g-1", null],
    ["Giám đốc duyệt", "review", null, "giam-doc"],
    ["Ký số", "esign", null, null],
    ["Báo người tạo", "notify", null, null],
  ]);
});

it("có node Nếu ⇒ branches = true; stage rác không làm hỏng", () => {
  const r = stepsOfStages([
    { name: "Nhánh", step: 0, executor: { kind: "if" } },
    approve("Pháp chế duyệt", 1, { group_key: "phap-che" }),
    null,
    "x",
  ]);
  expect(r.branches).toBe(true);
  expect(r.steps.map((s) => s.name)).toEqual(["Pháp chế duyệt"]);
});

describe("CR-146 · signPartnerOf (khối ký / đối tác chỉ xem)", () => {
  const G = "11111111-1111-4111-8111-111111111111";
  const c = (value: string | boolean) => ({ from: "const", value });
  test("đọc args hằng của stage Ký + có Gửi đối tác", async () => {
    const { signPartnerOf } = await import("./event-flow-steps.rules");
    const v = signPartnerOf([
      {
        executor: {
          kind: "tool",
          tool_key: "contracts-esign-send",
          args: { company_signers: c(`group:${G}`), partner_signs: c(true), order: c("parallel") },
        },
      },
      { executor: { kind: "tool", tool_key: "contracts-partner-send", args: {} } },
    ]);
    expect(v).toEqual({
      esign: {
        signers: [{ kind: "group", id: G }],
        partnerSigns: true,
        order: "parallel",
        provider: null,
      },
      partnerSend: true,
    });
  });
  test("không có bước Ký / Gửi ⇒ esign null, partnerSend false", async () => {
    const { signPartnerOf } = await import("./event-flow-steps.rules");
    expect(signPartnerOf([{ executor: { kind: "approve" } }])).toEqual({
      esign: null,
      partnerSend: false,
    });
  });
});
