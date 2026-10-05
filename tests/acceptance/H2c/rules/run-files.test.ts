// WRK-FR-11 · WRK-FR-18 · H2c-R14, R15, R18, R24 · tập file của run, tên trong job, khối file trong prompt, OUT_HINT,
// payload job (test-plan H2c §1, cases §1.3 R17–R24; chữ ký plan-rules §3).
import { describe, expect, it } from "bun:test";
import { AgentCliJobSchema, type JobAttachment, JobAttachmentSchema } from "@ai/contracts/hub";
import {
  agentFilesBlock,
  type FileRow,
  fileSizeKb,
  jobAttachments,
  jobFileNames,
  OUT_HINT,
  orchestratorFilesBlock,
  pickRunFiles,
  RUN_FILES_MAX,
  RUN_FILES_MAX_BYTES,
  type RunFile,
  withOutHint,
} from "../../../../apps/hub-api/src/modules/attachments/run-files.rules";
import {
  orchestratorPrompt,
  type PromptInput,
} from "../../../../apps/hub-api/src/modules/orchestrator/orchestrator.prompt";
import {
  buildJobPayload,
  type PayloadInput,
} from "../../../../apps/hub-api/src/modules/runner/runner.rules";
import { MIB, payloadInput, uid, utf8Bytes } from "./_rules";

const SHA = "a".repeat(64);
const T0 = Date.parse("2026-10-05T03:00:00.000Z");
const CUR = uid(10);

const row = (
  n: number,
  messageId: string,
  ageMin: number,
  position: number,
  size = 100,
): FileRow => ({
  id: uid(100 + n),
  messageId,
  messageCreatedAt: new Date(T0 - ageMin * 60_000),
  position,
  safeName: `f${n}.txt`,
  mime: "text/plain",
  size,
  sha256: SHA,
});
const ids = (rows: readonly FileRow[]): string[] => rows.map((r) => r.id);

describe("WRK-FR-11 · pickRunFiles [R17, R18]", () => {
  it("WRK-FR-11 · R17 · tin hiện tại trước theo position; tin cũ mới → cũ, hoà → messageId giảm; command chỉ tin hiện tại [H2c-R14]", () => {
    const rows = [
      row(1, uid(11), 30, 1),
      row(2, CUR, 0, 2),
      row(3, uid(13), 90, 0), // hoà thời điểm với uid(12): messageId lớn hơn trước
      row(4, CUR, 0, 0),
      row(5, uid(11), 30, 0),
      row(6, uid(12), 90, 0),
      row(7, CUR, 0, 1),
    ];
    const o = { currentMessageId: CUR } as const;
    const want = [uid(104), uid(107), uid(102), uid(105), uid(101), uid(103), uid(106)];
    expect(ids(pickRunFiles(rows, { ...o, kind: "orchestrated" }))).toEqual(want);
    expect(ids(pickRunFiles(rows, { ...o, kind: "direct" }))).toEqual(want);
    expect(ids(pickRunFiles(rows, { ...o, kind: "command" }))).toEqual([
      uid(104),
      uid(107),
      uid(102),
    ]);
  });

  it("WRK-FR-11 · R18 · cắt ở file thứ 11 hoặc khi tổng > 100 MiB, không nhảy cóc [H2c-R14]", () => {
    expect(RUN_FILES_MAX).toBe(10);
    expect(RUN_FILES_MAX_BYTES).toBe(104_857_600);
    const o = { currentMessageId: CUR, kind: "direct" } as const;
    const twelve = Array.from({ length: 12 }, (_, k) => row(k, CUR, 0, k));
    expect(ids(pickRunFiles(twelve, o))).toEqual(ids(twelve.slice(0, 10)));
    const five = Array.from({ length: 5 }, (_, k) => row(k, CUR, 0, k, 20 * MIB));
    expect(pickRunFiles(five, o)).toHaveLength(5);
    const six = [...five, row(5, CUR, 0, 5, 1)];
    expect(pickRunFiles(six, o)).toHaveLength(5);
    const jump = [
      row(0, CUR, 0, 0, 50 * MIB),
      row(1, CUR, 0, 1, 40 * MIB),
      row(2, CUR, 0, 2, 20 * MIB),
      row(3, CUR, 0, 3, 1),
    ];
    expect(ids(pickRunFiles(jump, o))).toEqual([uid(100), uid(101)]);
    expect(pickRunFiles([], o)).toEqual([]);
  });
});

