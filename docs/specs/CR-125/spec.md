---
id: CR-125
tên: Module tính năng một khuôn (khai báo + xử lý máy chủ + panel cấu hình, chung một khoá)
mã yêu cầu: MOD-FR-01..12, MOD-NFR-01..03
trạng thái: Intake nhanh 2026-11-07 (người dùng chấp nhận mọi mặc định), chưa làm
liên quan: CR-122 (node module FLOW2-FR-25/26, `AppManifest.nodes/events`), CR-123 u3a (`process-module-nodes.ts`), CR-124 q3 (xây trên khuôn này), ADR-0037 (ranh giới module)
---
# CR-125 · Module tính năng một khuôn

## 1. Mục tiêu
Mỗi tính năng (node trên sơ đồ) là **một gói 3 phần dùng chung một khoá node**:
1. **Khai báo** (dữ liệu + zod) — đã có một phần ở `AppManifest.nodes` (`packages/contracts/src/app-manifest/`).
2. **Xử lý máy chủ** — tool, `OutcomeHandler`, `FactsReader`, validator cấu hình, `options_path`. Hôm nay rải ở `apps/hub-api/src/modules/packs/<app>/*.mount.ts` + các sổ của kit (`flowPortRegistry`, `nodeConfigRegistry`, `PackToolRegistry`).
3. **Panel cấu hình** (tuỳ chọn) — hôm nay viết tay ở `apps/admin-web/src/features/processes` (`lib/wait-form.ts`, `NodeConfigPanel.tsx`, `FlowEsignFields.tsx`).

Một **sổ module** (module registry) ở lõi kiểm lúc khởi động và trong CI: mọi node/sự kiện/kết quả đã khai báo đều có xử lý, cổng khớp schema. Thiếu ⇒ dừng ngay, nói rõ lý do. Mục tiêu cuối: **thêm một node = một thư mục mỗi tầng, không sửa file nào khác** (`bun run module:new <app> <node>`).

Phạm vi đợt này (mặc định a): chuyển **Ký số** + **bước cơ bản** (Duyệt, Nếu, Thông báo, Kết thúc, Chờ tới…) trước; CR-124 q3 "Gửi đối tác xác nhận" là node đầu tiên làm mới theo khuôn này.

## 2. Hợp đồng sổ module

### 2.1 Tầng và chỗ đặt
| Tầng | Chỗ | Chứa | Luật |
|---|---|---|---|
| contracts | `packages/contracts/src/modules/` (`types.ts`, `core/…`, `<app>/<node>/node.ts`, `index.generated.ts`, `modules.rules.ts`) | khai báo + zod cổng + luật thuần `moduleIssues` | chỉ dữ liệu + zod (luật `contracts-only-zod`), không I/O |
| hub-api | `apps/hub-api/src/modules/packs/kit/adapters/module-registry.ts` (cổng ở `kit/application/module.ports.ts`, xuất qua `kit/public.ts`); binding ở `packs/<app>/nodes/<node>/binding.ts` | `NodeBinding`, `EventBinding`; `moduleRegistry.verify()` | gói chỉ đăng ký qua kit (giữ luật depcruise `contracts-no-process-engine`) |
| admin-web | `apps/admin-web/src/features/processes/modules/panel-registry.ts`; panel riêng ở `processes/modules/<app>/<node>/Panel.tsx` | panel chung dựng từ schema + panel riêng theo khoá node | không tự đổi contract |

