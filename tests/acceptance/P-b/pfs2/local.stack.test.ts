// P-b · PF-S2 · PB-R03 · PB-R07 · AC-H36 (e) · AC-PB-01 · LP-01…LP-05 (test-plan §4.2, C7): local_path chỉ platform_admin tạo;
// Runtime kiểm HUB_SOURCE_LOCAL_ROOTS + realpath lúc resolve ⇒ ngoài gốc = 422 SOURCE_UNRESOLVABLE (không SOURCE_FORBIDDEN_KIND).
// Phần "start ⇒ run needs_decision source_unresolvable" của LP-04 cần launcher S3 ⇒ scenario SC-PB2.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bootPb,
  checkSource,
  createSource,
  errCode,
  expectTreeOk,
  localSrcBody,
  must,
  OUTSIDE,
  type PbStack,
  parseReads,
  ROOT,
  resetPb,
  runStage,
  T,
  treeOf,
} from "../_support/pb-stack";

let st: PbStack;
beforeAll(async () => {
  st = await bootPb("lp");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const DOCS = `${ROOT}/pb-docs`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function localPin(key = "pb-docs"): Promise<Record<string, unknown>> {
  await createSource(st, "P", localSrcBody(key, DOCS));
  const r = await checkSource(st, "P", key, T.acme);
  expect(r.status).toBe(200);
  return r.json.pin;
}

describe("LP-01…LP-05 · local_path [PB-R03 · AC-H36(e) · AC-PB-01]", () => {
  it("PB-R03 · LP-01 · padmin tạo <ROOT>/pb-docs, check ⇒ 200 files=3, pin {kind:local_path, path, snapshot_id:uuid}", async () => {
    await createSource(st, "P", localSrcBody("pb-docs", DOCS));
    const r = await checkSource(st, "P", "pb-docs", T.acme);
    expect(r.status).toBe(200);
    expect(r.json.files).toBe(3);
    expect(r.json.pin).toMatchObject({ kind: "local_path", path: DOCS });
    expect(r.json.pin.snapshot_id).toMatch(UUID);
  });

  it("PB-R07 · AC-PB-01 · LP-02 · escape (symlink ra ngoài) bị bỏ; nội dung secret.txt không đọc được; .env, id_rsa vắng", async () => {
    const pin = await localPin();
    const src = { key: "pb-docs", pin, allowlist: [] as string[] };
    const t = await treeOf(st, src);
    expectTreeOk(t.out);
    expect(t.files).toEqual(["a.md", "sub/b.md", "sub/c.txt"]);
    const out = await runStage(st, {
      prompt:
        "#fake:read=sources/pb-docs/escape/secret.txt,sources/pb-docs/.env,sources/pb-docs/id_rsa",
      sources: [src],
    });
    expect(parseReads(out.text)).toEqual({
      "sources/pb-docs/escape/secret.txt": "ENOENT",
      "sources/pb-docs/.env": "ENOENT",
      "sources/pb-docs/id_rsa": "ENOENT",
    });
  });

  it.each([
    [`${ROOT}/../pb-outside`],
    [`${ROOT}/pb-docs/../../pb-outside`],
    ["/pb-roots-evil/x.md"],
    [`${ROOT}/lnk`],
  ])(
    "AC-H36(e) · C7 · LP-03 · path ngoài gốc %p: POST 201 (Hub chỉ validate cú pháp), check 422 SOURCE_UNRESOLVABLE (không SOURCE_FORBIDDEN_KIND)",
    async (path) => {
      await createSource(st, "P", localSrcBody("pb-out", path));
      const r = await checkSource(st, "P", "pb-out", T.acme);
      expect(errCode(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
      expect(r.json.pin).toBeUndefined();
    },
  );

  it("AC-H36(e) · PB-R03 · LP-04 · khai báo hợp lệ rồi thay thư mục bằng symlink sang pb-outside ⇒ check 422 SOURCE_UNRESOLVABLE", async () => {
    must(
      st.sh(`rm -rf ${ROOT}/pb-swap; mkdir -p ${ROOT}/pb-swap; printf x > ${ROOT}/pb-swap/a.md`),
      "dựng pb-swap",
    );
    try {
      await createSource(st, "P", localSrcBody("pb-swap", `${ROOT}/pb-swap`));
      must(st.sh(`rm -rf ${ROOT}/pb-swap; ln -s ${OUTSIDE} ${ROOT}/pb-swap`), "thay bằng symlink");
      const r = await checkSource(st, "P", "pb-swap", T.acme);
      expect(errCode(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    } finally {
      must(st.sh(`rm -rf ${ROOT}/pb-swap`), "dọn pb-swap");
    }
  });

  it("PB-R07 · AC-PB-01 · LP-05 · shared-hard.txt (hardlink, nlink>1) vắng trong snapshot", async () => {
    const pin = await localPin();
    const src = { key: "pb-docs", pin, allowlist: [] as string[] };
    const t = await treeOf(st, src);
    expectTreeOk(t.out);
    expect(t.files).not.toContain("shared-hard.txt");
    const out = await runStage(st, {
      prompt: "#fake:read=sources/pb-docs/shared-hard.txt",
      sources: [src],
    });
    expect(parseReads(out.text)["sources/pb-docs/shared-hard.txt"]).toBe("ENOENT");
  });
});
