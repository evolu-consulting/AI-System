// CR-125 · m3 · MOD-FR-06 · luật THUẦN của công cụ sổ module: sinh `index.generated.ts`, kiểm tĩnh, scaffold `module:new`.
// I/O nằm ở module-index.ts / check-modules.ts / module-new.ts (mỏng).
import {
  type BoundSummary,
  type FeatureModule,
  type ModuleIssue,
  writableOutputKeys,
} from "@ai/contracts/modules";

export const NAME_RE = /^[a-z][a-z0-9-]*$/;
export const STALE_MESSAGE =
  "Danh sách module tự sinh đã cũ — chạy bun run module:index rồi commit.";

const upper = (s: string): string => s.toUpperCase().replace(/-/g, "_");
const pascal = (s: string): string =>
  s
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

/** Tên hằng module của một app (`contracts` → `CONTRACTS_MODULE`). */
export const moduleConst = (app: string): string => `${upper(app)}_MODULE`;
/** Tên hằng node (`show-post` → `SHOW_POST_NODE`). */
export const nodeConst = (node: string): string => `${upper(node)}_NODE`;

/** Kiểm tên app/node; trả câu lỗi tiếng Việt hoặc null. */
export function nameError(what: "app" | "node", v: string): string | null {
  return NAME_RE.test(v)
    ? null
    : `Tên ${what} «${v}» không hợp lệ — dùng chữ thường, số, gạch ngang, bắt đầu bằng chữ (vd show-post).`;
}

/** App của nền tảng đứng trước (khớp thứ tự sổ m1); còn lại theo bảng chữ cái. */
const FIRST_APPS = ["core", "contracts"] as const;

/** Danh sách app có node (đã sắp, bỏ trùng); `core` luôn có (file `core/index.ts`). */
export function orderApps(appsWithNodes: readonly string[]): string[] {
  const set = new Set(appsWithNodes);
  const first = FIRST_APPS.filter((a) => a === "core" || set.has(a));
  return [
    ...first,
    ...[...set].filter((a) => !(FIRST_APPS as readonly string[]).includes(a)).sort(),
  ];
}

/** Nội dung `index.generated.ts` — tất định: cùng tập app ⇒ cùng từng byte. */
export function renderIndex(appsWithNodes: readonly string[]): string {
  const apps = orderApps(appsWithNodes);
  const imports = apps
    .map((a) => ({
      path: a === "core" ? "./core" : `./${a}/module`,
      line: `import { ${moduleConst(a)} } from "${a === "core" ? "./core" : `./${a}/module`}";`,
    }))
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    .map((x) => x.line);
  const list = apps.map(moduleConst).join(", ");
  return [
    "// CR-125 · m3 · TỰ SINH bởi `bun run module:index` — KHÔNG sửa tay. SỔ MODULE: danh sách node DUY NHẤT (MOD-FR-06),",
    "// sinh từ thư mục `modules/<app>/<node>/node.ts`.",
    ...imports,
    'import type { FeatureModule } from "./types";',
    "",
    `export const MODULES: readonly FeatureModule[] = [${list}];`,
    "",
  ].join("\n");
}

/** Dòng tệp `<app>/<node>/node.ts` → danh sách app có node + node theo app. */
export function scanNodePaths(relPaths: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of relPaths) {
    const m = /^([^/]+)\/([^/]+)\/node\.ts$/.exec(p.replace(/\\/g, "/"));
    if (!m) continue;
    const [, app = "", node = ""] = m;
    out.set(app, [...(out.get(app) ?? []), node]);
  }
  for (const [a, v] of out) out.set(a, v.sort());
  return out;
}

export type IndexInput = {
  nodes: ReadonlyMap<string, readonly string[]>;
  /** nội dung `<app>/module.ts` theo app (vắng = không có file) */
  moduleSrc: ReadonlyMap<string, string>;
  currentIndex: string;
};

const issue = (
  app: string,
  key: string,
  message: string,
  code: ModuleIssue["code"],
): ModuleIssue => ({
  code,
  app,
  key,
  message,
});

/** Kiểm tĩnh không cần hub: index tự sinh còn mới, mỗi app có module.ts, mỗi node.ts được liệt kê trong module.ts. */
export function staticIssues(inp: IndexInput): ModuleIssue[] {
  const out: ModuleIssue[] = [];
  const apps = [...inp.nodes.keys()].sort();
  if (inp.currentIndex !== renderIndex(apps))
    out.push(issue("*", "index.generated.ts", STALE_MESSAGE, "MOD_INDEX_STALE"));
  for (const app of apps) {
    const src = inp.moduleSrc.get(app);
    if (src === undefined) {
      out.push(
        issue(
          app,
          app,
          `Thiếu packages/contracts/src/modules/${app}/module.ts — chạy bun run module:new ${app} <node> hoặc tạo file khai báo module «${app}».`,
          "MOD_INDEX_STALE",
        ),
      );
      continue;
    }
    for (const node of inp.nodes.get(app) ?? [])
      if (!src.includes(`./${node}/node"`))
        out.push(
          issue(
            app,
            `${app}.${node}`,
            `Node «${app}.${node}» có node.ts nhưng chưa nằm trong ${app}/module.ts — thêm vào nodes[].`,
            "MOD_INDEX_STALE",
          ),
        );
  }
  return out;
}

