// HUB-FR-119 · HUB-FR-128 · HUB-FR-109 · P-c1 · e2e chat-web duyệt diff (test-plan P-c §4 E03–E04, E07, E10–E12; plan-frontend
// §1.2, §3, §5; mockup Pc-Diff): run P-b2 seed (a) — B (Kế toán) mở `/runs/:id`, thẻ "Kiểm Rà soát code" chứa region "Kết quả tự
// sửa mã" (đầu: Vòng k, nguồn@sha7, +i −d, n file, "Test đạt · 12,4 giây"; list "Danh sách file"; nhị phân; "Tải .diff"); Đạt
// gửi thật tới Hub. `autofix` + nội dung diff giả lập bằng `page.route`. Chưa có khối ⇒ đỏ ở locator region.
import { expect, type Page, test } from "@playwright/test";
import {
  afView,
  BIG_DIFF,
  DIFF,
  mkRoom,
  PC_E2E,
  passBtn,
  patchStage,
  seedPb2Run,
  serveAttachment,
  settle,
  users,
  withSql,
} from "../_pc-support";

test.afterEach(() => settle());

const IDX = 1; // "Rà soát code" (seed a: waiting_review, task Kế toán)
const card = (p: Page) => p.getByRole("region", { name: "Kiểm Rà soát code" });
const result = (p: Page) => p.getByRole("region", { name: "Kết quả tự sửa mã" });

async function openGate(o: {
  room: string;
  autofix: Record<string, unknown>;
  diff?: string | number;
}) {
  const room = await mkRoom(o.room);
  const r = await seedPb2Run(room.id, "a");
  return {
    r,
    open: async (p: Page) => {
      await patchStage(p, r.runId, IDX, o.autofix);
      if (o.diff !== undefined) await serveAttachment(p, PC_E2E.diffAtt, o.diff);
      await p.goto(`/runs/${r.runId}`);
    },
  };
}

test("HUB-FR-128 · HUB-FR-109 · E03 · có diff: đầu khối đủ (Vòng 1, pc-repo@a1b2c3d, +3 −1, 3 file, Test đạt · 12,4 giây); 3 file (1 nhị phân); file đầu mở sẵn; Tải .diff đúng tên; Đạt ⇒ 200", async ({
  browser,
}) => {
  const g = await openGate({ room: "EPC-03", autofix: afView(), diff: DIFF });
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    const box = card(u.B).getByRole("region", { name: "Kết quả tự sửa mã" });
    await expect(box.getByText("Tự sửa mã").first()).toBeVisible();
    await expect(box.getByText("Vòng 1")).toBeVisible();
    await expect(box.getByText("pc-repo@a1b2c3d")).toBeVisible();
    await expect(box.getByText("+3")).toBeVisible();
    await expect(box.getByText("−1")).toBeVisible();
    await expect(box.getByText("3 file")).toBeVisible();
    await expect(box.getByText("Test đạt · 12,4 giây")).toBeVisible();
    const files = box.getByRole("list", { name: "Danh sách file" });
    await expect(files.getByRole("listitem")).toHaveCount(3);
    await expect(files.getByText("nhị phân")).toBeVisible();
    await expect(box.getByTestId("autofix-diff-file-0")).toContainText("PC-E2E-MARK sửa dấu");
    const dl = u.B.waitForEvent("download");
    await box
      .getByRole("button", { name: "Tải .diff" })
      .or(box.getByRole("link", { name: "Tải .diff" }))
      .click();
    expect((await dl).suggestedFilename()).toBe("ra-soat-r1.diff.txt");
    const res = u.B.waitForResponse(
      (x) => x.request().method() === "POST" && /\/review-tasks\/.+\/decision/.test(x.url()),
    );
    await passBtn(card(u.B)).click();
    expect((await res).status()).toBe(200);
  } finally {
    await u.close();
  }
});

test("HUB-FR-128 · PC-R11 · E04 · vòng 2 (cộng dồn cùng nhánh) ⇒ 'Vòng 2', tên tải 'ra-soat-r2.diff.txt'", async ({
  browser,
}) => {
  const g = await openGate({
    room: "EPC-04",
    autofix: afView({
      round: 2,
      diff_file: {
        id: PC_E2E.diffAtt,
        name: "ra-soat-r2.diff.txt",
        mime: "text/plain",
        size: 1200,
      },
    }),
    diff: DIFF,
  });
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    await expect(result(u.B).getByText("Vòng 2")).toBeVisible();
    const dl = u.B.waitForEvent("download");
    await result(u.B)
      .getByRole("button", { name: "Tải .diff" })
      .or(result(u.B).getByRole("link", { name: "Tải .diff" }))
      .click();
    expect((await dl).suggestedFilename()).toBe("ra-soat-r2.diff.txt");
  } finally {
    await u.close();
  }
});