### 2.2 Phác thảo kiểu (TypeScript, để định hướng — tên cuối chốt ở lát m1)
```ts
// contracts · modules/types.ts — chỉ dữ liệu + zod
import type { z } from "zod";
import type { AppNodeDecl, AppEventDecl } from "../app-manifest/manifest";

/** Gợi ý ô nhập cho panel chung (không phải code UI). */
export type PortWidget = "person" | "people" | "department" | "days" | "hours" | "text" | "longtext" | "enum" | "money" | "date";

/** Cổng = zod schema + gợi ý ô; MỘT nguồn: cổng vào của node = schema args của tool. */
export type PortSchema<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: T;
  /** khoá trường ⇒ ô nhập; vắng ⇒ panel chung suy từ kiểu zod. */
  widgets?: Readonly<Record<string, PortWidget>>;
};

export type NodeKind = "base" | "app";

export type FeatureNodeDecl = AppNodeDecl & {
  kind: NodeKind;
  /** Bước cơ bản: executor.kind lõi (approve, if, notify, end, wait_until…) — def cũ không có `stage.node` vẫn khớp theo đây. */
  baseExecutor?: string;
  /** Cổng cấu hình = args của stage `config.stage` (tool) — thay dần `AppNodeIo` cho phần cấu hình. */
  configPort?: PortSchema;
  /** true ⇒ chỉ ghi nhận (DLC của Rowan), sổ không bắt buộc binding/schema. */
  legacy?: boolean;
};

export type FeatureModule = {
  /** = `AppManifest.key` hoặc `core`. */
  app: string;
  nodes: readonly FeatureNodeDecl[];
  events: readonly AppEventDecl[];
};

export type ModuleIssue = { code: ModuleIssueCode; app: string; key: string; detail?: string; message: string };
export type ModuleIssueCode =
  | "MOD_DUP" | "MOD_UNBOUND" | "MOD_TOOL_MISSING" | "MOD_PORT_MISMATCH"
  | "MOD_EVENT_UNBOUND" | "MOD_OUTCOME_UNBOUND" | "MOD_ORPHAN_BINDING" | "MOD_PANEL_ORPHAN" | "MOD_INDEX_STALE";

/** Luật thuần, O(node + sự kiện + kết quả): khai báo × tóm tắt binding (chỉ khoá + tham chiếu schema). */
export declare function moduleIssues(mods: readonly FeatureModule[], bound: BoundSummary): ModuleIssue[];
export type BoundSummary = {
  nodes: ReadonlyMap<string, { tools: readonly string[]; argsSchema?: z.ZodTypeAny }>;
  tools: ReadonlySet<string>;
  facts: ReadonlySet<string>;      // `<app>\0<event>`
  outcomes: ReadonlySet<string>;   // `<app>\0<event>`
};
```
```ts
// hub-api · packs/kit/application/module.ports.ts — cổng xử lý máy chủ
import type { FeatureNodeDecl } from "@ai/contracts/modules";
export type NodeBinding = {
  node: string;                          // khoá node, = FeatureNodeDecl.key
  tools?: readonly PackToolDef[];        // tool của node; args parse bằng CHÍNH configPort.schema
  validate?: NodeConfigValidator;        // (đang có) — đăng ký hộ vào nodeConfigRegistry
  options?: { path: string; routes: (app: Hono) => void };  // options_path GET
};
export type EventBinding = { app: string; facts?: FactsReader; outcome?: OutcomeHandler<unknown> };
export type ModuleRegistry = {
  bindNode(b: NodeBinding): void;
  bindEvent(b: EventBinding): void;
  /** Gọi MỘT lần cuối `packs.mount.ts`; lỗi ⇒ ném, server không lên. */
  verify(mods: readonly FeatureModule[]): void;
  node(key: string): { decl: FeatureNodeDecl; binding?: NodeBinding } | undefined;
};
```
```ts
// admin-web · processes/modules/panel-registry.ts
export type NodePanel = (p: { node: FeatureNodeDecl; args: unknown; onChange(a: unknown): void; issues: readonly NodeConfigIssue[] }) => JSX.Element;
export const panelRegistry: { register(nodeKey: string, p: NodePanel): void; panelFor(node: FeatureNodeDecl): NodePanel /* riêng ?? chung */ };
```

### 2.3 Một nguồn
- Danh sách node = `MODULES` (contracts, `index.generated.ts`). `nodesFor`, `process-module-nodes.ts` (`MULTI`), palette, menu "+", validator lưu và engine (tra cụm/khoá node) **chỉ đọc** từ đây. `AppManifest.nodes` và `CORE_NODES` thành re-export từ `MODULES` (cùng lát chuyển, không hai danh sách — Luật GỐC 1).
- Cổng vào cấu hình = `configPort.schema`; tool của node dùng đúng schema đó để parse `args` (không khai `params` lần hai; `params` của `PackToolDef` sinh từ schema).
- `flowPortRegistry`, `nodeConfigRegistry` giữ nguyên API bên trong; `moduleRegistry.bindNode/bindEvent` đăng ký hộ (không đổi đường engine đang gọi).

