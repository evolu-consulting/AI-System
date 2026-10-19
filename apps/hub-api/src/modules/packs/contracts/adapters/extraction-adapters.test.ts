// HD-FR-21 · HD-FR-24 · HD-FR-25 · HUB-BR-31: adapter agent (parse strict, nonce mới mỗi lần, lỗi ⇒ mã) + hàng đợi trích
// (không chặn, bỏ trùng, đồng thời ≤ N, chờ bằng `idle()`) + tra MST HTTP qua transport giả (cache, 429 nghỉ, không ném).
import { describe, expect, it } from "bun:test";
import { ExtractionOutputSchema } from "@ai/contracts";
import { createTaxRegistry, type TaxFetch, taxBaseUrl } from "../../../../lib/tax-registry.http";
import { createExtractionQueue } from "../application/extraction-queue";
import { requestExtract } from "../application/request-extract.usecase";
import { createExtractionAgent, extractionSchemaText, parseExtraction } from "./extraction-agent";

const KEYS = Object.keys(ExtractionOutputSchema.shape.fields.shape);
const empty = () => ({
  fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])) as Record<
    string,
    { value: unknown; quote: string }
  >,
  items: [],
  clauses: [],
});
const who = { tenantId: "t", userId: "u" };

describe("HUB-BR-31 · parse đầu ra strict", () => {
  it("JSON hợp lệ (kể cả có chữ thừa quanh) ⇒ parse", () => {
    expect(parseExtraction(`Đây là kết quả:\n${JSON.stringify(empty())}\nxong`)).not.toBeNull();
  });
  it("khoá lạ ở gốc / trong trường / sai kiểu / thiếu trường / không phải JSON ⇒ null", () => {
    expect(parseExtraction(JSON.stringify({ ...empty(), note: "x" }))).toBeNull();
    const e1 = empty();
    (e1.fields.number as Record<string, unknown>).verified = true;
    expect(parseExtraction(JSON.stringify(e1))).toBeNull();
    const e2 = empty();
    e2.fields.total_value = { value: "1 tỷ", quote: "" };
    expect(parseExtraction(JSON.stringify(e2))).toBeNull();
    const e3 = empty();
    delete (e3.fields as Record<string, unknown>).penalty;
    expect(parseExtraction(JSON.stringify(e3))).toBeNull();
    expect(parseExtraction("không có json")).toBeNull();
    const e4 = empty();
    e4.fields.title = { value: "a\u0000b", quote: "" };
    expect(parseExtraction(JSON.stringify(e4))).toBeNull(); // NUL ⇒ Postgres từ chối (S-M1)
    const e5 = empty();
    e5.fields.number = { value: "x", quote: "\ud800" };
    expect(parseExtraction(JSON.stringify(e5))).toBeNull(); // surrogate lẻ
    const e6 = empty();
    e6.fields.end_date = { value: "0000-01-01", quote: "" };
    expect(parseExtraction(JSON.stringify(e6))).toBeNull(); // năm 0000
    expect(parseExtraction(`{${"x".repeat(400_001)}}`)).toBeNull();
  });
  it("schema đưa vào lệnh hệ thống có đủ 23 khoá", () => {
    const s = extractionSchemaText();
    for (const k of KEYS) expect(s).toContain(`"${k}"`);
  });
});

describe("HUB-BR-31 · adapter agent", () => {
  it("agent: nonce mới mỗi lần; transport lỗi ⇒ mã; đầu ra hỏng ⇒ INVALID_OUTPUT; ném ⇒ AGENT_FAILED", async () => {
    const seen: string[] = [];
    let reply: { ok: true; text: string } | { ok: false; code: "TIMEOUT" } = {
      ok: true,
      text: JSON.stringify(empty()),
    };
    const agent = createExtractionAgent(async (r) => {
      seen.push(/<contract_document_([a-z0-9]+)>/.exec(r.prompt)?.[1] ?? "");
      return reply;
    });
    const req = { who, contractId: "c", text: "HĐ", file: null, parent: null };
    expect((await agent.extract(req)).ok).toBe(true);
    expect((await agent.extract(req)).ok).toBe(true);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toMatch(/^[0-9a-f]{32}$/);
    reply = { ok: false, code: "TIMEOUT" };
    expect(await agent.extract(req)).toEqual({ ok: false, code: "TIMEOUT" });
    reply = { ok: true, text: "{}" };
    expect(await agent.extract(req)).toEqual({ ok: false, code: "INVALID_OUTPUT" });
    const boom = createExtractionAgent(async () => {
      throw new Error("x");
    });
    expect(await boom.extract(req)).toEqual({ ok: false, code: "AGENT_FAILED" });
  });
});

describe("HD-FR-24 · hàng đợi trích", () => {
  it("start trả ngay; bỏ trùng; tối đa 2 lượt đồng thời; idle() chờ hết; lỗi ⇒ onSettled('error')", async () => {
    let live = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const settled: string[] = [];
    const q = createExtractionQueue({
      concurrency: 2,
      run: async (_w, id) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise<void>((r) => gates.push(r));
        live--;
        if (id === "bad") throw new Error("x");
        return "needs_review";
      },
      onSettled: (id, o) => settled.push(`${id}:${o}`),
    });
    await q.start(who, "a");
    await q.start(who, "a");
    await q.start(who, "b");
    await q.start(who, "bad");
    expect(q.size()).toBe(3);
    expect(peak).toBe(2);
    const done = q.idle();
    while (gates.length > 0 || q.size() > 0) {
      const g = gates.shift();
      if (g) g();
      await Promise.resolve();
      await new Promise<void>((r) => queueMicrotask(r));
    }
    await done;
    expect(settled.sort()).toEqual(["a:needs_review", "b:needs_review", "bad:error"]);
    expect(peak).toBe(2);
  });
});

