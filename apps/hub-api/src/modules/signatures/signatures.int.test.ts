// CR-181 · lát s1 · int (DB thật, role `hub_api`): chữ ký nội bộ ở hub 0155 + `signaturesRepo`.
// BR-K1 một bản đang dùng / loại, bản cũ còn trong lịch sử · BR-K2 người B (cùng công ty) và công ty khác KHÔNG đọc/ghi chữ ký của A ·
// BR-K3 `signature_for_stamp` chỉ trả đúng người trong ngữ cảnh · Q10 cho phép đổi dùng MỘT lần · Q5 thiết lập mặc định khi chưa có hàng ·
// audit CHECK nhận action mới. N2: người cho phép (quản trị) ≠ người xin.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SIGNATURE_PNG_MAX_BYTES, SIGNATURE_SETTINGS_DEFAULT } from "@ai/contracts/signature";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, type HubScopeArg, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { type SignaturesRepo, signaturesRepo } from "./public";

const T = { a: tenantId(1810), b: tenantId(1811) };
const U = { a1: userId(1810), a2: userId(1811), adm: userId(1812), b1: userId(1813) };
const png = (n: number, fill = 7) => Buffer.alloc(n, fill);
let o: Sql;
let db: Db;
const scope = (k: keyof typeof U, t: string): HubScopeArg => ({
  kind: "user",
  tenantId: t,
  userId: U[k],
});
const as = <R>(k: keyof typeof U, t: string, fn: (r: SignaturesRepo) => Promise<R>): Promise<R> =>
  withHubScope(db, scope(k, t), (tx) => fn(signaturesRepo(tx)));
