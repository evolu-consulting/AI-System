// tool-test-select · -Filter nêu tường minh đường dẫn/việc của suite ĐÓNG BĂNG luôn chạy (không cần -All); 0 file ⇒ lỗi rõ.
import { describe, expect, test } from "bun:test";
import { isFrozenFile, selectE2eConfigs } from "./frozen.rules";
import { explicitlyNamed } from "./test-e2e-par.rules";
import { namesFrozen, resolveIntFiles } from "./test-int-par.rules";

const ALL = [
  "apps/hub-api/src/modules/runs/a.int.test.ts",
  "tests/acceptance/P-a/pa1.int.test.ts",
  "tests/acceptance/P-a/pa2.int.test.ts",
  "tests/acceptance/K1/k1.int.test.ts",
  "tests/acceptance/X2a/rooms.int.test.ts",
  "tests/acceptance/X2a/me.int.test.ts",
];

describe("resolveIntFiles", () => {
  test("không filter + noFrozen ⇒ bỏ file đóng băng (cổng hằng ngày giữ nguyên)", () => {
    const r = resolveIntFiles(ALL, [], true, isFrozenFile);
    expect(r.files).toEqual([
      "apps/hub-api/src/modules/runs/a.int.test.ts",
      "tests/acceptance/X2a/me.int.test.ts",
    ]);
    expect(r.error).toBeUndefined();
  });

  test("filter nêu thư mục đóng băng (P-a) không có -All ⇒ vẫn chạy file đó", () => {
    const r = resolveIntFiles(ALL, ["tests/acceptance/P-a"], true, isFrozenFile);
    expect(r.error).toBeUndefined();
    expect(r.files).toContain("tests/acceptance/P-a/pa1.int.test.ts");
    expect(r.files).toContain("tests/acceptance/P-a/pa2.int.test.ts");
  });

  test("filter nêu đúng file đóng băng (kể cả glob X2a/rooms) ⇒ chạy", () => {
    const r = resolveIntFiles(ALL, ["tests/acceptance/X2a/rooms.int.test.ts"], true, isFrozenFile);
    expect(r.error).toBeUndefined();
    expect(r.files).toContain("tests/acceptance/X2a/rooms.int.test.ts");
  });

  test("filter có dấu \\ và ./ vẫn khớp", () => {
    const r = resolveIntFiles(ALL, [".\\tests\\acceptance\\K1"], true, isFrozenFile);
    expect(r.error).toBeUndefined();
  });

  test("tiền tố RỘNG (tests/acceptance) không kéo file đóng băng vào", () => {
    const r = resolveIntFiles(ALL, ["tests/acceptance"], true, isFrozenFile);
    const sel = r.files.filter((f) => f.startsWith("tests/acceptance"));
    expect(sel).toEqual(["tests/acceptance/X2a/me.int.test.ts"]);
  });

  test("0 file ⇒ error 'Filter không khớp file nào: …' (không chạy im lặng)", () => {
    const r = resolveIntFiles(ALL, ["tests/acceptance/khong-co", "zzz/y"], true, isFrozenFile);
    expect(r.files).toEqual([]);
    expect(r.error).toContain("Filter không khớp file nào: tests/acceptance/khong-co, zzz/y");
  });

  test("một filter lẻ không khớp, filter kia khớp ⇒ không lỗi, báo unmatched", () => {
    const r = resolveIntFiles(ALL, ["tests/acceptance/P-a", "gõ/sai"], true, isFrozenFile);
    expect(r.error).toBeUndefined();
    expect(r.unmatched).toEqual(["gõ/sai"]);
  });

  test("có -All (noFrozen=false) ⇒ như cũ, mọi file", () => {
    expect(resolveIntFiles(ALL, ["tests/acceptance/P-a"], false, isFrozenFile).files).toEqual(ALL);
  });

  test("namesFrozen: file/thư mục đóng băng nêu rõ; tiền tố rộng thì không", () => {
    const f = "tests/acceptance/P-a/pa1.int.test.ts";
    expect(namesFrozen(f, "tests/acceptance/P-a", isFrozenFile)).toBe(true);
    expect(namesFrozen(f, f, isFrozenFile)).toBe(true);
    expect(namesFrozen(f, "tests/acceptance", isFrozenFile)).toBe(false);
    expect(namesFrozen(f, "apps", isFrozenFile)).toBe(false);
  });
});

describe("e2e: việc đóng băng nêu tên", () => {
  const configs = [
    "playwright.config.ts",
    "e2e/P-a/playwright.pa.config.ts",
    "e2e/P-b/playwright.pb.config.ts",
    "e2e/chat/playwright.x2a.config.ts",
    "e2e/chat/playwright.config.ts",
  ];
  const sel = (only?: string) => selectE2eConfigs(configs, false, (c) => explicitlyNamed(c, only));

  test("không nêu tên ⇒ bỏ việc đóng băng", () => {
    expect(sel(undefined)).toEqual(["playwright.config.ts", "e2e/chat/playwright.config.ts"]);
  });
  test("nêu tên việc (P-a) ⇒ chạy P-a không cần -All, không kéo P-b", () => {
    const r = sel("root,P-a");
    expect(r).toContain("e2e/P-a/playwright.pa.config.ts");
    expect(r).not.toContain("e2e/P-b/playwright.pb.config.ts");
  });
  test("nêu đường dẫn cấu hình đóng băng ⇒ chạy", () => {
    expect(sel("e2e/chat/playwright.x2a.config.ts")).toContain("e2e/chat/playwright.x2a.config.ts");
  });
  test("tiền tố tên việc chung chung ('P') không đủ để kéo việc đóng băng", () => {
    expect(explicitlyNamed("e2e/P-a/playwright.pa.config.ts", "P")).toBe(false);
  });
  test("-All ⇒ như cũ", () => {
    expect(selectE2eConfigs(configs, true)).toEqual(configs);
  });
});