function fake(status: number, body: unknown, headers: Record<string, string> = {}) {
  const urls: string[] = [];
  const f: TaxFetch = async (url) => {
    urls.push(url);
    return {
      status,
      headers: { get: (k) => headers[k] ?? null },
      text: async () => JSON.stringify(body),
    };
  };
  return { f, urls };
}

describe("HD-FR-25 · tra MST HTTP (transport giả)", () => {
  it("found ⇒ tên + tình trạng; cache lần 2 không gọi; URL = base/MST", async () => {
    const { f, urls } = fake(200, {
      code: "00",
      data: { name: "CÔNG TY A", status: "Đang hoạt động" },
    });
    const t = createTaxRegistry({ baseUrl: "https://tax.test/v2/business", fetch: f });
    expect(await t.lookup("0312345678", { fast: true })).toMatchObject({
      result: "found",
      name: "CÔNG TY A",
      status: "Đang hoạt động",
    });
    await t.lookup("0312345678", { fast: false });
    expect(urls).toEqual(["https://tax.test/v2/business/0312345678"]);
  });
  it("code 51 ⇒ not_found; 5xx/thân lạ ⇒ unavailable; ném ⇒ unavailable", async () => {
    expect(
      await createTaxRegistry({ baseUrl: "https://x", fetch: fake(200, { code: "51" }).f }).lookup(
        "1",
        { fast: true },
      ),
    ).toEqual({ result: "not_found" });
    expect(
      await createTaxRegistry({ baseUrl: "https://x", fetch: fake(502, {}).f }).lookup("1", {
        fast: true,
      }),
    ).toEqual({ result: "unavailable" });
    expect(
      await createTaxRegistry({
        baseUrl: "https://x",
        fetch: fake(200, { code: "00", data: {} }).f,
      }).lookup("1", { fast: true }),
    ).toEqual({ result: "unavailable" });
    const thrower = createTaxRegistry({
      baseUrl: "https://x",
      fetch: async () => {
        throw new Error("net");
      },
    });
    expect(await thrower.lookup("1", { fast: true })).toEqual({ result: "unavailable" });
  });
});

describe("HD-FR-25 · tra MST HTTP — nghỉ 429, cấu hình egress", () => {
  it("429 ⇒ nghỉ theo Retry-After (đồng hồ giả), không gọi trong lúc nghỉ, hết nghỉ gọi lại", async () => {
    let now = 1_000;
    const { f, urls } = fake(429, {}, { "retry-after": "30" });
    const t = createTaxRegistry({ baseUrl: "https://x", fetch: f, now: () => now });
    expect((await t.lookup("1", { fast: true })).result).toBe("unavailable");
    expect((await t.lookup("2", { fast: true })).result).toBe("unavailable");
    expect(urls).toHaveLength(1);
    now += 31_000;
    await t.lookup("2", { fast: true });
    expect(urls).toHaveLength(2);
  });
  it("tên/tình trạng từ dịch vụ ngoài: bỏ ký tự điều khiển, cắt ≤ 300; thân > 64 KiB ⇒ unavailable", async () => {
    const long = `CÔNG TY\u0000 ${"X".repeat(400)}`;
    const t = createTaxRegistry({
      baseUrl: "https://x",
      fetch: fake(200, { code: "00", data: { name: long, status: "Đang\u0007 hoạt động" } }).f,
    });
    const r = await t.lookup("1", { fast: true });
    expect(r.result).toBe("found");
    if (r.result === "found") {
      expect(r.name.includes("\u0000")).toBe(false);
      expect(r.name.length).toBeLessThanOrEqual(300);
      expect(r.status).toBe("Đang  hoạt động");
    }
    const big = createTaxRegistry({
      baseUrl: "https://x",
      fetch: fake(200, { code: "00", data: { name: "A", pad: "y".repeat(70_000) } }).f,
    });
    expect(await big.lookup("2", { fast: true })).toEqual({ result: "unavailable" });
  });
  it("taxBaseUrl: chỉ http(s), không user:pass; vắng/sai ⇒ null", () => {
    expect(taxBaseUrl(undefined)).toBeNull();
    expect(taxBaseUrl("ftp://x")).toBeNull();
    expect(taxBaseUrl("https://u:p@x")).toBeNull();
    expect(taxBaseUrl("https://api.vietqr.io/v2/business/")).toBe(
      "https://api.vietqr.io/v2/business",
    );
  });
});

describe("D2-01 · chưa nối agent", () => {
  it("trích lại ⇒ `unavailable` trước mọi SQL, không xếp hàng", async () => {
    let tx = 0;
    let started = 0;
    const uow = {
      tenant: async () => {
        tx++;
        throw new Error("không được mở tx");
      },
    };
    const r = requestExtract({
      uow: uow as never,
      starter: {
        start: async () => {
          started++;
        },
      },
      available: false,
    });
    expect(await r(who, "c")).toEqual({ kind: "unavailable" });
    expect({ tx, started }).toEqual({ tx: 0, started: 0 });
  });
});
