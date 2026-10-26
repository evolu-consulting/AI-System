// CR-097 K2 · HD-FR-101 tải bản cập nhật = phiên bản mới (nháp) · HD-FR-102 xác nhận v2 ⇒ v1 bị thay (giữ ngày của v1) ·
// HD-FR-103 cutover nghĩa vụ (mở + hạn ≥ ngày hiệu lực v2 ⇒ huỷ; đã xong giữ; có dòng kho ⇒ giữ + ghi kết quả) · R18 danh sách
// chỉ bản hiện hành + `versions_count` · X5 xoá trong chuỗi · RLS: không thấy v1 ⇒ không thấy/không tạo v2 · chéo tenant 404.
// Viết TRƯỚC code (làn đầy đủ: tiền/kho, RLS). Hạ tầng HD1 (hub-api THẬT, FileBox giả, không AI: bước "AI đọc xong" giả bằng SQL).
// acme: lan = owner gói (người tải, phụ trách v1) · hoa = editor; beta: an = owner.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CBASE, type Json, pdf } from "../HD1/_support/hd1";
import { arrangeHd7, type CtxN1, d, deal, P, startHd1, T } from "../HD7/_support/hd7";

/** Fixture HD7 `deal` mở khoá HĐ đã xác nhận (lock-strict); K2 cần HĐ ĐÃ khoá (CONTRACT_NOT_LOCKED nếu không) ⇒ khoá lại như lúc xác nhận. */
async function lockedDeal(sql: CtxN1["sql"], o: Parameters<typeof deal>[1]): Promise<string> {
  const id = await deal(sql, o);
  await sql`update contracts.contracts set locked_at = now() where id = ${id}`;
  return id;
}

let c: CtxN1;
type Person = (typeof P)[keyof typeof P];

beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) {
    await c.sql`delete from contracts.visibility_settings where tenant_id = ${T.acme}`;
    await c.sql`delete from contracts.approval_settings where tenant_id = ${T.acme}`;
  }
  await c?.stop();
});

