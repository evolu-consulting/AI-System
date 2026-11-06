# P5 · Tích hợp SHT và việc nền (deep-link, SSO, brand, i18n)

Thuộc `index.md` (CR-106). Mã: **COM-FR-43…46**. Tuân Q2 (deep-link, không nhúng), I1 (cách ly), I2 (một điểm nối nghiệp vụ).

## 1. Mục tiêu
Gom mọi thứ "nối" hai app và hai việc nền mà P1–P4 dựa vào: deep-link 4 trang, đăng nhập một lần, `brand` dùng chung, hạ tầng i18n.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Sidebar nhóm "Sổ Hợp Tác" (4 mục) và Topbar brand.

## 3. Nghiệp vụ

### 3.1 Deep-link 4 trang + cách ly — COM-FR-43
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| L1 | 4 liên kết: Tổng quan `/overview` · Hợp đồng & giao dịch `/contracts` · Đối tác `/partners` · Sản phẩm & Giá `/products` của `contracts-web`; mở cùng tab | Mới (thay link đơn "Mở Sổ Hợp Tác") | `contracts-web/src/features/shell/lib/nav.ts:12-17`; hiện `Profile.tsx:46-58` |
| L2 | Đường dẫn cũ `/contracts` mặc định giữ làm trang đích khi không có tiền tố | Giữ | `Profile.tsx:51` (`shtUrl ?? "/contracts"`) |
| L3 | **Tiền tố host** `contracts-web` = `VITE_CONTRACTS_URL` (build-time); không đặt ⇒ rơi về đường dẫn tương đối `/contracts` (như hiện tại). Không dùng `shtUrl` của server (P0 D4) | Đổi (đã chốt) | `viewer.ts:65`, `api/mock.ts:385`, `Profile.tsx:51` |
| L4 | Cách ly: đối tác **không** có nhóm này và không nhận `shtUrl`; nếu tự gõ URL `contracts-web`, RLS `ext_deny` ⇒ 0 hàng, pack guard 403 (HT-76). Không thêm API community nào đọc dữ liệu SHT ngoài các port đã có (`nghiep-vu.md` §9 R45; ADR-0031) | Giữ | `hien-thi.md:126-127`; `cai-dat-va-quyen.md` §1 |
| L5 | Điểm nối nghiệp vụ duy nhất vẫn là "Lưu báo giá" (I2); deep-link chỉ là điều hướng, không truyền dữ liệu bài/báo giá qua URL | Giữ | `nghiep-vu.md` §8 |
| L6 | Chiều ngược (`contracts-web` → community): ngoài phạm vi CR-106 | Đã chốt (ngoài phạm vi) | — |
| L7 | Quyền hiện/ẩn nhóm SHT: `CommunityViewer` thêm `caps.contracts` = `none`, `read`, `write`, `admin` (lấy qua port gói↔gói, không gọi API contracts). Đối tác luôn `none` | **Đã chốt (backend-lead)**, shape ở §5.1 | `viewer.ts:17-26`; ADR-0031 |
| L8 | **Tiền đề ở contracts-web** (mô tả, chưa code): `/settings?sec=co\|rep\|biz\|scout\|flow` (chi tiết P4a §5) | Việc nền | `routes/_authed/settings/index.tsx:6` |

### 3.2 SSO giữa hai app (bản đầu: fallback) — COM-FR-44
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| S1 | **Q11 — fallback cho bản đầu**: deep-link luôn hoạt động; chủ quản **có thể phải đăng nhập lại** ở `contracts-web` (hai phiên khác nhau: `ai_rt_community` vs phiên contracts). Không làm gì thêm ở bản đầu | Đổi (hoãn) | `App.tsx:26-41`, `routes/sso.tsx` |
| S2 | SSO liền mạch community→SHT (mã SSO một lần khi bấm link hoặc đăng nhập chung qua lõi) = **CR sau**, ngoài CR-106 | Hoãn | — |
| S3 | Đăng xuất ở community không đăng xuất SHT (ghi nhận hạn chế) | Giữ | — |
| S4 | Nhắc người dùng: màn đăng nhập SHT là hành vi bình thường; không cần chuỗi mới | Ghi chú | — |

