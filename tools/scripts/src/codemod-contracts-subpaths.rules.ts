// CR-121 phần B-2 · ADR-0037 · luật thuần của codemod `@ai/contracts` (barrel gốc) → subpath
// (`@ai/contracts/<subpath>`). Barrel gốc `export *` ~40 file nên import một tên kéo cả đồ thị; subpath chỉ kéo đúng file.
// Phần chạy (đồ thị TS, ghi file) ở codemod-contracts-subpaths.ts.
import ts from "typescript";

export const ROOT_SPEC = "@ai/contracts";

/** Thư mục trong `packages/contracts/src` có subpath khác tên thư mục. */
const DIR_ALIAS: Readonly<Record<string, string>> = { "pack-community": "community" };

/** `src`-tương-đối của file khai báo (vd `access.ts`, `flow/cond.ts`) → tên subpath (`access`, `flow`). */
export function subpathOfFile(relFromSrc: string): string {
  const parts = relFromSrc.split("/");
  const first = parts[0] ?? "";
  if (parts.length > 1) return DIR_ALIAS[first] ?? first;
  return first.replace(/\.tsx?$/, "");
}

/** Subpath → target trong `exports` (file gốc `./src/<s>.ts`; thư mục `./src/<dir>/index.ts`). */
export function exportTarget(subpath: string, dirOfSubpath: (s: string) => string | null): string {
  const dir = dirOfSubpath(subpath);
  return dir ? `./src/${dir}/index.ts` : `./src/${subpath}.ts`;
}

export type Resolver = (name: string) => string | undefined;
export type RewriteResult = { text: string; changed: boolean; skipped: string[] };

type Spec = { name: string; local: string; isType: boolean };

function specOf(el: ts.ImportSpecifier | ts.ExportSpecifier): Spec {
  const name = (el.propertyName ?? el.name).text;
  return { name, local: el.name.text, isType: el.isTypeOnly };
}

function renderSpec(s: Spec, stmtType: boolean): string {
  const t = s.isType && !stmtType ? "type " : "";
  return `${t}${s.name === s.local ? s.name : `${s.name} as ${s.local}`}`;
}

function renderGroup(
  kind: "import" | "export",
  stmtType: boolean,
  names: Spec[],
  sub: string,
): string {
  const body = names.map((n) => renderSpec(n, stmtType)).join(", ");
  return `${kind} ${stmtType ? "type " : ""}{ ${body} } from "${ROOT_SPEC}/${sub}";`;
}

function namedElements(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] | null {
  if (ts.isImportDeclaration(node)) {
    const c = node.importClause;
    // import X from / import * as X from / import X, {…} ⇒ không đổi được an toàn
    if (!c || c.name || !c.namedBindings || !ts.isNamedImports(c.namedBindings)) return null;
    return c.namedBindings.elements;
  }
  const e = node.exportClause;
  return e && ts.isNamedExports(e) ? e.elements : null;
}

function isTypeOnlyStmt(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  return ts.isImportDeclaration(node) ? !!node.importClause?.isTypeOnly : node.isTypeOnly;
}

/** Nhóm theo subpath (giữ thứ tự xuất hiện đầu tiên); tên không resolve được ⇒ undefined. */
function groupBySubpath(els: readonly Spec[], resolve: Resolver): Map<string, Spec[]> | null {
  const groups = new Map<string, Spec[]>();
  for (const el of els) {
    const sub = resolve(el.name);
    if (!sub) return null;
    const arr = groups.get(sub) ?? [];
    arr.push(el);
    groups.set(sub, arr);
  }
  return groups;
}

type Edit = { start: number; end: number; text: string };

function planEdit(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
  sf: ts.SourceFile,
  resolve: Resolver,
  skipped: string[],
): Edit | null {
  const els = namedElements(node);
  if (!els) {
    skipped.push(node.getText(sf).split("\n")[0] ?? "");
    return null;
  }
  const groups = groupBySubpath(els.map(specOf), resolve);
  if (!groups || groups.size === 0) {
    skipped.push(node.getText(sf).replace(/\s+/g, " ").slice(0, 120));
    return null;
  }
  const kind = ts.isImportDeclaration(node) ? "import" : "export";
  const stmtType = isTypeOnlyStmt(node);
  const text = [...groups]
    .map(([sub, names]) => renderGroup(kind, stmtType, names, sub))
    .join("\n");
  return { start: node.getStart(sf), end: node.getEnd(), text };
}

function moduleSpecOf(node: ts.Node): string | null {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return null;
  const m = node.moduleSpecifier;
  return m && ts.isStringLiteral(m) ? m.text : null;
}

/** Thay mọi `import/export {…} from "@ai/contracts"` bằng các câu theo subpath. Bỏ qua (và báo) dạng không đổi được. */
export function rewriteSource(source: string, resolve: Resolver, fileName = "x.ts"): RewriteResult {
  if (!source.includes(`"${ROOT_SPEC}"`) && !source.includes(`'${ROOT_SPEC}'`)) {
    return { text: source, changed: false, skipped: [] };
  }
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const skipped: string[] = [];
  const edits: Edit[] = [];
  for (const st of sf.statements) {
    if (moduleSpecOf(st) !== ROOT_SPEC) continue;
    const e = planEdit(st as ts.ImportDeclaration | ts.ExportDeclaration, sf, resolve, skipped);
    if (e) edits.push(e);
  }
  let text = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  return { text, changed: edits.length > 0, skipped };
}
