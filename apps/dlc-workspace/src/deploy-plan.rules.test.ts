import { describe, expect, test } from "bun:test";
import {
  cfgFromSpec,
  deploySpecOf,
  parsePortRange,
  pickPort,
  publishedPorts,
  staticRootOf,
} from "./deploy-plan.rules";

describe("dlc-dify · kế hoạch deploy", () => {
  test("dải cổng + chọn cổng trống", () => {
    expect(parsePortRange("4700-4705")).toEqual({ from: 4700, to: 4705 });
    expect(parsePortRange("abc")).toEqual({ from: 4620, to: 4699 });
    expect(pickPort([4620, 4621], { from: 4620, to: 4625 })).toBe(4622);
    expect(pickPort([4620], { from: 4620, to: 4620 })).toBeNull();
    expect(
      publishedPorts("0.0.0.0:4610->8000/tcp, :::4610->8000/tcp, 127.0.0.1:4600->4600/tcp"),
    ).toEqual([4610, 4610, 4600]);
  });
  test("site tĩnh: tìm thư mục có index.html", () => {
    expect(staticRootOf(["README.md", "index.html"])).toBe("");
    expect(staticRootOf(["site/index.html", "site/css/a.css"])).toBe("site");
    expect(staticRootOf(["src/app.py"])).toBeNull();
  });
  test("mô tả của agent: static / command / hỏng", () => {
    expect(deploySpecOf({ kind: "static", root: "./site/" })).toEqual({
      kind: "static",
      root: "site",
    });
    expect(deploySpecOf({ kind: "static", root: "../etc" })).toBeNull();
    expect(
      deploySpecOf({
        kind: "command",
        image: "python:3.12-slim",
        run_command: "python -m server",
        container_port: 8000,
      }),
    ).toEqual({
      kind: "command",
      image: "python:3.12-slim",
      run_command: "python -m server",
      container_port: 8000,
    });
    expect(deploySpecOf({ kind: "command", image: "x" })).toBeNull();
    expect(deploySpecOf("static")).toBeNull();
  });
  test("cấu hình deploy có URL công khai", () => {
    const c = cfgFromSpec({ kind: "static", root: "site" }, 4621, "149.202.83.5");
    expect(c.url).toBe("http://149.202.83.5:4621/");
    expect(c.run_command).toContain("--directory /app/site");
    expect(c.container_port).toBe(8000);
    const d = cfgFromSpec(
      {
        kind: "command",
        image: "node:22-bookworm",
        run_command: "node server.js",
        container_port: 3000,
      },
      4622,
      "h",
    );
    expect(d).toMatchObject({
      build_command: "true",
      port: 4622,
      container_port: 3000,
      url: "http://h:4622/",
    });
  });
});

import { mergeTeam } from "./store";

describe("dlc-dify · đội domain của project", () => {
  test("gộp theo domain, giữ thứ tự cũ", () => {
    const cur = [
      { domain: "frontend", name: "FE", focus: "a" },
      { domain: "qc-frontend", name: "QC", focus: "" },
    ];
    const next = [
      { domain: "frontend", name: "FE2", focus: "b" },
      { domain: "content", name: "Content", focus: "" },
    ];
    expect(mergeTeam(cur, next).map((a) => `${a.domain}:${a.name}`)).toEqual([
      "frontend:FE2",
      "qc-frontend:QC",
      "content:Content",
    ]);
  });
});