describe("WRK-FR-11 · jobFileNames, jobAttachments, fileSizeKb [R19, R20]", () => {
  it("WRK-FR-11 · R19 · trùng (không phân biệt hoa) → stem-2.ext, stem-3.ext…; không đuôi → name-2 [H2c-R15]", () => {
    expect(jobFileNames(["a.pdf", "a.pdf", "a.pdf"])).toEqual(["a.pdf", "a-2.pdf", "a-3.pdf"]);
    expect(jobFileNames(["A.pdf", "a.pdf"])).toEqual(["A.pdf", "a-2.pdf"]);
    expect(jobFileNames(["a-2.pdf", "a.pdf", "a.pdf"])).toEqual(["a-2.pdf", "a.pdf", "a-3.pdf"]);
    expect(jobFileNames(["x", "x"])).toEqual(["x", "x-2"]);
    expect(jobFileNames([])).toEqual([]);
  });

  it("WRK-FR-11 · R19 · tên 120 byte trùng → `-2` vẫn ≤ 120 byte (bớt thân), giữ đuôi [H2c-R15 · WRK-BR-07]", () => {
    const n = `${"a".repeat(116)}.pdf`;
    const [first, second] = jobFileNames([n, n]);
    expect(first).toBe(n);
    expect(second?.endsWith("-2.pdf")).toBe(true);
    expect(utf8Bytes(second ?? "")).toBeLessThanOrEqual(120);
    expect(second?.toLowerCase()).not.toBe(n.toLowerCase());
    const v = `${"ạ".repeat(39)}.md`; // 117 + 3 = 120 byte
    const [, w] = jobFileNames([v, v]);
    expect(utf8Bytes(w ?? "")).toBeLessThanOrEqual(120);
    expect(w?.endsWith("-2.md")).toBe(true);
    expect(w?.startsWith("ạ".repeat(38))).toBe(true);
  });

  it("WRK-FR-11 · R20 · jobAttachments: thứ tự, tên khử trùng, parse JobAttachmentSchema; fileSizeKb [H2c-R15]", () => {
    expect(jobAttachments([])).toEqual([]);
    const files: RunFile[] = [
      { id: uid(201), name: "a.pdf", mime: "application/pdf", size: 1024, sha256: SHA },
      { id: uid(202), name: "A.PDF", mime: "application/pdf", size: 2048, sha256: "b".repeat(64) },
    ];
    const out = jobAttachments(files);
    expect(out).toEqual([
      { id: uid(201), name: "a.pdf", mime: "application/pdf", size: 1024, sha256: SHA },
      {
        id: uid(202),
        name: "A-2.PDF",
        mime: "application/pdf",
        size: 2048,
        sha256: "b".repeat(64),
      },
    ]);
    for (const a of out) expect(JobAttachmentSchema.safeParse(a).success).toBe(true);
    const kb: [number, number][] = [
      [1, 1],
      [1024, 1],
      [1025, 2],
      [20_971_520, 20_480],
    ];
    for (const [size, want] of kb) expect(fileSizeKb(size)).toBe(want);
  });
});

const ITEMS = [
  { name: "hoadon.pdf", mime: "application/pdf", size: 1_048_576 },
  { name: "a.md", mime: "text/markdown", size: 10 },
];

const PROMPT: PromptInput = {
  agents: [{ id: uid(1), key: "hoadon", description: "Xử lý hoá đơn" }],
  hint: { last_agent: null, waiting_for: null },
  history: [{ role: "user", content: "trước" }],
  steps: [],
  stepsLeft: 3,
  message: "Đọc hoá đơn giúp tôi",
};
/** `PromptInput.attachments?` (plan-rules §3) — stub B0 chưa thêm trường: truyền qua ép kiểu. */
const withFiles = (p: PromptInput, attachments: readonly (typeof ITEMS)[number][]): PromptInput =>
  ({ ...p, attachments }) as PromptInput;

