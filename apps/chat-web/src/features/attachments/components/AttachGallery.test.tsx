// CR-164 · bộ hiển thị chung `@ai/web-kit` (test đặt ở chat-web vì web-kit chưa có react-dom): AttachGallery / AttachDraftList.
import { describe, expect, test } from "bun:test";
import type { AttachLabels } from "@ai/web-kit/attach-layout";
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { AttachGallery } from "@ai/web-kit/ui/AttachGallery";
import { renderToStaticMarkup } from "react-dom/server";

const labels: AttachLabels = {
  openImage: (n) => `Phóng to ${n}`,
  prev: "Trước",
  next: "Sau",
  close: "Đóng",
  download: "Tải về",
  downloadOf: (n) => `Tải về ${n}`,
  view: "Xem",
  failed: "Lỗi",
  uploading: "Đang tải lên",
  retry: "Thử lại",
  remove: (n) => `Bỏ ${n}`,
  unavailable: "Không còn",
};
const img = (i: number) => ({ id: `i${i}`, name: `a${i}.png`, mime: "image/png" });
const gallery = (items: Parameters<typeof AttachGallery>[0]["items"]) =>
  renderToStaticMarkup(
    <AttachGallery items={items} getUrl={async () => "x"} onDownload={() => {}} labels={labels} />,
  );

describe("AttachGallery", () => {
  test.each([
    [1, "one"],
    [2, "two"],
    [3, "three"],
    [4, "four"],
  ] as const)("%d ảnh ⇒ bố cục %s, không «+N»", (n, layout) => {
    const h = gallery(Array.from({ length: n }, (_, i) => img(i)));
    expect(h).toContain(`data-layout="${layout}"`);
    expect(h.match(/data-testid="post-image"/g)?.length).toBe(n);
    expect(h).not.toContain("image-more");
  });
  test("7 ảnh ⇒ 4 ô, ô cuối «+3»", () => {
    const h = gallery(Array.from({ length: 7 }, (_, i) => img(i)));
    expect(h.match(/data-testid="post-image"/g)?.length).toBe(4);
    expect(h).toContain("+3");
  });
  test("ảnh + tệp lẫn: lưới + thẻ; PDF có «Xem»; tên dài cắt giữa; tệp hỏng xám không nút tải", () => {
    const h = gallery([
      img(1),
      {
        id: "p",
        name: "bao-cao-tai-chinh-quy-3-nam-2026-ban-cuoi-cung.pdf",
        mime: "application/pdf",
        size: 2048,
      },
      { id: "t", name: "cu.txt", mime: "text/plain", disabled: true },
    ]);
    expect(h).toContain("image-grid");
    expect(h.match(/data-testid="file-card"/g)?.length).toBe(2);
    expect(h.match(/data-testid="file-view"/g)?.length).toBe(1);
    expect(h.match(/data-testid="file-download"/g)?.length).toBe(1);
    expect(h).toContain("2 KB");
    expect(h).toContain("…");
    expect(h).toContain('aria-disabled="true"');
  });
  test("không mục ⇒ không vẽ gì", () => expect(gallery([])).toBe(""));
});

describe("AttachDraftList", () => {
  const html = (items: Parameters<typeof AttachDraftList>[0]["items"]) =>
    renderToStaticMarkup(<AttachDraftList items={items} labels={labels} onRemove={() => {}} />);
  test("ảnh ⇒ ô thu nhỏ, tệp ⇒ thẻ; mỗi mục có nút bỏ; đang tải ⇒ thanh tiến trình", () => {
    const h = html([
      { ...img(1), status: "uploading" },
      { id: "f", name: "a.pdf", mime: "application/pdf", size: 10, status: "uploading" },
      { id: "g", name: "b.pdf", mime: "application/pdf", size: 10, status: "ready" },
    ]);
    expect(h).toContain("draft-image");
    expect(h.match(/data-testid="draft-file"/g)?.length).toBe(2);
    expect(h.match(/data-testid="draft-remove"/g)?.length).toBe(3);
    expect(h.match(/role="progressbar"/g)?.length).toBe(2);
    expect(h).toContain('aria-label="Bỏ a.pdf"');
  });
  test("lỗi ⇒ hiện câu lỗi + Thử lại khi retryable", () => {
    const h = renderToStaticMarkup(
      <AttachDraftList
        items={[
          {
            id: "e",
            name: "x.exe",
            mime: "",
            status: "error",
            errorText: "Loại không hỗ trợ",
            retryable: true,
          },
        ]}
        labels={labels}
        onRemove={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(h).toContain("Loại không hỗ trợ");
    expect(h).toContain("Thử lại");
  });
});
