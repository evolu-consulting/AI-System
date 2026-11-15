// fix-extract-save · AI đoán loại HĐ mà tổ hợp (deal, direction, doc_type) vi phạm CHECK `contracts_deal_ck` ⇒ vẫn `needs_review`
// (deal bỏ trống, người dùng chọn ở màn kiểm), KHÔNG `SAVE_FAILED`. Repo giả mô phỏng CHECK của DB. Không DB, không mạng.
import { describe, expect, it } from "bun:test";
import { createExtractionAgent } from "../adapters/extraction-agent";
import { createExtractionVerifier } from "../adapters/extraction-verifier";
import { fillFields } from "../domain/fields.rules";
import { createRunExtraction } from "./run-extraction.usecase";

const who = { tenantId: "t", userId: "u" };
const KEYS = Object.keys(fillFields({}));
const reply = (deal: string) =>
  JSON.stringify({
    fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])),
    items: [],
    clauses: [],
    deal,
  });

/** Điều kiện `contracts_deal_ck`, chép nguyên văn từ migration (không dùng luật của domain để khỏi tự kiểm mình). */
const ck = (deal: string | null, dir: string | null, doc: string): boolean =>
  deal === null ||
  (dir !== null &&
    ((["buy", "sell", "referral"].includes(deal) && (deal === "buy") === (dir === "purchase")) ||
      (deal === "franchise" && ["sale", "purchase"].includes(dir) && doc === "contract") ||
      (deal === "cooperation" && dir === "sale" && doc === "contract")));

function fake(row: {
  deal: string | null;
  direction: string | null;
  docType: string;
  boom?: boolean;
}) {
  const log: string[] = [];
  const state = { ...row, extractState: "reading" };
  const repo = {
    source: async () => ({
      status: "draft",
      extractState: state.extractState,
      version: 1,
      fields: {},
      kind: "contract",
      text: "Hợp đồng nhượng quyền thương mại",
      file: null,
      parent: null,
      items: [],
      ...row,
    }),
    saveResult: async (
      _id: string,
      r: { dealWrite?: { deal: string | null; direction: string | null } },
    ) => {
      if (row.boom) throw new Error("db down");
      const deal = state.deal ?? r.dealWrite?.deal ?? null;
      const direction = state.direction ?? r.dealWrite?.direction ?? null;
      if (!ck(deal, direction, state.docType)) throw new Error("contracts_deal_ck");
      Object.assign(state, { deal, direction, extractState: "ready" });
      return true;
    },
    saveFailure: async (_id: string, code: string) => {
      log.push(`fail:${code}`);
      return true;
    },
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
      fn({ extraction: repo, outbox: { enqueue: async () => {} } }),
  };
  return { uow: uow as never, log, state };
}

const warned: { msg: string; fields?: Record<string, unknown> }[] = [];
const run = (f: ReturnType<typeof fake>, deal: string) =>
  createRunExtraction({
    log: { warn: (msg, fields) => warned.push({ msg, fields }) },
    uow: f.uow,
    agent: createExtractionAgent(async () => ({ ok: true, text: reply(deal) })),
    verifier: createExtractionVerifier(),
    tax: null,
  })(who, "c");

describe("AI đoán loại HĐ ⇒ luôn lưu được", () => {
  it("Nhượng quyền, hướng chưa có ⇒ needs_review, deal + hướng hợp lệ", async () => {
    const f = fake({ deal: null, direction: null, docType: "contract" });
    expect(await run(f, "franchise")).toBe("needs_review");
    expect(f.state).toMatchObject({ deal: "franchise", direction: "sale", extractState: "ready" });
  });
  it("Hợp tác mà hướng đã là purchase ⇒ needs_review, bỏ deal (không SAVE_FAILED)", async () => {
    const f = fake({ deal: null, direction: "purchase", docType: "contract" });
    expect(await run(f, "cooperation")).toBe("needs_review");
    expect(f.log).toEqual([]);
    expect(f.state).toMatchObject({ deal: null, direction: "purchase" });
  });
  it("ghi hỏng thật ⇒ SAVE_FAILED và log đúng một lần (mã/loại lỗi, không nội dung)", async () => {
    warned.length = 0;
    const f = fake({ deal: null, direction: null, docType: "contract", boom: true });
    expect(await run(f, "franchise")).toBe("extract_failed");
    expect(f.log).toEqual(["fail:SAVE_FAILED"]);
    expect(warned).toEqual([
      { msg: "contract-extract-save-failed", fields: { error_name: "Error", error: "db down" } },
    ]);
  });
});
