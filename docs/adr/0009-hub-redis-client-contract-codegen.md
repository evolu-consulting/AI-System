# ADR-0009 · Hub: Redis client (ioredis) và toolchain contract zod → JSON Schema → pydantic

Trạng thái: **Accepted** (Gate H1, 2026-10-04) · Ngày: 2026-10-04 · Spec: `docs/specs/H1-hub-core/` (plan §1 P10, §2.6) · Liên quan: ADR-0001 (dòng ioredis), ADR-0007 #5–#6, ADR-0008

## Bối cảnh
hub-api (Bun) cần: `XADD` có id tường minh (`<seq>-0`) vào `sse:<run_id>`, `XREAD BLOCK` multiplex nhiều stream trên kết nối riêng, `XRANGE/XREVRANGE`, `EXPIRE`, `DEL` (plan §5). ADR-0001 đã ghi "Redis 7 (ioredis)" và pin `ioredis 6.0.0` nhưng chưa cài; Bun 1.3 có client Redis dựng sẵn — cần chốt lại. Contract Hub↔Runtime (ADR-0007 #6) cần cách xuất JSON Schema từ zod và sinh pydantic v2 cho Python, kiểm khớp được.

## Lựa chọn

### 1. Redis client cho Bun
| | A. `ioredis` 6.0.0 | B. `Bun.redis` / `RedisClient` (Bun 1.3) | C. `redis` (node-redis 5) |
|---|---|---|---|
| Phụ thuộc | thêm 1 package (đã duyệt ở ADR-0001) | 0 | thêm 1 package |
| Streams | lệnh có kiểu `xadd/xread/xrange/xrevrange`; 6.0.0-beta.1 thêm MAXCOUNT/MAXSIZE cho stream read | không có API stream riêng — phải `send("XADD", […])`, tự parse reply | lệnh có kiểu |
| Kết nối chặn | `duplicate()`; BLOCK trên kết nối riêng | `duplicate()` có | `duplicate()`/isolation pool |
| Hạn chế ghi nhận | Node ≥ 20, RESP3 mặc định từ 6.0 | tài liệu Bun: MULTI/EXEC phải dùng lệnh thô; không Sentinel/Cluster; Streams không được tài liệu hoá | — |
| Độ phổ biến | > 14 000 sao GitHub, hàng triệu lượt tải/tuần | mới | phổ biến tương đương |

### 2. zod → JSON Schema
| | A. `z.toJSONSchema` (có sẵn trong zod 4.6.5 đã cài) | B. `zod-to-json-schema` |
|---|---|---|
| Phụ thuộc | 0 | +1, viết cho zod 3 |
| Draft | 2020-12, `unrepresentable: "throw"` bắt lỗi kiểu không biểu diễn được | 7 / 2019-09 |

### 3. JSON Schema → pydantic v2
| | A. `datamodel-code-generator` 0.71 (dev, `apps/agent-runtime`) | B. Viết tay pydantic + test so JSON Schema |
|---|---|---|
| Đồng bộ | sinh lại tất định (`--disable-timestamp`), `contracts:check` so byte | dễ lệch, test so sánh phức tạp |
| Đầu ra | `--output-model-type pydantic_v2.BaseModel`, ràng buộc `--field-constraints`, `extra=forbid` | tuỳ người viết |
| Rủi ro | output đổi giữa phiên bản → pin trong `uv.lock`, nâng cấp = sinh lại + commit | công sức + lệch |

## Quyết định (đề xuất)
1. **ioredis 6.0.0** cho hub-api (đúng pin ADR-0001): Streams có kiểu, `XADD` id tường minh để fencing (plan §5.2), một kết nối chặn/loại stream mỗi instance. Không chọn `Bun.redis` vì Streams chỉ qua `send()` không kiểu và chưa được tài liệu hoá; xem lại khi Bun hỗ trợ chính thức.
2. **`z.toJSONSchema`** của zod 4, không thêm thư viện. Contract Hub chỉ dùng tập kiểu biểu diễn được (plan §2).
3. **`datamodel-code-generator`** là dev dependency của `apps/agent-runtime` (pin trong `uv.lock`); chạy qua `bun run contracts:gen`, kiểm bằng `bun run contracts:check` (HUB-H1-AC-06). Không thêm vào ADR-0008.

## Hệ quả
- `apps/hub-api/package.json` thêm `ioredis` (exact `6.0.0`); `jose`, `hono`, `zod`, `yaml` (ADR-0005) đã có.
- File sinh (`contracts/hub.schema.json`, `src/agent_runtime/contracts/hub.py`) không sửa tay; đổi contract = sửa zod → sinh lại → commit cả ba.
- Nếu `pyright` strict không qua trên file sinh: chỉnh cờ codegen, không `type: ignore`.

## Nguồn
- Bun Redis client, mục giới hạn: https://bun.com/docs/runtime/redis
- ioredis 6.0.0 (2026-07-31) và 6.0.0-beta.1: https://newreleases.io/project/npm/ioredis/release/6.0.0 · https://newreleases.io/project/npm/ioredis/release/6.0.0-beta.1
- datamodel-code-generator: https://pypi.org/project/datamodel-code-generator
