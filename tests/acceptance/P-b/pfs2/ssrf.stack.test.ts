// P-b · PF-S2 · PB-R19 · HUB-BR-30 · SS-01…SS-05 (test-plan §4.2; SS-06 = CA-06 ở cache.stack.test.ts).
// Cấu hình "độc" chèn bằng SQL (CRUD/contract từ chối): Runtime phải từ chối ở resolve. Mỗi ca đòi Runtime THỰC SỰ trả lời
// trong hạn (`checkSource` ném lỗi đỏ-do-chưa-code nếu quá 35 s), nên không xanh giả khi Runtime không làm gì.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bootPb,
  checkSource,
  errCode,
  markerExists,
  type PbStack,
  resetPb,
  sqlSource,
  urlOf,
} from "../_support/pb-stack";

let st: PbStack;
beforeAll(async () => {
  st = await bootPb("ss");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const REJECT = ["SOURCE_HOST_NOT_ALLOWED", "SOURCE_UNRESOLVABLE"];
async function poisoned(key: string, url: string, branch = "main") {
  await sqlSource(st, { key, kind: "git_remote", config: { kind: "git_remote", url, branch } });
  return checkSource(st, "Adm", key);
}
function expectRejected(r: { status: number; json: { error?: { code?: string } } | null }) {
  const c = errCode(r as never);
  expect(c.status).toBe(422);
  expect(REJECT).toContain(c.code ?? "");
}

describe("SS-01…SS-05 · chống SSRF / inject git [PB-R19 · HUB-BR-30]", () => {
  it("PB-R19 · SS-01 · url ext::sh -c touch ... ⇒ check 422; marker pwn-ext KHÔNG tồn tại", async () => {
    const r = await poisoned("ss-ext", 'ext::sh -c "touch /fixtures/markers/pwn-ext"');
    expectRejected(r);
    expect(markerExists(st, "pwn-ext")).toBe(false);
  });

  it("PB-R19 · SS-02 · url file:///fixtures/app-repo.git ⇒ từ chối (file:// cấm trong sản phẩm)", async () => {
    expectRejected(await poisoned("ss-file", "file:///fixtures/app-repo.git"));
  });

  it.each([
    ["git://github.com/pb-test/app-repo.git"],
    ["http://github.com/pb-test/app-repo.git"],
    ["https://github.com:8443/pb-test/app-repo.git"],
    ["https://evil.example.com/pb-test/app-repo.git"],
    ["https://user:pw@github.com/pb-test/app-repo.git"],
  ])("PB-R19 · SS-03 · url %s ⇒ từ chối", async (url) => {
    expectRejected(await poisoned("ss-bad", url));
  });

  it.each([["--upload-pack=touch /fixtures/markers/pwn-branch"], ["-x"]])(
    "PB-R19 · SS-04 · branch %p ⇒ từ chối, marker pwn-branch vắng",
    async (branch) => {
      expectRejected(await poisoned("ss-br", urlOf("app-repo"), branch));
      expect(markerExists(st, "pwn-branch")).toBe(false);
    },
  );

  it("PB-R19 · SS-05 · repo không tồn tại/cần xác thực ⇒ 422 SOURCE_UNRESOLVABLE trong < 30 s (GIT_TERMINAL_PROMPT=0, không treo)", async () => {
    const r = await poisoned("ss-private", urlOf("private-repo"));
    expect(errCode(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(r.ms).toBeLessThan(30_000);
  });
});