## 3. Kiểm lúc khởi động và CI
| Mã | Khi nào | Câu lỗi (tiếng Việt) |
|---|---|---|
| `MOD_DUP` | khoá node/sự kiện khai hai lần | `Khoá node «contracts.esign» khai báo hai lần (contracts, community) — giữ một.` |
| `MOD_UNBOUND` | node `app` không `legacy` mà không có binding | `Node «Ký số» (contracts.esign) chưa có xử lý máy chủ — thêm packs/contracts/nodes/esign/binding.ts.` |
| `MOD_TOOL_MISSING` | stage gọi `tool_key` chưa đăng ký | `Node «Ký số» gọi tool «contracts-esign-send» nhưng tool chưa đăng ký.` |
| `MOD_PORT_MISMATCH` | schema args của tool ≠ `configPort.schema` (so tham chiếu; khác ⇒ so hình JSON Schema) | `Cấu hình node «Ký số» khác tham số tool «contracts-esign-send»: thiếu «signers».` |
| `MOD_EVENT_UNBOUND` | sự kiện có `facts` mà không `FactsReader` | `Sự kiện «Khi gửi duyệt HĐ» (contract.submitted) chưa có bộ đọc dữ kiện.` |
| `MOD_OUTCOME_UNBOUND` | sự kiện có `outcomes` mà không `OutcomeHandler` | `Sự kiện «contract.submitted» có kết quả «approved» nhưng app chưa xử lý kết quả.` |
| `MOD_ORPHAN_BINDING` | binding cho khoá không khai | `Có xử lý cho node «contracts.xyz» nhưng không có khai báo — xoá binding hoặc thêm node.ts.` |
| `MOD_PANEL_ORPHAN` | (admin-web, unit test) panel riêng cho khoá không có | `Panel cấu hình đăng ký cho «contracts.xyz» nhưng node không tồn tại.` |
| `MOD_INDEX_STALE` | (CI) `index.generated.ts` lệch thư mục | `Danh sách module tự sinh đã cũ — chạy bun run module:index rồi commit.` |

- **Khởi động** (`packs.mount.ts`, sau mọi mount): `moduleRegistry.verify(MODULES)`; có lỗi ⇒ ném `Khởi động dừng: N lỗi module` + từng dòng trên, log `error`, process thoát ≠ 0. Node `legacy` (DLC) chỉ kiểm `MOD_DUP`.
- **CI**: `bun run check:modules` (`tools/scripts/src/check-modules.ts`) chạy `moduleIssues` với tóm tắt binding đọc tĩnh (import các `binding.ts`, không DB, không mount) + kiểm index tự sinh. Thêm vào cổng merge (`slice:merge`) cạnh `check:app-events`.

