// HUB-FR-115 · HUB-FR-129 · PC2-R08 · Q5 · FC14 · FC15 · P-c2 · e2e chat-web "Cần người quyết" Áp + thẻ thread (test-plan P-c2 §4
// E15–E17; plan-frontend §1.4, §3, §5; mockup Pc2-Decision): run `needs_decision` (seedRun P-a) ⇒ lý do `apply_conflict`/`apply_failed`
// bằng SQL (chỉ khi 0032 có) + `apply` vá qua `page.route`. Chỉ 2 nút (nhãn sẵn có), câu theo `error_code` (8 mã). Thẻ thread phòng:
// `article` "Áp bản sửa" + "Đã mở PR" + link "#42".
import { expect, type Page, test } from "@playwright/test";
import {
  ADD,
  applyView,
  CANCEL,
  mkRoom,
  patchRun,
  seedPb2Run,
  seedRun,
  setApplyDecision,
  settle,
  USE,
  users,
  withApply,
} from "../_pc2-support";

test.afterEach(() => settle());

const decision = (p: Page) => p.getByRole("region", { name: "Cần người quyết" });
const NONE = { provider: null, pr_number: null, pr_url: null, head_sha: null };

async function decisionRun(room: string, reason: "apply_conflict" | "apply_failed") {
  const rm = await mkRoom(room);
  const r = await seedRun(rm.id, "needs_decision");
  return { ...r, ready: await setApplyDecision(r.runId, reason) };
}

test("HUB-FR-115 · Q5 · FC15 · E15 · apply_conflict: heading 'Bản sửa xung đột với mã mới', file xung đột (testid), 2 nút, không 'Dùng bản hiện có'", async ({
  browser,
}) => {
  const r = await decisionRun("EPC2-15", "apply_conflict");
  const u = await users(browser, "A");
  try {
    const files = ["src/tong.ts", "src/rat/dai/ten-file-rat-dai-khong-co-khoang-trang.ts"];
    await patchRun(
      u.A,
      r.runId,
      withApply(
        0,
        applyView({ ...NONE, status: "conflict", rebased: true, conflict_files: files }),
      ),
    );
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    await expect(d.getByRole("heading", { name: "Bản sửa xung đột với mã mới" })).toBeVisible();
    await expect(d.getByText("File xung đột")).toBeVisible();
    await expect(d.getByTestId("apply-conflict-file-0")).toHaveText(files[0] as string);
    await expect(d.getByTestId("apply-conflict-file-1")).toHaveText(files[1] as string);
    await expect(d.getByRole("button", { name: ADD })).toBeVisible();
    await expect(d.getByRole("button", { name: CANCEL })).toBeVisible();
    await expect(d.getByRole("button", { name: USE })).toHaveCount(0);
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

const ERR: Record<string, string> = {
  auth: "GitHub từ chối khoá nguồn (sai, hết hạn hoặc không đủ quyền). Thay khoá ở trang Nguồn rồi thử lại.",
  no_credential:
    "Nguồn chưa có khoá nguồn nên không đẩy được nhánh. Gán khoá ở trang Nguồn rồi thử lại.",
  push_rejected: "GitHub từ chối nhận nhánh (bị bảo vệ hoặc bị chặn). Thử lại hoặc huỷ.",
  network: "Không kết nối được tới GitHub. Thử lại sau.",
  rate_limited: "GitHub giới hạn tần suất gọi. Đợi vài phút rồi thử lại.",
  provider_error: "GitHub báo lỗi khi mở PR. Thử lại sau.",
  check_failed:
    "Sau khi gộp với mã mới nhất, bản sửa không qua kiểm lại (test, đường dẫn, kích thước hoặc bí mật). Chạy lại quy trình trên mã mới, hoặc huỷ.",
  unsupported_provider:
    'Máy chủ git của nguồn chưa hỗ trợ mở PR. Đổi chế độ áp của nguồn sang "Chỉ nhánh".',
};

test("HUB-FR-115 · PC2-R08 · FC14 · E16 · apply_failed: heading 'Áp bản sửa không thành công' + câu đúng cho từng error_code (8 mã); 2 nút", async ({
  browser,
}) => {
  const r = await decisionRun("EPC2-16", "apply_failed");
  const u = await users(browser, "A");
  try {
    const st = await patchRun(u.A, r.runId, () => {});
    for (const [code, text] of Object.entries(ERR)) {
      const status = code === "check_failed" ? "check_failed" : "failed";
      const failures = code === "check_failed" ? [{ check: "tests", detail: "exit 1" }] : [];
      st.patch = withApply(0, applyView({ ...NONE, status, error_code: code, failures }));
      await u.A.goto(`/runs/${r.runId}`);
      const d = decision(u.A);
      await expect(d.getByRole("heading", { name: "Áp bản sửa không thành công" })).toBeVisible();
      await expect(d.getByText(text, { exact: false })).toBeVisible();
      await expect(d.getByRole("button", { name: USE })).toHaveCount(0);
    }
    await expect(decision(u.A).getByRole("button", { name: ADD })).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("HUB-FR-129 · E17 · thẻ thread phòng: article 'Áp bản sửa' + 'Đã mở PR' + link '#42' (https)", async ({
  browser,
}) => {
  const rm = await mkRoom("EPC2-17");
  const r = await seedPb2Run(rm.id, "a");
  const u = await users(browser, "A");
  try {
    await patchRun(u.A, r.runId, withApply(1, applyView()));
    await u.A.goto(`/rooms/${rm.id}`);
    const art = u.A.getByRole("article").filter({ hasText: "Áp bản sửa" }).first();
    await expect(art).toBeVisible();
    await expect(art.getByText("Đã mở PR")).toBeVisible();
    await expect(art.getByRole("link", { name: /#42/ })).toHaveAttribute("href", /^https:\/\//);
  } finally {
    await u.close();
  }
});
