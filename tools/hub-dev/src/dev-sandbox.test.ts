// WRK-FR-28 · ADR-0011 #1 · P-c1 R4 — hub-dev bật sandbox job tự-sửa cho Runtime (chỉ dev).
import { describe, expect, test } from "bun:test";
import { sandboxRuntime } from "./dev";

describe("sandboxRuntime", () => {
  test("container mặc định: docker + socket + work cùng đường dẫn VM", () => {
    const r = sandboxRuntime(true, {});
    expect(r.env.RUNTIME_SANDBOX).toBe("docker");
    expect(r.env.RUNTIME_SANDBOX_HOST_WORKDIR).toBe("/tmp/hub-dev-work");
    expect(r.env.RUNTIME_SANDBOX_IMAGE).toBe("ai-autofix-sandbox:0.1.0");
    expect(r.args).toEqual([
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      "/tmp/hub-dev-work:/tmp/hub-dev-work",
    ]);
  });

  test("RUNTIME_SANDBOX=off ⇒ không socket", () => {
    expect(sandboxRuntime(true, { RUNTIME_SANDBOX: "off" })).toEqual({
      env: { RUNTIME_SANDBOX: "off" },
      args: [],
    });
  });

  test("tiến trình thường: chỉ chuyển tiếp RUNTIME_SANDBOX* đã đặt", () => {
    const r = sandboxRuntime(false, {
      RUNTIME_SANDBOX: "podman",
      PATH: "/x",
      RUNTIME_SANDBOX_CPUS: "",
    });
    expect(r).toEqual({ env: { RUNTIME_SANDBOX: "podman" }, args: [] });
  });
});