## 4. Yêu cầu và nghiệm thu
- **MOD-FR-01 Khuôn 3 phần.** Given node `contracts.esign`, When đọc `MODULES`, Then có khai báo + `configPort` zod; hub có `nodes/esign/binding.ts` cùng khoá; admin-web có panel riêng đăng ký cùng khoá. `[test: unit contracts modules.rules; unit hub module-registry]`
- **MOD-FR-02 Kiểm khởi động.** Given binding Ký số bị gỡ, When hub khởi động, Then không lên, log `MOD_UNBOUND` đúng câu §3. Given đủ binding, Then lên bình thường. `[test: unit module-registry.verify]`
- **MOD-FR-03 Kiểm CI.** Given thêm `node.ts` không binding, When `bun run check:modules`, Then thoát 1 kèm câu lỗi; đủ ⇒ thoát 0. `slice:merge` từ chối khi đỏ. `[test: unit check-modules]`
- **MOD-FR-04 Một nguồn cổng.** Given `configPort.schema` của Ký số, When tool `contracts-esign-send` chạy, Then args parse bằng đúng schema đó; sửa schema một chỗ ⇒ validator lưu + tool + panel cùng đổi. Given tool khai schema khác, Then `MOD_PORT_MISMATCH`. `[test: unit; int esign tool đường chính]`
- **MOD-FR-05 Bước cơ bản cùng khuôn.** Given module `core`, Then có Duyệt, Nếu, Thông báo (chuông/email), Kết thúc, Chờ tới, Chờ khoảng với `kind: "base"` + `baseExecutor`. Given def cũ không có `stage.node`, When mở/lưu/chạy, Then khớp bước cơ bản theo `executor.kind`, không lỗi. `[test: unit core module; int lưu def cũ]`
- **MOD-FR-06 Đọc từ sổ.** Given node mới trong `MODULES`, When mở trình sửa, Then palette, menu "+", luật cụm (`moduleClusters`), validator lưu đều thấy node, không sửa file nào khác. `[test: unit palette-node, process-module-nodes]`
- **MOD-FR-07 Panel chung.** Given node không có panel riêng, When chọn node, Then panel dựng từ `configPort` (người, phòng ban, số ngày, chữ…) theo `widgets`, lỗi lưu hiện cạnh ô (`path` `stages.<i>.executor.args.<khoá>`). `[test: unit panel-registry; e2e một lần cuối CR]`
- **MOD-FR-08 Panel riêng.** Given `panelRegistry.register("contracts.esign", EsignPanel)`, Then Ký số dùng panel riêng; panel cũ viết tay (`FlowEsignFields`, phần esign trong `NodeConfigPanel`) gỡ trong cùng lát (D6). `[test: unit]`
- **MOD-FR-09 Scaffold.** When `bun run module:new contracts partner-send`, Then sinh `contracts/modules/contracts/partner-send/node.ts`, `hub-api/packs/contracts/nodes/partner-send/binding.ts` (+ test mẫu), tuỳ chọn `--panel` sinh `Panel.tsx`, chạy lại `module:index`; `check:modules` xanh ngay (binding mẫu đủ). `[test: unit scaffold trên thư mục tạm]`
- **MOD-FR-10 DLC không đụng.** Given node DLC hiện có, Then sổ ghi `legacy: true` từ khai báo hiện tại, không đòi binding, không di chuyển file DLC; `dlc:check` xanh. `[test: unit modules.rules legacy]`
- **MOD-FR-11 Người ký chọn cách ký (người dùng chốt 2026-11-07).** Given node Ký số, Then cấu hình node CHỈ khai AI ký (người ký công ty, đối tác, thứ tự) + hạn ký + nhắc; KHÔNG có nhà cung cấp. When người ký bấm «Ký ngay», Then chọn trong các cách công ty đã bật (DocuSign, Ký thử, MISA… = registry nhà cung cấp + cài đặt ký số của công ty); chỉ một cách khả dụng ⇒ ký thẳng, không hỏi. Cách khác loại phong bì đã gửi ⇒ huỷ phong bì cũ (không bắn `esign.voided`) và gửi lại cùng người ký/hạn/nhắc, chỉ khi chưa ai ký. Def đã lưu có `provider` vẫn chạy: trường bị bỏ qua khi đọc (không migration). `[test: unit esign-node (decode bỏ qua provider); unit esign-switch; unit esign-view (hỏi/ký thẳng); int esign-node]`
- **MOD-FR-12 Tự nối đầu vào (người dùng chốt 2026-11-07).** Given thêm một node, Then mọi đầu vào có ĐÚNG MỘT nguồn (khoá + kiểu trùng; vd `contract_id` từ «Bắt đầu khi») được nối luôn; chỉ hỏi khi nhiều nguồn hoặc không có, bằng câu nghiệp vụ kèm cách khắc phục («Bước «Ký số» cần «Hợp đồng» — thêm bước Tải hợp đồng trước.»), thay câu kỹ thuật «Chọn nguồn cho thông tin này». MỘT hàm thuần `autoMapInputs` ở `packages/contracts/src/modules/auto-map.ts` cho trình sửa và kiểm lúc lưu. `[test: unit auto-map; unit auto-bind]`- **MOD-NFR-01 Hiệu năng.** Sổ dựng MỘT lần lúc khởi động, tra `Map` O(1), `verify` O(node + sự kiện + kết quả), < 10 ms với 100 node; `check:modules` < 3 s; trình sửa không thêm request (vẫn `palette-api`). `[test: unit đo verify 100 node]`
- **MOD-NFR-02 Tương thích.** Def đã lưu có `stage.node` (vd `contracts.esign`) chạy và mở như cũ — khoá node không đổi; nếu buộc đổi khoá ⇒ bảng `aliases` trong contracts (không migration). `[test: int lưu/mở def có sẵn]`
- **MOD-NFR-03 Lỗi dễ hiểu.** Mọi lỗi §3 nói node nào, thiếu gì, sửa ở file nào.

## 5. Không làm
- **Không đổi `FlowDef`, không đổi engine / máy trạng thái run** (launch/settle/kick/timer giữ nguyên); engine chỉ đổi chỗ đọc danh sách node.
- **Không migration DB.** Không cần: khoá node giữ nguyên, sổ nằm trong code. Nếu một lát thấy buộc phải có ⇒ dừng, báo điều phối (hard stop).
- Không chuyển DLC (Rowan), không chuyển node Community đợt này (chỉ ghi vào sổ từ manifest hiện có).
- Không panel kéo-thả tự thiết kế; không cho tenant tự thêm node.

## 6. Rủi ro
| Rủi ro | Cách giữ |
|---|---|
| Fail fast làm server prod không lên vì một binding thiếu | `check:modules` chặn ở cổng merge trước; verify chạy cả trong int boot; lỗi in rõ file cần sửa |
| Def đã lưu có `stage.node` lệch khi đổi khoá | Không đổi khoá đợt này; `aliases` nếu cần; int mở/lưu def có sẵn |
| Hai danh sách node trong lúc chuyển (manifest cũ + `MODULES`) | Lát m1 biến `AppManifest.nodes`/`CORE_NODES` thành re-export trong cùng lát |
| So schema zod giữa tầng bằng tham chiếu vỡ khi bundle trùng bản | So tham chiếu trước, lệch ⇒ so JSON Schema (`z.toJSONSchema`) |
| Xung đột file tự sinh `index.generated.ts` khi lát song song | File chỉ sinh bằng `module:index`; xung đột ⇒ chạy lại lệnh, không sửa tay |
| Đụng việc đang chạy | arch-a2 sửa `modules/*/public.ts` (không packs) ⇒ CR-125 không sửa file đó; arch-a4 (ops, admin-api) không chạm; cr123-u4 (admin-web processes canvas/StageIf/rules) ⇒ mọi lát admin-web processes của CR-125 chạy **SAU** u4 merge |

