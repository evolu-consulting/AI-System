// HUB-BR-33 · WRK-FR-28 · plan-runtime §5.10 — phần thuần của `sandbox:image`.
import { describe, expect, test } from "bun:test";
import { SANDBOX_IMAGE, sandboxArgs } from "../scripts/run";
import { buildArgv, bunVersion, shaFor } from "./build";

const SHA = "a".repeat(64);

describe("sandbox:image", () => {
  test("bunVersion đọc packageManager bun@x.y.z, sai dạng ⇒ lỗi", () => {
    expect(bunVersion("bun@1.3.14")).toBe("1.3.14");
    expect(() => bunVersion("npm@10.0.0")).toThrow();
    expect(() => bunVersion(undefined)).toThrow();
  });

  test("shaFor chọn đúng file, thiếu ⇒ lỗi", () => {
    const txt = `${"b".repeat(64)}  bun-linux-aarch64.zip\n${SHA}  bun-linux-x64.zip\n`;
    expect(shaFor(txt, "bun-linux-x64.zip")).toBe(SHA);
    expect(() => shaFor(txt, "bun-darwin-x64.zip")).toThrow();
  });

  test("buildArgv truyền BUN_VERSION/BUN_SHA256 và thẻ ảnh", () => {
    const argv = buildArgv("1.3.14", SHA);
    expect(argv).toContain("BUN_VERSION=1.3.14");
    expect(argv).toContain(`BUN_SHA256=${SHA}`);
    expect(argv[argv.indexOf("-t") + 1]).toBe(SANDBOX_IMAGE);
  });

  test("sandboxArgs: socket + thư mục cùng đường dẫn + ảnh", () => {
    const a = sandboxArgs();
    expect(a).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(a).toContain("/tmp/ai-sandbox-work:/tmp/ai-sandbox-work");
    expect(a).toContain(`RUNTIME_SANDBOX_IMAGE=${SANDBOX_IMAGE}`);
  });
});