describe("WRK-FR-11 · khối <attachments> trong prompt [R21, R22]", () => {
  it("WRK-FR-11 · R21 · orchestratorFilesBlock nguyên văn; rỗng → null [H2c-R15]", () => {
    expect(orchestratorFilesBlock([])).toBeNull();
    expect(orchestratorFilesBlock(ITEMS)).toBe(
      "<attachments>\n- hoadon.pdf (application/pdf, 1024 KB)\n- a.md (text/markdown, 1 KB)\n</attachments>",
    );
  });

  it("WRK-FR-11 · R21 · orchestratorPrompt: khối giữa </steps_left> và <message>; vắng/[] → y hệt H1 [H2c-R15]", () => {
    const h1 = orchestratorPrompt(PROMPT);
    expect(orchestratorPrompt(withFiles(PROMPT, []))).toBe(h1);
    expect(orchestratorPrompt(withFiles(PROMPT, []), true)).toBe(orchestratorPrompt(PROMPT, true));
    const block =
      "<attachments>\n- hoadon.pdf (application/pdf, 1024 KB)\n- a.md (text/markdown, 1 KB)\n</attachments>";
    const got = orchestratorPrompt(withFiles(PROMPT, ITEMS));
    expect(got).toContain(`</steps_left>\n${block}\n<message>`);
    expect(got.replace(`${block}\n`, "")).toBe(h1);
  });

  it("WRK-FR-11 · R22 · agentFilesBlock nguyên văn (đường dẫn attachments/<name>); rỗng → null [H2c-R18]", () => {
    expect(agentFilesBlock([])).toBeNull();
    expect(agentFilesBlock(ITEMS)).toBe(
      "<attachments>\nThe user attached these files. They are in your working directory; read them by relative path:\n" +
        "- attachments/hoadon.pdf (application/pdf, 1024 KB)\n- attachments/a.md (text/markdown, 1 KB)\n</attachments>",
    );
  });
});

describe("WRK-FR-18 · OUT_HINT, withOutHint [R23]", () => {
  it("WRK-FR-18 · R23 · nối OUT_HINT; đếm UTF-16; quá max → giữ system + dropped [H2c-R24 · HUB-H2c-AC-12]", () => {
    expect(OUT_HINT).toBe(
      "To return files to the user, write them directly in the out/ directory (at most 5 files, 20 MiB each).",
    );
    expect(withOutHint("", 8000)).toEqual({ text: OUT_HINT, dropped: false });
    expect(withOutHint("S", 8000)).toEqual({ text: `S\n\n${OUT_HINT}`, dropped: false });
    const exact = `S\n\n${OUT_HINT}`.length;
    expect(withOutHint("S", exact)).toEqual({ text: `S\n\n${OUT_HINT}`, dropped: false });
    expect(withOutHint("S", exact - 1)).toEqual({ text: "S", dropped: true });
    const emoji = `😀\n\n${OUT_HINT}`.length; // 😀 = 2 đơn vị UTF-16
    expect(emoji).toBe(OUT_HINT.length + 4);
    expect(withOutHint("😀", emoji)).toEqual({ text: `😀\n\n${OUT_HINT}`, dropped: false });
    expect(withOutHint("😀", emoji - 1)).toEqual({ text: "😀", dropped: true });
  });
});

describe("WRK-FR-11 · buildJobPayload + attachments [R24]", () => {
  it("WRK-FR-11 · R24 · vắng/[] → payload H2b (không khoá); ≥ 1 → khoá attachments, parse AgentCliJobSchema [H2c-R15]", () => {
    const base = payloadInput();
    const h2b = buildJobPayload(base);
    expect(h2b).not.toBeNull();
    expect(h2b && "attachments" in h2b).toBe(false);
    // `PayloadInput.attachments?` (plan-rules §3) — stub B0 chưa thêm trường: truyền qua ép kiểu.
    const empty = buildJobPayload({ ...base, attachments: [] } as PayloadInput);
    expect(empty).toEqual(h2b);
    expect(empty && "attachments" in empty).toBe(false);
    const files: JobAttachment[] = [
      { id: uid(301), name: "hoadon.pdf", mime: "application/pdf", size: 2048, sha256: SHA },
      { id: uid(302), name: "a.md", mime: "text/markdown", size: 10, sha256: "c".repeat(64) },
    ];
    const p = buildJobPayload({ ...base, attachments: files } as PayloadInput);
    expect(p?.attachments).toEqual(files);
    expect(AgentCliJobSchema.safeParse(p).success).toBe(true);
    expect({ ...p, attachments: undefined }).toEqual({ ...h2b, attachments: undefined });
  });
});
