// HUB-FR-44 · H2c-R01–R03, R05, R07 · HUB-H2c-AC-01–AC-04 · test-plan-int §2.1 A01–A19: `POST /attachments` — thân thô +
// `X-Filename`, stream ra `<dir>/<tenant>/<id>` qua `.part` (R05), 413 trước khi đọc thân (Content-Length) / bộ đếm
// (chunked), `Content-Length` giả nhỏ (socket thô, L3), 400 header/thân rỗng, 415 đuôi/chữ ký/UTF-8, thứ tự kiểm plan §2.4,
// client đứt, tên hiển thị/tên an toàn (AC-04), log không tên file, CORS `X-Filename`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { AttachmentSchema } from "@ai/contracts/chat";
import {
  displayName,
  safeName,
} from "../../../apps/hub-api/src/modules/attachments/attachment.rules";
import { type Json, type Keys, makeKeys, type Sql, sign, T, USERS, waitFor } from "../H1/_fixtures";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import {
  attRow,
  codeOf,
  diskFiles,
  type HubC,
  KEY_RE,
  MAX,
  MiB,
  parts,
  pathOf,
  pct,
  rawGet,
  rawUpload,
  sample,
  setupH2c,
  sha256,
  startHubH2c,
  upload,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let tiny: HubC;
let token = "";
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  tiny = await startHubH2c(k, { tenantMaxBytes: 1, extra: { instanceId: "qc-hub-h2c-tiny" } });
  token = await sign(k, USERS.lan);
}, 60_000);
beforeEach(() => {
  log = captureLogs();
});
afterEach(() => log.restore());
afterAll(async () => {
  await hub?.stop();
  await tiny?.stop();
  await sql?.end();
});

/** Số hàng `hub.attachments` + file trên đĩa của `h` (so "0 ghi"). */
async function snap(h: HubC): Promise<{ rows: number; files: string[] }> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
  return { rows: r?.n ?? -1, files: await diskFiles(h.dir) };
}
const auth = (name: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  "X-Filename": pct(name),
  ...extra,
});
const logged = (msg: string) => log.lines.filter((l) => l.rec.msg === msg);
const allLogText = () => log.lines.map((l) => JSON.stringify(l.rec)).join("\n");
const health = (h: HubC) => rawGet(h.port);