### 3.3 Brand dùng chung nguồn với SHT — COM-FR-45 (Contract/dữ liệu **MỚI**)
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| B1 | Thêm `brand` cho tài khoản community: `{ name: string, appName?: string, logo: string \| null (data URL/URL), accent: CompanyAccent }` lấy từ **công ty chủ quản** | Mới | `CompanyOut.company` (`pack-contracts/company.ts:35-40,53-63`) |
| B2 | **Dùng chung nguồn** với SHT: giá trị = trường `name`, `app_name`, `logo`, `accent` của `/company`. Một bảng/nguồn, một nơi sửa (P4c); community chỉ đọc | Mới | P4c C1 |
| B3 | Áp cho **cả chủ quản lẫn đối tác**: mỗi account hiện brand **công ty của mình** (đối tác thấy brand công ty đối tác nếu có; chưa có ⇒ accent mặc định "indigo" và chữ cái đầu). Chốt: topbar của đối tác cũng hiện brand công ty mình (P0 D5, P1 T2) | Mới | brief CR-106; P1 T2 |
| B4 | Đọc brand qua `GET /pack/community/brand` → `{ name, appName, logo (data URL/URL hoặc null), accent }`, lấy qua **port gói↔gói** (ADR-0031); shape ở §5.1. (Không nhúng vào `CommunityViewerSchema`.) User ngoài bị `ext_deny` trên `/company` ⇒ không gọi port, trả fallback | **Đã chốt (backend-lead)** | `docs/adr/0031-pack-to-pack-ports.md` |
| B5 | Chỉ trả 4 trường brand; **không** trả pháp nhân/MST/cờ duyệt/ngưỡng (P4c §6) | Mới | I1 |
| B6 | Màu: community đang có 5 accent, công ty có 6 (`rose`) — thêm `rose`; `brand.accent` thay `COMMUNITY_ACCENTS`/`readAccent` | Đổi | `styles/globals.css:17-38`; `ctx.tsx:55-65` |
| B7 | Cache: brand tải cùng viewer lúc boot; đổi ở P4c có hiệu lực lần tải sau (không realtime) | Mới | — |
**Trạng thái:** **Đã chốt (backend-lead)** — shape zod + endpoint/port + quyền + cách ly ở §5.1.

### 3.4 Hạ tầng i18n VI/EN — COM-FR-46 (Phụ thuộc nền của CR-106)
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| I1 | **community-web hiện hardcode tiếng Việt, chưa có hạ tầng i18n** (chỉ `src/ui/login-i18n.ts` riêng cho đăng nhập) ⇒ cần thêm i18n (hệ khoá + bản EN) như một **việc nền của CR-106**; mọi nhãn ở P1–P4 đi qua khoá | Mới (nền) | `ui/TopBar.tsx`, `Settings.tsx`, `Feed.tsx` (chuỗi viết thẳng); `ui/login-i18n.ts` |
| I2 | Tạo namespace `packages/i18n/locales/community/{vi,en}.json`; nạp bằng loader bắt chước `contracts-web`; thiếu khoá EN ⇒ rơi về VI (P0 D9) | Mới | `packages/i18n/locales/contracts/` |
| I3 | Dialog Cài đặt (Q10) chỉ cần nhãn thẻ mục SHT, đặt trong namespace `community` với VI verbatim từ `contracts.settings.sec.*`; không phụ thuộc EN của contracts-web | Đổi (đơn giản hoá) | `v2l.vi.json:7-17` |
| I4 | Ngôn ngữ: `localStorage` `community.lang`, mặc định `navigator.language`, rơi về VI; đổi ở Cài đặt › Cá nhân › Tài khoản › Ngôn ngữ (P4b N6) | Mới | P4b |
| I5 | **Tất cả nhãn EN trong P1–P4 là "đề xuất dịch, chờ duyệt"**; khoá tiếng Việt giữ verbatim nguồn | Quy ước | P1–P4 §7 |
| I6 | Định dạng ngày/số theo ngôn ngữ (`timeAgo`, tiền) | Mới | `src/lib/format.ts` |

