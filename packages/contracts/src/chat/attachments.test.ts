// HUB-FR-44, HUB-FR-12 · phần H2c của contract chat (plan §2.1, P2): chỉ thêm, request/tin cũ parse như trước.
import { describe, expect, test } from "bun:test";
import {
  ATTACH_ALLOWED,
  ATTACH_MAX_BYTES,
  AttachmentDetailSchema,
  AttachmentNotFoundDetailsSchema,
  AttachmentRefSchema,
  AttachmentSchema,
  CHAT_API_ERRORS,
  CHAT_ATTACHMENT_ERROR_CODES,
  CHAT_ATTACHMENT_ERRORS,
  CHAT_RUN_ERROR_CODES,
  FILENAME_HEADER,
  MessageSchema,
  SendMessageRequestSchema,
} from "./index";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const AT = "2026-10-05T00:00:00.000Z";
const att = {
  id: U1,
  filename: "a.pdf",
  mime: "application/pdf" as const,
  size: 1,
  created_at: AT,
};
const ref = {
  id: U1,
  filename: "a.pdf",
  mime: "application/pdf" as const,
  size: 1,
  available: true,
};
const userMsg = {
  id: U1,
  conversation_id: U1,
  flow_id: U1,
  role: "user",
  content: "hi",
  run_id: null,
  created_at: AT,
  run: null,
  ask: null,
};

describe("H2c chat attachments", () => {
  test("hằng: 14 đuôi, 20 MiB, header", () => {
    expect(Object.keys(ATTACH_ALLOWED)).toHaveLength(14);
    expect(ATTACH_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(FILENAME_HEADER).toBe("X-Filename");
  });

  test("Attachment / Detail / Ref: strict, size 1–20 MiB, mime trong danh sách", () => {
    expect(AttachmentSchema.parse(att)).toEqual(att);
    expect(AttachmentSchema.safeParse({ ...att, size: 0 }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...att, size: ATTACH_MAX_BYTES + 1 }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...att, mime: "application/zip" }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...att, filename: "a".repeat(201) }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...att, extra: 1 }).success).toBe(false);
    expect(AttachmentDetailSchema.safeParse({ ...att, available: false }).success).toBe(true);
    expect(AttachmentDetailSchema.safeParse(att).success).toBe(false);
    expect(AttachmentRefSchema.parse(ref)).toEqual(ref);
    expect(AttachmentRefSchema.safeParse({ ...ref, created_at: AT }).success).toBe(false);
  });

  test("CHAT_ATTACHMENT_ERRORS riêng, CHAT_API_ERRORS/CHAT_RUN_ERROR_CODES không đổi", () => {
    expect(CHAT_ATTACHMENT_ERRORS).toEqual({
      ATTACHMENT_NOT_FOUND: 404,
      ATTACHMENT_QUOTA_EXCEEDED: 409,
      ATTACHMENT_TOO_LARGE: 413,
      ATTACHMENT_TYPE_NOT_ALLOWED: 415,
    });
    expect(CHAT_ATTACHMENT_ERROR_CODES).toHaveLength(4);
    expect(Object.keys(CHAT_API_ERRORS)).toHaveLength(6);
    expect(CHAT_RUN_ERROR_CODES).toHaveLength(7);
    expect(AttachmentNotFoundDetailsSchema.safeParse({ ids: [U1] }).success).toBe(true);
    expect(AttachmentNotFoundDetailsSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe("H2c chat attachments — tin nhắn", () => {
  test("SendMessageRequest.attachment_ids: vắng giữ nguyên, 1–10, không trùng", () => {
    expect(SendMessageRequestSchema.parse({ content: "hi" })).toEqual({ content: "hi" });
    expect(SendMessageRequestSchema.parse({ content: "hi", attachment_ids: [U1, U2] })).toEqual({
      content: "hi",
      attachment_ids: [U1, U2],
    });
    expect(SendMessageRequestSchema.safeParse({ content: "hi", attachment_ids: [] }).success).toBe(
      false,
    );
    const dup = SendMessageRequestSchema.safeParse({ content: "hi", attachment_ids: [U1, U1] });
    expect(dup.success).toBe(false);
    const eleven = Array.from(
      { length: 11 },
      (_, i) => `${U1.slice(0, 24)}${String(i).padStart(12, "0")}`,
    );
    expect(
      SendMessageRequestSchema.safeParse({ content: "hi", attachment_ids: eleven }).success,
    ).toBe(false);
    expect(
      SendMessageRequestSchema.safeParse({ content: "hi", attachment_ids: ["x"] }).success,
    ).toBe(false);
  });

  test("Message.attachments: tuỳ chọn, user lẫn assistant, ≥ 1", () => {
    expect(MessageSchema.parse(userMsg)).toEqual(userMsg as never);
    expect(MessageSchema.safeParse({ ...userMsg, attachments: [ref] }).success).toBe(true);
    expect(MessageSchema.safeParse({ ...userMsg, attachments: [] }).success).toBe(false);
    const assistant = { ...userMsg, role: "assistant", content: "", attachments: [ref] };
    expect(MessageSchema.safeParse(assistant).success).toBe(true);
  });
});
