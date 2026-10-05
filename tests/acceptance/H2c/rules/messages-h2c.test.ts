// HUB-FR-44 · H2c-R12 · Message.attachments: toMessage(refs), toAttachmentRef (test-plan H2c §1, cases §1.8 R42–R43;
// chữ ký plan-rules §5 `conversations.rules.ts`).
import { describe, expect, it } from "bun:test";
import {
  type AttachmentRef,
  type Message,
  MessageSchema,
  type Responder,
  type RunSummary,
} from "@ai/contracts/chat";
import * as conv from "../../../../apps/hub-api/src/modules/conversations/conversations.rules";
import {
  type MessageRow,
  toMessage,
} from "../../../../apps/hub-api/src/modules/conversations/conversations.rules";
import { lookup, uid } from "./_rules";

/** Chữ ký plan-rules §5: `toMessage(m, run, responder?, refs?)` — stub B0 chưa thêm `refs` (gán được: ít tham số hơn). */
type ToMessage = (
  m: MessageRow,
  run: RunSummary | null,
  responder?: Responder | null,
  refs?: readonly AttachmentRef[],
) => Message;
const toMessageRefs: ToMessage = toMessage;

type RefRow = {
  id: string;
  filename: string;
  mime: AttachmentRef["mime"];
  size: number;
  purgedAt: Date | null;
};
/** `toAttachmentRef` chưa có stub ở B0 (báo backend-lead). */
const toAttachmentRef = lookup<(r: RefRow) => AttachmentRef>(
  conv,
  "toAttachmentRef",
  "conversations/conversations.rules.ts",
);

const AT = new Date("2026-10-05T01:00:00.000Z");
const row = (role: "user" | "assistant"): MessageRow => ({
  id: uid(801),
  conversationId: uid(802),
  flowId: uid(803),
  role,
  content: role === "user" ? "Đọc hoá đơn này" : "Tổng tiền 1.200.000đ",
  runId: role === "user" ? null : uid(804),
  ask: null,
  createdAt: AT,
});
const RUN: RunSummary = { id: uid(804), status: "finished", ms: 1200, steps: [], error: null };
const REFS: AttachmentRef[] = [
  { id: uid(811), filename: "Hoá đơn.pdf", mime: "application/pdf", size: 2048, available: true },
  { id: uid(812), filename: "ket-qua.csv", mime: "text/csv", size: 10, available: false },
];

describe("HUB-FR-44 · toMessage + attachments [R42]", () => {
  it("HUB-FR-44 · R42 · refs vắng / [] → y hệt H2b, không khoá attachments [H2c-R12 · HUB-H2c-AC-06]", () => {
    for (const [role, run] of [
      ["user", null],
      ["assistant", RUN],
    ] as const) {
      const h2b = toMessage(row(role), run);
      const empty = toMessageRefs(row(role), run, undefined, []);
      expect(empty).toEqual(h2b);
      expect("attachments" in empty).toBe(false);
      expect("attachments" in toMessageRefs(row(role), run)).toBe(false);
    }
  });

  it("HUB-FR-44 · R42 · refs 2 mục → khoá attachments đúng thứ tự, parse MessageSchema (user và assistant) [H2c-R12]", () => {
    for (const [role, run] of [
      ["user", null],
      ["assistant", RUN],
    ] as const) {
      const m = toMessageRefs(row(role), run, null, REFS);
      expect(m.attachments).toEqual(REFS);
      expect(MessageSchema.safeParse(m).success).toBe(true);
      const { attachments: _drop, ...rest } = m;
      expect(rest).toEqual(toMessage(row(role), run));
    }
  });
});

describe("HUB-FR-44 · toAttachmentRef [R43]", () => {
  it("HUB-FR-44 · R43 · available = purgedAt null; đúng 5 khoá [H2c-R12 · HUB-H2c-AC-13]", () => {
    const r: RefRow = {
      id: uid(821),
      filename: "a.pdf",
      mime: "application/pdf",
      size: 5,
      purgedAt: null,
    };
    expect(toAttachmentRef(r)).toEqual({
      id: uid(821),
      filename: "a.pdf",
      mime: "application/pdf",
      size: 5,
      available: true,
    });
    const gone = toAttachmentRef({ ...r, purgedAt: AT });
    expect(gone.available).toBe(false);
    expect(Object.keys(gone).sort()).toEqual(["available", "filename", "id", "mime", "size"]);
  });
});
