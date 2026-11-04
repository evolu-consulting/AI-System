// CR-118 · COM-FR-37 · loại media theo MIME và dung lượng hiển thị.
import { describe, expect, it } from "bun:test";
import { attachFiles, attachKindOf, formatSize } from "./media";

describe("attachKindOf", () => {
  it("image video và tệp khác theo MIME", () => {
    expect(attachKindOf("image/png")).toBe("image");
    expect(attachKindOf("video/mp4")).toBe("video");
    expect(attachKindOf("application/pdf")).toBe("file");
    expect(attachKindOf("")).toBe("file");
  });
});

describe("formatSize", () => {
  it("đổi đơn vị B KB MB", () => {
    expect(formatSize(512, "en-US")).toBe("512 B");
    expect(formatSize(1536, "en-US")).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024, "en-US")).toBe("5 MB");
  });
});

describe("attachFiles", () => {
  it("ảnh và video được thêm, PDF ghi chú chưa hỗ trợ, quá hạn mức ghi chú tối đa", () => {
    const r = attachFiles(
      [],
      [
        { name: "a.png", type: "image/png" },
        { name: "b.pdf", type: "application/pdf" },
      ],
      1,
    );
    expect(r.media.map((m) => m.label)).toEqual(["a.png"]);
    expect(r.notices).toEqual(["fileUnsupported"]);
    const vids = attachFiles(
      [],
      Array.from({ length: 3 }, (_, i) => ({ name: `v${i}.mp4`, type: "video/mp4" })),
      1,
    );
    expect(vids.media.length).toBe(2);
    expect(vids.notices).toEqual(["maxVideos"]);
  });
});
