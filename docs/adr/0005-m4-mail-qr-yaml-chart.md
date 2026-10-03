# ADR-0005 · Thư viện M4: gửi mail (nodemailer), QR (qrcode), YAML (yaml), TOTP tự viết, biểu đồ (không recharts ở Admin)

Trạng thái: **Accepted** (người dùng duyệt 2026-10-03, trước Gate M4) · Ngày: 2026-10-03 · Tác giả: backend-lead · Spec: [M4-ops](../specs/M4-ops/spec.md) §9 Q3 (spec ghi "ADR-0004"; số 0004 đã dùng cho thư viện web M1) · Plan: [plan-cd §1, §9–10](../specs/M4-ops/plan-cd.md)

## Bối cảnh
- M4 cần: email cảnh báo quota (FR-41, R05) tới Mailpit ở dev (ADR-0001 đã chọn Mailpit); QR để bật 2FA (FR-08); đọc/ghi yaml cho Import/Export (FR-54); biểu đồ theo ngày ở màn Chi phí (FR-42).
- ADR-0001 đã Accepted "shadcn chart (Recharts)" theo `ui-operations §7` (giao diện Ops), chưa có số đo bundle cho Admin. Ngân sách: JS ban đầu < 250 KB gzip (CONVENTIONS §6), chunk route ≤ 50 KB gzip (M0 §6, ADR-0004).
- Chạy trên Bun 1.3.14 (`apps/admin-api`); mọi số kích thước gzip lấy từ bundlephobia API, 2026-10-03; phiên bản từ `npm view`, 2026-10-03.

## 1. Gửi mail (server)
| Tiêu chí | **`nodemailer` 10.0.13** | Tự viết SMTP trên `Bun.connect` | Mailpit HTTP API trực tiếp |
|---|---|---|---|
| Dependency | 0 (types: `@types/nodemailer` 8.0.2) | 0 | 0 |
| STARTTLS/SMTPS, auth, MIME UTF-8, chống header injection | Có sẵn | Phải tự làm (~300 dòng + test) | Không phải SMTP: production không dùng được |
| Tương thích | `engines.node >= 20`; dùng `net`/`tls`/`dns`, Bun hỗ trợ — **kiểm bằng int test với Mailpit ở task TM** | Bun-only | — |
| Bảo trì | Gói phổ biến nhất mảng này, bản phát hành 2026-09-30 | Dự án tự giữ | — |
| Rủi ro | Major thay đổi thường xuyên → ghim chính xác | Lỗi giao thức/TLS | Khoá cứng vào Mailpit |

## 2. QR cho 2FA
| Tiêu chí | **`qrcode` 1.5.4 ở server** (SVG → data URL) | `qrcode` / `uqr` ở client | `uqr` 0.1.3 ở server |
|---|---|---|---|
| Bundle web | **0** | +8,8 KB (`qrcode`) / +4,4 KB (`uqr`) gzip | 0 |
| Dependency | 3 (`dijkstrajs`, `pngjs`, `yargs` — 2 cái sau chỉ cho CLI/PNG, không chạy ở đường SVG) | — | 0 |
| Độ chín | 1.x ổn định nhiều năm, `@types/qrcode` 1.5.6 | — | 0.x, pre-1.0 |
| Bảo mật | Secret đã trả cho client để nhập tay → sinh QR ở server không làm lộ thêm; response `Cache-Control: no-store`, không log | như trái | như trái |

## 3. YAML (Import/Export, server)
| Tiêu chí | **`yaml` 2.9.1** | `Bun.YAML` (có sẵn) | `js-yaml` 5.4.2 |
|---|---|---|---|
| Kích thước | 31 KB gzip, 0 dependency — chỉ server | 0 | nhỏ, 1 dependency |
| Chống "billion laughs" | `maxAliasCount` (đặt `0` = cấm alias) | **Không**: đo tại máy, 9 tầng alias → `Out of memory` | alias là tham chiếu chung; duyệt sâu (zod) vẫn nở |
| Khoá trùng, vị trí lỗi | `uniqueKeys`, `prettyErrors` có line/col | lỗi ít chi tiết | có line |
| Stringify ổn định | `sortMapEntries`, `lineWidth: 0` | `Bun.YAML.stringify` cơ bản | có |

