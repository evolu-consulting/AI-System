// HUB-BR-04 · H3a-R19 · PL13 · HUB-H3a-AC-13 · test-plan-cases H3a §2.6 A24–A25: tương thích — Admin test-run (Dify sync,
// không job, không đọc `provider_state`) chạy bình thường khi provider subscription `cooldown`; `run.failed` thật của mọi
// tổ hợp reason × locale hợp schema `@ai/contracts/chat` (contract không đổi).
// A24 lệch cases: test-run không tạo job nên không dựng được job fail `ALL_PROVIDERS_EXHAUSTED`+`quota` qua int (bài học
// H2c B9) — kiểm vế dựng được: test-run không bị chặn bởi cooldown, phản hồi đúng `TestRunResponseSchema` (PL13).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { RunFailedDataSchema } from "@ai/contracts/chat";
import { TestRunResponseSchema } from "@ai/contracts/hub-internal";
import { call, USERS } from "../H1/_fixtures";
import { ARGS_DICH, INTERNAL_TOKEN, MAP_DICH, OUT, WF } from "../H2a/_h2a";
import { settleRuns } from "../H2b/_h2b";
import {
  endOf,
  type H3aCtx,
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

describe("A24–A25 · tương thích [H3a-R19 · PL13 · HUB-H3a-AC-13]", () => {
  it("HUB-BR-04 · A24 · provider cooldown +1 h: Admin test-run /dich → 200 ok:true, đúng TestRunResponseSchema (không bị chặn, PL13) [H3a-R19 · H3a-R10]", async () => {
    await withProvider(x.sql, "cooldown", 3_600_000, async () => {
      x.dify.mock.reset();
      const r = await call(x.hub, "POST", "/internal/test-run", {
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
        body: {
          command: {
            workflow_id: WF.dich,
            args: ARGS_DICH,
            input_map: MAP_DICH,
            output: OUT,
            timeout_s: 10,
          },
          text: "en xin chào",
          actor_user_id: USERS.padmin.id,
        },
      });
      expect(r.status).toBe(200);
      expect(TestRunResponseSchema.safeParse(r.json).success).toBe(true);
      expect(r.json?.ok).toBe(true);
    });
  });

  it("HUB-BR-04 · A25 · run.failed thật (cooldown/logged_out × vi/en) parse bằng RunFailedDataSchema, câu = R08 [H3a-R19 · H3a-R08 · HUB-H3a-AC-13]", async () => {
    const cases: [ProviderStatus, number | null, R08Reason][] = [
      ["cooldown", 3_600_000, "quota"],
      ["logged_out", null, "provider_unavailable"],
    ];
    for (const [status, until, reason] of cases)
      for (const [who, locale] of [
        ["lan", "vi"],
        ["hoa", "en"],
      ] as const)
        await withProvider(x.sql, status, until, async () => {
          const r = await startRun(x, who, `Câu A25 ${status} ${locale}`);
          const end = await endOf(r.s, 5_000);
          expect(end.event).toBe("run.failed");
          expect(RunFailedDataSchema.safeParse(end.data).success).toBe(true);
          expect({ status, locale, message: end.data?.message }).toEqual({
            status,
            locale,
            message: R08[reason][locale].message,
          });
        });
  });
});
