// dlc-dify · kế hoạch deploy của project (luật thuần, không I/O): spec agent mô tả CÁCH chạy app (`static` = site tĩnh có
// index.html, `command` = build + lệnh chạy), workspace tự cấp cổng trong dải của máy chủ và URL công khai
// `http://<host>:<port>/` để người dùng mở app sau khi deploy. Project không có mô tả mà repo có index.html ⇒ coi là site tĩnh.
import type { DeployCfg } from "./deploy";

export type DeploySpec =
  | { kind: "static"; root?: string }
  | {
      kind: "command";
      build_command?: string;
      image: string;
      run_command: string;
      container_port: number;
    };

/** Ảnh và lệnh phục vụ site tĩnh: Python stdlib (ảnh đã có trên máy chủ), bản release mount ở `/app`. */
const STATIC_IMAGE = "python:3.12-slim";
const STATIC_PORT = 8000;
const SAFE_ROOT = /^[A-Za-z0-9._/-]{0,200}$/;

export type PortRange = { from: number; to: number };

/** `"4620-4699"` ⇒ dải cổng; sai ⇒ mặc định 4620–4699. */
export function parsePortRange(raw: string | undefined): PortRange {
  const m = /^(\d{4,5})-(\d{4,5})$/.exec((raw ?? "").trim());
  const from = m ? Number(m[1]) : 4620;
  const to = m ? Number(m[2]) : 4699;
  return from >= 1024 && to >= from && to <= 65535 ? { from, to } : { from: 4620, to: 4699 };
}

/** Cổng trống thấp nhất trong dải (bỏ cổng đã cấp cho project khác hoặc đang được publish). Hết ⇒ null. */
export function pickPort(used: Iterable<number>, range: PortRange): number | null {
  const taken = new Set(used);
  for (let p = range.from; p <= range.to; p++) if (!taken.has(p)) return p;
  return null;
}

/** Cổng host đang publish từ chuỗi `docker ps --format {{.Ports}}` (vd `0.0.0.0:4610->8000/tcp, :::4610->8000/tcp`). */
export function publishedPorts(dockerPorts: string): number[] {
  return [...dockerPorts.matchAll(/:(\d{2,5})->/g)].map((m) => Number(m[1]));
}

/** Thư mục chứa index.html để phục vụ (gốc repo trước, rồi các tên quen thuộc). Không có ⇒ null. */
export function staticRootOf(files: readonly string[]): string | null {
  const set = new Set(files);
  for (const dir of ["", "site", "public", "dist", "www", "web", "docs"]) {
    if (set.has(dir ? `${dir}/index.html` : "index.html")) return dir;
  }
  return null;
}

/** Mô tả của agent (JSON tự do) ⇒ DeploySpec hợp lệ, hỏng ⇒ null. */
export function deploySpecOf(raw: unknown): DeploySpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "static") return staticSpec(r);
  if (r.kind === "command") return commandSpec(r);
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function staticSpec(r: Record<string, unknown>): DeploySpec | null {
  const root = str(r.root).replace(/^\.?\/+|\/+$/g, "");
  return SAFE_ROOT.test(root) && !root.includes("..") ? { kind: "static", root } : null;
}

function commandSpec(r: Record<string, unknown>): DeploySpec | null {
  const image = str(r.image);
  const run = str(r.run_command);
  const cport = Number(r.container_port);
  if (!image || !run || !Number.isInteger(cport) || cport < 1 || cport > 65535) return null;
  const build = str(r.build_command);
  return {
    kind: "command",
    image: image.slice(0, 200),
    run_command: run.slice(0, 2000),
    container_port: cport,
    ...(build && { build_command: build.slice(0, 2000) }),
  };
}

/** DeploySpec + cổng + host công khai ⇒ cấu hình deploy (deploy.ts) có URL để báo người dùng. */
export function cfgFromSpec(spec: DeploySpec, port: number, host: string): DeployCfg {
  const url = `http://${host}:${port}/`;
  if (spec.kind === "static") {
    const dir = spec.root ? `/app/${spec.root}` : "/app";
    return {
      build_command: "true",
      image: STATIC_IMAGE,
      run_command: `python -m http.server ${STATIC_PORT} --bind 0.0.0.0 --directory ${dir}`,
      port,
      container_port: STATIC_PORT,
      url,
    };
  }
  return {
    build_command: spec.build_command ?? "true",
    image: spec.image,
    run_command: spec.run_command,
    port,
    container_port: spec.container_port,
    url,
  };
}