/** Tóm tắt binding "dễ tính" cho kiểm tĩnh: coi mọi node/tool/sự kiện đã có xử lý ⇒ chỉ còn luật không cần runtime (MOD_DUP). */
export function staticBound(mods: readonly FeatureModule[]): BoundSummary {
  const nodes = new Map<string, { tools: readonly string[]; outputs: readonly string[] }>();
  const tools = new Set<string>();
  const facts = new Set<string>();
  const outcomes = new Set<string>();
  for (const m of mods) {
    for (const n of m.nodes) {
      const ts = n.stages.flatMap((s) => (s.executor.kind === "tool" ? [s.executor.tool_key] : []));
      for (const t of ts) if (typeof t === "string") tools.add(t);
      nodes.set(n.key, {
        tools: ts.filter((t): t is string => typeof t === "string"),
        outputs: writableOutputKeys(n),
      });
    }
    for (const e of m.events) {
      facts.add(`${m.app}\0${e.key}`);
      outcomes.add(`${m.app}\0${e.key}`);
    }
  }
  return { nodes, tools, facts, outcomes };
}

export function formatIssue(i: ModuleIssue): string {
  return `  ${i.code} ${i.app}·${i.key}: ${i.message}`;
}

// ---- module:new ----

export function nodeSource(app: string, node: string): string {
  const key = `${app}.${node}`;
  return `// CR-125 · khai báo node «${key}» (module:new). Điền nhãn, nhóm, stage mẫu; binding máy chủ: packs/${app}/nodes/${node}/binding.ts.
import type { FeatureNodeDecl } from "../../types";

export const ${nodeConst(node)}: FeatureNodeDecl = {
  key: "${key}",
  label: { vi: "${pascal(node)}", en: "${pascal(node)}" },
  group: "content",
  kind: "app",
  menu: { section: "business" },
  feature: "${app}-write",
  stages: [],
  // Cổng vào (bước trước phải cấp) và cổng ra (bước sau nhận được), nhãn nghiệp vụ vi/en. fix = cách khắc phục khi thiếu nguồn.
  inputs: [
    {
      key: "record_id",
      type: "string",
      required: true,
      label: { vi: "Bản ghi", en: "Record" },
      fix: { vi: "bắt đầu quy trình từ sự kiện của app này.", en: "start the flow from an event of this app." },
    },
  ],
  // pending: true = máy chủ chưa ghi giá trị này vào dữ liệu lượt chạy (chưa dùng làm nguồn tự nối). Khi binding.ts đã ghi:
  // thêm khoá vào outputs của binding và BỎ pending (sổ module kiểm hai chiều: MOD_OUTPUT_UNBOUND).
  outputs: [
    {
      key: "result",
      type: "string",
      required: false,
      pending: true,
      label: { vi: "Kết quả", en: "Result" },
    },
  ],
};
`;
}

export function nodeTestSource(app: string, node: string): string {
  return `// CR-125 · khung test node «${app}.${node}» (module:new).
import { describe, expect, test } from "bun:test";
import { ${nodeConst(node)} } from "./node";

describe("${app}.${node}", () => {
  test("khoá node khớp thư mục", () => {
    expect(${nodeConst(node)}.key).toBe("${app}.${node}");
  });
});
`;
}

export function moduleSource(app: string, node: string): string {
  return `// CR-125 · module «${app}» (module:new). Sự kiện của app khai ở AppManifest.events (ghép bằng withEvents).
import type { FeatureModule } from "../types";
import { ${nodeConst(node)} } from "./${node}/node";

export const ${moduleConst(app)}: FeatureModule = {
  app: "${app}",
  events: [],
  nodes: [${nodeConst(node)}],
};
`;
}

/** Thêm node vào module.ts có sẵn (import + nodes[]); đã có ⇒ trả nguyên văn. */
export function addNodeToModule(src: string, node: string): string {
  if (src.includes(`./${node}/node"`)) return src;
  const imp = `import { ${nodeConst(node)} } from "./${node}/node";`;
  const lines = src.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (l.startsWith("import ")) last = i;
  });
  lines.splice(last + 1, 0, imp);
  return lines.join("\n").replace(/nodes:\s*\[([^\]]*)\]/, (_m, inner: string) => {
    const items = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return `nodes: [${[...items, nodeConst(node)].join(", ")}]`;
  });
}
