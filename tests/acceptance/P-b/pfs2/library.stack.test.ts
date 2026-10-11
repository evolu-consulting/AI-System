// P-b · PF-S2 · PB-R04 · HUB-FR-120 · LB-01, LB-03 (test-plan §4.2). LB-02 (bản v2 của cùng tài liệu) và LB-04 (job-token
// source.resolve tải kho H2c — hệ quả của LB-01) xem "Cần bổ sung" test-plan §8: chưa có mô hình "bản tài liệu" trong spec.
// Tài liệu library dựng bằng: người dùng tải lên thật (byte nằm trong kho Hub) rồi SQL đổi origin sang 'library' (0021).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { uploadOk } from "../../H2c/_h2c";
import {
  bootPb,
  checkSource,
  createSource,
  errCode,
  expectTreeOk,
  PA,
  type PbStack,
  parseReads,
  resetPb,
  runStage,
  sha256,
  sqlSource,
  treeOf,
} from "../_support/pb-stack";

let st: PbStack;
beforeAll(async () => {
  st = await bootPb("lb");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const V1 = "Quy định v1\n";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("LB-01, LB-03 · library [PB-R04]", () => {
  it("PB-R04 · LB-01 · nguồn library quy-dinh.md: check ⇒ pin {kind:library, document_id, version}; stage thấy 1 file có nội dung 'Quy định v1'", async () => {
    const bytes = new TextEncoder().encode(V1);
    const id = await uploadOk(st.hub, await st.tok("A"), bytes, "quy-dinh.md");
    await st.sql`update hub.attachments set origin = 'library' where id = ${id}`;
    await createSource(st, "Adm", {
      key: "lib-qd",
      kind: "library",
      config: { kind: "library", document_id: id },
      description: "Quy định",
    });
    const r = await checkSource(st, "Adm", "lib-qd");
    expect(r.status).toBe(200);
    expect(r.json.pin).toMatchObject({ kind: "library", document_id: id });
    expect(r.json.pin.version).toMatch(UUID);
    expect(r.json.files).toBe(1);
    const src = { key: "lib-qd", pin: r.json.pin, allowlist: [] as string[] };
    const t = await treeOf(st, src);
    expectTreeOk(t.out);
    expect(t.files).toEqual(["quy-dinh.md"]);
    const out = await runStage(st, {
      prompt: "#fake:read=sources/lib-qd/quy-dinh.md",
      sources: [src],
    });
    expect(parseReads(out.text)["sources/lib-qd/quy-dinh.md"]).toBe(sha256(V1));
  });

  it("PB-R04 · AC-PB-04 · LB-03 · nguồn acme trỏ beta-secret.md của beta (SQL) ⇒ check 422 SOURCE_UNRESOLVABLE, không lộ nội dung", async () => {
    const betaDoc = crypto.randomUUID();
    await st.sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename, safe_name, mime, size,
        sha256, storage_key) values (${betaDoc}, ${PA.D.tid}, ${PA.D.id}, 'library', null, 'beta-secret.md',
        'beta-secret.md', 'text/markdown', 64, ${"a".repeat(64)}, ${`${PA.D.tid}/${betaDoc}`})`;
    await sqlSource(st, {
      key: "lib-cross",
      kind: "library",
      config: { kind: "library", document_id: betaDoc },
    });
    const r = await checkSource(st, "Adm", "lib-cross");
    expect(errCode(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(r.text).not.toContain("beta-secret");
  });
});