## 4. Điều hướng & trạng thái
Deep-link là `<a href>` thường (mở cùng tab, có thể chuột giữa mở tab mới). Boot: `session.ensure()` → tải viewer + brand → render Shell; brand lỗi ⇒ dùng mặc định (không chặn app).

## 5. Dữ liệu / Contract
| Điểm | Trạng thái |
|---|---|
| `GET /pack/community/brand` `{name, appName, logo, accent}` (B1/B4) | **Đã chốt (backend-lead)** — §5.1 |
| Port đọc brand `/company` cho gói community (ADR-0031) | **Đã chốt (backend-lead)** — `CompanyBrandReader`, §5.1 |
| `viewer.caps.contracts` (L7) | **Đã chốt (backend-lead)** — §5.1 |
| `?sec=` ở contracts-web (L8) | Việc nền frontend |
| Mã SSO community→contracts | Hoãn (Q11), CR sau |
| Namespace i18n `community` + biến thể vi/en | **MỚI** (frontend) |

### 5.1 Shape chốt (backend-lead) — brand + caps
Đặt zod ở `packages/contracts/src/pack-community/viewer.ts`; endpoint HTTP ở `apps/hub-api/.../packs/community/adapters/org.routes.ts`; port khai ở `.../community/application/pack-ports.ts`, tiêm thật ở `packs/community-wire.mount.ts` (ADR-0031). KHÔNG đổi API công khai của gói contracts; chỉ **thêm port đọc** (ADR-0031 §5: port đọc chỉ trả dữ liệu chủ quản được thấy).

**(1) `GET /pack/community/brand` — brand dùng chung nguồn `/company`.**
```ts
// 6 màu dùng chung với công ty (B6 — thêm "rose" so với COMMUNITY_ACCENTS 5 màu).
export const BRAND_ACCENTS = ["indigo", "blue", "teal", "green", "orange", "rose"] as const;
export type BrandAccent = (typeof BRAND_ACCENTS)[number];
export const CommunityBrandSchema = z.strictObject({
  name: z.string(),                 // tên công ty; fallback = orgName của account
  appName: z.string().nullable(),   // app_name (null nếu chưa đặt)
  logo: z.string().nullable(),      // data URL | URL | null
  accent: z.enum(BRAND_ACCENTS),    // fallback "indigo"
});
export type CommunityBrand = z.infer<typeof CommunityBrandSchema>;
```
- **Port** (community khai, contracts cung cấp): `CompanyBrandReader.read(who: HostCaller): Promise<{ name: string; appName: string | null; logo: string | null; accent: BrandAccent } | null>`. Chạy trong tx + GUC người gọi; tự kiểm `kind=internal` (ADR-0031 §4); `kind=external` ⇒ **không gọi port**.
- **Quyền + cách ly (I1, HT-76):** chủ quản (kind=internal, mọi vai host) ⇒ endpoint gọi port, trả 4 trường từ `CompanyOut.company` (`name`, `app_name`, `logo`, `accent`). Đối tác (kind=external) ⇒ port **không được gọi** (bị `ext_deny` trên bảng company); endpoint trả **fallback** `{ name: viewer.orgName, appName: null, logo: null, accent: "indigo" }`. **Tuyệt đối không** trả `own_names`/`own_tax_ids`/`approval_enabled`/`legal_warn_threshold` (B5, P4c §6).
- **Fallback (B3, P0 D5, AC P5-AC07):** port trả `null` (chủ quản chưa có company) hoặc caller external ⇒ accent `"indigo"` + `name = viewer.orgName` (FE lấy chữ cái đầu). App không chặn khi lỗi (`§4`).

