// CR-181 · in chữ ký lên PDF ở máy chủ (decisions §2 Q11/Q13/Q16/Q18, §4; BR-L3).
// `pdf-lib` + `@pdf-lib/fontkit` (Be Vietnam Pro cho dòng chữ dưới) + `@napi-rs/canvas` (đổi nét đen → màu mực, ADR-0041).
// Mỗi ảnh (theo nội dung) tô màu + embed MỘT lần; mỗi trang đặt qua ma trận hiển thị → gốc nên /Rotate, CropBox lệch gốc đều đúng.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SIGN_DOC_PAGES_MAX, type SignPart } from "@ai/contracts/pack-contracts";
import {
  pngDimensions,
  SIGNATURE_PNG_MAX_HEIGHT,
  SIGNATURE_PNG_MAX_WIDTH,
} from "@ai/contracts/signature";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fontkit from "@pdf-lib/fontkit";
import {
  clip,
  concatTransformationMatrix,
  EncryptedPDFError,
  endPath,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";
import { SignError } from "../domain/sign-error";
import { displayToUser, type PageView, resolveParts } from "../domain/sign-geometry";

const FONT_URL = new URL("./fonts/BeVietnamPro-Regular.ttf", import.meta.url);
const CAPTION_SIZE = 7.5;
/** Co chữ cho vừa bề ngang khung chỗ ký, không nhỏ hơn mức này (dưới nữa thì cắt «…»). */
const CAPTION_MIN_SIZE = 5;
const LINE_GAP = 1.5;
const MIN_TEXT_Y = 4;
const INK = {
  blue: { hex: "#1f3a8a", rgb: [0.12, 0.23, 0.54] },
  black: { hex: "#1a1a1a", rgb: [0.1, 0.1, 0.1] },
} as const;

export type Ink = keyof typeof INK;
/** `caption` = dòng dưới chữ ký (Họ tên · Chức vụ · Phòng ban); `signedOn` = «Ký ngày dd/mm/yyyy hh:mm» (BR-188-2, luôn có từ use case). Chỉ in khi chữ ký nằm gọn một trang. */
export type StampMark = {
  png: Uint8Array;
  parts: readonly SignPart[];
  caption?: string;
  signedOn?: string;
};
export type StampInput = { pdf: Uint8Array; marks: readonly StampMark[]; ink: Ink };
export type StampResult = { bytes: Uint8Array; sha256: string; pages: number };

export const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Nét đen nền trong ⇒ cùng nét màu mực (`source-in`: chỉ tô nơi đã có nét, giữ độ trong suốt). */
export async function tint(png: Uint8Array, hex: string): Promise<Uint8Array> {
  // Kiểm kích thước khai trong IHDR TRƯỚC khi giải mã/cấp canvas (PNG nhỏ khai 20000×20000 ⇒ canvas cỡ GB).
  const dim = pngDimensions(png);
  if (!dim) throw new SignError("SIGN_IMAGE_INVALID");
  if (dim.width > SIGNATURE_PNG_MAX_WIDTH || dim.height > SIGNATURE_PNG_MAX_HEIGHT)
    throw new SignError("SIGN_IMAGE_TOO_LARGE", `${dim.width}x${dim.height}`);
  let img: Awaited<ReturnType<typeof loadImage>>;
  try {
    img = await loadImage(Buffer.from(png));
  } catch {
    throw new SignError("SIGN_IMAGE_INVALID");
  }
  const cv = createCanvas(img.width, img.height);
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = hex;
  g.fillRect(0, 0, img.width, img.height);
  return cv.toBuffer("image/png");
}

function pageView(p: PDFPage): PageView {
  const m = p.getMediaBox();
  const c = p.getCropBox();
  const x0 = Math.max(m.x, c.x);
  const y0 = Math.max(m.y, c.y);
  const x1 = Math.min(m.x + m.width, c.x + c.width);
  const y1 = Math.min(m.y + m.height, c.y + c.height);
  const ok = x1 > x0 && y1 > y0;
  const box = ok ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : m;
  return { ...box, rotate: p.getRotation().angle };
}

async function loadPdf(pdf: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    // pdf-lib biên dịch ES5 nên `instanceof` có thể sai ⇒ nhận diện thêm theo thông điệp.
    if (e instanceof EncryptedPDFError || (e instanceof Error && /is encrypted/.test(e.message)))
      throw new SignError("SIGN_PDF_ENCRYPTED");
    throw new SignError("SIGN_PDF_INVALID");
  }
  if (doc.getPageCount() > SIGN_DOC_PAGES_MAX)
    throw new SignError("SIGN_TOO_MANY_PAGES", `${doc.getPageCount()} > ${SIGN_DOC_PAGES_MAX}`);
  return doc;
}

/** Bọc nội dung cũ trong q…Q (API công khai của pdf-lib) để CTM/trạng thái đồ hoạ của tệp gốc không ảnh hưởng dấu mới. */
const isolate = (page: PDFPage): void => page.translateContent(0, 0);

type Ctx = { pages: PDFPage[]; views: PageView[]; ink: (typeof INK)[Ink]; isolated: Set<number> };

