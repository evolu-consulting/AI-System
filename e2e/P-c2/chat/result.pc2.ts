// HUB-FR-129 · HUB-FR-128 · HUB-FR-130 · PC2-R07 · PC2-R15 · Q4 · C7 · C9 · P-c2 · e2e chat-web kết quả Áp + dòng gate (test-plan P-c2 §4
// E08–E14; plan-frontend §1.3, FC11–FC13, §3, §5; mockup Pc2-Result): run P-b2 seed (a) — `apply` (stage 1) + `autofix` (apply_mode /
// apply_base / diff_file) vá qua `page.route`. Region "Kết quả áp bản sửa"; link PR chỉ khi https (FC12); "Tải .diff" cho Chỉ nhánh;
// gate "Kiểm Rà soát code" có "Đạt sẽ…". Chưa có khối ⇒ đỏ ở locator region.
import { expect, type Page, test } from "@playwright/test";
import {
  afView,
  applyView,
  DIFF_NAME,
  mkRoom,
  PC_E2E,
  PR_URL,
  patchRun,
  SHA,
  seedPb2Run,
  serveAttachment,
  settle,
  users,
  withApply,
} from "../_pc2-support";

test.afterEach(() => settle());

const IDX = 1; // "Rà soát code" (seed a: waiting_review, task Kế toán)
const region = (p: Page) => p.getByRole("region", { name: "Kết quả áp bản sửa" });
const card = (p: Page) => p.getByRole("region", { name: "Kiểm Rà soát code" });

async function openRun(room: string, apply: unknown, autofix?: unknown, who: "A" | "B" = "A") {
  const rm = await mkRoom(room);
  const r = await seedPb2Run(rm.id, "a");
  return async (browser: import("@playwright/test").Browser) => {
    const u = await users(browser, who);
    const p = u[who] as Page;
    await patchRun(
      p,
      r.runId,
      withApply(IDX, apply, autofix === undefined ? undefined : IDX, autofix),
    );
    await p.goto(`/runs/${r.runId}`);
    return { p, close: u.close, runId: r.runId };
  };
}

