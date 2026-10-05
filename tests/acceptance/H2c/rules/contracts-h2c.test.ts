// HUB-FR-44 · WRK-FR-11 · WRK-FR-18 · contract H2c: chat chỉ thêm (đính kèm), hub `attachments`/`outputs`/file Dify,
// hub-internal file của job (test-plan H2c §1, cases §1.9 R44–R49; spec §3, plan §2).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATTACH_ALLOWED,
  ATTACH_FILENAME_HEADER_MAX_BYTES,
  ATTACH_FILENAME_MAX,
  ATTACH_MAX_BYTES,
  ATTACH_PER_MESSAGE_MAX,
  AttachmentDetailSchema,
  AttachmentNotFoundDetailsSchema,
  AttachmentSchema,
  CHAT_API_ERRORS,
  CHAT_ATTACHMENT_ERRORS,
  CHAT_EVENT_NAMES,
  CHAT_RUN_ERROR_CODES,
  FILENAME_HEADER,
  MessageSchema,
  SendMessageRequestSchema,
} from "@ai/contracts/chat";
import {
  AgentCliJobSchema,
  ALLOWED_TOOLS,
  DifyFileInputSchema,
  HUB_JSON_SCHEMAS,
  type HubJsonSchemaName,
  JOB_FAIL_REASONS,
  JobAttachmentSchema,
  JobResultEventSchema,
  WorkflowInputValueSchema,
} from "@ai/contracts/hub";
import {
  CONTENT_SHA256_HEADER,
  HUB_INTERNAL_ERRORS,
  JobOutputResponseSchema,
} from "@ai/contracts/hub-internal";
import { buildJobPayload } from "../../../../apps/hub-api/src/modules/runner/runner.rules";
import { agentWith, payloadInput, uid } from "./_rules";

const FIXTURES = resolve(import.meta.dir, "../../../../packages/contracts/fixtures/hub");
type Kind = "valid" | "invalid";
const readJson = (kind: Kind, f: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(FIXTURES, kind, f), "utf8"));
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

const NEW_CODES = Object.keys(CHAT_ATTACHMENT_ERRORS);
const SHA = "a".repeat(64);
const ATT = {
  id: uid(1),
  filename: "a.pdf",
  mime: "application/pdf",
  size: 1,
  created_at: "2026-10-05T01:00:00.000Z",
};
const JOB_ATT = { id: uid(2), name: "a.pdf", mime: "application/pdf", size: 1, sha256: SHA };