## 4. TOTP (server)
| Tiêu chí | **Tự viết RFC 6238/4226 bằng `node:crypto`** (~80 dòng) | `otplib` / `otpauth` |
|---|---|---|
| Dependency | 0 | 1–3 gói |
| Kiểm chứng | Vector RFC 6238 phụ lục B trong unit test; so bằng `timingSafeEqual` | Có test sẵn |
| Kiểm soát | Cửa sổ ±1, chống dùng lại `last_used_step`, base32 — đúng như spec cần | API rộng hơn cần |

## 5. Biểu đồ (web, khối A) — `plan-frontend.md` D1 đã chọn SVG tự vẽ (`DailyBars`)
| Tiêu chí | `recharts` 3.10.1 (shadcn chart) | **SVG tự vẽ** (cột theo ngày ≤ 31, tooltip, vân chéo `overage`) | `uPlot` |
|---|---|---|---|
| gzip | **151,5 KB** (11 dependency: d3-*, redux toolkit, immer…) | ≈ 2–3 KB | ≈ 20 KB, canvas |
| Ngân sách chunk route 50 KB | **Vượt ~3 lần** dù nạp lười | Đạt | Đạt |
| A11y | có `accessibilityLayer` | tự làm: `role="img"` + bảng số liệu ẩn | canvas, kém |
| Ghi chú | ADR-0001 Accepted cho Ops UI | Đủ cho 1 biểu đồ cột duy nhất của Admin | Thêm phụ thuộc mới |

## Quyết định
0. QR sinh ở server, trả `qr_svg` cùng `otpauth_url` (đây là "phương án B" của plan-frontend D2, chọn làm mặc định) → `admin-web` không cần gói `qrcode`.
1. `apps/admin-api` thêm (ghim chính xác): `nodemailer@10.0.13`, `qrcode@1.5.4`, `yaml@2.9.1`; dev: `@types/nodemailer@8.0.2`, `@types/qrcode@1.5.6`. Không thêm gì cho TOTP (`node:crypto`).
2. YAML luôn parse với `{maxAliasCount: 0, uniqueKeys: true, schema: "core"}`, sau khi kiểm `content` ≤ 1 MiB.
3. Mailer đi qua interface `Mailer.send` (`lib/mailer`), không module nào import `nodemailer` trực tiếp → đổi nhà cung cấp chỉ sửa một file.
4. Biểu đồ Admin: SVG tự vẽ (thống nhất plan-frontend D1), **không** thêm `recharts` vào `admin-web` (giữ ADR-0001 cho Ops UI). Nếu người dùng chọn giữ `recharts` ở Gate: nạp lười chỉ ở route `/usage` và `/`, tách vendor chunk riêng, nới ngân sách chunk của route đó lên 160 KB gzip và ghi `docs/TECH-DEBT.md`; không nới JS ban đầu.

## Hệ quả
- Bundle web: +0 KB (QR ở server; biểu đồ tự vẽ). Server: +3 dependency trực tiếp.
- Bảo mật: `yaml` cấm alias (chặn DoS bộ nhớ); mailer chặn CR/LF ở subject, không log địa chỉ/nội dung; QR/secret TOTP không log, `no-store`.
- Rủi ro: `nodemailer` trên Bun chưa có ở dự án — int test Mailpit (task TM) là điều kiện xong; lỗi thì dự phòng là SMTP tự viết tối thiểu (không TLS, chỉ dev) và ghi TECH-DEBT.
- Nguồn: npm registry (`npm view <pkg> version dependencies engines time.modified`, 2026-10-03); bundlephobia API (`qrcode@1.5.4` 8.750 B, `uqr@0.1.3` 4.365 B, `yaml@2.9.1` 31.325 B, `recharts@3.10.1` 151.514 B gzip); RFC 6238 (https://www.rfc-editor.org/rfc/rfc6238); tài liệu `yaml` mục Options/`maxAliasCount` (https://eemeli.org/yaml/#options); đo `Bun.YAML.parse` trên Bun 1.3.14 tại máy dev.
- Khi Accepted: thêm 3 dòng vào bảng phiên bản ADR-0001 và dòng 0005 vào `docs/adr/README.md` (docs-architect).
