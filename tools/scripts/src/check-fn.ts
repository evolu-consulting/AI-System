// ADM-NFR-06 · `bun run check:fn`: hàm ≤ 50 dòng (component React ≤ 200), ≤ 4 tham số (CONVENTIONS §4, TECH-DEBT #18,
// plan M3 §7). Phân tích cú pháp bằng TypeScript compiler API, không typecheck. Nợ cũ nằm trong check-fn.allow.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { changedFiles, listFiles, notIgnored, repoRoot, toRepoPath } from "./lib/git";

export const FN_LINE_LIMIT = 50;
export const COMPONENT_LINE_LIMIT = 200;
export const PARAM_LIMIT = 4;

export type FnInfo = {
  name: string;
  line: number;
  lines: number;
  params: number;
  component: boolean;
};
export type FnViolation = FnInfo & {
  path: string;
  limit: number;
  overLines: boolean;
  overParams: boolean;
};
export type AllowEntry = { file: string; name: string; reason: string };

const SCOPE_RE = /^(apps|packages|tools)\/[^/]+\/src\/.+\.tsx?$/;
const EXEMPT = ["/components/ui/", "/__fixtures__/", "/migrations/", "/migrations-dev/"];
const WRAPPERS = new Set(["memo", "forwardRef", "React.memo", "React.forwardRef"]);

/** Path posix tương đối gốc repo có thuộc phạm vi kiểm không (bỏ tests/**, e2e/** của qc). */
export function inScope(path: string): boolean {
  if (!SCOPE_RE.test(path) || path.endsWith(".d.ts")) return false;
  if (/\.(gen|generated)\.ts$/.test(path)) return false;
  return !EXEMPT.some((d) => `/${path}`.includes(d));
}

const nameText = (n: ts.Node | undefined, sf: ts.SourceFile): string | null =>
  n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n))
    ? n.text
    : (n?.getText(sf) ?? null);

/** Tên callback ẩn danh: `callee("đối số chuỗi đầu")` (vd `describe("…")`), không có chuỗi thì `callee(…)`. */
function callbackName(call: ts.CallExpression, sf: ts.SourceFile): string {
  const callee = call.expression.getText(sf).replace(/\s+/g, "");
  const first = call.arguments.find((a) => ts.isStringLiteralLike(a));
  return first && ts.isStringLiteralLike(first)
    ? `${callee}("${first.text.slice(0, 40)}")`
    : `${callee}(…)`;
}

/** Tên của biểu thức hàm theo nơi nó được gán/truyền. */
function exprName(node: ts.Node, sf: ts.SourceFile): string {
  const p = node.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
    return nameText(p.name, sf) ?? "<anonymous>";
  }
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText(sf);
    if (WRAPPERS.has(callee) && ts.isVariableDeclaration(p.parent)) {
      return nameText(p.parent.name, sf) ?? "<anonymous>";
    }
    return callbackName(p, sf);
  }
  return "<anonymous>";
}

function fnName(node: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return (node.name && nameText(node.name, sf)) || exprName(node, sf);
  }
  return nameText(node.name, sf) ?? "<anonymous>";
}

function isFnLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

function info(node: ts.FunctionLikeDeclaration, sf: ts.SourceFile, tsx: boolean): FnInfo {
  const name = fnName(node, sf);
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  const params = node.parameters.filter((p) => nameText(p.name, sf) !== "this").length;
  return {
    name,
    line: start + 1,
    lines: end - start + 1,
    params,
    component: tsx && /^[A-Z]/.test(name),
  };
}

/** Mọi hàm trong file (kể cả hàm lồng, tính riêng). */
export function analyzeSource(path: string, text: string): FnInfo[] {
  const tsx = path.endsWith(".tsx");
  const sf = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: FnInfo[] = [];
  const visit = (n: ts.Node): void => {
    if (isFnLike(n) && n.body) out.push(info(n, sf, tsx));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function violationsOf(path: string, fns: readonly FnInfo[]): FnViolation[] {
  const out: FnViolation[] = [];
  for (const f of fns) {
    const limit = f.component ? COMPONENT_LINE_LIMIT : FN_LINE_LIMIT;
    const overLines = f.lines > limit;
    const overParams = f.params > PARAM_LIMIT;
    if (overLines || overParams) out.push({ ...f, path, limit, overLines, overParams });
  }
  return out;
}

/** Tách vi phạm theo allowlist (khoá file + tên). `stale` = mục allowlist (trong các file đã kiểm) không còn vi phạm. */
export function applyAllow(
  vs: readonly FnViolation[],
  allow: readonly AllowEntry[],
  checked: ReadonlySet<string>,
): { failing: FnViolation[]; stale: AllowEntry[] } {
  const key = (file: string, name: string) => `${file}\u0000${name}`;
  const allowed = new Set(allow.map((a) => key(a.file, a.name)));
  const hit = new Set(vs.map((v) => key(v.path, v.name)));
  return {
    failing: vs.filter((v) => !allowed.has(key(v.path, v.name))),
    stale: allow.filter((a) => checked.has(a.file) && !hit.has(key(a.file, a.name))),
  };
}

export function formatViolation(v: FnViolation): string {
  const why = [
    v.overLines ? `${v.lines} dòng > ${v.limit}` : "",
    v.overParams ? `${v.params} tham số > ${PARAM_LIMIT}` : "",
  ].filter(Boolean);
  return `${v.path}:${v.line} ${v.name} (${why.join(", ")})`;
}

function selectFiles(root: string, argv: string[]): string[] {
  if (argv.includes("--all")) return listFiles(root);
  const at = argv.indexOf("--files");
  if (at === -1) return changedFiles(root);
  const given = argv.slice(at + 1).map((p) => toRepoPath(process.cwd(), root, p));
  return notIgnored(root, given);
}

function loadAllow(root: string): AllowEntry[] {
  const p = join(root, "tools/scripts/check-fn.allow.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as AllowEntry[]) : [];
}

function main(argv: string[]): number {
  const root = repoRoot();
  const paths = selectFiles(root, argv).filter((p) => inScope(p) && existsSync(join(root, p)));
  const vs = paths.flatMap((p) =>
    violationsOf(p, analyzeSource(p, readFileSync(join(root, p), "utf8"))),
  );
  const { failing, stale } = applyAllow(vs, loadAllow(root), new Set(paths));
  for (const a of stale) console.warn(`check:fn cảnh báo: allowlist thừa ${a.file} ${a.name}`);
  for (const v of failing) console.error(formatViolation(v));
  if (failing.length) return 1;
  console.log(`check:fn OK (${paths.length} file, ${vs.length} ngoại lệ trong allowlist)`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
