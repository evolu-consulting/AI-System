// CR-123 U2 (FLOW3-FR-13) · unit: thẻ duyệt 3 dòng (trạng thái · lý do · bước kế), nút theo vai, từ vựng "Cần xử lý"/"Duyệt".
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ApprovalCardStep, ContractApproval } from "@ai/contracts/pack-contracts";
import { approvalView } from "./approval";
import { esignStatusLines, noRecipientSteps, rowStatusLines } from "./card-status";
import type { TimelineRow } from "./engine-card";

const NOW = Date.parse("2026-11-08T09:00:00Z");
const fmt = (iso: string) => `@${iso.slice(0, 10)}`;
const row = (o: Partial<TimelineRow>): TimelineRow => ({
  idx: 1,
  name: "Duyệt kế toán",
  group: "Kế toán",
  headOnly: false,
  status: "open",
  due: null,
  escalatedTo: null,
  decidedBy: null,
  decidedAt: null,
  feedback: null,
  skipWhen: null,
  ownerOverride: false,
  overdue: false,
  ...o,
});
const me = { canAct: true, now: NOW, fmt };
const other = { ...me, canAct: false };
const keys = (l: ReturnType<typeof rowStatusLines>) => [l.state.key, l.reason.key, l.next.key];
const C = "contracts.approval.card";

describe("CR-125 · cùng duyệt: thẻ nhóm khác bị đóng", () => {
  const ctx = { canAct: false, now: 0, fmt: (s: string) => s };
  test("bước xong, thẻ của mình bị đóng kèm lý do ⇒ «Đã đóng» + lý do, không «Đã duyệt / Hệ thống tự chuyển»", () => {
    const l = rowStatusLines(
      row({ status: "passed", decidedBy: null, feedback: "Đã có người từ chối/trả lại" }),
      ctx,
    );
    expect(l.state.key).toBe("contracts.approval.card.state.closed");
    expect(l.reason.key).toBe("contracts.approval.card.reason.closedDeclined");
    expect(
      rowStatusLines(row({ status: "passed", decidedBy: null, feedback: "Đã đủ người duyệt" }), ctx)
        .reason.key,
    ).toBe("contracts.approval.card.reason.closedEnough");
  });
  test("bước tự chuyển bình thường (không lý do) giữ nguyên «Đã duyệt»", () => {
    const l = rowStatusLines(row({ status: "passed", decidedBy: null, feedback: null }), ctx);
    expect(l.state.key).toBe("contracts.approval.card.state.passed");
  });
});
describe("rowStatusLines · mỗi trạng thái đủ 3 dòng", () => {
  test("đang chờ: ai duyệt · hạn · bạn hay người khác cần làm", () => {
    const r = row({ due: { at: "2026-11-09T09:00:00Z", flag: null } });
    const mine = rowStatusLines(r, me);
    expect(mine.state).toEqual({ key: `${C}.state.open`, vars: { who: "Kế toán" } });
    expect(mine.reason).toEqual({ key: `${C}.reason.openDue`, vars: { due: "@2026-11-09" } });
    expect(mine.next.key).toBe(`${C}.next.openMe`);
    expect(rowStatusLines(r, other).next).toEqual({
      key: `${C}.next.openOther`,
      vars: { who: "Kế toán" },
    });
  });
  test("quá hạn nói số giờ; chưa đặt hạn nói rõ", () => {
    const late = rowStatusLines(
      row({ due: { at: "2026-11-08T05:00:00Z", flag: "overdue" }, overdue: true }),
      me,
    );
    expect(late.reason).toEqual({
      key: `${C}.reason.openOverdue`,
      vars: { n: 4, due: "@2026-11-08" },
    });
    expect(rowStatusLines(row({}), me).reason.key).toBe(`${C}.reason.openNoDue`);
  });
  test("đã duyệt: bởi ai lúc nào (hoặc duyệt thay / hệ thống tự chuyển)", () => {
    const by = rowStatusLines(
      row({ status: "passed", decidedBy: "An", decidedAt: "2026-11-08T01:00:00Z" }),
      me,
    );
    expect(by.reason).toEqual({
      key: `${C}.reason.passedBy`,
      vars: { name: "An", at: "@2026-11-08" },
    });
    expect(
      rowStatusLines(row({ status: "passed", decidedBy: "An", ownerOverride: true }), me).reason
        .key,
    ).toBe(`${C}.reason.passedOwner`);
    expect(rowStatusLines(row({ status: "passed" }), me).reason.key).toBe(`${C}.reason.passedAuto`);
  });
  test("trả lại / từ chối: lý do là góp ý của người duyệt, thiếu thì câu mặc định", () => {
    expect(rowStatusLines(row({ status: "returned", feedback: "Sửa giá" }), me).reason).toEqual({
      key: `${C}.reason.feedback`,
      vars: { text: "Sửa giá" },
    });
    expect(keys(rowStatusLines(row({ status: "rejected" }), me))).toEqual([
      `${C}.state.rejected`,
      `${C}.reason.rejectedNone`,
      `${C}.next.rejected`,
    ]);
  });
  test("mọi trạng thái đều có đủ state + reason + next", () => {
    for (const status of [
      "pending",
      "open",
      "passed",
      "skipped",
      "returned",
      "rejected",
      "running",
      "failed",
    ] as const) {
      const l = rowStatusLines(row({ status }), other);
      expect(l.state.key).toStartWith(`${C}.state.`);
      expect(l.reason.key).toStartWith(`${C}.reason.`);
      expect(l.next.key).toStartWith(`${C}.next.`);
    }
  });
});