test("HUB-FR-128 · PC-R09 · E07 · no_changes ⇒ 'Không có thay đổi' + hướng dẫn; không danh sách file; nút Đạt vẫn có", async ({
  browser,
}) => {
  const g = await openGate({
    room: "EPC-07",
    autofix: afView({ status: "no_changes", diff_file: null, diff_stats: null }),
  });
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    await expect(result(u.B).getByText("Không có thay đổi", { exact: true })).toBeVisible();
    await expect(
      result(u.B).getByText("Agent không sửa file nào, hoặc bản sửa trùng nguồn.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(result(u.B).getByRole("list", { name: "Danh sách file" })).toHaveCount(0);
    await expect(passBtn(card(u.B))).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-128 · FC3 · E10 · diff 2.600 dòng ⇒ cảnh báo 'Diff lớn: chỉ hiển thị 2.000 dòng đầu, còn … dòng.'", async ({
  browser,
}) => {
  const g = await openGate({
    room: "EPC-10",
    autofix: afView({
      diff_stats: { files: 1, insertions: 2596, deletions: 0, bytes: BIG_DIFF.length },
    }),
    diff: BIG_DIFF,
  });
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    await expect(
      result(u.B).getByText(
        /^Diff lớn: chỉ hiển thị 2\.000 dòng đầu, còn 60[01] dòng\. Tải \.diff để xem đủ\.$/,
      ),
    ).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-128 · E11 · tải diff lỗi (500) ⇒ alert 'Không tải được diff' + 'Thử lại'; Thử lại sau khi phục hồi ⇒ hiện danh sách", async ({
  browser,
}) => {
  const g = await openGate({ room: "EPC-11", autofix: afView(), diff: 500 });
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    const err = result(u.B).getByRole("alert").filter({ hasText: "Không tải được diff" });
    await expect(err).toBeVisible();
    await u.B.unroute(new RegExp(`/attachments/${PC_E2E.diffAtt}/content(\\?.*)?$`));
    await serveAttachment(u.B, PC_E2E.diffAtt, DIFF);
    await result(u.B).getByRole("button", { name: "Thử lại" }).click();
    await expect(result(u.B).getByRole("list", { name: "Danh sách file" })).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-128 · E12 · EN: 'Autofix result' region, 'Round 1', 'Tests passed · 12.4 s', '3 files'", async ({
  browser,
}) => {
  const g = await openGate({ room: "EPC-12", autofix: afView(), diff: DIFF });
  await withSql((sql) => sql`update admin.users set locale = 'en' where username = 'hoa'`);
  const u = await users(browser, "B");
  try {
    await g.open(u.B);
    const box = u.B.getByRole("region", { name: "Autofix result" });
    await expect(box.getByText("Round 1")).toBeVisible();
    await expect(box.getByText("Tests passed · 12.4 s")).toBeVisible();
    await expect(box.getByText("3 files")).toBeVisible();
  } finally {
    await u.close();
    await withSql((sql) => sql`update admin.users set locale = 'vi' where username = 'hoa'`);
  }
});

test("HUB-FR-128 · plan-frontend §1.3 · E13 · thẻ quy trình trong thread phòng: 'Tự sửa mã' + 'Vòng 1' + 'Test đạt' + nút 'Xem diff'", async ({
  browser,
}) => {
  const room = await mkRoom("EPC-13");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A");
  try {
    await patchStage(u.A, r.runId, IDX, afView());
    await u.A.goto(`/rooms/${room.id}`);
    const blockCard = u.A.getByRole("article").filter({ hasText: "Tự sửa mã" }).first();
    await expect(blockCard).toBeVisible();
    await expect(blockCard.getByText("Vòng 1")).toBeVisible();
    await expect(
      blockCard
        .getByRole("button", { name: "Xem diff" })
        .or(blockCard.getByRole("link", { name: "Xem diff" })),
    ).toBeVisible();
  } finally {
    await u.close();
  }
});
