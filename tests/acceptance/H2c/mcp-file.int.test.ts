// HUB-FR-50 · H2c-R23 · HUB-H2c-AC-11 · P12 · K10 · test-plan-int §2.12 A110–A116: `/mcp` với file — job có `payload.attachments`
// ⇒ `tools/list` giữ workflow có input `file` (`file` → `{type:"string", description: mô tả + " (file name in attachments/)"}`);
// `tools/call` nhận tên (hoặc id) file thuộc job → Hub `POST /v1/files/upload` (MK) rồi gọi workflow với `inputs.file` object;
// tên ngoài job → `isError` câu tĩnh, 0 lời gọi Dify; lỗi upload → câu tĩnh; job **không** file ⇒ bỏ **mọi** workflow có input
// `file` (đổi hành vi H2a — K10); `side_effect` xác nhận trước upload. Job dựng SQL (`fileJob`); `anh-tuy-chon` (input `img`
// tuỳ chọn) gắn vào agent `hoadon` và đặt `side_effect` (A115) trước khi dựng hub.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { DifyFileInputSchema } from "@ai/contracts/hub";
import type { Json, Keys, Sql } from "../H1/_fixtures";
import { makeKeys } from "../H1/_fixtures";
import { AG } from "../H1/_hub";
import { type Dify, markSideEffect, startDify, WF_KEY } from "../H2a/_h2a";
import { isConfirmation, MCP_ERR, rpcRaw, toolCall } from "../H2a/_h2a2";
import { HOADON_FILE_DESC, type HubC, sample, setupH2c, startHubH2c, WF3 } from "./_h2c";
import {
  difyUser,
  endSqlRuns,
  type FileJob,
  type FileJobOpts,
  fileJob,
  setWorkflowKey,
  storedFile,
  TOOL_FILE,
  uploadsOf,
} from "./_h2c2";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
const TOOLS = ["hoadon-file", "anh-tuy-chon", WF_KEY.trello];

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values (${AG.hoadon}, ${WF3.anhTuyChon})`;
  await markSideEffect(sql, WF3.anhTuyChon);
  k = await makeKeys();
  hub = await startHubH2c(k);
}, 60_000);
afterEach(() => endSqlRuns(sql));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

const job = (o: FileJobOpts = {}): Promise<FileJob> =>
  fileJob(sql, hub, {
    tools: TOOLS,
    files: [{ name: "hoadon.pdf", content: sample.pdf(2048) }],
    ...o,
  });
const list = async (token: string): Promise<Json[]> => {
  const r = await rpcRaw(hub, token, { jsonrpc: "2.0", id: "l", method: "tools/list" });
  expect(r.status).toBe(200);
  return (r.json?.result?.tools ?? []) as Json[];
};
const textOf = (result: Json): string | undefined => result?.content?.[0]?.text;

describe("A110, A114 · tools/list theo file của job [H2c-R23 · HUB-H2c-AC-11 · K10]", () => {
  it("HUB-FR-50 · A110 · job hoadon có file → tools/list có hoadon-file, inputSchema.properties.file = {type:'string', description:'Hoá đơn PDF (file name in attachments/)'}, file ∈ required [H2c-R23 · HUB-H2c-AC-11]", async () => {
    const j = await job();
    const tools = await list(j.token);
    const t = tools.find((x) => x.name === "hoadon-file");
    expect(t).toBeDefined();
    expect(t?.inputSchema?.properties?.file).toEqual({
      type: "string",
      description: `${HOADON_FILE_DESC} (file name in attachments/)`,
    });
    expect(t?.inputSchema?.required ?? []).toContain("file");
    expect(tools.map((x) => x.name)).toContain(WF_KEY.trello);
  });

  it("HUB-FR-50 · A114 · job không file → tools/list không có hoadon-file và không có anh-tuy-chon (input file tuỳ chọn — đổi hành vi H2a, K10); workflow không file vẫn có [H2c-R23 · P12]", async () => {
    const j = await job({ files: [] });
    const names = (await list(j.token)).map((x) => x.name);
    expect(names).toContain(WF_KEY.trello);
    expect(names).not.toContain("hoadon-file");
    expect(names).not.toContain("anh-tuy-chon");
  });
});

describe("A111–A113, A115–A116 · tools/call với file [H2c-R23 · HUB-H2c-AC-11]", () => {
  it("HUB-FR-50 · A111 · tools/call hoadon-file {file:'hoadon.pdf'} → 1 upload (user, tên, sha256, Bearer key workflow) + 1 lời gọi workflow inputs.file object; bằng id cũng được [H2c-R23 · HUB-H2c-AC-11]", async () => {
    dify.mock.reset();
    const j = await job();
    const f = j.files[0] as FileJob["files"][number];
    const byName = await toolCall(hub, j.token, "hoadon-file", {
      file: "hoadon.pdf",
      note: "A111",
    });
    expect(byName.result?.isError).toBe(false);
    const ups = uploadsOf(dify, "hoadon.pdf");
    expect(ups.length).toBe(1);
    expect(ups[0]?.auth).toBe("Bearer mk-ok");
    expect(ups[0]?.body).toEqual({
      user: difyUser("lan"),
      file: { name: "hoadon.pdf", type: "application/pdf", size: f.size, sha256: f.sha256 },
    });
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    const input = (runs[0]?.body as Json)?.inputs;
    expect(DifyFileInputSchema.safeParse(input?.file).success).toBe(true);
    expect(input?.file).toMatchObject({ type: "document", transfer_method: "local_file" });
    expect(String(input?.file?.upload_file_id)).toMatch(/^upl-/);
    expect(input?.note).toBe("A111");
    expect((ups[0]?.at ?? Infinity) <= (runs[0]?.at ?? 0)).toBe(true);
    const byId = await toolCall(hub, j.token, "hoadon-file", { file: f.id });
    expect(byId.result?.isError).toBe(false);
    expect(uploadsOf(dify, "hoadon.pdf").length).toBe(2);
  });

  it("HUB-FR-50 · A112 · tên ngoài job (khac.pdf — file cùng user, tin khác) → isError 'This file is not attached to this message.', 0 lời gọi Dify; đối chứng tên đúng → gọi [H2c-R23 · plan-errors §3]", async () => {
    const j = await job();
    const other = await storedFile(sql, hub, "khac.pdf", sample.pdf(400));
    dify.mock.reset();
    for (const v of ["khac.pdf", other.id]) {
      const { result } = await toolCall(hub, j.token, "hoadon-file", { file: v });
      expect({ v, result }).toEqual({
        v,
        result: { content: [{ type: "text", text: TOOL_FILE.notAttached }], isError: true },
      });
    }
    expect(dify.mock.calls().length).toBe(0);
    const ok = await toolCall(hub, j.token, "hoadon-file", { file: "hoadon.pdf" });
    expect(ok.result?.isError).toBe(false);
  });

  it("HUB-FR-50 · A113 · upload 415 (upload-415*) → isError 'Dify rejected this file (type or size).', 0 lời gọi workflow; key mk-401 → TOOL_ERROR_TEXT.NOT_CONFIGURED [H2c-R22 · H2c-R23]", async () => {
    dify.mock.reset();
    const j = await job({ files: [{ name: "upload-415-a113.pdf", content: sample.pdf(300) }] });
    const rej = await toolCall(hub, j.token, "hoadon-file", { file: "upload-415-a113.pdf" });
    expect(rej.result).toEqual({
      content: [{ type: "text", text: TOOL_FILE.rejected }],
      isError: true,
    });
    expect(uploadsOf(dify, "upload-415-a113.pdf").length).toBe(1);
    expect(dify.runs().length).toBe(0);
    const g = await job({ files: [{ name: "a113-key.pdf", content: sample.pdf(300) }] });
    await setWorkflowKey(sql, WF3.hoadonFile, "mk-401");
    try {
      const nc = await toolCall(hub, g.token, "hoadon-file", { file: "a113-key.pdf" });
      expect(nc.result).toEqual({
        content: [{ type: "text", text: MCP_ERR.notConfigured }],
        isError: true,
      });
    } finally {
      await setWorkflowKey(sql, WF3.hoadonFile, "mk-ok");
    }
    expect(dify.runs().length).toBe(0);
  });

  it("HUB-FR-50 · A115 · job có file: create-trello-card vẫn đòi xác nhận (H2a-R21); workflow có file + side_effect (anh-tuy-chon) → xác nhận trước upload (0 upload) [H2c-R23 · H2a-R21]", async () => {
    dify.mock.reset();
    const j = await job();
    const trello = await toolCall(hub, j.token, WF_KEY.trello, { title: "Thẻ A115" });
    expect(isConfirmation(trello.result)).toBe(true);
    const tools = (await list(j.token)).map((x) => x.name);
    expect(tools).toContain("anh-tuy-chon");
    const img = await toolCall(hub, j.token, "anh-tuy-chon", { img: "hoadon.pdf", q: "A115" });
    expect(isConfirmation(img.result)).toBe(true);
    expect(uploadsOf(dify).length).toBe(0);
    expect(dify.runs().length).toBe(0);
  });

  it("HUB-FR-50 · A116 · job có file, tools/call thiếu file bắt buộc / file không phải chuỗi → lỗi validate như H2a ('Invalid arguments…'), 0 upload [H2c-R23 · H2a-R20]", async () => {
    dify.mock.reset();
    const j = await job();
    const tools = (await list(j.token)).map((x) => x.name);
    expect(tools).toContain("hoadon-file");
    const missing = await toolCall(hub, j.token, "hoadon-file", { note: "thiếu file" });
    expect(missing.result).toEqual({
      content: [{ type: "text", text: MCP_ERR.invalid }],
      isError: true,
    });
    // không phải chuỗi: validate schema (H2a) hoặc `fileArg` null (plan-errors §3) — cả hai là lỗi câu tĩnh, 0 upload
    const num = await toolCall(hub, j.token, "hoadon-file", { file: 123 });
    expect(num.result?.isError).toBe(true);
    expect([MCP_ERR.invalid, TOOL_FILE.notAttached as string]).toContain(textOf(num.result) ?? "");
    expect(uploadsOf(dify).length).toBe(0);
    expect(dify.runs().length).toBe(0);
  });
});
