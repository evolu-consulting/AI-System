// PK-FR-05 · PK-AC06 · PK-FR-10 · TF4 · PackGate (render tĩnh, i18n thật): đang tải, lỗi + "Thử lại", trang PACK_FORBIDDEN /
// PACK_DISABLED (VI + EN nguyên văn plan-frontend §7), quyền đủ ⇒ nội dung.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import type { PackView } from "../lib/pack-state";
import { PackGate } from "./PackGate";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const gate = (status: "loading" | "error" | "ready", view: PackView | null, errorKey?: string) =>
  renderToStaticMarkup(
    <PackGate
      status={status}
      view={view}
      errorKey={errorKey ?? null}
      onRetry={() => {}}
      onLogout={() => {}}
    >
      <nav>NOI-DUNG</nav>
    </PackGate>,
  );

describe("PackGate", () => {
  test("PK-FR-10 · đang tải ⇒ status 'Đang tải…', chưa hiện nội dung", () => {
    const out = gate("loading", null);
    expect(out).toContain('role="status" aria-label="Đang tải…"');
    expect(out).not.toContain("NOI-DUNG");
  });
  test("PK-FR-10 · lỗi mạng ⇒ alert + nút Thử lại", () => {
    const out = gate("error", null, "contracts.errors.network");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Không kết nối được máy chủ");
    expect(out).toContain(">Thử lại</button>");
    expect(out).not.toContain("NOI-DUNG");
  });
  test("PK-FR-05 · PACK_FORBIDDEN ⇒ heading riêng, không nội dung", () => {
    const out = gate("ready", { kind: "forbidden" });
    expect(out).toContain("<h1");
    expect(out).toContain("Bạn chưa có quyền dùng gói Hợp đồng");
    expect(out).not.toContain("NOI-DUNG");
  });
  test("PK-AC06 · PACK_DISABLED ⇒ heading riêng", () => {
    const out = gate("ready", { kind: "disabled" });
    expect(out).toContain("Gói Hợp đồng chưa được bật cho công ty bạn");
    expect(out).not.toContain("Bạn chưa có quyền");
  });
  test("PK-FR-05 · quyền đủ ⇒ nội dung", () => {
    expect(gate("ready", { kind: "ok", write: false, owner: false })).toBe("<nav>NOI-DUNG</nav>");
  });
  test("PK-FR-05 · EN nguyên văn", async () => {
    await i18n.changeLanguage("en");
    expect(gate("ready", { kind: "forbidden" })).toContain(
      "You don&#x27;t have access to the Contracts pack",
    );
    expect(gate("ready", { kind: "disabled" })).toContain(
      "The Contracts pack isn&#x27;t enabled for your company",
    );
    await i18n.changeLanguage("vi");
  });
});