describe("A01–A08 · tải lên, giới hạn, thân [H2c-R01 · R05 · AC-01 · AC-02]", () => {
  it("HUB-FR-44 · A01 · lan POST pdf 1 MiB → 201 Attachment strict (mime pdf, size); đĩa thêm đúng <acme>/<id>, sha256 đĩa = thân = cột; hàng upload, user lan, chưa gắn [H2c-R01 · AC-01]", async () => {
    const before = await diskFiles(hub.dir);
    const body = sample.pdf(MiB);
    const r = await upload(hub, token, body, "hoadon.pdf");
    expect(r.status).toBe(201);
    const p = AttachmentSchema.safeParse(r.json);
    expect(p.success).toBe(true);
    expect({ mime: r.json?.mime, size: r.json?.size, filename: r.json?.filename }).toEqual({
      mime: "application/pdf",
      size: MiB,
      filename: "hoadon.pdf",
    });
    const id = r.json.id as string;
    const after = await diskFiles(hub.dir);
    expect(after.filter((f) => !before.includes(f))).toEqual([`${T.acme}/${id}`]);
    const onDisk = new Uint8Array(await Bun.file(pathOf(hub.dir, `${T.acme}/${id}`)).arrayBuffer());
    const row = await attRow(sql, id);
    expect(sha256(onDisk)).toBe(sha256(body));
    expect(row.sha256).toBe(sha256(body));
    expect({
      origin: row.origin,
      user: row.user_id,
      msg: row.message_id,
      bound: row.bound_at,
      key: row.storage_key,
    }).toEqual({
      origin: "upload",
      user: USERS.lan.id,
      msg: null,
      bound: null,
      key: `${T.acme}/${id}`,
    });
  });

  it("HUB-FR-44 · A02 · đúng 20 971 520 B → 201; +1 có Content-Length (gửi chậm 1 MiB/50 ms) → 413 {max_bytes} khi đã gửi < 2 MiB, 0 hàng, 0 .part [H2c-R01 · AC-02]", async () => {
    const ok = await upload(hub, token, sample.pdf(MAX), "dung-20.pdf");
    expect(ok.status).toBe(201);
    const s0 = await snap(hub);
    const r = await rawUpload(hub.port, auth("qua-20.pdf", { "Content-Length": String(MAX + 1) }), {
      total: MAX + 1,
      chunk: MiB,
      everyMs: 50,
      prefix: new TextEncoder().encode("%PDF-1.4\n"),
    });
    expect(r.status).toBe(413);
    expect(r.sentAtResponse).toBeLessThan(2 * MiB);
    expect(JSON.parse(r.body || "null")?.error).toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
      details: { max_bytes: MAX },
    });
    expect(await snap(hub)).toEqual(s0);
  });

  it("HUB-FR-44 · A03 · Content-Length: 0 → 400 {field: body}; chunked rỗng → 400; 0 hàng/file [H2c-R01 · AC-02]", async () => {
    const s0 = await snap(hub);
    const empty = await upload(hub, token, new Uint8Array(0), "rong.pdf");
    expect(codeOf(empty)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(empty.json?.error?.details).toEqual({ field: "body" });
    const chunked = await rawUpload(
      hub.port,
      auth("rong2.pdf", { "Transfer-Encoding": "chunked" }),
      { bytes: new TextEncoder().encode("0\r\n\r\n") },
    );
    expect(chunked.status).toBe(400);
    expect(await snap(hub)).toEqual(s0);
  });

  it("HUB-FR-44 · A04 · chunked không Content-Length 20 MiB + 1 → 413 (bộ đếm), 0 hàng, 0 .part; chunked 1 MiB → 201 [L3 (a) · AC-02]", async () => {
    const s0 = await snap(hub);
    const big = await upload(hub, token, sample.pdf(MAX + 1), "chunk-qua.pdf", { chunked: true });
    expect(codeOf(big)).toEqual({ status: 413, code: "ATTACHMENT_TOO_LARGE" });
    expect(await snap(hub)).toEqual(s0);
    const small = await upload(hub, token, sample.pdf(MiB), "chunk-1.pdf", { chunked: true });
    expect(small.status).toBe(201);
    expect(small.json?.size).toBe(MiB);
  });

  it("HUB-FR-44 · A05 · socket thô Content-Length 1024 + thân 20 MiB + 1 → không hàng nào size > 1024, không .part, GET /health kế 200; không JWT (thiếu cả X-Filename) → 401 AUTH_EXPIRED [L3 (b) · AC-02]", async () => {
    const t0 = new Date();
    const big = sample.pdf(MAX + 1);
    await rawUpload(hub.port, auth("gia-1024.pdf", { "Content-Length": "1024" }), {
      bytes: big,
      closeAfter: true,
    });
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
      where created_at >= ${t0} and size > 1024`;
    expect(r?.n).toBe(0);
    expect(parts(await diskFiles(hub.dir))).toEqual([]);
    expect(await health(hub)).toBe(200);
    const noJwt = await upload(hub, "", sample.pdf(100), "x.pdf", { rawName: null });
    expect(codeOf(noJwt)).toEqual({ status: 401, code: "AUTH_EXPIRED" });
  });

  it("HUB-FR-44 · A06 · X-Filename thiếu / rỗng / %ZZ / thô Hoá.pdf / 1 025 byte giải mã → 400 {field: X-Filename}; 0 ghi [H2c-R02 · AC-02]", async () => {
    const s0 = await snap(hub);
    const cases: (string | null)[] = [null, "", "%ZZ", "Hoá.pdf", pct(`${"a".repeat(1021)}.pdf`)];
    for (const raw of cases) {
      const r = await upload(hub, token, sample.pdf(100), "x.pdf", { rawName: raw });
      expect({ raw, ...codeOf(r), details: r.json?.error?.details }).toEqual({
        raw,
        status: 400,
        code: "VALIDATION_ERROR",
        details: { field: "X-Filename" },
      });
    }
    expect(await snap(hub)).toEqual(s0);
  });

  it("HUB-FR-44 · A07 · thứ tự: header sai + .exe → 400; .exe + Content-Length 21 MiB → 415 (đuôi trước 413); Content-Length 21 MiB + hạn mức đầy → 413 (trước 409) [plan §2.4]", async () => {
    const bad = await upload(hub, token, sample.txt(10), "x.exe", { rawName: "%ZZ.exe" });
    expect(codeOf(bad)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    const slow = { total: 21 * MiB, chunk: 64 * 1024, everyMs: 50 };
    const exe = await rawUpload(
      hub.port,
      auth("a07.exe", { "Content-Length": String(21 * MiB) }),
      slow,
    );
    expect(exe.status).toBe(415);
    const full = await rawUpload(
      tiny.port,
      auth("a07.pdf", { "Content-Length": String(21 * MiB) }),
      slow,
    );
    expect(full.status).toBe(413);
  });

  it("HUB-FR-44 · A08 · client đứt sau 2 MiB → không hàng, .part xoá (≤ 2 s), warn attachment-upload-aborted{tenant_id, user_id, bytes}; Hub phục vụ request kế [H2c-R05]", async () => {
    const s0 = await snap(hub);
    const r = await rawUpload(hub.port, auth("dut.pdf", { "Content-Length": String(5 * MiB) }), {
      total: 5 * MiB,
      chunk: 256 * 1024,
      everyMs: 20,
      prefix: new TextEncoder().encode("%PDF-1.4\n"),
      abortAfter: 2 * MiB,
    });
    expect(r.status).toBe(0);
    const s1 = await waitFor(
      () => snap(hub),
      (s) => parts(s.files).length === 0,
      2_000,
    );
    expect(s1).toEqual(s0);
    const w = await waitFor(
      async () => logged("attachment-upload-aborted"),
      (xs) => xs.length > 0,
      2_000,
    );
    expect(w[0]?.level).toBe("warn");
    expect(w[0]?.rec).toMatchObject({ tenant_id: T.acme, user_id: USERS.lan.id });
    expect(typeof w[0]?.rec.bytes).toBe("number");
    expect(await health(hub)).toBe(200);
  });
});

describe("A09–A14 · tên và loại [H2c-R02 · R03 · AC-03 · AC-04]", () => {
  const NAMES: [string, string][] = [
    ["../../etc/passwd.txt", "txt"],
    ["a\\b.txt", "txt"],
    ["‮gnp.exe.txt", "txt"],
    ["CON.txt", "txt"],
    [".env.md", "md"],
    ["-x.md", "md"],
    ["Hoá đơn tháng 9.pdf", "pdf"],
    ["a<b>|c.csv", "csv"],
  ];
  const bodyFor = (ext: string) =>
    ext === "pdf" ? sample.pdf(512) : ext === "csv" ? sample.csv(512) : sample.txt(512);

  it("HUB-FR-44 · A09 · X-Filename pct từng tên bảng R07 → filename = displayName, safe_name = safeName(displayName); đĩa chỉ <uuid>/<uuid> [H2c-R02 · AC-04]", async () => {
    for (const [name, ext] of NAMES) {
      const r = await upload(hub, token, bodyFor(ext), name);
      expect({ name, status: r.status }).toEqual({ name, status: 201 });
      const row = await attRow(sql, r.json.id);
      const disp = displayName(name);
      expect({ name, filename: r.json.filename, safe: row.safe_name }).toEqual({
        name,
        filename: disp,
        safe: safeName(disp),
      });
    }
    const files = await diskFiles(hub.dir);
    expect(files.filter((f) => !KEY_RE.test(f))).toEqual([]);
  });

  it("HUB-FR-44 · A10 · tên 300 ký tự .txt → filename 200 ký tự kết thúc .txt; U+202E gnp.exe.txt → 201 text/plain, filename gnp.exe.txt [H2c-R02 · AC-04]", async () => {
    const long = await upload(hub, token, sample.txt(64), `${"a".repeat(296)}.txt`);
    expect(long.status).toBe(201);
    expect({
      len: long.json?.filename?.length,
      end: long.json?.filename?.endsWith(".txt"),
    }).toEqual({
      len: 200,
      end: true,
    });
    const rlo = await upload(hub, token, sample.txt(64), "‮gnp.exe.txt");
    expect({ status: rlo.status, mime: rlo.json?.mime, filename: rlo.json?.filename }).toEqual({
      status: 201,
      mime: "text/plain",
      filename: "gnp.exe.txt",
    });
  });

  it("HUB-FR-44 · A11 · 415: .exe; MZ đuôi .pdf; .pdf chứa PNG; .html; .svg; .txt có 00 ở 5 MiB; #! đuôi .md → ATTACHMENT_TYPE_NOT_ALLOWED, 0 hàng, 0 .part; log info attachment-rejected{code:415} [H2c-R03 · AC-03]", async () => {
    const enc = new TextEncoder();
    const nul = sample.txt(6 * MiB);
    nul[5 * MiB] = 0;
    const cases: [string, Uint8Array][] = [
      ["a.exe", sample.txt(64)],
      ["mz.pdf", Uint8Array.from([0x4d, 0x5a, ...sample.pdf(64)])],
      ["png.pdf", sample.png(256)],
      ["a.html", enc.encode("<html><body>x</body></html>")],
      ["a.svg", enc.encode("<svg xmlns='http://www.w3.org/2000/svg'/>")],
      ["nul.txt", nul],
      ["sh.md", enc.encode("#!/bin/sh\necho hi\n")],
    ];
    const s0 = await snap(hub);
    for (const [name, body] of cases) {
      const r = await upload(hub, token, body, name);
      expect({ name, ...codeOf(r) }).toEqual({
        name,
        status: 415,
        code: "ATTACHMENT_TYPE_NOT_ALLOWED",
      });
    }
    expect(await snap(hub)).toEqual(s0);
    const rej = logged("attachment-rejected").filter((l) => l.rec.code === 415);
    expect(rej.length).toBe(cases.length);
    expect(rej.every((l) => l.level === "info")).toBe(true);
  });

  it("HUB-FR-44 · A12 · 201: .docx (PK\\x03\\x04), .csv BOM, .JPG (FF D8 FF E0) → mime theo ATTACH_ALLOWED [H2c-R03 · AC-03]", async () => {
    const cases: [string, Uint8Array, string][] = [
      [
        "bao-cao.docx",
        sample.docx(512),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["bang.csv", sample.csv(512), "text/csv"],
      ["ANH.JPG", sample.jpg(512), "image/jpeg"],
    ];
    for (const [name, body, mime] of cases) {
      const r = await upload(hub, token, body, name);
      expect({ name, status: r.status, mime: r.json?.mime }).toEqual({ name, status: 201, mime });
    }
  });

  it("HUB-FR-44 · A13 · Content-Type: application/x-msdownload của client với .pdf hợp lệ → 201 mime application/pdf [H2c-R03]", async () => {
    const r = await upload(hub, token, sample.pdf(512), "ok.pdf", {
      headers: { "content-type": "application/x-msdownload" },
    });
    expect({ status: r.status, mime: r.json?.mime }).toEqual({
      status: 201,
      mime: "application/pdf",
    });
  });

  it("HUB-FR-44 · A14 · .txt UTF-8 cắt dở cuối (E1 BA) → 415; .json UTF-8 hợp lệ → 201 application/json [H2c-R03]", async () => {
    const cut = Uint8Array.from([...new TextEncoder().encode("Ho"), 0xe1, 0xba]);
    expect(codeOf(await upload(hub, token, cut, "cut.txt"))).toEqual({
      status: 415,
      code: "ATTACHMENT_TYPE_NOT_ALLOWED",
    });
    const json = new TextEncoder().encode(JSON.stringify({ ten: "Hoá đơn", so: 9 }));
    const ok = await upload(hub, token, json, "data.json");
    expect({ status: ok.status, mime: ok.json?.mime }).toEqual({
      status: 201,
      mime: "application/json",
    });
  });
});

describe("A15–A19 · transaction, song song, log, role, CORS [H2c-R05 · R07]", () => {
  it("HUB-FR-44 · A15 · lỗi trong transaction sau khi stream xong (409 chốt, chunked, hạn mức đầy) → không hàng, .part xoá, không file cuối [H2c-R05]", async () => {
    const s0 = await snap(tiny);
    const [n0] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    const r = await upload(tiny, token, sample.pdf(4096), "chot.pdf", { chunked: true });
    expect(codeOf(r)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    const [n1] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(n1?.n).toBe(n0?.n);
    expect((await snap(tiny)).files).toEqual(s0.files);
  });

  it("HUB-FR-44 · A16 · trong lúc upload 4 MiB đang stream: chưa có hàng (INSERT sau stream); sau 201 file cuối tồn tại và hàng có [H2c-R05]", async () => {
    const t0 = new Date();
    let midRows = -1;
    const r = await rawUpload(
      hub.port,
      auth("dang-gui.pdf", { "Content-Length": String(4 * MiB) }),
      {
        total: 4 * MiB,
        chunk: 512 * 1024,
        everyMs: 30,
        prefix: new TextEncoder().encode("%PDF-1.4\n"),
        onChunk: async (sent) => {
          if (midRows >= 0 || sent < 2 * MiB) return;
          const [x] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
          where tenant_id = ${T.acme} and created_at >= ${t0}`;
          midRows = x?.n ?? -1;
        },
      },
    );
    expect(r.status).toBe(201);
    expect(midRows).toBe(0);
    const id = JSON.parse(r.body || "{}").id as string;
    expect(await attRow(sql, id)).toBeDefined();
    expect(await Bun.file(pathOf(hub.dir, `${T.acme}/${id}`)).exists()).toBe(true);
  });

  it("HUB-FR-44 · A17 · hai upload song song cùng user → 2 id khác nhau, 2 file, sha256 từng file đúng [H2c-R05]", async () => {
    const a = sample.pdf(2 * MiB);
    const b = sample.txt(2 * MiB);
    const [ra, rb] = await Promise.all([
      upload(hub, token, a, "song-a.pdf"),
      upload(hub, token, b, "song-b.txt"),
    ]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.json.id).not.toBe(rb.json.id);
    for (const [r, body] of [
      [ra, a],
      [rb, b],
    ] as [Json, Uint8Array][]) {
      const f = new Uint8Array(
        await Bun.file(pathOf(hub.dir, `${T.acme}/${r.json.id}`)).arrayBuffer(),
      );
      expect(sha256(f)).toBe(sha256(body));
    }
  });

  it("HUB-FR-44 · A18 · log attachment_uploaded{attachment_id, tenant_id, user_id, size, mime, origin:upload}; không tên file, không byte thân; không dòng usage_logs mới [H2c-R07]", async () => {
    const [u0] = await sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs`;
    const body = new TextEncoder().encode("NOI-DUNG-BI-MAT-A18\n");
    const r = await upload(hub, token, body, "hoadon-a18.txt");
    expect(r.status).toBe(201);
    const up = logged("attachment_uploaded");
    expect(up.length).toBe(1);
    expect(up[0]?.rec).toMatchObject({
      attachment_id: r.json.id,
      tenant_id: T.acme,
      user_id: USERS.lan.id,
      size: body.length,
      mime: "text/plain",
      origin: "upload",
    });
    const all = allLogText();
    expect(all).not.toContain("hoadon");
    expect(all).not.toContain("NOI-DUNG-BI-MAT");
    const [u1] = await sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs`;
    expect(u1?.n).toBe(u0?.n);
  });

  it("HUB-FR-44 · A19 · mọi role (lan member, tadmin) → 201; CORS preflight cho X-Filename, Access-Control-Expose-Headers ∋ Content-Disposition [H2c-R01 · P17]", async () => {
    const lan = await upload(hub, token, sample.pdf(256), "lan.pdf");
    const ta = await upload(hub, await sign(k, USERS.tadmin), sample.pdf(256), "tadmin.pdf");
    expect([lan.status, ta.status]).toEqual([201, 201]);
    const origin = "http://localhost:3100";
    const pre = await fetch(`${hub.base}/attachments`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,x-filename",
      },
    });
    const allow = (pre.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allow.split(/\s*,\s*/)).toContain("x-filename");
    const r = await upload(hub, token, sample.pdf(256), "cors.pdf", {
      headers: { Origin: origin },
    });
    const expose = (r.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    expect(expose.split(/\s*,\s*/)).toContain("content-disposition");
  });
});