describe("HUB-FR-44 · contract chat H2c [R44–R46]", () => {
  it("HUB-FR-44 · R44 · hằng, ATTACH_ALLOWED 14 khoá, CHAT_ATTACHMENT_ERRORS; mã cũ không đổi (P2) [spec §3 · HUB-H2c-AC-16]", () => {
    expect(ATTACH_MAX_BYTES).toBe(20_971_520);
    expect(ATTACH_PER_MESSAGE_MAX).toBe(10);
    expect(ATTACH_FILENAME_MAX).toBe(200);
    expect(ATTACH_FILENAME_HEADER_MAX_BYTES).toBe(1024);
    expect(FILENAME_HEADER).toBe("X-Filename");
    expect(ATTACH_ALLOWED).toEqual({
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      xml: "application/xml",
      json: "application/json",
    });
    expect(CHAT_ATTACHMENT_ERRORS).toEqual({
      ATTACHMENT_NOT_FOUND: 404,
      ATTACHMENT_QUOTA_EXCEEDED: 409,
      ATTACHMENT_TOO_LARGE: 413,
      ATTACHMENT_TYPE_NOT_ALLOWED: 415,
    });
    for (const c of NEW_CODES) {
      expect(Object.keys(CHAT_API_ERRORS)).not.toContain(c);
      expect(CHAT_RUN_ERROR_CODES as readonly string[]).not.toContain(c);
      expect(CHAT_EVENT_NAMES as readonly string[]).not.toContain(c);
    }
  });

  it("HUB-FR-44 · R45 · AttachmentSchema strict, size 1…20 MiB, filename ≤ 200, mime ∈ ATTACH_MIMES; Detail cần available [spec §3]", () => {
    expect(ok(AttachmentSchema, ATT)).toBe(true);
    expect(ok(AttachmentSchema, { ...ATT, size: ATTACH_MAX_BYTES })).toBe(true);
    for (const bad of [
      { ...ATT, extra: 1 },
      { ...ATT, size: 0 },
      { ...ATT, size: ATTACH_MAX_BYTES + 1 },
      { ...ATT, filename: "a".repeat(201) },
      { ...ATT, mime: "text/html" },
    ])
      expect(ok(AttachmentSchema, bad)).toBe(false);
    expect(ok(AttachmentSchema, { ...ATT, filename: "a".repeat(200) })).toBe(true);
    expect(ok(AttachmentDetailSchema, ATT)).toBe(false);
    expect(ok(AttachmentDetailSchema, { ...ATT, available: false })).toBe(true);
    expect(ok(AttachmentNotFoundDetailsSchema, { ids: [uid(3)] })).toBe(true);
    expect(ok(AttachmentNotFoundDetailsSchema, { ids: [] })).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, k) => uid(10 + k));
    expect(ok(AttachmentNotFoundDetailsSchema, { ids: eleven })).toBe(false);
  });

  it("HUB-FR-44 · R46 · SendMessageRequest attachment_ids 1–10, không trùng; Message.attachments min 1, max 10 [spec §3]", () => {
    expect(SendMessageRequestSchema.parse({ content: "hi" })).toEqual({ content: "hi" });
    const ten = Array.from({ length: 10 }, (_, k) => uid(20 + k));
    expect(ok(SendMessageRequestSchema, { content: "hi", attachment_ids: [uid(20)] })).toBe(true);
    expect(ok(SendMessageRequestSchema, { content: "hi", attachment_ids: ten })).toBe(true);
    for (const ids of [[], [...ten, uid(99)], [uid(20), uid(20)], ["x"]])
      expect(ok(SendMessageRequestSchema, { content: "hi", attachment_ids: ids })).toBe(false);
    expect(ok(SendMessageRequestSchema, { content: "hi", files: [uid(20)] })).toBe(false);

    const msg = {
      id: uid(30),
      conversation_id: uid(31),
      flow_id: uid(32),
      role: "user",
      content: "xin",
      run_id: null,
      created_at: "2026-10-05T01:00:00.000Z",
      run: null,
      ask: null,
    };
    const ref = {
      id: uid(33),
      filename: "a.pdf",
      mime: "application/pdf",
      size: 1,
      available: true,
    };
    expect(ok(MessageSchema, msg)).toBe(true);
    expect(ok(MessageSchema, { ...msg, attachments: [ref] })).toBe(true);
    expect(ok(MessageSchema, { ...msg, attachments: [] })).toBe(false);
    expect(ok(MessageSchema, { ...msg, attachments: Array(11).fill(ref) })).toBe(false);
  });
});

describe("WRK-FR-11 · contract hub H2c [R47, R48]", () => {
  it("WRK-FR-11 · R47 · JobAttachment name an toàn ≤ 120, sha256 hex thường; AgentCliJob attachments ≤ 10 [spec §3 · WRK-BR-07]", () => {
    for (const name of ["Hoá đơn.pdf", "a-2.pdf", "_-x.md", "a".repeat(120)])
      expect(ok(JobAttachmentSchema, { ...JOB_ATT, name })).toBe(true);
    for (const name of ["../x", "a/b", "a\\b", ".env", "-x", "", "a\u0000b", "a".repeat(121)])
      expect(ok(JobAttachmentSchema, { ...JOB_ATT, name })).toBe(false);
    expect(ok(JobAttachmentSchema, { ...JOB_ATT, sha256: SHA.toUpperCase() })).toBe(false);
    expect(ok(JobAttachmentSchema, { ...JOB_ATT, sha256: SHA.slice(1) })).toBe(false);

    const job = readJson("valid", "JobPayload.agent.json");
    expect("attachments" in job).toBe(false);
    expect(ok(AgentCliJobSchema, job)).toBe(true);
    const many = Array.from({ length: 11 }, (_, k) => ({ ...JOB_ATT, id: uid(40 + k) }));
    expect(ok(AgentCliJobSchema, { ...job, attachments: many.slice(0, 10) })).toBe(true);
    expect(ok(AgentCliJobSchema, { ...job, attachments: many })).toBe(false);
  });

  it("WRK-FR-18 · R48 · ALLOWED_TOOLS + Write (PL9); buildJobPayload giữ Write khi cấu hình, vắng → Read, Grep [spec §3 · H2c-R24]", () => {
    expect([...ALLOWED_TOOLS]).toEqual(["Read", "Grep", "Glob", "Write"]);
    const job = readJson("valid", "JobPayload.agent.json");
    expect(ok(AgentCliJobSchema, { ...job, allowed_tools: ["Read", "Write"] })).toBe(true);
    expect(ok(AgentCliJobSchema, { ...job, allowed_tools: ["Read", "Edit"] })).toBe(false);
    const five = ["Read", "Grep", "Glob", "Write", "Read"];
    expect(ok(AgentCliJobSchema, { ...job, allowed_tools: five })).toBe(false);

    const write = agentWith({ runtimeOptions: { allowed_tools: ["Read", "Grep", "Write"] } });
    expect(buildJobPayload(payloadInput({ agent: write }))?.allowed_tools).toContain("Write");
    expect(buildJobPayload(payloadInput())?.allowed_tools).toEqual(["Read", "Grep"]);

    expect(JOB_FAIL_REASONS.at(-1)).toBe("attachment");
    expect(JOB_FAIL_REASONS).toHaveLength(15);
  });

  it("WRK-FR-18 · R48 · job.result outputs 1–5; DifyFileInput local_file + image|document; WorkflowInputValue nhận object file [spec §3]", () => {
    const res = readJson("valid", "RunEvent.result.json");
    expect(ok(JobResultEventSchema, res)).toBe(true);
    expect(ok(JobResultEventSchema, { ...res, outputs: [uid(50)] })).toBe(true);
    expect(ok(JobResultEventSchema, { ...res, outputs: [] })).toBe(false);
    const six = Array.from({ length: 6 }, (_, k) => uid(50 + k));
    expect(ok(JobResultEventSchema, { ...res, outputs: six })).toBe(false);

    const file = { type: "document", transfer_method: "local_file", upload_file_id: "f-1" };
    expect(ok(DifyFileInputSchema, file)).toBe(true);
    expect(ok(DifyFileInputSchema, { ...file, type: "image" })).toBe(true);
    expect(ok(DifyFileInputSchema, { ...file, transfer_method: "remote_url" })).toBe(false);
    expect(ok(DifyFileInputSchema, { ...file, type: "video" })).toBe(false);
    expect(ok(WorkflowInputValueSchema, file)).toBe(true);
  });
});

