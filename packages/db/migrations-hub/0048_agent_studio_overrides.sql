-- seed-keep-studio: cac cot cua agent ma admin da doi qua Studio; `hub:seed` khong ghi de cac cot nay.
ALTER TABLE hub.agents ADD COLUMN studio_overrides text[] NOT NULL DEFAULT '{}';
