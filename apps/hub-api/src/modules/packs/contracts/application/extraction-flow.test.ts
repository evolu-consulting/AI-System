// HD-FR-24 · HD-FR-25 · review HD2 Trung 1/2/4 + S-M1: lượt trích không khoá trước (ghi có điều kiện version, thua đua ⇒ đọc lại
// gộp lại, giữ sửa tay mới hơn), agent treo ⇒ TIMEOUT + huỷ signal + trả chỗ hàng đợi, MST bị hẹn giờ ⇒ hẹn đúng giờ rồi tra lại
// từ hàng đợi (hẹn giờ + đồng hồ giả, không ngủ chờ), cổng MST giãn 2 s. Không DB, không mạng.
import { describe, expect, it } from "bun:test";
import { createTaxRegistry, type TaxFetch } from "../../../../lib/tax-registry.http";
import { createExtractionAgent, type Deadline } from "../adapters/extraction-agent";
import { createExtractionVerifier } from "../adapters/extraction-verifier";
import { fillFields } from "../domain/fields.rules";
import { createExtractionQueue } from "./extraction-queue";
import { createRunExtraction } from "./run-extraction.usecase";
import { createRefreshParties } from "./tax-parties";

const who = { tenantId: "t", userId: "u" };
const KEYS = Object.keys(fillFields({}));
const emptyJson = () =>
  JSON.stringify({
    fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])),
    items: [],
    clauses: [],
  });

type Row = { status: string; version: number; fields: unknown; warnings?: unknown };
function fakeUow(row: Row, o: { failSave?: boolean; beforeSave?: () => void } = {}) {
  const log: string[] = [];
  const repo = {
    source: async () => ({
      ...row,
      kind: "contract",
      text: "Bên bán: Công ty A, MST: 0312345678",
      file: null,
      parent: null,
      items: [],
    }),
    saveResult: async (
      _id: string,
      r: { expected: number; fields: unknown; warnings: unknown },
    ) => {
      o.beforeSave?.();
      if (o.failSave) throw new Error("22P05");
      log.push(`save@${r.expected}`);
      if (row.version !== r.expected || row.status !== "extracting") return false;
      Object.assign(row, {
        status: "needs_review",
        version: row.version + 1,
        fields: r.fields,
        warnings: r.warnings,
      });
      return true;
    },
    saveWarnings: async (_id: string, w: unknown, expected: number) => {
      log.push(`warn@${expected}`);
      if (row.version !== expected) return false;
      row.warnings = w;
      return true;
    },
    saveFailure: async (_id: string, code: string) => {
      log.push(`fail:${code}`);
      row.status = "extract_failed";
      return true;
    },
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
      fn({ extraction: repo, outbox: { enqueue: async () => {} } }),
  };
  return { uow: uow as never, log, row };
}
const okAgent = (text = emptyJson()) => createExtractionAgent(async () => ({ ok: true, text }));

describe("Trung 1 · ghi có điều kiện version, không khoá trước", () => {
  it("sửa tay xen giữa (version đổi) ⇒ đọc lại, gộp lại, trường edited mới hơn được giữ", async () => {
    const edited = fillFields({
      total_value: { value: 9, quote: "", verified: true, edited: true },
    });
    const f = fakeUow(
      { status: "extracting", version: 2, fields: {} },
      {
        beforeSave: () => {
          if (f.row.version === 2) Object.assign(f.row, { version: 3, fields: edited }); // PATCH lúc agent chạy
        },
      },
    );
    const run = createRunExtraction({
      uow: f.uow,
      agent: okAgent(),
      verifier: createExtractionVerifier(),
      tax: null,
    });
    expect(await run(who, "c")).toBe("needs_review");
    expect(f.log).toEqual(["save@2", "save@3"]);
    expect((f.row.fields as Record<string, { value: unknown }>).total_value?.value).toBe(9);
  });
  it("S-M1 · ghi ném ⇒ SAVE_FAILED ⇒ extract_failed", async () => {
    const f = fakeUow({ status: "extracting", version: 1, fields: {} }, { failSave: true });
    const run = createRunExtraction({
      uow: f.uow,
      agent: okAgent(),
      verifier: createExtractionVerifier(),
      tax: null,
    });
    expect(await run(who, "c")).toBe("extract_failed");
    expect(f.log).toEqual(["fail:SAVE_FAILED"]);
  });
});