async function uploadVersion(p: Person, id: string): Promise<{ status: number; json: Json }> {
  const fd = new FormData();
  fd.set(
    "file",
    new File([pdf() as unknown as BlobPart], "ban-cap-nhat.pdf", { type: "application/pdf" }),
  );
  const res = await fetch(`${c.hub.base}${CBASE}/${id}/versions`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const code = (r: { json: Json }) => r.json?.error?.code ?? null;

/** Giả "AI đọc xong": v2 sang Chờ duyệt với ngày bắt đầu trên văn bản v2. */
async function extracted(id: string, start: string): Promise<void> {
  await c.sql`update contracts.contracts set status = 'needs_review', version = version + 1,
    fields = jsonb_build_object('start_date', jsonb_build_object('value', ${start}::text, 'quote', ''),
      'number', jsonb_build_object('value', 'HĐ-V2', 'quote', ''),
      'total_value', jsonb_build_object('value', 120000000, 'quote', ''))
    where id = ${id}`;
}

async function ob(contract: string, seq: number, due: string, status = "open"): Promise<string> {
  const [r] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, direction, kind, seq, due_date, amount, status, done_at, source)
    values (${T.acme}, ${contract}, 'pay', 'payment', ${seq}, ${due}, 1000, ${status},
      ${status === "done" ? due : null}, 'manual') returning id::text`;
  return r?.id as string;
}

/** Dòng kho xuất gắn nghĩa vụ `milestone` (SP/thành phần riêng của ca). */
async function stockMove(contract: string, milestone: string): Promise<void> {
  const [p] = await c.sql<{ id: string }[]>`insert into contracts.products (tenant_id, name, grp)
    values (${T.acme}, ${`SP K2 ${milestone}`}, 'goods') returning id::text`;
  const [pc] = await c.sql<{ id: string }[]>`insert into contracts.product_components
      (tenant_id, product_id, name, mode) values (${T.acme}, ${p?.id}, 'TP', 'order') returning id::text`;
  await c.sql`insert into contracts.stock_moves (id, tenant_id, component_id, direction, qty, unit_cost, amount,
      moved_on, contract_id, milestone_id)
    values (gen_random_uuid(), ${T.acme}, ${pc?.id}, 'out', 1, 0, 0, current_date, ${contract}, ${milestone})`;
}

async function approvalOff(): Promise<void> {
  await c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, false)
    on conflict (tenant_id) do update set approval_enabled = false`;
}

describe("HD-FR-101…103 · đường chính: tải v2 → xác nhận → v1 bị thay + cutover + danh sách", () => {
  it("v2 nháp kế thừa phụ trách; xác nhận ⇒ v1 superseded, nghĩa vụ cutover, list chỉ v2 (versions_count 2)", async () => {
    await arrangeHd7(c);
    await approvalOff();
    const v1 = await lockedDeal(c.sql, { start: d(-90), end: d(300), number: "HĐ-V1" });
    const [v1Before] = await c.sql<
      { fields: Json }[]
    >`select fields from contracts.contracts where id = ${v1}`;
    const oPast = await ob(v1, 1, d(-10));
    const oDone = await ob(v1, 2, d(30), "done");
    const oFuture = await ob(v1, 3, d(30));
    const oStock = await ob(v1, 4, d(60));
    await stockMove(v1, oStock);

    const up = await uploadVersion(P.lan, v1);
    expect({
      status: up.status,
      s: up.json?.status,
      no: up.json?.version_no,
      root: up.json?.root_id,
    }).toEqual({
      status: 201,
      s: "extracting",
      no: 2,
      root: v1,
    });
    const v2 = up.json.id as string;
    const [row] = await c.sql<
      { root: string; sup: string; owner: string; no: number }[]
    >`select root_id::text as root,
      supersedes_id::text as sup, owner_user_id::text as owner, version_no as no from contracts.contracts where id = ${v2}`;
    expect(row).toEqual({ root: v1, sup: v1, owner: P.lan.id, no: 2 });
    // Một nháp mở mỗi chuỗi.
    const again = await uploadVersion(P.lan, v1);
    expect({ status: again.status, code: code(again) }).toEqual({
      status: 409,
      code: "VERSION_DRAFT_EXISTS",
    });
    // Nháp trong chuỗi xoá được? — không xoá ở đây; bản hiện hành (đã xác nhận) trong chuỗi ⇒ 409.
    const delV1 = await c.hubCall(P.lan, "DELETE", `${CBASE}/${v1}`, {});
    expect({ status: delV1.status, code: code(delV1) }).toEqual({
      status: 409,
      code: "CONTRACT_HAS_VERSIONS",
    });

    await extracted(v2, d(0));
    const dv2 = (await c.hubCall(P.lan, "GET", `${CBASE}/${v2}`)).json;
    const conf = await c.hubCall(P.lan, "POST", `${CBASE}/${v2}/review`, { version: dv2.version });
    expect({ status: conf.status, s: conf.json?.status }).toEqual({ status: 200, s: "active" });

    const [s1] = await c.sql<{ by: string; at: boolean; fields: Json; status: string }[]>`select
      superseded_by::text as by, superseded_at is not null as at, fields, status from contracts.contracts where id = ${v1}`;
    expect({
      by: s1?.by,
      at: s1?.at,
      sameFields: JSON.stringify(s1?.fields) === JSON.stringify(v1Before?.fields),
    }).toEqual({
      by: v2,
      at: true,
      sameFields: true,
    });
    const obs = await c.sql<
      { id: string; status: string; reason: string | null }[]
    >`select id::text, status,
      cancel_reason as reason from contracts.obligations where contract_id = ${v1}`;
    const by = Object.fromEntries(obs.map((o) => [o.id, { s: o.status, r: o.reason }]));
    expect(by).toEqual({
      [oPast]: { s: "open", r: null },
      [oDone]: { s: "done", r: null },
      [oFuture]: { s: "cancelled", r: "thay bằng phiên bản 2" },
      [oStock]: { s: "open", r: null },
    });
    const [ev] = await c.sql<{ data: Json }[]>`select data from contracts.contract_events
      where contract_id = ${v2} and type = 'version_cutover'`;
    expect({
      cancelled: ev?.data?.cancelled,
      kept: ev?.data?.kept_stock,
      sup: ev?.data?.superseded,
    }).toEqual({
      cancelled: [oFuture],
      kept: [oStock],
      sup: [v1],
    });

    const list = (await c.hubCall(P.lan, "GET", `${CBASE}?page_size=100`)).json;
    const ids = list.items.map((x: { id: string }) => x.id);
    const mine = list.items.find((x: { id: string }) => x.id === v2);
    expect({
      hasV1: ids.includes(v1),
      hasV2: ids.includes(v2),
      no: mine?.version_no,
      n: mine?.versions_count,
    }).toEqual({
      hasV1: false,
      hasV2: true,
      no: 2,
      n: 2,
    });

    const d1 = (await c.hubCall(P.lan, "GET", `${CBASE}/${v1}`)).json;
    expect({
      current: d1.current_id,
      by: d1.superseded_by,
      at: typeof d1.superseded_at,
      versions: d1.versions.map((x: { id: string; version_no: number }) => [x.id, x.version_no]),
    }).toEqual({
      current: v2,
      by: v2,
      at: "string",
      versions: [
        [v1, 1],
        [v2, 2],
      ],
    });

    // Bản đã bị thay chỉ đọc.
    const own = await c.hubCall(P.lan, "PUT", `${CBASE}/${v1}/owner`, { owner_user_id: P.hoa.id });
    expect({ status: own.status, code: code(own) }).toEqual({
      status: 409,
      code: "CONTRACT_SUPERSEDED",
    });
    const reup = await uploadVersion(P.lan, v1);
    expect({ status: reup.status, code: code(reup) }).toEqual({
      status: 409,
      code: "CONTRACT_SUPERSEDED",
    });
    const delV2 = await c.hubCall(P.lan, "DELETE", `${CBASE}/${v2}`, {});
    expect({ status: delV2.status, code: code(delV2) }).toEqual({
      status: 409,
      code: "CONTRACT_HAS_VERSIONS",
    });

    // So sánh trường pháp lý v1 ↔ v2.
    const diff = await c.hubCall(P.lan, "GET", `${CBASE}/${v2}/versions/diff?a=${v1}&b=${v2}`);
    const keys = (diff.json?.changes ?? []).map((x: { key: string }) => x.key);
    expect({
      status: diff.status,
      number: keys.includes("number"),
      value: keys.includes("total_value"),
    }).toEqual({
      status: 200,
      number: true,
      value: true,
    });
  }, 90_000);

  it("bản nháp mới nhất trong chuỗi xoá được (bỏ bản cập nhật) ⇒ v1 vẫn hiện hành, tải lại được", async () => {
    await arrangeHd7(c);
    const v1 = await lockedDeal(c.sql, { number: "HĐ-DEL" });
    const up = await uploadVersion(P.lan, v1);
    expect(up.status).toBe(201);
    const del = await c.hubCall(P.lan, "DELETE", `${CBASE}/${up.json.id}`, {});
    expect(del.status).toBe(200);
    expect((await uploadVersion(P.lan, v1)).status).toBe(201);
  }, 60_000);
});

describe("cách ly · RLS chuỗi phiên bản", () => {
  it("chéo tenant: owner beta tải bản cập nhật cho HĐ acme ⇒ 404, không tạo hàng", async () => {
    await arrangeHd7(c);
    const v1 = await lockedDeal(c.sql, { number: "HĐ-X" });
    const r = await uploadVersion(P.an, v1);
    expect(r.status).toBe(404);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contracts where root_id = ${v1}`;
    expect(n?.n).toBe(1);
  }, 60_000);

  it("chế độ org: hoa không thấy v1 (của lan) ⇒ không tạo được v2 (404) và không thấy v2 lan tải", async () => {
    await arrangeHd7(c);
    const v1 = await lockedDeal(c.sql, { number: "HĐ-RLS" });
    await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
      on conflict (tenant_id) do update set mode = 'org'`;
    try {
      expect((await c.hubCall(P.hoa, "GET", `${CBASE}/${v1}`)).status).toBe(404);
      expect((await uploadVersion(P.hoa, v1)).status).toBe(404);
      const up = await uploadVersion(P.lan, v1);
      expect(up.status).toBe(201);
      expect((await c.hubCall(P.hoa, "GET", `${CBASE}/${up.json.id}`)).status).toBe(404);
      const list = (await c.hubCall(P.hoa, "GET", `${CBASE}?page_size=100`)).json;
      expect(list.items.map((x: { id: string }) => x.id)).not.toContain(up.json.id);
    } finally {
      await c.sql`delete from contracts.visibility_settings where tenant_id = ${T.acme}`;
    }
  }, 60_000);
});
