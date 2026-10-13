// HUB-FR-115 · WRK-FR-29 · HUB-BR-33 · PC-R06 · PC-R10 · P-c1 · e2e chat-web "Cần người quyết" (test-plan P-c §4 E05–E06, E08–E09;
// plan-frontend §1.3, §3, §5; mockup Pc-Decision): run `needs_decision` (seedRun P-a, stage 0 "Đọc hoá đơn") ⇒ lý do đổi sang
// `autofix_check_failed` / `sandbox_unavailable` bằng SQL (chỉ khi 0031 có) + `autofix.failures` vá qua `page.route`. Chỉ 2 nút
// (Thêm lượt / Huỷ — nhãn sẵn có "Thêm 1 lần làm lại" / "Huỷ lượt chạy"), không "Dùng bản hiện có". Nhóm Bí mật KHÔNG hiện giá trị.
import { expect, type Page, test } from "@playwright/test";
import {
  afView,
  hub,
  mkRoom,
  PC_E2E,
  patchStage,
  pcReady,
  seedRun,
  serveAttachment,
  setDecision,
  settle,
  tok,
  users,
} from "../_pc-support";

test.afterEach(() => settle());

const SECRET = "AKIAQCQCQCQCQCQCQCQC";
const decision = (p: Page) => p.getByRole("region", { name: "Cần người quyết" });
const ADD = "Thêm 1 lần làm lại";
const CANCEL = "Huỷ lượt chạy";
const USE = "Dùng bản hiện có";

async function decisionRun(room: string, reason: "autofix_check_failed" | "sandbox_unavailable") {
  const rm = await mkRoom(room);
  const r = await seedRun(rm.id, "needs_decision");
  const ready = await setDecision(r.runId, reason);
  return { ...r, ready };
}

test("WRK-FR-29 · PC-R10 · E05 · bí mật: heading 'Kiểm bản sửa không đạt' + 'Vòng 1'; nhóm 'Bí mật (không hiện giá trị)' chỉ 'src/cfg.ts:7 · quy tắc aws_key'; KHÔNG lộ giá trị; 2 nút; Thêm lượt ⇒ 200", async ({
  browser,
}) => {
  const r = await decisionRun("EPC-05", "autofix_check_failed");
  const u = await users(browser, "A");
  try {
    await patchStage(
      u.A,
      r.runId,
      0,
      afView({
        status: "check_failed",
        diff_file: null,
        diff_stats: null,
        test: null,
        test_log_file: null,
        failures: [
          {
            check: "secrets",
            path: "src/cfg.ts",
            line: 7,
            rule: "aws_key",
            detail: `khớp ${SECRET}`,
          },
        ],
      }),
    );
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    await expect(d.getByRole("heading", { name: "Kiểm bản sửa không đạt" })).toBeVisible();
    await expect(d.getByText("Chưa lưu diff.", { exact: false })).toBeVisible();
    await expect(d.getByText("Bí mật (không hiện giá trị)")).toBeVisible();
    await expect(d.getByText("src/cfg.ts:7 · quy tắc aws_key")).toBeVisible();
    await expect(u.A.getByText(SECRET)).toHaveCount(0);
    await expect(d.getByRole("button", { name: ADD })).toBeVisible();
    await expect(d.getByRole("button", { name: CANCEL })).toBeVisible();
    await expect(d.getByRole("button", { name: USE })).toHaveCount(0);
    const res = u.A.waitForResponse(
      (x) => x.request().method() === "POST" && x.url().endsWith(`/process-runs/${r.runId}/decide`),
    );
    await d.getByRole("button", { name: ADD }).click();
    expect((await res).status()).toBe(200);
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("WRK-FR-29 · PC-R08(4) · FC5 · E06 · test đỏ: nhóm 'Test đỏ · exit 1 · 3,2 giây' + 30 dòng cuối log (dòng 40 có, dòng 10 không) + 'Tải log đầy đủ'; nhóm Đường dẫn trước nhóm Test", async ({
  browser,
}) => {
  const r = await decisionRun("EPC-06", "autofix_check_failed");
  const u = await users(browser, "A");
  try {
    await patchStage(
      u.A,
      r.runId,
      0,
      afView({
        status: "check_failed",
        diff_file: null,
        diff_stats: null,
        test: { exit_code: 1, duration_ms: 3_200 },
        failures: [
          { check: "tests", detail: "exit 1: 2 failed" },
          { check: "paths", path: ".github/workflows/ci.yml", detail: "đường dẫn cấm" },
        ],
      }),
    );
    const log = Array.from({ length: 40 }, (_, i) => `log dòng ${i + 1}`).join("\n");
    await serveAttachment(u.A, PC_E2E.logAtt, log);
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    const paths = d.getByText("Đường dẫn", { exact: true });
    const tests = d.getByText("Test đỏ · exit 1 · 3,2 giây");
    await expect(paths).toBeVisible();
    await expect(tests).toBeVisible();
    const [yp, yt] = [(await paths.boundingBox())?.y ?? 0, (await tests.boundingBox())?.y ?? 0];
    expect(yp).toBeLessThan(yt);
    await expect(d.getByText("log dòng 40")).toBeVisible();
    await expect(d.getByText("log dòng 10", { exact: true })).toHaveCount(0);
    await expect(
      d
        .getByRole("button", { name: "Tải log đầy đủ" })
        .or(d.getByRole("link", { name: "Tải log đầy đủ" })),
    ).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("HUB-BR-33 · PC-R06 · E08 · sandbox_unavailable ⇒ heading 'Không có môi trường chạy an toàn' + câu hướng dẫn; chỉ 2 nút", async ({
  browser,
}) => {
  const r = await decisionRun("EPC-08", "sandbox_unavailable");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    await expect(
      d.getByRole("heading", { name: "Không có môi trường chạy an toàn" }),
    ).toBeVisible();
    await expect(
      d.getByText("Máy chạy chưa dựng được container cô lập nên không thể tự sửa mã.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(d.getByRole("button", { name: ADD })).toBeVisible();
    await expect(d.getByRole("button", { name: CANCEL })).toBeVisible();
    await expect(d.getByRole("button", { name: USE })).toHaveCount(0);
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("HUB-BR-14 · PC-R14 · E09 · người lạ (S) mở /runs/:id ⇒ 'Không tìm thấy', không có khối tự sửa; Hub GET nội dung diff ⇒ 404", async ({
  browser,
}) => {
  expect(await pcReady()).toBe(true);
  const r = await decisionRun("EPC-09", "autofix_check_failed");
  const u = await users(browser, "S");
  try {
    await patchStage(u.S, r.runId, 0, afView());
    await u.S.goto(`/runs/${r.runId}`);
    await expect(u.S.getByText("Không tìm thấy").first()).toBeVisible();
    await expect(u.S.getByRole("region", { name: "Kết quả tự sửa mã" })).toHaveCount(0);
    expect(
      (await hub(await tok("S"), "GET", `/attachments/${PC_E2E.diffAtt}/content`)).status,
    ).toBe(404);
  } finally {
    await u.close();
  }
});
