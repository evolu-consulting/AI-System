-- CR-113 (review #4) · "duyệt thay" (`contract_events` type `approval_override`) ghi write-ahead TRƯỚC khi engine nhận quyết ⇒ bấm
-- lại / thử lại cùng task không được nhân bản: một hàng mỗi (lượt `run_id`, task engine `task_id`, người). Có `actor_user_id` vì hai
-- chủ gói khác nhau có thể cùng bấm một task (người thua đua giữ bản ghi lần bấm; thẻ chỉ tính bản ghi của ĐÚNG người quyết).
-- Index một phần (chỉ type này) ⇒ không ảnh hưởng event khác; ghi `on conflict do nothing`. Chỉ cộng thêm.
CREATE UNIQUE INDEX IF NOT EXISTS contract_events_override_uq
  ON contracts.contract_events (tenant_id, (data ->> 'run_id'), (data ->> 'task_id'), actor_user_id)
  WHERE type = 'approval_override';
--> statement-breakpoint
-- Bù trừ: engine không nhận quyết (not_open / đua / lỗi) sau khi đã ghi trước ⇒ xoá ĐÚNG hàng vừa chèn. `contracts_rw` không có
-- DELETE trên `contract_events` (0001) ⇒ hàm SECURITY DEFINER hẹp: chỉ type `approval_override`, chỉ hàng của tenant + người
-- của tx (`app.tenant_id`/`app.user_id`, như `reviewer_contract_ids()` 0070) ⇒ role gói không xoá được event khác / của người khác.
CREATE OR REPLACE FUNCTION contracts.void_override(p_id bigint) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH d AS (
    DELETE FROM contracts.contract_events e
    WHERE e.id = p_id AND e.type = 'approval_override'
      AND e.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND e.actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM d);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.void_override(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.void_override(bigint) TO contracts_rw;
