-- SEC 2026-11-12 (fix-sec-seed) · `hub.record_evidence`: tệp / chữ ký không do người ghi tải lên (0140) trước đây RAISE 42501 có câu tiếng Việt ⇒
-- đường duyệt của thẻ HĐ / cổng duyệt trả 500. Tách kiểm «của chính bạn» ra trước, RAISE SQLSTATE `EK422` với message = mã
-- `EVIDENCE_FILE_NOT_OWNED` ⇒ `mapError` (dbGuardCode EK422) trả 422 có mã ở MỌI route ghi bằng chứng. Kiểm PNG/cỡ/đã dọn giữ như 0140.
-- record_evidence: INSERT bằng chứng cho tenant/người của tx. Tệp (chữ ký PNG ≤ 200 KB, tệp ≤ 10 MB, ≤ 5) phải thuộc CHÍNH tenant này,
-- chưa bị dọn. `on_behalf_of` (người được giao thật) chỉ khi có uỷ quyền on→by CÒN HIỆU LỰC (chưa huỷ, trong khoảng) đúng loại việc (task_decision→approve/form, milestone/hold/penalty/exec_request→milestone, sign_cancel→esign), hoặc `by` là assignee `via='delegated'` của
-- đúng task đó (chống mạo danh người khác). `task_decision`: task phải thuộc tenant (kind khác nằm ở schema gói ⇒ gói tự kiểm hàng của mình).
CREATE OR REPLACE FUNCTION hub.record_evidence(
  p_subject_kind text,
  p_subject_id uuid,
  p_note text,
  p_signature_attachment_id uuid,
  p_attachment_ids uuid[],
  p_on_behalf_of uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_files uuid[] := COALESCE(p_attachment_ids, '{}'::uuid[]);
  v_id uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'record_evidence: chưa đặt tenant/người dùng' USING ERRCODE = '42501';
  END IF;
  IF p_subject_id IS NULL OR p_note IS NULL OR char_length(p_note) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'record_evidence: cần ý kiến 1..4000 ký tự và đối tượng' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_files) > 5 OR EXISTS (SELECT 1 FROM unnest(v_files) f WHERE f IS NULL) THEN
    RAISE EXCEPTION 'record_evidence: tối đa 5 tệp' USING ERRCODE = '22023';
  END IF;
  -- Của chính người ghi (cùng tenant) — kiểm TRƯỚC để trả mã rõ (EK422 ⇒ 422 EVIDENCE_FILE_NOT_OWNED).
  IF (p_signature_attachment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM hub.attachments a
         WHERE a.id = p_signature_attachment_id AND a.tenant_id = v_tid AND a.user_id = v_uid))
     OR (cardinality(v_files) > 0 AND (SELECT count(*) FROM hub.attachments a
         WHERE a.id = ANY (v_files) AND a.tenant_id = v_tid AND a.user_id = v_uid)
       <> (SELECT count(DISTINCT f) FROM unnest(v_files) f)) THEN
    RAISE EXCEPTION 'EVIDENCE_FILE_NOT_OWNED' USING ERRCODE = 'EK422';
  END IF;
  IF p_signature_attachment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hub.attachments a
        WHERE a.id = p_signature_attachment_id AND a.tenant_id = v_tid AND a.user_id = v_uid AND a.purged_at IS NULL
          AND a.mime = 'image/png' AND a.size <= 204800) THEN
    RAISE EXCEPTION 'record_evidence: chữ ký phải là ảnh PNG ≤ 200 KB do chính bạn tải lên' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_files) > 0 AND (SELECT count(*) FROM hub.attachments a
        WHERE a.id = ANY (v_files) AND a.tenant_id = v_tid AND a.user_id = v_uid AND a.purged_at IS NULL AND a.size <= 10485760)
      <> (SELECT count(DISTINCT f) FROM unnest(v_files) f) THEN
    RAISE EXCEPTION 'record_evidence: tệp không do bạn tải lên, đã bị dọn hoặc quá 10 MB' USING ERRCODE = '42501';
  END IF;
  IF p_subject_kind = 'task_decision' AND NOT EXISTS (
       SELECT 1 FROM hub.review_tasks t WHERE t.id = p_subject_id AND t.tenant_id = v_tid) THEN
    RAISE EXCEPTION 'record_evidence: việc không thuộc công ty này' USING ERRCODE = '42501';
  END IF;
  IF p_on_behalf_of IS NOT NULL AND (p_on_behalf_of = v_uid OR NOT (
       EXISTS (SELECT 1 FROM hub.delegations d
                WHERE d.tenant_id = v_tid AND d.from_user_id = p_on_behalf_of AND d.to_user_id = v_uid
                  AND d.revoked_at IS NULL AND now() >= d.from_at AND now() < d.to_at
                  AND (CASE p_subject_kind
                         WHEN 'task_decision' THEN d.kinds && ARRAY['approve', 'form']::text[]
                         WHEN 'sign_cancel' THEN 'esign' = ANY (d.kinds)
                         WHEN 'milestone' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'hold' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'penalty' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'exec_request' THEN 'milestone' = ANY (d.kinds)
                         ELSE true END))
       OR (p_subject_kind = 'task_decision' AND EXISTS (
             SELECT 1 FROM hub.review_task_assignees a
              WHERE a.tenant_id = v_tid AND a.task_id = p_subject_id AND a.user_id = v_uid
                AND a.via = 'delegated' AND a.on_behalf_of = p_on_behalf_of)))) THEN
    RAISE EXCEPTION 'record_evidence: không có uỷ quyền từ người này' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.evidence (tenant_id, subject_kind, subject_id, note, signature_attachment_id, attachment_ids,
                            by_user, on_behalf_of)
  VALUES (v_tid, p_subject_kind, p_subject_id, p_note, p_signature_attachment_id, v_files, v_uid, p_on_behalf_of)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