describe("esignStatusLines", () => {
  const e = (o: Partial<NonNullable<ContractApproval["esign"]>>) => ({
    key: "esign",
    name: "Ký số",
    status: "needs_decision" as const,
    reason: "NO_PARTNER_EMAIL" as const,
    can_resend: true,
    ...o,
  });
  test("lỗi: lý do kèm cách sửa + bước kế theo quyền gửi lại", () => {
    const l = esignStatusLines(e({}));
    expect(l.reason.key).toBe("contracts.approval.esign.reason.NO_PARTNER_EMAIL");
    expect(l.next.key).toBe("contracts.approval.esign.line.next.resend");
    expect(esignStatusLines(e({ can_resend: false })).next.key).toEndWith("next.owner");
  });
  test("chờ ký có/không hạn", () => {
    expect(
      esignStatusLines(e({ status: "sent", reason: null, due_at: "2026-11-09T00:00:00Z" })).reason
        .key,
    ).toEndWith("reason.sent");
    expect(esignStatusLines(e({ status: "sent", reason: null })).reason.key).toEndWith(
      "reason.sentNoDue",
    );
  });
});

describe("noRecipientSteps (NOTIFY_NO_RECIPIENT)", () => {
  test("chỉ bước có cảnh báo", () => {
    expect(
      noRecipientSteps([
        { name: "Báo giám đốc", warning: "NOTIFY_NO_RECIPIENT" },
        { name: "Duyệt" },
        { name: "Báo sale", warning: null },
      ]),
    ).toEqual(["Báo giám đốc"]);
  });
});

describe("nút theo vai (người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối)", () => {
  const G = "11111111-1111-4111-8111-111111111111";
  const st = (o: Partial<ApprovalCardStep>): ApprovalCardStep => ({
    idx: 1,
    key: "s1",
    name: "Kế toán",
    kind: "review",
    status: "open",
    group_id: G,
    head_only: false,
    escalated_group_id: null,
    due_at: null,
    escalated: false,
    decided_by: null,
    decided_at: null,
    feedback: null,
    ...o,
  });
  const card = (o: Partial<ContractApproval> = {}): ContractApproval => ({
    mode: "engine",
    run_id: G,
    run_status: "running",
    step: "level1",
    task_id: G,
    can_act: true,
    feedback: null,
    steps: [st({ idx: 0, key: "s0", status: "passed" }), st({})],
    ...o,
  });
  test("người duyệt: đúng ba nút, không Xác nhận / Đọc lại", () => {
    const v = approvalView(card(), { write: true, hasSource: true });
    expect(v).toMatchObject({ pass: true, back: true, reject: true });
    expect(v.confirm).toBe(false);
    expect(v.redo).toBe(false);
    expect(v.approve).toBe(false);
  });
  test("chỉ xem hoặc không thuộc nhóm duyệt: không nút nào, có lý do", () => {
    const view = approvalView(card(), { write: false, hasSource: true });
    expect([view.pass, view.back, view.reject, view.confirm]).toEqual([
      undefined,
      undefined,
      false,
      false,
    ]);
    expect(view.note).toBe("contracts.approval.blocked.viewOnly");
    const nr = approvalView(card({ can_act: false, block_reason: "not_reviewer" }), {
      write: true,
      hasSource: true,
    });
    expect(nr.pass).toBeUndefined();
    expect(nr.note).toBe("contracts.approval.engine.blocked.notReviewer");
  });
});

describe("từ vựng thẻ duyệt trong chuỗi contracts", () => {
  const dir = new URL("../../../../../../packages/i18n/locales/contracts/", import.meta.url);
  const vi = readdirSync(dir)
    .filter((f) => f.endsWith(".vi.json") || f === "vi.json")
    .map((f) => ({ f, text: readFileSync(new URL(f, dir), "utf8") }));
  test("một chữ 'Cần xử lý': không còn 'Cần quyết', 'Giai đoạn'", () => {
    for (const { f, text } of vi) {
      expect(text, f).not.toContain("Cần quyết");
      expect(text, f).not.toContain("Giai đoạn");
    }
  });
  test("nút người duyệt: 'Duyệt' · 'Trả lại sửa', không 'Đạt' / 'đi tới'", () => {
    const main = JSON.parse(vi.find((x) => x.f === "vi.json")?.text ?? "{}");
    expect(main.contracts.approval.pass).toBe("Duyệt");
    expect(main.contracts.approval.return).toBe("Trả lại sửa");
    for (const { f, text } of vi) {
      expect(text, f).not.toContain("đi tới");
      expect(text, f).not.toContain('"Đạt"');
    }
  });
  test("mọi khoá 3 dòng dùng trong builder đều có chữ tiếng Việt", () => {
    const merged: Record<string, unknown>[] = vi.map((x) => JSON.parse(x.text).contracts);
    const get = (k: string) =>
      merged
        .map((m) =>
          k
            .split(".")
            .slice(1)
            .reduce<unknown>((o, p) => (o as never)?.[p], m),
        )
        .find((v) => typeof v === "string");
    const all = [
      ...(
        [
          "pending",
          "open",
          "passed",
          "skipped",
          "returned",
          "rejected",
          "running",
          "failed",
        ] as const
      )
        .flatMap((s) =>
          [me, other].map((c) => rowStatusLines(row({ status: s, decidedBy: "A" }), c)),
        )
        .flatMap(keys),
      ...(["pending", "sending", "sent", "completed", "needs_decision"] as const).flatMap((s) =>
        keys(
          esignStatusLines({
            key: "e",
            name: "Ký số",
            status: s,
            reason: "SEND_FAILED",
            can_resend: false,
          }),
        ),
      ),
    ];
    for (const k of new Set(all)) expect(get(k), k).toBeDefined();
  });
});
