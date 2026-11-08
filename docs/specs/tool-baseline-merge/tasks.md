---
id: tool-baseline-merge
lát: tool-baseline-merge
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
slice:merge tự giải conflict `.dependency-cruiser-known-violations.json` khi rebase; baseline ghi theo định dạng ổn định; `bun run depcruise` xanh khi chỉ có cảnh báo stale.

## Làm
- `baseline.rules.ts` (chuẩn hoá/sắp/bỏ trùng, nhận diện cảnh báo stale), `check-boundaries.ts --write` dùng nó.
- `slice-rebase.ts`: conflict chỉ ở baseline ⇒ lấy upstream, sinh lại bằng `check-boundaries --write`, add, continue; file khác ⇒ dừng như cũ.
- `depcruise.ts`: đầu ra chỉ có dòng baseline cũ thì exit 0.

## Không làm / Chạm
Không dùng merge driver `.gitattributes` (sinh lại đơn giản và đúng hơn gộp văn bản). File baseline sắp xếp lại một lần (diff lớn một lần duy nhất).

## Test tối thiểu
Unit `baseline.rules.test.ts`, `slice-rebase.test.ts`. Perf: không.

## Quyết định trong lúc làm
- So sánh theo điểm mã, không theo locale, để cùng kết quả mọi máy.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED docs/current/platform/baseline-merge.md
#### Yêu cầu: Baseline ranh giới ghi ổn định
File baseline luôn sắp theo luật, from, to, không trùng, khoá cố định; cùng tập vi phạm thì cùng từng byte.
- Kịch bản: khi thứ tự đầu vào khác nhau thì file ghi ra giống nhau [test: tools/scripts/src/baseline.rules.test.ts » thứ tự vào khác nhau cho cùng một file]
- Kịch bản: khi có mục trùng thì chỉ giữ một và đã sắp [test: tools/scripts/src/baseline.rules.test.ts » sắp theo luật, from, to và bỏ trùng]

#### Yêu cầu: slice:merge tự giải conflict baseline
Khi rebase dừng mà file conflict duy nhất là baseline, lấy bản upstream, sinh lại bằng check-boundaries --write, add và tiếp tục, lặp từng commit; file khác conflict hoặc sinh lại thất bại thì dừng và báo.
- Kịch bản: khi mỗi commit chỉ conflict baseline thì tự giải hết [test: tools/scripts/src/baseline.rules.test.ts » chỉ baseline conflict ở mỗi commit lấy upstream, sinh lại, add, continue]
- Kịch bản: khi có file khác conflict thì dừng không sinh lại [test: tools/scripts/src/baseline.rules.test.ts » file khác conflict dừng, không sinh lại]
- Kịch bản: khi sinh lại bị từ chối vì vi phạm mới thì dừng báo [test: tools/scripts/src/baseline.rules.test.ts » sinh lại thất bại vi phạm mới dừng báo]

#### Yêu cầu: depcruise xanh khi chỉ có cảnh báo stale
`bun run depcruise` thoát 0 khi đầu ra chỉ gồm dòng thông tin về vi phạm đã biết hoặc stale; có vi phạm thật thì vẫn đỏ.
- Kịch bản: khi chỉ có dòng stale thì xanh [test: tools/scripts/src/baseline.rules.test.ts » chỉ dòng baseline cũ thì xanh]
- Kịch bản: khi có vi phạm thật thì đỏ [test: tools/scripts/src/baseline.rules.test.ts » có vi phạm thật thì đỏ]

## Việc còn lại
Không.