const NEW_VALID = [
  "JobPayload.agent-files.json",
  "JobPayload.workflow-file.json",
  "RunEvent.result-outputs.json",
  "JobOutputResponse.basic.json",
  "JobOutputResponse.other.json",
];
const NEW_INVALID = [
  "JobPayload.files-11.json",
  "JobPayload.file-bad-sha.json",
  "JobPayload.file-name-slash.json",
  "JobPayload.file-name-dot.json",
  "RunEvent.outputs-6.json",
  "RunEvent.outputs-empty.json",
  "JobOutputResponse.no-id.json",
  "JobOutputResponse.extra.json",
];
const schemaOf = (f: string) => HUB_JSON_SCHEMAS[f.split(".")[0] as HubJsonSchemaName];

describe("HUB-FR-44 · fixture + hub-internal [R49]", () => {
  it("HUB-FR-44 · R49 · fixture mới (5 valid, 8 invalid) đúng chiều; mọi fixture cũ vẫn đúng chiều [plan §2.2]", () => {
    const list = (kind: Kind) =>
      readdirSync(resolve(FIXTURES, kind)).filter((f) => f.endsWith(".json"));
    for (const f of NEW_VALID) expect(list("valid")).toContain(f);
    for (const f of NEW_INVALID) expect(list("invalid")).toContain(f);
    for (const kind of ["valid", "invalid"] as const) {
      for (const f of list(kind)) {
        const schema = schemaOf(f);
        expect(schema, f).toBeDefined();
        expect(ok(schema, readJson(kind, f)), `${kind}/${f}`).toBe(kind === "valid");
      }
    }
  });

  it("HUB-FR-75 · R49 · JobOutputResponse strict {id}; CONTENT_SHA256_HEADER; HUB_INTERNAL_ERRORS thêm 404/409/413/415 [plan §2.3]", () => {
    expect(ok(JobOutputResponseSchema, { id: uid(60) })).toBe(true);
    expect(ok(JobOutputResponseSchema, { id: uid(60), name: "a" })).toBe(false);
    expect(ok(JobOutputResponseSchema, {})).toBe(false);
    expect(CONTENT_SHA256_HEADER).toBe("X-Content-SHA256");
    expect(HUB_INTERNAL_ERRORS).toMatchObject({
      NOT_FOUND: 404,
      ATTACHMENT_QUOTA_EXCEEDED: 409,
      ATTACHMENT_TOO_LARGE: 413,
      ATTACHMENT_TYPE_NOT_ALLOWED: 415,
    });
  });
});
