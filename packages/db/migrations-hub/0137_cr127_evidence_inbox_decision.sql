-- CR-127 · K8 · C2 (phân loại ca đỏ): `hub.evidence.subject_kind` += 'inbox_decision' (bằng chứng quyết HĐ nhận, subject = HĐ nhận).
-- Trước đây nằm ở migration GÓI contracts 0094 ⇒ schema hub phụ thuộc đã migrate gói hay chưa (H1 A48). Nay thuộc hub; 0094 không còn sửa hub.
-- Chỉ NỚI CHECK ⇒ dữ liệu cũ luôn thoả; chạy lại vô hại (DROP IF EXISTS + ADD cùng danh sách).
ALTER TABLE hub.evidence DROP CONSTRAINT IF EXISTS evidence_subject_kind_ck;
--> statement-breakpoint
ALTER TABLE hub.evidence ADD CONSTRAINT evidence_subject_kind_ck CHECK (subject_kind IN ('task_decision', 'milestone', 'hold',
  'penalty', 'exec_request', 'effect_outcome', 'sign_cancel', 'unchanged_resubmit', 'inbox_decision'));