test("HUB-FR-129 · PC2-R07 · FC12 · E08 · pr_opened: 'Đã mở PR', link 'PR #42' (https, tab mới, rel noopener noreferrer), 'Đã rebase lên b2c3d4e', 'Tự gộp: bật'", async ({
  browser,
}) => {
  const open = await openRun(
    "EPC2-08",
    applyView({
      rebased: true,
      target_sha: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
      mode: "auto_merge",
      auto_merge: "on",
    }),
  );
  const s = await open(browser);
  try {
    const box = region(s.p);
    await expect(box.getByText("Đã mở PR")).toBeVisible();
    const link = box.getByRole("link", { name: /PR #42/ });
    await expect(link).toHaveAttribute("href", PR_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(box.getByText("Đã rebase lên b2c3d4e")).toBeVisible();
    await expect(box.getByText("Tự gộp: bật")).toBeVisible();
  } finally {
    await s.close();
  }
});

test("HUB-FR-129 · Q6 · E09 · auto_merge failed ⇒ 'Tự gộp: không bật được' + gợi ý gộp tay; PR vẫn hiện", async ({
  browser,
}) => {
  const open = await openRun("EPC2-09", applyView({ mode: "auto_merge", auto_merge: "failed" }));
  const s = await open(browser);
  try {
    const box = region(s.p);
    await expect(box.getByText("Tự gộp: không bật được")).toBeVisible();
    await expect(
      box.getByText('PR vẫn mở, cần gộp tay. Kiểm tra repo đã bật "Allow auto-merge" chưa.'),
    ).toBeVisible();
    await expect(box.getByRole("link", { name: /PR #42/ })).toBeVisible();
  } finally {
    await s.close();
  }
});

test("HUB-FR-129 · E5 · E10 · pushed (Chỉ nhánh): 'Đã đẩy nhánh' + câu không mở PR; không link PR", async ({
  browser,
}) => {
  const open = await openRun(
    "EPC2-10",
    applyView({
      mode: "branch_only",
      status: "pushed",
      provider: null,
      pr_number: null,
      pr_url: null,
    }),
  );
  const s = await open(browser);
  try {
    const box = region(s.p);
    await expect(box.getByText("Đã đẩy nhánh")).toBeVisible();
    await expect(box.getByText('Nguồn đặt chế độ "Chỉ nhánh" nên không mở PR.')).toBeVisible();
    await expect(box.getByRole("link", { name: /PR #/ })).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("HUB-FR-129 · Q4 · FC11 · E11 · local branch_only: 'Chỉ nhánh' + hướng dẫn + 'Tải .diff' tải đúng tên diff của stage tự sửa", async ({
  browser,
}) => {
  const open = await openRun(
    "EPC2-11",
    applyView({
      mode: "branch_only",
      status: "branch_only",
      branch: null,
      target_sha: null,
      head_sha: null,
      provider: null,
      pr_number: null,
      pr_url: null,
    }),
    afView({ pin_sha: null, apply_mode: "branch_only", apply_base: null }),
  );
  const s = await open(browser);
  try {
    await serveAttachment(s.p, PC_E2E.diffAtt, "diff --git a/x b/x\n");
    const box = region(s.p);
    await expect(box.getByText("Chỉ nhánh", { exact: true })).toBeVisible();
    await expect(
      box.getByText(
        "Nguồn đường dẫn cục bộ không đẩy lên đâu. Tải bản sửa rồi áp vào máy của bạn:",
      ),
    ).toBeVisible();
    const dl = s.p.waitForEvent("download");
    await box
      .getByRole("button", { name: "Tải .diff" })
      .or(box.getByRole("link", { name: "Tải .diff" }))
      .click();
    expect((await dl).suggestedFilename()).toBe(DIFF_NAME);
  } finally {
    await s.close();
  }
});

test("HUB-FR-129 · PC2-R03 · E12 · no_changes ⇒ 'Không có thay đổi' + câu", async ({ browser }) => {
  const open = await openRun(
    "EPC2-12",
    applyView({
      status: "no_changes",
      branch: null,
      target_sha: null,
      head_sha: null,
      provider: null,
      pr_number: null,
      pr_url: null,
    }),
  );
  const s = await open(browser);
  try {
    await expect(region(s.p).getByText("Không có thay đổi")).toBeVisible();
    await expect(
      region(s.p).getByText("Bản sửa trùng nguồn nên không có gì để đẩy."),
    ).toBeVisible();
  } finally {
    await s.close();
  }
});

test("PC2-R15 · FC12 · E13 · pr_url không https ⇒ chỉ chữ 'PR #42', KHÔNG có link, không in URL", async ({
  browser,
}) => {
  const open = await openRun("EPC2-13", applyView({ pr_url: "javascript:alert(1)" }));
  const s = await open(browser);
  try {
    const box = region(s.p);
    await expect(box.getByText(/PR #42/)).toBeVisible();
    await expect(box.getByRole("link", { name: /PR #42/ })).toHaveCount(0);
    await expect(s.p.locator('a[href^="javascript:"]')).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("HUB-FR-128 · C7 · C9 · FC13 · E14 · gate tự sửa: apply_mode pr + base main ⇒ 'Đạt sẽ mở PR vào main.'; branch_only ⇒ câu đẩy nhánh; null ⇒ không câu 'Đạt sẽ'", async ({
  browser,
}) => {
  const rm = await mkRoom("EPC2-14");
  const r = await seedPb2Run(rm.id, "a");
  const u = await users(browser, "B");
  try {
    const st = await patchRun(
      u.B,
      r.runId,
      withApply(IDX, undefined, IDX, afView({ apply_mode: "pr", apply_base: "main" })),
    );
    await u.B.goto(`/runs/${r.runId}`);
    await expect(card(u.B).getByText("Đạt sẽ mở PR vào main.")).toBeVisible();
    st.patch = withApply(
      IDX,
      undefined,
      IDX,
      afView({ apply_mode: "branch_only", apply_base: "main" }),
    );
    await u.B.reload();
    await expect(card(u.B).getByText("Đạt sẽ đẩy nhánh lên repo, không mở PR.")).toBeVisible();
    st.patch = withApply(IDX, undefined, IDX, afView({ apply_mode: null, apply_base: null }));
    await u.B.reload();
    await expect(card(u.B).getByRole("region", { name: "Kết quả tự sửa mã" })).toBeVisible();
    await expect(card(u.B).getByText(/^Đạt sẽ/)).toHaveCount(0);
    expect(SHA).toBeTruthy();
  } finally {
    await u.close();
  }
});
