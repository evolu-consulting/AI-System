// CR-127 · E7 · BR-17 · int: `POST /tenants/:tid/flow-preview` (+ `/scenarios`) — đường chính (người nhận việc thật của công ty, đóng vai,
// Kết thúc), KHÔNG ghi (số hàng mọi bảng hub/admin không đổi), chỉ platform_admin (tenant_admin / member 403).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPa,
  PA,
  PA_FIX,
  stageDef,
  startPa,
  T,
} from "../../../../../../tests/acceptance/P-a/_support/pa";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const END = { kind: "agent", agent_id: "a0a00000-0000-4000-8000-000000000001" };
const draft = {
  event: "contract.submitted",
  stages: [
    stageDef({
      key: "kt",
      name: "Kế toán duyệt",
      executor: { kind: "approve", reject_step: 2, return_step: null },
      after: { kind: "review", group_id: PA_FIX.gKeToan },
    }),
    {
      ...stageDef({ key: "ok", name: "Hoàn tất", executor: END, after: { kind: "auto" } }),
      outcome: "approved",
    },
    {
      ...stageDef({ key: "no", name: "Từ chối", executor: END, after: { kind: "auto" } }),
      outcome: "rejected",
    },
  ].map((s, i) => ({ ...s, step: i })),
};
const P = `/tenants/${T.acme}/flow-preview`;

/** Tổng số hàng mọi bảng hub + admin (HĐ/chữ ký nằm ở bảng gói — chạy thử không có đường ghi nào tới đó; kiểm cả hub.* gồm run/task/notice/evidence). */
const rows = async (): Promise<number> => {
  const [r] = await c.sql<{ n: number }[]>`select coalesce(sum((xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::int), 0)::int as n
    from pg_tables where schemaname in ('hub', 'admin')`;
  return r?.n ?? -1;
};

describe("CR-127 · E7 · chạy thử", () => {
  it("đường đi + người nhận việc thật + đóng vai; không ghi gì", async () => {
    const before = await rows();
    const wait = await c.call("P", "POST", P, { draft, facts: {}, starter_user_id: PA.A.id });
    expect(wait.status).toBe(200);
    const w = wait.json as {
      status: string;
      waiting_step: string;
      path: { review?: { need: string; who: { user_id: string }[] } }[];
    };
    expect(w.status).toBe("waiting");
    expect(w.waiting_step).toBe("kt");
    const who = w.path.at(-1)?.review;
    expect(who?.need).toBe("one");
    expect(who?.who.map((h) => h.user_id).sort()).toEqual([PA.B.id, PA.T.id].sort());

    const approved = await c.call("P", "POST", P, {
      draft,
      facts: {},
      starter_user_id: PA.A.id,
      decisions: [{ step_key: "kt", result: "approve", actor_user_id: PA.B.id }],
    });
    const a = approved.json as {
      status: string;
      outcome: { key: string } | null;
      path: { step_key: string; can_act?: boolean }[];
    };
    expect(a.status).toBe("finished");
    expect(a.outcome?.key).toBe("approved");
    expect(a.path.find((p) => p.step_key === "kt")?.can_act).toBe(true);

    // người ngoài phòng đóng vai ⇒ không quyết được (canAct của engine)
    const blocked = await c.call("P", "POST", P, {
      draft,
      facts: {},
      starter_user_id: PA.A.id,
      decisions: [{ step_key: "kt", result: "approve", actor_user_id: PA.X.id }],
    });
    expect((blocked.json as { status: string }).status).toBe("waiting");

    const sc = await c.call("P", "POST", `${P}/scenarios`, {
      draft,
      facts: {},
      starter_user_id: PA.A.id,
    });
    expect(sc.status).toBe(200);
    const keys = (sc.json as { scenarios: { key: string }[] }).scenarios.map((s) => s.key);
    expect(keys).toEqual(["approve_then", "reject", "return"]);
    expect(await rows()).toBe(before);
  });

  it("chỉ platform_admin: quản trị công ty / thành viên 403; công ty lạ 404; thiếu nguồn 400", async () => {
    const body = { draft, facts: {} };
    expect((await c.call("Adm", "POST", P, body)).status).toBe(403);
    expect((await c.call("A", "POST", P, body)).status).toBe(403);
    expect((await c.call("Adm", "POST", `${P}/scenarios`, body)).status).toBe(403);
    const none = await c.call(
      "P",
      "POST",
      `/tenants/a5a00000-0000-4000-8000-0000000fffff/flow-preview`,
      body,
    );
    expect(none.status).toBe(404);
    expect((await c.call("P", "POST", P, { facts: {} })).status).toBe(400);
  });
});
