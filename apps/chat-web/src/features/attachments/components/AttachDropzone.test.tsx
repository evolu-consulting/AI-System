// CR-173 · bộ chọn tệp chung `@ai/web-kit` (test đặt ở chat-web vì web-kit chưa có react-dom): vùng kéo-thả, nút gọn, thẻ tệp mới.
import { describe, expect, test } from "bun:test";
import type { AttachLabels, AttachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { AttachDropzone, AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { renderToStaticMarkup } from "react-dom/server";

const pick: AttachPickLabels = {
  drop: "Kéo thả tệp vào đây hoặc",
  choose: "Chọn tệp",
  dropActive: "Thả tệp để đính kèm",
  image: "ảnh",
  attach: "Đính kèm tệp",
  hint: (types, size) => `Hỗ trợ ${types} · tối đa ${size} mỗi tệp`,
  tooBig: (n, m) => `${n} quá ${m}`,
  badType: (n) => `${n} sai loại`,
  tooMany: (m) => `tối đa ${m} tệp`,
};
const labels: AttachLabels = {
  openImage: (n) => n,
  prev: "",
  next: "",
  close: "",
  download: "",
  downloadOf: (n) => n,
  view: "",
  failed: "Lỗi",
  uploading: "Đang tải lên",
  retry: "Thử lại",
  remove: (n) => `Bỏ ${n}`,
  unavailable: "",
};
const zone = (p: Partial<Parameters<typeof AttachDropzone>[0]> = {}) =>
  renderToStaticMarkup(<AttachDropzone labels={pick} onFiles={() => {}} {...p} />);

describe("AttachDropzone", () => {
  test("vùng nét đứt: câu «Kéo thả… Chọn tệp», gợi ý loại + dung lượng, ô tệp ẩn đúng accept", () => {
    const h = zone({ accept: ".pdf,.docx", maxBytes: 20 * 1024 * 1024, inputTestId: "in" });
    expect(h).toContain('data-testid="attach-dropzone"');
    expect(h).toContain("dashed");
    expect(h).toContain("Kéo thả tệp vào đây hoặc");
    expect(h).toContain(">Chọn tệp</button>");
    expect(h).toContain("Hỗ trợ PDF, DOCX · tối đa 20 MB mỗi tệp");
    expect(h).toContain('type="file"');
    expect(h).toContain('accept=".pdf,.docx"');
    expect(h).toContain('data-testid="in"');
  });
  test("một tệp ⇒ không `multiple`; nhiều tệp ⇒ có", () => {
    expect(zone({ multiple: false })).not.toContain("multiple");
    expect(zone()).toContain("multiple");
  });
  test("đang tải / khoá ⇒ nút Chọn tệp bị khoá; lỗi từ app hiện tại chỗ (role=alert)", () => {
    const h = zone({ busy: true, error: "Máy chủ từ chối" });
    expect(h).toContain("disabled");
    expect(h).toContain('role="alert"');
    expect(h).toContain("Máy chủ từ chối");
  });
  test("bản gọn một hàng", () =>
    expect(zone({ variant: "compact" })).toContain('data-variant="compact"'));
  test("nút gọn: icon kẹp giấy có tên + chú thích, ô tệp ẩn", () => {
    const h = renderToStaticMarkup(
      <AttachPickButton
        labels={pick}
        onFiles={() => {}}
        inputTestId="f"
        check={false}
        accept=".pdf"
      />,
    );
    expect(h).toContain('aria-label="Đính kèm tệp"');
    expect(h).toContain('title="Đính kèm tệp"');
    expect(h).toContain('data-testid="f"');
    expect(h).toContain("lucide-paperclip");
  });
});

describe("thẻ tệp đã chọn (CR-173)", () => {
  const html = (items: Parameters<typeof AttachDraftList>[0]["items"], extra = {}) =>
    renderToStaticMarkup(
      <AttachDraftList items={items} labels={labels} onRemove={() => {}} {...extra} />,
    );
  test("biểu tượng theo loại, tên cắt giữa, đuôi + dung lượng, ✕ có tên", () => {
    const h = html([
      {
        id: "a",
        name: "bao-cao-tai-chinh-quy-3-nam-2026-ban-cuoi-cung.pdf",
        mime: "application/pdf",
        size: 1536,
        status: "ready",
      },
      { id: "b", name: "ds.xlsx", mime: "", size: 2048, status: "ready" },
    ]);
    expect(h).toContain('data-kind="pdf"');
    expect(h).toContain('data-kind="sheet"');
    expect(h).toContain("PDF · 1,5 KB");
    expect(h).toContain("…");
    expect(h).toContain('aria-label="Bỏ ds.xlsx"');
  });
  test("lỗi tại chỗ trên thẻ; đang tải có thanh tiến trình; testid giữ được", () => {
    const h = html(
      [
        {
          id: "e",
          name: "x.pdf",
          mime: "application/pdf",
          status: "error",
          errorText: "Quá 20 MB",
        },
        {
          id: "u",
          name: "y.pdf",
          mime: "application/pdf",
          size: 10,
          status: "uploading",
          progress: 0.4,
        },
      ],
      { itemTestId: "file-item", layout: "stack" },
    );
    expect(h).toContain("Quá 20 MB");
    expect(h).toContain('data-testid="draft-file-error"');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="40"');
    expect(h.match(/data-testid="file-item"/g)?.length).toBe(2);
  });
});