/** Vẽ một phần (clip + ảnh vừa khung giữ tỉ lệ + dòng chữ dưới nếu một phần) lên đúng trang. */
function drawPart(
  c: Ctx,
  img: PDFImage,
  q: ReturnType<typeof resolveParts>[number],
  lines: { texts: readonly string[]; font: PDFFont } | undefined,
): void {
  const page = c.pages[q.page] as PDFPage;
  if (!c.isolated.has(q.page)) {
    isolate(page);
    c.isolated.add(q.page);
  }
  const k = Math.min(q.frame.w / img.width, q.frame.h / img.height);
  const w = img.width * k;
  const h = img.height * k;
  const [a, b, cc, d, e, f] = displayToUser(c.views[q.page] as PageView);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(a, b, cc, d, e, f),
    pushGraphicsState(),
    rectangle(q.clip.x, q.clip.y, q.clip.w, q.clip.h),
    clip(),
    endPath(),
  );
  page.drawImage(img, {
    x: q.frame.x + (q.frame.w - w) / 2,
    y: q.frame.y + (q.frame.h - h) / 2,
    width: w,
    height: h,
  });
  page.pushOperators(popGraphicsState());
  if (lines) {
    const fit = lines.texts.map((t) => fitLine(lines.font, t, q.frame.w));
    const { from, ys } = layoutLines(
      q.frame.y,
      fit.map((f) => f.size),
    );
    ys.forEach((y, i) => {
      const f = fit[from + i] as { text: string; size: number };
      page.drawText(f.text, {
        x: q.frame.x,
        y,
        size: f.size,
        font: lines.font,
        color: rgb(c.ink.rgb[0], c.ink.rgb[1], c.ink.rgb[2]),
      });
    });
  }
  page.pushOperators(popGraphicsState());
}

/** Dòng chữ nào đặt ở đâu dưới khung (y tăng lên trên): không dòng nào thấp hơn MIN_TEXT_Y, các dòng không đè nhau.
 *  Thiếu chỗ ⇒ bỏ dòng ĐẦU (caption) và giữ dòng CUỐI («Ký ngày …»); dòng cuối còn lại kẹp sát đáy. */
export function layoutLines(
  frameY: number,
  sizes: readonly number[],
): { from: number; ys: number[] } {
  const place = (from: number) => {
    const ys: number[] = [];
    let y = frameY - 9;
    for (const sz of sizes.slice(from)) {
      ys.push(y);
      y -= sz + LINE_GAP;
    }
    return ys;
  };
  for (let from = 0; from < sizes.length - 1; from++) {
    const ys = place(from);
    if ((ys.at(-1) as number) >= MIN_TEXT_Y) return { from, ys };
  }
  const from = Math.max(0, sizes.length - 1);
  return { from, ys: place(from).map((y) => Math.max(MIN_TEXT_Y, y)) };
}

/** Một dòng chữ vừa khung: co cỡ chữ tới CAPTION_MIN_SIZE, vẫn dài hơn thì cắt bớt và thêm «…». */
export function fitLine(
  font: Pick<PDFFont, "widthOfTextAtSize">,
  text: string,
  maxWidth: number,
): { text: string; size: number } {
  const w = font.widthOfTextAtSize(text, CAPTION_SIZE);
  if (w <= maxWidth) return { text, size: CAPTION_SIZE };
  const size = Math.max(CAPTION_MIN_SIZE, (CAPTION_SIZE * maxWidth) / w);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size };
}

async function loadCaptionFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(readFileSync(FONT_URL), { subset: true });
}

export async function stampPdf(i: StampInput): Promise<StampResult> {
  const doc = await loadPdf(i.pdf);
  const pages = doc.getPages();
  const views = pages.map(pageView);
  // Kiểm toàn bộ hình học TRƯỚC khi tô màu / embed (lỗi ⇒ không tốn công).
  const plans = i.marks.map((m) => ({ m, parts: resolveParts(m.parts, views) }));
  const c: Ctx = { pages, views, ink: INK[i.ink], isolated: new Set() };
  const images = new Map<string, PDFImage>();
  let font: PDFFont | undefined;

  for (const { m, parts } of plans) {
    const key = sha256Hex(m.png);
    let img = images.get(key);
    if (!img) {
      img = await doc.embedPng(await tint(m.png, c.ink.hex));
      images.set(key, img);
    }
    // Dòng chữ dưới khung: dấu một phần ⇒ dưới phần đó; dấu nhiều phần (giáp lai/xoè quạt) ⇒ chỉ dưới PHẦN CUỐI (BR-188-2: «Ký ngày …» luôn in).
    const texts = [m.caption, m.signedOn].flatMap((x) => (x ? [x] : []));
    if (texts.length > 0) font ??= await loadCaptionFont(doc);
    for (const [i, q] of parts.entries()) {
      const last = i === parts.length - 1 && texts.length > 0 && font;
      drawPart(c, img, q, last ? { texts, font } : undefined);
    }
  }
  const bytes = await doc.save();
  return { bytes, sha256: sha256Hex(bytes), pages: pages.length };
}