const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    return x.code ?? x.cause?.code ?? "err";
  }
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 'p1810', 'P1810'), (${T.b}, 'p1811', 'P1811') on conflict do nothing`;
  await users(o, T.a, 3, { from: 1810 });
  await users(o, T.b, 1, { from: 1813 });
  db = createDb(urls().hubApi, { max: 4 });
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-181 s1 · BR-K1 một bản đang dùng, bản cũ còn lịch sử", () => {
  it("tạo lần đầu: không thay ai; đổi: retire bản cũ + bản mới; bytes giữ nguyên", async () => {
    const first = await as("a1", T.a, (r) => r.create("main", "draw", png(100, 1)));
    expect(first.replacedId).toBeNull();
    const second = await as("a1", T.a, (r) => r.create("main", "upload", png(120, 2)));
    expect(second.replacedId).toBe(first.id);
    const act = await as("a1", T.a, (r) => r.getActive("main"));
    expect(act?.id).toBe(second.id);
    expect(act?.method).toBe("upload");
    expect(act?.png.equals(png(120, 2))).toBe(true);
    const hist = await as("a1", T.a, (r) => r.listHistory("main"));
    expect(hist.map((h) => h.id)).toEqual([second.id, first.id]);
    expect(hist[0]?.retiredAt).toBeNull();
    expect(hist[1]?.retiredAt).not.toBeNull();
    const [n] =
      await o`select count(*)::int as n from hub.user_signatures where tenant_id = ${T.a} and user_id = ${U.a1} and kind = 'main' and retired_at is null`;
    expect(n?.n).toBe(1);
  });
  it("loại `initials` độc lập với `main`; getActiveAll gom cả hai", async () => {
    await as("a1", T.a, (r) => r.create("initials", "type", png(50, 3)));
    const all = await as("a1", T.a, (r) => r.getActiveAll());
    expect(all.main?.kind).toBe("main");
    expect(all.initials?.kind).toBe("initials");
    expect((await as("a1", T.a, (r) => r.listHistory(null))).length).toBe(3);
  });
  it("hai lần tạo đồng thời cùng người: cả hai thành công, vẫn đúng một bản đang dùng", async () => {
    const [x, y] = await Promise.all([
      as("a2", T.a, (r) => r.create("main", "draw", png(10, 4))),
      as("a2", T.a, (r) => r.create("main", "draw", png(10, 5))),
    ]);
    expect(x.id).not.toBe(y.id);
    const [n] =
      await o`select count(*)::int as n from hub.user_signatures where tenant_id = ${T.a} and user_id = ${U.a2} and kind = 'main' and retired_at is null`;
    expect(n?.n).toBe(1);
  });
  it("đầu vào sai: ảnh quá trần / rỗng / kind-method lạ ⇒ 22023, không ghi gì", async () => {
    const before = await as("a2", T.a, (r) => r.listHistory(null, 100));
    expect(
      await code(() =>
        as("a2", T.a, (r) => r.create("main", "draw", png(SIGNATURE_PNG_MAX_BYTES + 1))),
      ),
    ).toBe("22023");
    expect(await code(() => as("a2", T.a, (r) => r.create("main", "draw", png(0))))).toBe("22023");
    expect(await code(() => as("a2", T.a, (r) => r.create("x" as never, "draw", png(5))))).toBe(
      "22023",
    );
    expect(await code(() => as("a2", T.a, (r) => r.create("main", "x" as never, png(5))))).toBe(
      "22023",
    );
    expect((await as("a2", T.a, (r) => r.listHistory(null, 100))).length).toBe(before.length);
    // đúng trần thì được
    expect(
      (await as("a2", T.a, (r) => r.create("initials", "draw", png(SIGNATURE_PNG_MAX_BYTES)))).id,
    ).toBeTruthy();
  });
});

describe("CR-181 s1 · BR-K2 chỉ chữ ký của chính mình (N2: người khác cùng công ty, công ty khác)", () => {
  it("người B cùng công ty không thấy chữ ký/lịch sử của A; công ty khác cũng không", async () => {
    // a2 (người khác a1, cùng tenant) — a1 có main + initials
    const a2 = await as("a2", T.a, (r) => r.getActive("main"));
    expect(a2?.png.equals(png(10, 5)) || a2?.png.equals(png(10, 4))).toBe(true);
    expect(a2?.png.equals(png(120, 2))).toBe(false);
    expect(await as("adm", T.a, (r) => r.getActive("main"))).toBeNull();
    expect((await as("adm", T.a, (r) => r.listHistory(null))).length).toBe(0);
    expect(await as("b1", T.b, (r) => r.getActive("main"))).toBeNull();
    // cùng userId của A nhưng đứng trong tenant khác ⇒ không thấy (khoá theo tenant)
    expect(
      await withHubScope(db, { kind: "user", tenantId: T.b, userId: U.a1 }, (tx) =>
        signaturesRepo(tx).getActive("main"),
      ),
    ).toBeNull();
  });
  it("B ghi: chữ ký mới chỉ vào hàng của B, không đụng bản của A", async () => {
    const mine = await as("adm", T.a, (r) => r.create("main", "type", png(30, 9)));
    const a1 = await as("a1", T.a, (r) => r.getActive("main"));
    expect(a1?.png.equals(png(120, 2))).toBe(true);
    const [row] = await o`select user_id from hub.user_signatures where id = ${mine.id}`;
    expect(row?.user_id).toBe(U.adm);
  });
  it("signature_for_stamp: đúng người trong ngữ cảnh ⇒ ảnh; người khác/tenant khác ⇒ 42501", async () => {
    const own = await as("a1", T.a, (r) => r.signatureForStamp(T.a, U.a1, "main"));
    expect(own?.png.equals(png(120, 2))).toBe(true);
    expect(await as("a1", T.a, (r) => r.signatureForStamp(T.a, U.a1, "initials"))).not.toBeNull();
    expect(await code(() => as("adm", T.a, (r) => r.signatureForStamp(T.a, U.a1, "main")))).toBe(
      "42501",
    );
    expect(await code(() => as("b1", T.b, (r) => r.signatureForStamp(T.a, U.a1, "main")))).toBe(
      "42501",
    );
    expect(await code(() => as("a1", T.a, (r) => r.signatureForStamp(T.b, U.a1, "main")))).toBe(
      "42501",
    );
    expect(await as("b1", T.b, (r) => r.signatureForStamp(T.b, U.b1, "main"))).toBeNull();
  });
  it("bảng không đọc/ghi trực tiếp ở scope người dùng (RLS); thiếu ngữ cảnh ⇒ 42501", async () => {
    const sel = await code(() =>
      inHub(
        { kind: "user", tenantId: T.a, userId: U.a1 },
        (tx) => tx`select id from hub.user_signatures`,
      ),
    );
    expect(sel).toBe("42501");
    const ins = await code(() =>
      inHub(
        { kind: "user", tenantId: T.a, userId: U.a1 },
        (tx) =>
          tx`insert into hub.user_signatures (tenant_id, user_id, kind, method, png) values (${T.a}, ${U.a1}, 'initials', 'draw', ${Buffer.from([1])})`,
      ),
    );
    expect(ins).toBe("42501");
    expect(
      await code(() => inHub("none", (tx) => tx`select * from hub.sig_get_active('main')`)),
    ).toBe("42501");
    expect(
      await code(() =>
        inHub({ kind: "system" }, (tx) => tx`select * from hub.sig_get_active('main')`),
      ),
    ).toBe("42501");
  });
});

describe("CR-181 s1 · Q10 xin đổi / cho phép đổi dùng một lần (quản trị ≠ người xin)", () => {
  it("xin → chờ → quản trị cho phép → dùng đúng một lần → xin lần mới được", async () => {
    expect(await as("a1", T.a, (r) => r.getChangeState())).toBeNull();
    const req = await as("a1", T.a, (r) => r.requestChange());
    expect(req.fresh).toBe(true);
    expect(req.grantedAt).toBeNull();
    expect((await as("a1", T.a, (r) => r.requestChange())).fresh).toBe(false);
    // chưa được cho phép ⇒ không dùng được
    expect(await as("a1", T.a, (r) => r.consumeGrant())).toBe(false);
    // quản trị (người khác) cho phép
    const g = await as("adm", T.a, (r) => r.grantChangeAsAdmin(U.a1));
    expect(g.id).toBe(req.id);
    expect(g.grantedAt).not.toBeNull();
    expect(g.fresh).toBe(true);
    expect((await as("adm", T.a, (r) => r.grantChangeAsAdmin(U.a1))).fresh).toBe(false);
    const st = await as("a1", T.a, (r) => r.getChangeState());
    expect(st?.grantedBy).toBe(U.adm);
    // người khác không dùng được quyền của a1
    expect(await as("a2", T.a, (r) => r.consumeGrant())).toBe(false);
    // hai lần dùng đồng thời: chỉ một true
    const both = await Promise.all([
      as("a1", T.a, (r) => r.consumeGrant()),
      as("a1", T.a, (r) => r.consumeGrant()),
    ]);
    expect(both.filter(Boolean).length).toBe(1);
    expect(await as("a1", T.a, (r) => r.consumeGrant())).toBe(false);
    expect(await as("a1", T.a, (r) => r.getChangeState())).toBeNull();
    expect((await as("a1", T.a, (r) => r.requestChange())).fresh).toBe(true);
  });
  it("quản trị cho phép khi chưa ai xin ⇒ tạo hàng đã cho phép; người ngoài công ty ⇒ P0002", async () => {
    const g = await as("adm", T.a, (r) => r.grantChangeAsAdmin(U.a2));
    expect(g.grantedAt).not.toBeNull();
    expect(await as("a2", T.a, (r) => r.consumeGrant())).toBe(true);
    expect(await code(() => as("adm", T.a, (r) => r.grantChangeAsAdmin(U.b1)))).toBe("P0002");
  });
  it("quyền đổi của công ty khác không lẫn: b1 không dùng được grant của a1", async () => {
    await as("adm", T.a, (r) => r.grantChangeAsAdmin(U.a1));
    expect(await as("b1", T.b, (r) => r.consumeGrant())).toBe(false);
    expect(await as("b1", T.b, (r) => r.getChangeState())).toBeNull();
  });
});

describe("CR-181 s1 · quyền quản trị: hàm ghi của quản trị đòi cờ app.sig_admin (Q10, Q15)", () => {
  const settingsArgs = `array['draw'], true, array['name'], 'blue', 'shrink', 'self', true, false, null`;
  it("người dùng thường gọi thẳng sig_settings_put / sig_change_grant (không cờ) ⇒ 42501, không ghi gì", async () => {
    const u = { kind: "user", tenantId: T.a, userId: U.a2 } as const;
    expect(
      await code(() =>
        inHub(u, (tx) => tx.unsafe(`select * from hub.sig_settings_put(${settingsArgs})`)),
      ),
    ).toBe("42501");
    expect(
      await code(() => inHub(u, (tx) => tx`select * from hub.sig_change_grant(${U.adm}::uuid)`)),
    ).toBe("42501");
    // tự cấp cho mình khi KHÔNG có cờ cũng bị chặn
    expect(
      await code(() => inHub(u, (tx) => tx`select * from hub.sig_change_grant(${U.a2}::uuid)`)),
    ).toBe("42501");
    const [n] =
      await o`select count(*)::int as n from hub.signature_settings where tenant_id = ${T.a} and updated_by = ${U.a2}`;
    expect(n?.n).toBe(0);
  });
  it("cờ chỉ có hiệu lực trong tx đặt cờ: tx sau không còn cờ", async () => {
    await as("adm", T.a, (r) => r.grantChangeAsAdmin(U.a1));
    expect(
      await code(() =>
        inHub(
          { kind: "user", tenantId: T.a, userId: U.adm },
          (tx) => tx`select * from hub.sig_change_grant(${U.a1}::uuid)`,
        ),
      ),
    ).toBe("42501");
  });
  it("quản trị không tự cấp quyền đổi cho chính mình ⇒ 42501 (kể cả có cờ)", async () => {
    expect(await code(() => as("adm", T.a, (r) => r.grantChangeAsAdmin(U.adm)))).toBe("42501");
    expect(await as("adm", T.a, (r) => r.getChangeState())).toBeNull();
  });
});

describe("CR-181 s1 · Q5 thiết lập công ty", () => {
  it("chưa có hàng ⇒ mặc định (tắt, 3 cách, bắt buộc, tên + ngày, xanh, thu nhỏ, tự đổi)", async () => {
    const s = await as("a1", T.a, (r) => r.getSettings());
    expect(s.stored).toBe(false);
    expect(s.settings).toEqual(SIGNATURE_SETTINGS_DEFAULT);
    expect(s.settings.on_doc_enabled).toBe(false);
  });
  it("ghi rồi đọc lại (mọi thành viên đọc được); tenant khác vẫn mặc định", async () => {
    const next = {
      ...SIGNATURE_SETTINGS_DEFAULT,
      methods: ["draw", "type"] as ("draw" | "type")[],
      ink: "black" as const,
      on_doc_enabled: true,
      caption: ["name", "title", "date", "time"] as ("name" | "title" | "date" | "time")[],
      initials: "own" as const,
      change_policy: "admin" as const,
    };
    const w = await as("adm", T.a, (r) => r.putSettingsAsAdmin(next));
    expect(w.stored).toBe(true);
    expect(w.updatedBy).toBe(U.adm);
    const rd = await as("a2", T.a, (r) => r.getSettings());
    expect(rd.settings).toEqual(next);
    const other = await as("b1", T.b, (r) => r.getSettings());
    expect(other.stored).toBe(false);
    // ghi lần hai = cập nhật cùng một hàng
    await as("adm", T.a, (r) => r.putSettingsAsAdmin({ ...next, ink: "blue" }));
    const [n] =
      await o`select count(*)::int as n from hub.signature_settings where tenant_id = ${T.a}`;
    expect(n?.n).toBe(1);
  });
  it("giá trị sai bị CHECK chặn (23514): 0 cách tạo, mực lạ", async () => {
    const base = { ...SIGNATURE_SETTINGS_DEFAULT };
    expect(
      await code(() => as("adm", T.a, (r) => r.putSettingsAsAdmin({ ...base, methods: [] }))),
    ).toBe("23514");
    expect(
      await code(() =>
        as("adm", T.a, (r) => r.putSettingsAsAdmin({ ...base, ink: "red" as never })),
      ),
    ).toBe("23514");
  });
});

describe("CR-181 s1 · audit CHECK nhận action mới", () => {
  it("5 action chữ ký + entity `signature` ghi được; action lạ vẫn bị chặn", async () => {
    for (const action of [
      "signature_created",
      "signature_settings_changed",
      "signature_change_requested",
      "signature_change_granted",
      "document_signed",
    ]) {
      await o`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name) values (${T.a}, ${U.a1}, 'member', ${action}, 'signature', ${U.a1}, 'x')`;
    }
    // action cũ vẫn dùng được (không làm rơi giá trị trước đó)
    await o`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name) values (${T.a}, ${U.a1}, 'member', 'set_routing', 'run', ${U.a1}, 'x')`;
    expect(
      await code(
        () =>
          o`insert into hub.audit_log (tenant_id, action, entity, entity_name) values (${T.a}, 'signature_deleted', 'signature', 'x')`,
      ),
    ).toBe("23514");
  });
});

describe("CR-188 · BR-188-1 dòng dưới chữ ký lưu theo phiên bản (hub 0161)", () => {
  const CAP = "Nguyễn Thị Ánh Ngọc · Giám đốc · Kinh doanh";
  it("lưu rồi đọc lại ở getActive / getActiveAll / signature_for_stamp; bản cũ giữ caption riêng; rỗng ⇒ null", async () => {
    const first = await as("a1", T.a, (r) => r.create("main", "type", png(40, 6), `  ${CAP}  `));
    const act = await as("a1", T.a, (r) => r.getActive("main"));
    expect(act?.caption).toBe(CAP); // đã cắt khoảng trắng
    expect((await as("a1", T.a, (r) => r.getActiveAll())).main?.caption).toBe(CAP);
    expect((await as("a1", T.a, (r) => r.signatureForStamp(T.a, U.a1, "main")))?.caption).toBe(CAP);
    const second = await as("a1", T.a, (r) => r.create("main", "type", png(41, 6), "   "));
    expect(second.replacedId).toBe(first.id);
    expect((await as("a1", T.a, (r) => r.getActive("main")))?.caption).toBeNull();
    const [old] = await o`select caption from hub.user_signatures where id = ${first.id}`;
    expect(old?.caption).toBe(CAP); // bản cũ không bị ghi đè
    // gọi kiểu cũ (không truyền caption) vẫn chạy
    expect((await as("a1", T.a, (r) => r.create("main", "type", png(42, 6)))).id).toBeTruthy();
  });
  it("quá 200 ký tự ⇒ 22023, không ghi gì; đúng 200 thì được", async () => {
    const before = await as("a2", T.a, (r) => r.listHistory(null, 100));
    expect(
      await code(() => as("a2", T.a, (r) => r.create("main", "type", png(9, 2), "a".repeat(201)))),
    ).toBe("22023");
    expect((await as("a2", T.a, (r) => r.listHistory(null, 100))).length).toBe(before.length);
    const ok = await as("a2", T.a, (r) => r.create("main", "type", png(9, 2), "a".repeat(200)));
    expect(ok.id).toBeTruthy();
  });
  it("người KHÁC (cùng công ty, công ty khác) không đọc được caption của a1; bảng không đọc trực tiếp", async () => {
    await as("a1", T.a, (r) => r.create("main", "type", png(43, 6), CAP));
    expect((await as("adm", T.a, (r) => r.getActive("main")))?.caption ?? null).not.toBe(CAP);
    expect((await as("b1", T.b, (r) => r.getActive("main")))?.caption ?? null).not.toBe(CAP);
    expect(await code(() => as("adm", T.a, (r) => r.signatureForStamp(T.a, U.a1, "main")))).toBe(
      "42501",
    );
    expect(
      await code(() =>
        withHubScope(db, scope("adm", T.a), (tx) =>
          tx.execute(sql`select caption from hub.user_signatures`),
        ),
      ),
    ).not.toBe("ok");
  });
  it("quản trị đọc theo luật cũ: signature_png_by_ids chỉ trả id + png (KHÔNG caption)", async () => {
    const mine = await as("a1", T.a, (r) => r.getActive("main"));
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<Record<string, unknown>>(
        sql`select * from hub.signature_png_by_ids(${T.a}::uuid, array[${mine?.id}::uuid])`,
      ),
    );
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["id", "png"]);
  });
  it("profile(): họ tên của chính người gọi, chức vụ/phòng ban trống khi chưa có", async () => {
    const p = await as("a1", T.a, (r) => r.profile());
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.title).toBeNull();
    expect(p.department).toBeNull();
  });
});
