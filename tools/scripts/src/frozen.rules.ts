// F1 (CR-095) · danh sách suite của module ĐÓNG BĂNG (docs/platform/modules.md): ra khỏi cổng hằng ngày (`test:affected`, `test:all --no-frozen`),
// chạy theo yêu cầu bằng `bun run test:frozen` (khi nâng cấp). `test:all` (không cờ) vẫn chạy hết cho kiểm tra hằng tháng.
// Chỉ sửa danh sách này khi một module đổi trạng thái (cùng lúc với docs/platform/modules.md).

/** Mẫu đường dẫn file test (unit + int) thuộc module đóng băng. */
export const FROZEN_TEST_GLOBS: readonly string[] = [
  "apps/hub-api/src/modules/{processes,sources,rooms,kh}/**",
  "apps/admin-api/src/modules/{workflows,workflow-tools,transfer,commands}/**",
  "apps/chat-web/src/features/{processes,rooms}/**",
  "apps/admin-web/src/features/{processes,sources,commands,workflows,transfer}/**",
  "apps/studio-web/src/features/settings/**",
  // Nghiệm thu theo mốc: quy trình (P-*), KnowledgeHub cũ (K1), phòng + agent trong phòng (X2b*), lệnh Admin (H3b-cmd).
  "tests/acceptance/{P-a,P-b,P-b2,P-c,P-c2,P-d,K1,X2b,X2b2,H3b-cmd}/**",
  // X2a: chỉ phần phòng; `/me/stream`, danh bạ, seed, stream-isolation là module ĐANG DÙNG nên ở lại cổng.
  "tests/acceptance/X2a/{rooms,members,messages,concurrency,log,isolation,rv1-security,rv2-security,db-rls}.int.test.ts",
  "tests/acceptance/X2a/rules/{rooms-rules,room-events}.test.ts",
];

/** Cấu hình e2e của module đóng băng (quy trình, KH, phòng). */
export const FROZEN_E2E_CONFIGS: readonly string[] = [
  "e2e/P-a/playwright.pa.config.ts",
  "e2e/P-b/playwright.pb.config.ts",
  "e2e/P-b2/playwright.pb2.config.ts",
  "e2e/P-c/playwright.pc.config.ts",
  "e2e/P-c2/playwright.pc2.config.ts",
  "e2e/P-d/playwright.pd.config.ts",
  "e2e/K1/playwright.k1.config.ts",
  "e2e/chat/playwright.x2a.config.ts",
  "e2e/chat/playwright.x2b.config.ts",
  "e2e/chat/playwright.x2b2.config.ts",
];

/** Glob tối giản, thuần (không phụ thuộc `bun`): hỗ trợ `**`, `*`, `?`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*|\?|[{},]/g, (m) => TOKENS[m] ?? m);
  return new RegExp(`^${re}$`);
}
const TOKENS: Record<string, string> = {
  "**": ".*",
  "*": "[^/]*",
  "?": "[^/]",
  "{": "(?:",
  "}": ")",
  ",": "|",
};
const GLOBS = FROZEN_TEST_GLOBS.map(globToRegExp);
const norm = (p: string): string => p.replaceAll("\\", "/").replace(/^\.\//, "");

export const isFrozenFile = (f: string): boolean => {
  const p = norm(f);
  return GLOBS.some((g) => g.test(p));
};

export const isFrozenConfig = (c: string): boolean => FROZEN_E2E_CONFIGS.includes(norm(c));

/** `ignore` của bunfig (`pathIgnorePatterns`) + mẫu đóng băng ⇒ nội dung bunfig cho cổng hằng ngày. */
export function gateBunfig(baseToml: string): string {
  const extra = FROZEN_TEST_GLOBS.map((g) => `"${g}"`).join(", ");
  return baseToml.replace(
    /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/,
    (_m, inner: string) => `pathIgnorePatterns = [${inner.trim()}, ${extra}]`,
  );
}
