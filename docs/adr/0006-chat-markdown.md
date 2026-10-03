# ADR-0006 · Render markdown + highlight code cho Chat App (C1)

Trạng thái: **Accepted** (Gate C1, 2026-10-04) · Ngày: 2026-10-03 · Tác giả: frontend-lead · Spec: `docs/specs/C1-chat-ui/spec.md` §9 Q3, `plan-frontend.md` §10–11

## Bối cảnh
- `ui-chat-extension.md` §5: câu trả lời stream theo `delta`, render **markdown GFM** (bảng, code có highlight + nút copy, link mở tab mới, danh sách), con trỏ nhấp nháy khi đang stream.
- Ngân sách (spec §6, CONVENTIONS §6, `check:bundle` admin-web): JS ban đầu chat-web ≤ 150 KB gzip; mỗi chunk bất đồng bộ ≤ 50 KB gzip. Stream 500 `delta` không giật.
- Nội dung đến từ AI → coi là **không tin cậy**: không được render HTML thô, chặn `javascript:` URL.
- Stack đã Accepted (ADR-0001): React 18.3.1, Rsbuild 2, Tailwind v4. Chưa có thư viện markdown nào trong repo.

## Lựa chọn

Kích thước: bundlephobia (gzip, bản mới nhất, tra 2026-10-03); "ước" = chưa tra được (bundlephobia trả lỗi/timeout), đo lại bằng `rsbuild build` + `check:bundle` ở BUILD.

| Tiêu chí | A. `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 + `highlight.js` 11.12.0 **core** + ~10 ngôn ngữ tự đăng ký | B. A nhưng highlight bằng `rehype-highlight` 7.0.2 (mặc định spec Q3) | C. `marked` 18.0.14 + `DOMPurify` 3.4.16 + hljs core | D. `markdown-to-jsx` 9.10.3 + hljs core | E. `streamdown` 2.7.0 |
|---|---|---|---|---|---|
| Gzip phần markdown | 34,1 + 9,8 = **43,9 KB** | 43,9 KB | marked ước ≈ 12 KB + DOMPurify 11,1 KB ≈ 23 KB | **28,2 KB** | **153,7 KB** |
| Gzip phần highlight | core ước ≈ 7–8 KB + 10 ngôn ngữ ≈ 15–20 KB, **chunk riêng**, chỉ nạp khi có khối code | kéo `lowlight` + gói `common` (~37 ngôn ngữ) cố định (lowlight đầy đủ 288,7 KB; `common` ước 40–60 KB) → chunk vượt 50 KB | như A | như A | có sẵn (Shiki) |
| Ra React element (không `innerHTML`) | Có | Có | **Không** (`dangerouslySetInnerHTML` + sanitize mỗi khung hình) | Có | Có |
| HTML thô / URL nguy hiểm | Mặc định bỏ HTML thô; `urlTransform` chặn `javascript:` | như A | phụ thuộc cấu hình DOMPurify | phải tắt HTML bằng option, tự lọc URL | có lớp bảo vệ riêng |
| GFM (bảng, task list, autolink, strikethrough) | Đủ, theo spec CommonMark/GFM (micromark) | Đủ | Đủ | Phần lớn, không bám spec chặt | Đủ |
| Tuỳ biến `code`/`a`/`table` bằng component (nút copy, `target=_blank rel=noopener noreferrer`) | `components` prop | như A | Phải dùng event delegation trên HTML | `overrides` | Có |
| Stream (chuỗi chưa đóng ``` `` ```) | Parse lại mỗi khung; plan memo khối đã đóng | như A | Parse lại + sanitize mỗi khung | như A | Thiết kế cho stream |
| Peer React 18 / ESM / Rsbuild | `react >=18` ✓ · ESM ✓ | ✓ | không phụ thuộc React | ✓ | cần React 19? (chưa xác minh) |
| Bảo trì | unified/remark, rất phổ biến | như A | rất phổ biến | 1 tác giả chính | mới, nặng |

## Quyết định đề xuất
**A.** Lý do: an toàn mặc định (không HTML thô, React element), GFM chuẩn, chunk markdown ≈ 44 KB < 50 KB, highlight chỉ trả phí khi câu trả lời có code. B vượt ngân sách chunk vì `rehype-highlight` import tĩnh gói `common` của lowlight; C rẻ hơn ~20 KB nhưng phải đổ HTML vào DOM mỗi khung hình (rủi ro XSS khi cấu hình sai, mất focus/selection, nút copy phải delegation); D nhỏ hơn ~16 KB nhưng bám GFM kém và tự lo lọc URL; E quá nặng.

Phương án dự phòng nếu đo thực tế chunk A > 50 KB: chuyển D (giữ cùng component `Markdown` props `{text, streaming}` nên đổi không lan).

## Cách dùng (ràng buộc khi BUILD)
- `features/answer/components/Markdown.tsx` nạp bằng `React.lazy(() => import(...))`; trong lúc chunk chưa tới hiện chữ thô `whitespace-pre-wrap` (không chặn stream). Prefetch chunk khi trình duyệt rảnh sau đăng nhập.
- `CodeBlock` gọi `lib/highlight.ts` → `import("highlight.js/lib/core")` + đăng ký: `typescript, javascript, json, bash, python, sql, xml, css, yaml, markdown`; ngôn ngữ khác → không tô màu. Không `highlightAuto` (tốn CPU khi stream). Chỉ tô màu khi run xong hoặc khối code đã đóng.
- Không dùng `rehype-raw`; `a` → `target="_blank" rel="noopener noreferrer"`; ảnh markdown: hiện dạng link (C1 không tải ảnh ngoài).
- Theme highlight: CSS tự viết bằng token (`--primary-strong`, `--muted-strong-foreground`…), không nhập CSS theme của highlight.js.
- Ghim phiên bản chính xác trong `apps/chat-web/package.json`; ghi vào bảng ADR-0001 khi cài.

## Hệ quả
- +3 dependency (cùng cây `unified`/`micromark` ~ 30 gói con của react-markdown/remark-gfm).
- `check:bundle` chat-web phải đo cả chunk markdown (≤ 50 KB) — đã có trong script chép từ admin-web.
- Extension sau này dùng lại cùng component (khi tách `packages/ui-chat`).

## Nguồn
- bundlephobia: react-markdown@10.1.0 34 090 B · remark-gfm@4.0.1 9 811 B · markdown-to-jsx@9.10.3 28 161 B · dompurify@3.4.16 11 137 B · streamdown@2.7.0 153 673 B · lowlight@3.3.0 288 674 B (gzip, 2026-10-03).
- npm registry `latest`: marked 18.0.14, highlight.js 11.12.0, rehype-highlight 7.0.2 (bundlephobia không trả số đo cho ba gói này lúc tra).
