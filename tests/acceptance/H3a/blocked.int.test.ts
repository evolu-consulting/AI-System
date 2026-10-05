// HUB-BR-04 · WRK-FR-15 · H3a-R06, R08, R09 · HUB-H3a-AC-04 (vế Hub), HUB-H3a-AC-06 · test-plan-cases H3a §2.1 A01–A08:
// provider đang chặn trước enqueue ⇒ 0 job, `run.failed ALL_PROVIDERS_EXHAUSTED` ngay với câu theo reason (cooldown ⇒
// `quota`, logged_out/error ⇒ `provider_unavailable`), GET /runs/:id cùng nguồn, không lộ provider/giờ. A09 ⇒ A18.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { RunFailedDataSchema, RunSchema } from "@ai/contracts/chat";
import { call, sign, USERS, type UserKey } from "../H1/_fixtures";
import { settleRuns } from "../H2b/_h2b";
import {
  endOf,
  expectNoLeak,
  type H3aCtx,
  jobsOfRun,
  type ProviderStatus,
  R08,
  type R08Reason,
  startH3a,
  startRun,
  withProvider,
} from "./_h3a";

let x: H3aCtx;
beforeAll(async () => {
  x = await startH3a();
}, 60_000);
afterEach(() => settleRuns(x.hub, x.sql, x.k));
afterAll(() => x?.stop());

const HOUR = 3_600_000;
const LOCALE: Record<"lan" | "hoa", "vi" | "en"> = { lan: "vi", hoa: "en" };

/** Gửi tin thường khi provider bị chặn; trả SSE kết thúc + ms + run id. */
async function blockedRun(who: UserKey, content: string) {
  const t0 = Date.now();
  const r = await startRun(x, who, content);
  const end = await endOf(r.s, 5_000);
  return { ...r, end, ms: Date.now() - t0 };
}

const CASES: [string, "lan" | "hoa", ProviderStatus, number | null, R08Reason][] = [
  ["A01", "lan", "cooldown", HOUR, "quota"],
  ["A02", "hoa", "cooldown", HOUR, "quota"],
  ["A03", "lan", "logged_out", null, "provider_unavailable"],
  ["A04", "hoa", "error", null, "provider_unavailable"],
  ["A05", "lan", "cooldown", null, "quota"],
];

describe("A01–A05 · chặn trước enqueue → câu theo reason, 0 job [H3a-R06 · H3a-R08 · H3a-R09 · HUB-H3a-AC-04]", () => {
  for (const [idc, who, status, until, reason] of CASES)
    it(`HUB-BR-04 · ${idc} · ${status}${until === null ? " (cooldown_until NULL)" : " +1 h"} · ${who} (${LOCALE[who]}) → run.failed ALL_PROVIDERS_EXHAUSTED + câu ${reason} nguyên văn, 0 job, ≤ 3 s [H3a-R08 · H3a-R09 · HUB-H3a-AC-04 · HUB-H3a-AC-06]`, async () => {
      await withProvider(x.sql, status, until, async () => {
        const r = await blockedRun(who, `Câu ${idc} ${status}`);
        console.info(`[H3a ${idc}] chặn → run.failed ${r.ms} ms`);
        expect(r.end.event).toBe("run.failed");
        expect(r.end.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
        expect({ message: r.end.data?.message, hint: r.end.data?.hint }).toEqual(
          R08[reason][LOCALE[who]],
        );
        expect(await jobsOfRun(x.sql, r.runId)).toEqual([]);
        expect(r.ms).toBeLessThanOrEqual(3_000);
      });
    });
});

describe("A06–A08 · cùng nguồn, không lộ, hết hạn cooldown [H3a-R08 · H3a-R06]", () => {
  it("HUB-BR-04 · A06 · A01 xong → GET /runs/:id status=failed, error = SSE run.failed (code/message/hint) [H3a-R08 · HUB-H3a-AC-06]", async () => {
    await withProvider(x.sql, "cooldown", HOUR, async () => {
      const r = await blockedRun("lan", "Câu A06");
      const res = await call(x.hub, "GET", `/runs/${r.runId}`, {
        token: await sign(x.k, USERS.lan),
      });
      expect(res.status).toBe(200);
      const run = RunSchema.parse(res.json);
      expect(run.status).toBe("failed");
      expect(run.error).toEqual({
        code: r.end.data?.code,
        message: r.end.data?.message,
        hint: r.end.data?.hint,
      });
      expect(run.error).toEqual({ code: "ALL_PROVIDERS_EXHAUSTED", ...R08.quota.vi });
    });
  });

  it("HUB-BR-04 · A07 · run.failed (cooldown, logged_out) hợp schema chat, không chứa khoá provider, tên vendor, @, chữ số giờ [H3a-R08 · H1-R26]", async () => {
    for (const [status, until, reason] of [
      ["cooldown", HOUR, "quota"],
      ["logged_out", null, "provider_unavailable"],
    ] as const)
      await withProvider(x.sql, status, until, async () => {
        const r = await blockedRun("lan", `Câu A07 ${status}`);
        expect(RunFailedDataSchema.safeParse(r.end.data).success).toBe(true);
        expectNoLeak(r.end.data);
        expect(r.end.data?.message).toBe(R08[reason].vi.message);
      });
  });

  it("WRK-FR-15 · A08 · cooldown đã hết hạn (now−1 s) → job được tạo, run chạy bình thường (hồi quy H1 A30) [H3a-R06 · H1-R18]", async () => {
    await withProvider(x.sql, "cooldown", -1_000, async () => {
      const r = await startRun(x, "lan", "Câu A08 hết cooldown");
      const job = await x.rt.next(r.runId);
      await x.rt.decide(job, { decision: "answer", text: "Chạy được A08." });
      expect((await endOf(r.s)).event).toBe("run.finished");
    });
  });
});
