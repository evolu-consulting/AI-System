-- ADM-FR-62, ADM-FR-32, ADM-FR-53 · spec M3 §4: groups, group_members, feature_grants, config_meta + users_tenant_id_uq (drizzle-kit sinh; users_tenant_id_uq dời lên trước FK kép vì FK cần đích unique có sẵn).
CREATE TABLE "admin"."config_meta" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"config_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "config_meta_id_check" CHECK ("admin"."config_meta"."id" = 1),
	CONSTRAINT "config_meta_config_version_check" CHECK ("admin"."config_meta"."config_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "admin"."feature_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"group_id" uuid,
	"user_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_grants_subject_check" CHECK (num_nonnulls("admin"."feature_grants"."group_id", "admin"."feature_grants"."user_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "admin"."group_members" (
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_pkey" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "admin"."groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "groups_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "groups_key_check" CHECK ("admin"."groups"."key" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "groups_name_check" CHECK (jsonb_typeof("admin"."groups"."name") = 'object' AND "admin"."groups"."name" ? 'vi'),
	CONSTRAINT "groups_description_check" CHECK (char_length("admin"."groups"."description") <= 400),
	CONSTRAINT "groups_version_check" CHECK ("admin"."groups"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "admin"."users" ADD CONSTRAINT "users_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "admin"."feature_grants" ADD CONSTRAINT "feature_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_grants" ADD CONSTRAINT "feature_grants_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "admin"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_grants" ADD CONSTRAINT "feature_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_grants" ADD CONSTRAINT "feature_grants_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "admin"."groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_grants" ADD CONSTRAINT "feature_grants_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "admin"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."group_members" ADD CONSTRAINT "group_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."group_members" ADD CONSTRAINT "group_members_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "admin"."groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."group_members" ADD CONSTRAINT "group_members_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "admin"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."groups" ADD CONSTRAINT "groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_grants_tenant_feature_idx" ON "admin"."feature_grants" USING btree ("tenant_id","feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_grants_group_uq" ON "admin"."feature_grants" USING btree ("tenant_id","feature_id","group_id") WHERE "admin"."feature_grants"."group_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_grants_user_uq" ON "admin"."feature_grants" USING btree ("tenant_id","feature_id","user_id") WHERE "admin"."feature_grants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feature_grants_group_idx" ON "admin"."feature_grants" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "feature_grants_user_idx" ON "admin"."feature_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "admin"."group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_tenant_key_uq" ON "admin"."groups" USING btree ("tenant_id","key");
