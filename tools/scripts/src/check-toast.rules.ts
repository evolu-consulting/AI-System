// CR-125 G3 · luật thuần của `bun run check:toast` (audit #20, check 8): toast chỉ import từ gói UI chung (`@ai/web-kit/ui/toast`),
// không import `sonner` trực tiếp ngoài packages/web-kit.
export type ToastIssue = { file: string; line: number; msg: string };

const SONNER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']sonner["']/;

export function toastIssues(files: ReadonlyMap<string, string>): ToastIssue[] {
  const out: ToastIssue[] = [];
  for (const [file, text] of files) {
    if (file.startsWith("packages/web-kit/")) continue;
    text.split("\n").forEach((l, i) => {
      if (SONNER.test(l)) {
        out.push({
          file,
          line: i + 1,
          msg: "import 'sonner' trực tiếp — dùng @ai/web-kit/ui/toast (hoặc /toaster)",
        });
      }
    });
  }
  return out;
}