describe("Trung 2 · agent treo", () => {
  it("hết hạn giờ ⇒ TIMEOUT, signal bị huỷ; lượt trả chỗ hàng đợi, HĐ sang extract_failed (trích lại được)", async () => {
    let fire = () => {};
    let arm = () => {};
    const armed = new Promise<void>((r) => {
      arm = r;
    });
    const deadline: Deadline = () => {
      const wait = new Promise<void>((r) => {
        fire = r;
      });
      arm();
      return { wait, cancel: () => {} };
    };
    let signal: AbortSignal | null = null;
    const agent = createExtractionAgent(
      (req) => {
        signal = req.signal;
        return new Promise(() => {}); // không bao giờ xong
      },
      { deadline },
    );
    const f = fakeUow({ status: "extracting", version: 1, fields: {} });
    const settled: string[] = [];
    const q = createExtractionQueue({
      concurrency: 1,
      run: createRunExtraction({
        uow: f.uow,
        agent,
        verifier: createExtractionVerifier(),
        tax: null,
      }),
      onSettled: (id, o) => settled.push(`${id}:${o}`),
    });
    await q.start(who, "c");
    const idle = q.idle();
    await armed; // agent đã được gọi, đang treo
    expect(q.size()).toBe(1);
    fire();
    await idle;
    expect(settled).toEqual(["c:extract_failed"]);
    expect(f.log).toEqual(["fail:TIMEOUT"]);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(q.size()).toBe(0);
  });
});

function fakeFetch() {
  const urls: string[] = [];
  const f: TaxFetch = async (url) => {
    urls.push(url);
    const body = { code: "00", data: { name: "CÔNG TY TNHH A", status: "Đang hoạt động" } };
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  return { f, urls };
}

describe("Trung 4 · cổng MST giãn 2 s, hẹn giờ tra lại từ hàng đợi", () => {
  it("hai MST liền nhau ⇒ cái thứ hai `unavailable` + retryAt = khe kế (không gọi mạng, không chờ)", async () => {
    let now = 10_000;
    const { f, urls } = fakeFetch();
    const t = createTaxRegistry({ baseUrl: "https://x", fetch: f, now: () => now });
    expect((await t.lookup("0312345678", { fast: false })).result).toBe("found");
    expect(await t.lookup("0109876543", { fast: false })).toEqual({
      result: "unavailable",
      retryAt: 12_000,
    });
    expect(urls).toHaveLength(1);
    now = 12_000;
    expect((await t.lookup("0109876543", { fast: false })).result).toBe("found");
  });
});

describe("Trung 4 · hẹn giờ tra lại MST từ hàng đợi", () => {
  it("trích xong còn MST bị hẹn ⇒ hẹn đúng giờ; tới giờ ⇒ lượt refresh tra lại và cập nhật cảnh báo theo version", async () => {
    let now = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const { f } = fakeFetch();
    const tax = createTaxRegistry({ baseUrl: "https://x", fetch: f, now: () => now });
    await tax.lookup("0999999999", { fast: false }); // chiếm khe ⇒ lượt trích gặp `unavailable`
    const json = JSON.parse(emptyJson());
    json.fields.supplier_name = { value: "Công ty A", quote: "Bên bán: Công ty A" };
    json.fields.supplier_tax_id = { value: "0312345678", quote: "MST: 0312345678" };
    const fk = fakeUow({ status: "extracting", version: 1, fields: {} });
    const deps = { uow: fk.uow, tax };
    let q: ReturnType<typeof createExtractionQueue> | null = null;
    const schedule = (w: typeof who, id: string, at: number, n: number) =>
      q?.scheduleTaxRetry(w, id, at, n);
    q = createExtractionQueue({
      run: createRunExtraction({
        ...deps,
        agent: okAgent(JSON.stringify(json)),
        verifier: createExtractionVerifier(),
        scheduleTaxRetry: schedule,
      }),
      refresh: createRefreshParties({ ...deps, schedule }),
      now: () => now,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
    });
    await q.start(who, "c");
    await q.idle();
    expect(timers.map((t) => t.ms)).toEqual([2_000]);
    now = 2_000;
    timers[0]?.fn();
    await q.idle();
    expect(fk.log).toEqual(["save@1", "warn@2"]);
    expect(timers).toHaveLength(1); // tra được ⇒ không hẹn tiếp
  });
  it("gộp lời gọi đang bay chỉ khi cùng `fast` (nhập tay không chờ lượt nền)", async () => {
    let calls = 0;
    const f: TaxFetch = async () => {
      calls++;
      return { status: 200, headers: { get: () => null }, text: async () => '{"code":"51"}' };
    };
    const t = createTaxRegistry({ baseUrl: "https://x", fetch: f, intervalMs: 0 });
    await Promise.all([t.lookup("1", { fast: false }), t.lookup("1", { fast: false })]);
    expect(calls).toBe(1);
  });
});
