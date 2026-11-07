// CR-125 · x9 · đo hình học cạnh trên canvas flow (dùng trong e2e): cạnh không đi dưới node, cạnh rời Ký số bắt đầu ở chấm đầu ra.
import { expect, type Page } from "@playwright/test";

/** CR-125 · x9 · không cạnh nào đi XUYÊN / DƯỚI node: lấy mẫu điểm trên đường của mọi cạnh (mỗi 4px) và đối chiếu hộp mọi node trừ node nguồn / đích của cạnh. */
export async function expectEdgesClear(page: Page, what: string): Promise<void> {
  const under = async (): Promise<string[]> =>
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hàm chạy trong trang (đo hình học), không tách được
    page.evaluate(() => {
      const rects = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => ({
        id: el.getAttribute("data-id") ?? "",
        r: el.getBoundingClientRect(),
      }));
      const out: string[] = [];
      for (const path of document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
        const id = path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "";
        const [s, t] = (id.split("#")[0] ?? "").split(">");
        const m = path.getScreenCTM();
        if (!m) continue;
        const len = path.getTotalLength();
        for (let l = 0; l <= len; l += 4) {
          const pt = path.getPointAtLength(l);
          const x = pt.x * m.a + pt.y * m.c + m.e;
          const y = pt.x * m.b + pt.y * m.d + m.f;
          const hit = rects.find(
            (q) =>
              q.id !== s &&
              q.id !== t &&
              x > q.r.left + 2 &&
              x < q.r.right - 2 &&
              y > q.r.top + 2 &&
              y < q.r.bottom - 2,
          );
          if (hit) {
            out.push(`${id} đi dưới node ${hit.id}`);
            break;
          }
        }
      }
      return out;
    });
  await expect.poll(under, { message: `${what}: cạnh đi xuyên / dưới node` }).toEqual([]);
}
/**
 * CR-125 · x9 · mọi cạnh rời ô Ký số bắt đầu ĐÚNG ở một chấm đầu ra (≤ 4px) theo mép của hướng hiện tại (phải = Ngang, dưới = Dọc),
 * và chấm "Ký xong" (đi tiếp) có cạnh — không còn cạnh rời từ mép trên node rồi đi vòng.
 */
export async function expectExitEdgesAtPills(
  page: Page,
  side: "right" | "bottom",
  what: string,
): Promise<void> {
  const verdict = async (): Promise<string> =>
    page.evaluate((s) => {
      const kyId = document
        .querySelector("[data-testid='module-node']")
        ?.closest(".react-flow__node")
        ?.getAttribute("data-id");
      const pills = [...document.querySelectorAll<HTMLElement>("[data-testid^='module-exit-']")];
      if (!kyId || pills.length === 0) return "không có ô Ký số / chấm đầu ra";
      const anchors = pills.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.dataset.testid ?? "",
          pos: el.getAttribute("data-handlepos"),
          p:
            s === "bottom"
              ? { x: r.x + r.width / 2, y: r.bottom }
              : { x: r.right, y: r.y + r.height / 2 },
        };
      });
      const bad = anchors.find((a) => a.pos !== s);
      if (bad) return `chấm ${bad.name} không ở mép ${s}`;
      const starts = [
        ...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path"),
      ].flatMap((path) => {
        const id = path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "";
        const m = path.getScreenCTM();
        if (!m || !id.startsWith(`${kyId}>`)) return [];
        const pt = path.getPointAtLength(0);
        return [{ id, x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f }];
      });
      const near = (q: { x: number; y: number }) =>
        Math.min(...anchors.map((a) => Math.hypot(q.x - a.p.x, q.y - a.p.y)));
      const off = starts.find((q) => near(q) > 4);
      if (off) return `cạnh ${off.id} bắt đầu cách chấm gần nhất ${near(off).toFixed(1)}px`;
      const main = anchors.find((a) => a.name === "module-exit-done");
      if (main && !starts.some((q) => Math.hypot(q.x - main.p.x, q.y - main.p.y) <= 4))
        return "chấm Ký xong chưa có cạnh";
      return "ok";
    }, side);
  await expect.poll(verdict, { message: `${what}: cạnh phải bắt đầu ở chấm đầu ra` }).toBe("ok");
}

/** CR-125 · x11 · SAU "vừa khung" (mở lần đầu / nút vừa khung): hộp MỌI node nằm trọn trong khung canvas (không node nào — kể cả cột Kết thúc cuối — bị cắt mép). */
export async function expectAllNodesInPane(page: Page, what: string): Promise<void> {
  const verdict = async (): Promise<string> =>
    page.evaluate(() => {
      const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect();
      const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")];
      if (!pane || nodes.length < 2) return "chưa có khung / node";
      const out = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left < pane.left - 1 ||
          r.top < pane.top - 1 ||
          r.right > pane.right + 1 ||
          r.bottom > pane.bottom + 1
        );
      });
      return out ? `node ${out.getAttribute("data-id")} bị cắt khỏi khung` : "ok";
    });
  await expect.poll(verdict, { message: `${what}: mọi node phải nằm trọn trong khung` }).toBe("ok");
}