## 7. Chia lát (≤ 60 phút mỗi lát; Sonnet mặc định; không lát nào đổi trạng thái run)
| Lát | Nội dung | File chạm | Model | Nhóm song song | Phụ thuộc |
|---|---|---|---|---|---|
| m0 | Bản đồ file (Luật 0d.2) vào `tasks.md` | `docs/specs/CR-125/tasks.md` | Explore Haiku | — | — |
| m1 | Kiểu + zod cổng + `moduleIssues` + module `core` (bước cơ bản) + `MODULES`; `CORE_NODES`/`AppManifest.nodes`/`nodesFor`/`process-module-nodes` đọc từ `MODULES` | `packages/contracts/src/modules/**`, `app-manifest/core.nodes.ts`, `app-manifest/nodes.rules.ts`, `app-manifest/contracts.manifest.ts` (nodes ⇒ re-export), `hub-admin/process-module-nodes.ts`, `package.json` contracts (subpath `./modules`) | Sonnet high; **Opus low soát** ranh giới (nhiều lát dựa vào) | A | m0 |
| m2 | `moduleRegistry` ở kit + `verify` cuối `packs.mount.ts` + bọc `flowPortRegistry`/`nodeConfigRegistry` | `packs/kit/application/module.ports.ts`, `packs/kit/adapters/module-registry.ts`, `packs/kit/public.ts`, `packs/packs.mount.ts` | Sonnet high | B (∥ m3) | m1 |
| m3 | `check:modules` + `module:index` + `module:new` + nối cổng merge | `tools/scripts/src/check-modules.ts`, `tools/scripts/src/module-new.ts`, `tools/scripts/src/module-index.ts`, `package.json` gốc, script `slice:merge` | Sonnet | B (∥ m2) | m1 |
| m4 | Chuyển Ký số: `node.ts` + `configPort` = schema args tool (từ `EsignNodeConfig`); `nodes/esign/binding.ts`; `esign.mount.ts` chỉ còn gọi binding | `contracts/src/modules/contracts/esign/**`, `pack-contracts` (schema esign node), `packs/contracts/nodes/esign/**`, `packs/contracts/esign.mount.ts` | Sonnet | C (∥ m5) | m2, m3 |
| m5 | Binding bước cơ bản `core` (ghi executor lõi, không sửa engine) + sự kiện/kết quả contracts, community qua `bindEvent` | `packs/core/nodes/**` (mới), `packs/core-tools.mount.ts`, `packs/contracts/flow-events.mount.ts`, `packs/community-flow.mount.ts` | Sonnet | C (∥ m4) | m2, m3 |
| m6a | Panel registry + panel chung từ schema; đăng ký panel Ký số; gỡ phần esign viết tay | `admin-web/.../processes/modules/**`, `components/flow/NodeConfigPanel.tsx`, `components/library/FlowEsignFields.tsx`, `lib/wait-form.ts` | Sonnet | D (nối tiếp) | m4, **sau cr123-u4** |
| m6b | Palette, menu "+", canvas đọc `MODULES` (bỏ đọc manifest rải rác) | `lib/palette-node.ts`, `palette-api.ts`, `components/flow/NodePalette.tsx`, `lib/insert-on-edge.ts` | Sonnet | D (sau m6a) | m6a |
| m7 | e2e một lần cuối CR (journey-approval + Ký số trên canvas + panel chung) + review/security diff gộp | `e2e/**` (qc) | Sonnet qc · Opus medium review | — | m1–m6b |

- **Song song không đụng file:** m2 ∥ m3 (kit vs tools); m4 ∥ m5 (packs/contracts esign vs packs/core + flow-events). File tự sinh `index.generated.ts` xung đột ⇒ chạy `module:index`.
- **CR-124 q3 chờ m4** (khuôn đã chứng minh trên Ký số); q3 dùng `module:new contracts partner-send`.
- Không lát nào cần migration; không lát nào giao số migration.

## 8. Quyết định trong lúc làm
- (trống)
