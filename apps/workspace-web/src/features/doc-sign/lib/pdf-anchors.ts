// CR-181 · s12 · đọc chữ từng trang bằng pdf.js `getTextContent`, đổi toạ độ trang xoay, rồi `findAnchors`.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type Anchors, findAnchors, type PageText } from "./anchors";
import { rotatePoint } from "./session-map";

export async function readAnchors(doc: PDFDocumentProxy): Promise<Anchors> {
  const pages: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const [x0, y0, x1, y1] = pg.view;
    const w = (x1 ?? 0) - (x0 ?? 0);
    const h = (y1 ?? 0) - (y0 ?? 0);
    const rot = pg.rotate ?? 0;
    const tc = await pg.getTextContent();
    const items = tc.items.flatMap((it) => {
      if (!("str" in it)) return [];
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = it.transform;
      const [rx, ry] = rotatePoint(e - (x0 ?? 0), f - (y0 ?? 0), rot, w, h);
      return [{ str: it.str, transform: [a, b, c, d, rx, ry] }];
    });
    pages.push({ page: n - 1, items });
  }
  return findAnchors(pages);
}
