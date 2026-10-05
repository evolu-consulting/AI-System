// HUB-FR-12 · ADM-FR-21 · H2c-R20–R22 · HUB-H2c-AC-09, AC-10 (vế Hub) · T7–T9 · K10 · test-plan-int §2.11 A100–A109: lệnh có input
// `file` map `attachment` — sync: sau `run.started`, Hub `POST /v1/files/upload` (MK: multipart `user`, tên `safe_name`, `type` =
// mime, Bearer key workflow) **trước** `/v1/workflows/run`, `inputs.file = {type, transfer_method:"local_file", upload_file_id}`;
// async: upload trước INSERT job, payload `workflow.async` mang object file; lỗi upload → `run.failed` (413/415/400 file_too_large
// ⇒ `UPSTREAM_ERROR` + hint `file_rejected`; 401 ⇒ `NOT_CONFIGURED`; 5xx/không id/chậm ⇒ như H2a-R11); chỉ file đầu (T9), mỗi lần
// gọi một upload (T8); thiếu/lệch map ⇒ 422 trước run (K10). File "đã tải lên" = hàng SQL + nội dung trong `HUB_ATTACH_DIR`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { CmdMissingArgDetailsSchema, ErrorResponseSchema } from "@ai/contracts/chat";
import { DifyFileInputSchema, WorkflowInputValueSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import {
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { insertConv, runIdOf, type Sse, testRedis } from "../H1/_hub";
import { type Dify, startDify } from "../H2a/_h2a";
import { ScriptRuntime2 } from "../H2a/_runtime2";
import { settleRuns } from "../H2b/_h2b";
import { attRow, countsH2c, type HubC, sample, sendWith, setupH2c, startHubH2c, WF3 } from "./_h2c";
import { difyUser, FILE_REJECTED_HINT, PDF, setWorkflowKey, storedFile, uploadsOf } from "./_h2c2";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let redis: Redis;
let rt2: ScriptRuntime2;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2c(k);
  redis = await testRedis();
  rt2 = new ScriptRuntime2(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

type Sent = { s: Sse; runId: string; conv: string; flow: string };
/** E12 lệnh + `attachment_ids`; 200 ⇒ chờ sự kiện kết thúc (`ms`). */
async function cmd(
  who: UserKey,
  content: string,
  ids?: string[],
  o: { conv?: string; flow?: string; ms?: number; wait?: boolean } = {},
): Promise<Sent> {
  const conv = o.conv ?? (await insertConv(sql, who, crypto.randomUUID()));
  const s = await sendWith(hub, await sign(k, USERS[who]), conv, content, ids, o.flow);
  try {
    if (s.status === 200 && o.wait !== false) await s.terminal(o.ms ?? 10_000);
  } finally {
    if (o.wait !== false) s.close();
  }
  return { s, runId: runIdOf(s), conv, flow: s.headers.get("x-flow-id") ?? "" };
}
const file = (name: string, who: UserKey = "lan", bytes = sample.pdf(2048), mime = PDF) =>
  storedFile(sql, hub, name, bytes, { who, mime });
const ended = (s: Sse) =>
  s.events.find((e) => e.event === "run.finished" || e.event === "run.failed");
const workflowStep = async (runId: string): Promise<Json> => {
  const [r] = await sql<{ detail: Json }[]>`select detail from hub.run_steps
    where run_id = ${runId} and type = 'workflow' order by seq limit 1`;
  return r?.detail;
};
/** `run.failed` đúng mã; câu `message` H1; `hint` = hint `file_rejected` (khi `rejected`) hoặc H1. */
function expectFailed(
  x: Sent,
  code: "UPSTREAM_ERROR" | "NOT_CONFIGURED",
  locale: "vi" | "en",
  rejected: boolean,
) {
  expect(x.s.status).toBe(200);
  const f = ended(x.s);
  expect(f?.event).toBe("run.failed");
  const t = runErrorText(code, locale);
  expect({ code: f?.data?.code, message: f?.data?.message, hint: f?.data?.hint }).toEqual({
    code,
    message: t.message,
    hint: rejected ? FILE_REJECTED_HINT[locale] : t.hint,
  });
}
function cmdError(s: Sse): {
  status: number;
  code?: string;
  missing?: string[];
  invalid?: string[];
} {
  const e = ErrorResponseSchema.safeParse(s.json);
  const d = CmdMissingArgDetailsSchema.safeParse(e.data?.error.details);
  return {
    status: s.status,
    code: e.data?.error.code,
    missing: d.data?.missing,
    invalid: d.data?.invalid,
  };
}

describe("A100–A101 · command sync + upload [HUB-H2c-AC-09 · H2c-R21 · H2c-R22]", () => {
  it("HUB-FR-12 · A100 · /hoadon ghi chú + hoadon.pdf → MK POST /v1/files/upload (user <tenant>:<user>, tên safe_name, type application/pdf, size/sha256, Bearer key workflow) trước /v1/workflows/run; inputs.file = {document, local_file, upl-…}, inputs.note; run finished; step workflow detail.upload {mime, size, ms} [HUB-H2c-AC-09 · H2c-R22]", async () => {
    dify.mock.reset();
    const f = await file("hoadon-a100.pdf");
    const x = await cmd("lan", "/hoadon ghi chú", [f.id]);
    expect(x.s.status).toBe(200);
    expect(ended(x.s)?.event).toBe("run.finished");
    const ups = uploadsOf(dify, "hoadon-a100.pdf");
    expect(ups.length).toBe(1);
    expect(ups[0]?.auth).toBe("Bearer mk-ok");
    expect(ups[0]?.body).toEqual({
      user: difyUser("lan"),
      file: { name: "hoadon-a100.pdf", type: PDF, size: f.size, sha256: f.sha256 },
    });
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect((ups[0]?.at ?? Infinity) <= (runs[0]?.at ?? 0)).toBe(true);
    expect((runs[0]?.body as Json)?.inputs).toEqual({
      file: { type: "document", transfer_method: "local_file", upload_file_id: "upl-1" },
      note: "ghi chú",
    });
    const d = await workflowStep(x.runId);
    expect(d?.upload).toMatchObject({ mime: PDF, size: f.size });
    expect(typeof d?.upload?.ms).toBe("number");
  });

  it("HUB-FR-12 · A101 · ảnh .png → inputs.file.type = 'image' (difyFileType), upload type image/png [H2c-R22 · R10]", async () => {
    dify.mock.reset();
    const f = await file("anh-a101.png", "lan", sample.png(1500), "image/png");
    const x = await cmd("lan", "/hoadon ảnh", [f.id]);
    expect(ended(x.s)?.event).toBe("run.finished");
    expect((uploadsOf(dify, "anh-a101.png")[0]?.body as Json)?.file?.type).toBe("image/png");
    expect((dify.runs()[0]?.body as Json)?.inputs?.file).toMatchObject({ type: "image" });
  });
});

describe("A102–A103 · lỗi upload Dify [H2c-R22 · plan-errors §4]", () => {
  it("HUB-FR-12 · A102 · MK upload-415* / upload-413* / upload-400-too-large* → run.failed UPSTREAM_ERROR + hint file_rejected theo runs.locale (vi lan, en hoa); detail.upload.reason file_rejected; 0 lời gọi workflow [H2c-R22 · HUB-H2c-AC-09]", async () => {
    dify.mock.reset();
    const cases: [string, UserKey][] = [
      ["upload-415-a102.pdf", "lan"],
      ["upload-413-a102.pdf", "lan"],
      ["upload-400-too-large-a102.pdf", "lan"],
      ["upload-415-a102-en.pdf", "hoa"],
    ];
    for (const [name, who] of cases) {
      const f = await file(name, who);
      const x = await cmd(who, "/hoadon lỗi", [f.id]);
      expectFailed(x, "UPSTREAM_ERROR", USERS[who].locale, true);
      expect(uploadsOf(dify, name).length).toBe(1);
      expect((await workflowStep(x.runId))?.upload?.reason).toBe("file_rejected");
    }
    expect(dify.runs().length).toBe(0);
  });

  it("HUB-FR-12 · A103 · key mk-401 → NOT_CONFIGURED; upload-500* / upload-noid* → UPSTREAM_ERROR như H2a-R11 (hint H1, không hint file); 0 lời gọi workflow [H2c-R22 · H2a-R11]", async () => {
    dify.mock.reset();
    const g = await file("a103-key.pdf");
    await setWorkflowKey(sql, WF3.hoadonFile, "mk-401");
    try {
      expectFailed(await cmd("lan", "/hoadon key", [g.id]), "NOT_CONFIGURED", "vi", false);
    } finally {
      await setWorkflowKey(sql, WF3.hoadonFile, "mk-ok");
    }
    expect(uploadsOf(dify, "a103-key.pdf").length).toBe(1);
    for (const name of ["upload-500-a103.pdf", "upload-noid-a103.pdf"]) {
      const f = await file(name);
      expectFailed(await cmd("lan", "/hoadon 5xx", [f.id]), "UPSTREAM_ERROR", "vi", false);
      expect(uploadsOf(dify, name).length).toBe(1);
    }
    expect(dify.runs().length).toBe(0);
  });

  it("HUB-FR-12 · A103 · upload-slow-65000* → run.failed TIMEOUT/UPSTREAM_ERROR (hạn upload 60 s / timeout lệnh) trong ≤ 70 s, 0 lời gọi workflow [H2c-R22 · H2a-R10]", async () => {
    dify.mock.reset();
    const f = await file("upload-slow-65000-a103.pdf");
    const t0 = Date.now();
    const x = await cmd("lan", "/hoadon chậm", [f.id], { ms: 75_000 });
    expect(x.s.status).toBe(200);
    const end = ended(x.s);
    expect(end?.event).toBe("run.failed");
    expect(["TIMEOUT", "UPSTREAM_ERROR"]).toContain(end?.data?.code);
    expect(Date.now() - t0).toBeLessThanOrEqual(70_000);
    expect(uploadsOf(dify, "upload-slow-65000-a103.pdf").length).toBe(1);
    expect(dify.runs().length).toBe(0);
  }, 100_000);
});

describe("A104–A107 · số lần upload, file đầu, map [T8 · T9 · K10 · H2c-R20]", () => {
  it("HUB-FR-12 · A104 · /hoadon hai tin cùng flow, mỗi tin một file → 2 upload (mỗi lần gọi một upload, không cache — T8) [H2c-R22]", async () => {
    dify.mock.reset();
    const [a, b] = [await file("a104-1.pdf"), await file("a104-2.pdf")];
    const x1 = await cmd("lan", "/hoadon lần 1", [a.id]);
    expect(ended(x1.s)?.event).toBe("run.finished");
    const x2 = await cmd("lan", "/hoadon lần 2", [b.id], { conv: x1.conv, flow: x1.flow });
    expect(ended(x2.s)?.event).toBe("run.finished");
    expect([uploadsOf(dify, "a104-1.pdf").length, uploadsOf(dify, "a104-2.pdf").length]).toEqual([
      1, 1,
    ]);
    expect(dify.runs().length).toBe(2);
  });

  it("HUB-FR-12 · A105 · nhiều file → chỉ file đầu đi Dify (T9); mọi file vẫn gắn vào tin user (position 0, 1) [H2c-R20 · T9]", async () => {
    dify.mock.reset();
    const [a, b] = [await file("a105-dau.pdf"), await file("a105-sau.pdf")];
    const x = await cmd("lan", "/hoadon hai file", [a.id, b.id]);
    expect(ended(x.s)?.event).toBe("run.finished");
    expect([
      uploadsOf(dify, "a105-dau.pdf").length,
      uploadsOf(dify, "a105-sau.pdf").length,
    ]).toEqual([1, 0]);
    const [ra, rb] = [await attRow(sql, a.id), await attRow(sql, b.id)];
    expect([ra?.position, rb?.position]).toEqual([0, 1]);
    expect(ra?.message_id).not.toBeNull();
    expect(rb?.message_id).toBe(ra?.message_id);
  });

  it("HUB-FR-12 · A106 · /hoadon không file → 422 CMD_MISSING_ARG{missing:['file']}; /sai-map x (± file) → 422 invalid ∋ note; /file-arg x → 422 invalid; 0 ghi, 0 upload [HUB-H2c-AC-09 · K10 · P13 · ADM-FR-21]", async () => {
    dify.mock.reset();
    const f = await file("a106.pdf");
    const before = await countsH2c(sql);
    expect(cmdError((await cmd("lan", "/hoadon")).s)).toMatchObject({
      status: 422,
      code: "CMD_MISSING_ARG",
      missing: ["file"],
    });
    for (const ids of [undefined, [f.id]]) {
      const e = cmdError((await cmd("lan", "/sai-map x", ids)).s);
      expect({ ids: ids?.length ?? 0, status: e.status, code: e.code }).toEqual({
        ids: ids?.length ?? 0,
        status: 422,
        code: "CMD_MISSING_ARG",
      });
      expect(e.invalid).toContain("note");
    }
    const fa = cmdError((await cmd("lan", "/file-arg x")).s);
    expect({ status: fa.status, code: fa.code, invalid: fa.invalid }).toEqual({
      status: 422,
      code: "CMD_MISSING_ARG",
      invalid: ["note"],
    });
    expect(await countsH2c(sql)).toEqual(before);
    expect((await attRow(sql, f.id))?.message_id).toBeNull();
    expect(uploadsOf(dify).length).toBe(0);
  });

  it("HUB-FR-12 · A107 · /hoadon-tuy không file → chạy, inputs không có img; /dich en … + file (không map attachment) → file gắn vào tin, 0 upload [H2c-R20 · ADM-FR-21]", async () => {
    dify.mock.reset();
    const x = await cmd("lan", "/hoadon-tuy câu hỏi A107");
    expect(ended(x.s)?.event).toBe("run.finished");
    const inputs = (dify.runs()[0]?.body as Json)?.inputs;
    expect("img" in (inputs ?? {})).toBe(false);
    expect(inputs?.q).toBe("câu hỏi A107");
    const f = await file("a107.pdf");
    const d = await cmd("lan", "/dich en xin chào", [f.id]);
    expect(ended(d.s)?.event).toBe("run.finished");
    expect((await attRow(sql, f.id))?.message_id).not.toBeNull();
    expect(uploadsOf(dify).length).toBe(0);
  });
});

describe("A108–A109 · command async [HUB-H2c-AC-10 · T7]", () => {
  it("HUB-FR-12 · A108 · /hoadon-async + file → 1 upload (Hub) trước INSERT job (at MK < jobs.created_at); payload workflow.async inputs.file = object file (WorkflowInputValue), note [HUB-H2c-AC-10 · T7]", async () => {
    dify.mock.reset();
    const f = await file("a108.pdf");
    const x = await cmd("lan", "/hoadon-async ghi chú A108", [f.id], { wait: false });
    try {
      expect(x.s.status).toBe(200);
      const row = await rt2.peekAsync(x.runId);
      expect(row).toBeDefined();
      const ups = uploadsOf(dify, "a108.pdf");
      expect(ups.length).toBe(1);
      const [j] = await sql<
        { at: Date }[]
      >`select created_at as at from hub.jobs where id = ${row?.id ?? null}`;
      expect((ups[0]?.at ?? Infinity) <= (j?.at.getTime() ?? 0)).toBe(true);
      const inputs = (row?.payload as Json)?.inputs;
      expect(WorkflowInputValueSchema.safeParse(inputs?.file).success).toBe(true);
      expect(DifyFileInputSchema.parse(inputs?.file)).toEqual({
        type: "document",
        transfer_method: "local_file",
        upload_file_id: "upl-1",
      });
      expect(inputs?.note).toBe("ghi chú A108");
      expect(dify.runs().length).toBe(0);
    } finally {
      x.s.close();
    }
  });

  it("HUB-FR-12 · A109 · async upload 415 → run.failed UPSTREAM_ERROR + hint file_rejected như A102, không job nào [H2c-R22 · T7]", async () => {
    dify.mock.reset();
    const f = await file("upload-415-a109.pdf");
    const x = await cmd("lan", "/hoadon-async lỗi", [f.id]);
    expectFailed(x, "UPSTREAM_ERROR", "vi", true);
    expect(uploadsOf(dify, "upload-415-a109.pdf").length).toBe(1);
    const jobs = await sql`select id from hub.jobs where run_id = ${x.runId}`;
    expect(jobs.length).toBe(0);
  });
});