**(2) `viewer.caps.contracts` — thêm vào `CommunityViewer`.**
```ts
export const CONTRACTS_CAPS = ["none", "read", "write", "admin"] as const;
export type ContractsCap = (typeof CONTRACTS_CAPS)[number];
// Thêm trường vào CommunityViewerSchema:
//   caps: z.strictObject({ contracts: z.enum(CONTRACTS_CAPS) }),
```
- **Port** (community khai, contracts cung cấp): `ContractsCapReader.capOf(who: HostCaller): Promise<ContractsCap>`. Suy từ quyền gói contracts của chính user (nhóm/role gói contracts), **không** gọi HTTP contracts. Ánh xạ: không gắn gói / không quyền ⇒ `none`; quyền đọc ⇒ `read`; quyền ghi (`write`) ⇒ `write`; admin/owner gói contracts ⇒ `admin`.
- **Quyền + cách ly:** đối tác (`kind=external`) ⇒ **luôn** `none` (endpoint không gọi port). Dùng để FE ẩn nhóm SHT và cột uy tín; chặn thật vẫn ở server (`ext_deny`, pack guard 403 — HT-76). `caps` tải cùng viewer lúc boot.

## 6. Quyền & cách ly
Giữ HT-75/HT-76 và `ext_deny` nguyên vẹn; thêm int mới cho endpoint brand: user ngoài chỉ nhận 4 trường brand, không đọc được bảng gói contracts. Mọi nhãn/liên kết SHT bị ẩn với đối tác, nhưng chặn thật nằm ở server.

## 7. Nhãn VI / EN (EN đề xuất dịch, chờ duyệt)
| VI | EN đề xuất |
|---|---|
| Tổng quan · Hợp đồng & giao dịch · Đối tác · Sản phẩm & Giá | Overview · Contracts & transactions · Partners · Products & Prices |
| Mở Sổ Hợp Tác (nhãn cũ, bỏ) | Open Sổ Hợp Tác (bỏ) |
| Chủ quản (phụ đề brand) | Host |
Nguồn VI: `contracts/vi.json:202-207`, `Profile.tsx:56`.

## 8. Tiêu chí chấp nhận
| AC | FR | Nội dung |
|---|---|---|
| P5-AC01 | 43 | Bốn liên kết SHT trỏ đúng 4 đường dẫn `contracts-web`; mở cùng tab. |
| P5-AC02 | 43 | Đối tác: DOM không có liên kết SHT; gõ tay URL contracts-web ⇒ 403/0 hàng (HT-76). |
| P5-AC03 | 43 | Không có endpoint/bảng mới nối community↔SHT ngoài brand (đọc) và Lưu báo giá hiện có (I2). |
| P5-AC04 | 44 | Fallback (Q11): bấm liên kết SHT luôn mở được `contracts-web`; nếu chưa có phiên SHT thì hiện màn đăng nhập SHT, đăng nhập xong vào đúng trang đích (không mất đường dẫn). |
| P5-AC05 | 45 | `brand` của account = `name/app_name/logo/accent` từ `/company` của công ty đó; sửa ở P4c phản ánh sau lần tải kế tiếp. |
| P5-AC06 | 45 | Endpoint brand trả đúng 4 trường cho đối tác; không có pháp nhân/MST/cờ duyệt. |
| P5-AC07 | 45 | Chưa có brand ⇒ chữ cái đầu + accent mặc định, app vẫn chạy. |
| P5-AC08 | 46 | Không còn chuỗi VI viết thẳng trong các màn P1–P4 (kiểm bằng lint/grep); chuyển VI↔EN đổi nhãn. |
| P5-AC09 | 46 | Thiếu khoá EN ⇒ rơi về VI, không hiện khoá thô. |

## 9. Mã truy vết
COM-FR-43 Deep-link + cách ly (+ caps, tiền đề `?sec=`) · COM-FR-44 SSO fallback · COM-FR-45 Brand dùng chung nguồn · COM-FR-46 Hạ tầng i18n.

## 10. Việc còn mở
Đã chốt: host `VITE_CONTRACTS_URL` (L3), SSO fallback (Q11), brand mỗi account công ty mình (B3), i18n namespace + ngôn ngữ (I2–I4), chiều ngược ngoài phạm vi (L6).
Backend-lead **đã chốt** (shape zod + endpoint/port + quyền + cách ly): (1) `GET /pack/community/brand` + port `CompanyBrandReader` (§5.1); (2) `viewer.caps.contracts` + port `ContractsCapReader` (§5.1); (3) `profile/:orgId/partners` + `media` + điểm uy tín qua `HostBookReader.read` (P3 §5).
