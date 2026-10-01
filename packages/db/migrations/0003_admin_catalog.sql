-- ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-31, ADM-FR-50 · spec M2 §4: 6 bảng catalog + features.updated_by (drizzle-kit sinh).
CREATE TABLE "admin"."command_names" (
	"name" text PRIMARY KEY NOT NULL,
	"command_id" uuid NOT NULL,
	CONSTRAINT "command_names_name_check" CHECK ("admin"."command_names"."name" ~ '^[a-z0-9-]{2,32}$')
);
--> statement-breakpoint
CREATE TABLE "admin"."commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" jsonb NOT NULL,
	"workflow_id" uuid NOT NULL,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"mode" text DEFAULT 'sync' NOT NULL,
	"timeout_s" integer DEFAULT 30 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "commands_name_check" CHECK ("admin"."commands"."name" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "commands_aliases_check" CHECK (cardinality("admin"."commands"."aliases") <= 5),
	CONSTRAINT "commands_description_check" CHECK (jsonb_typeof("admin"."commands"."description") = 'object' AND "admin"."commands"."description" ? 'vi'),
	CONSTRAINT "commands_args_check" CHECK (jsonb_typeof("admin"."commands"."args") = 'array'),
	CONSTRAINT "commands_input_map_check" CHECK (jsonb_typeof("admin"."commands"."input_map") = 'object'),
	CONSTRAINT "commands_output_check" CHECK (jsonb_typeof("admin"."commands"."output") = 'object'),
	CONSTRAINT "commands_mode_check" CHECK ("admin"."commands"."mode" IN ('sync', 'async')),
	CONSTRAINT "commands_timeout_s_check" CHECK ("admin"."commands"."timeout_s" BETWEEN 1 AND 600),
	CONSTRAINT "commands_version_check" CHECK ("admin"."commands"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "admin"."feature_commands" (
	"feature_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	CONSTRAINT "feature_commands_pkey" PRIMARY KEY("feature_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "admin"."feature_entitlements" (
	"feature_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY("feature_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "admin"."secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"last4" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "secrets_name_check" CHECK ("admin"."secrets"."name" ~ '^[A-Z0-9_]{2,64}$'),
	CONSTRAINT "secrets_ciphertext_check" CHECK (octet_length("admin"."secrets"."ciphertext") BETWEEN 24 AND 6160),
	CONSTRAINT "secrets_iv_check" CHECK (octet_length("admin"."secrets"."iv") = 12),
	CONSTRAINT "secrets_key_version_check" CHECK ("admin"."secrets"."key_version" >= 1),
	CONSTRAINT "secrets_last4_check" CHECK (char_length("admin"."secrets"."last4") = 4),
	CONSTRAINT "secrets_note_check" CHECK (char_length("admin"."secrets"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "admin"."workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"app_type" text NOT NULL,
	"base_url" text NOT NULL,
	"secret_id" uuid NOT NULL,
	"input_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_field" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "workflows_key_check" CHECK ("admin"."workflows"."key" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "workflows_name_check" CHECK (char_length("admin"."workflows"."name") BETWEEN 1 AND 128),
	CONSTRAINT "workflows_description_check" CHECK (char_length("admin"."workflows"."description") BETWEEN 20 AND 400),
	CONSTRAINT "workflows_app_type_check" CHECK ("admin"."workflows"."app_type" IN ('workflow', 'chat', 'agent')),
	CONSTRAINT "workflows_base_url_check" CHECK (char_length("admin"."workflows"."base_url") <= 2048 AND "admin"."workflows"."base_url" ~ '^https?://'),
	CONSTRAINT "workflows_input_schema_check" CHECK (jsonb_typeof("admin"."workflows"."input_schema") = 'array'),
	CONSTRAINT "workflows_output_field_check" CHECK (char_length("admin"."workflows"."output_field") BETWEEN 1 AND 128),
	CONSTRAINT "workflows_version_check" CHECK ("admin"."workflows"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "admin"."features" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "admin"."command_names" ADD CONSTRAINT "command_names_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "admin"."commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."commands" ADD CONSTRAINT "commands_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "admin"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."commands" ADD CONSTRAINT "commands_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_commands" ADD CONSTRAINT "feature_commands_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "admin"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_commands" ADD CONSTRAINT "feature_commands_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "admin"."commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_entitlements" ADD CONSTRAINT "feature_entitlements_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "admin"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_entitlements" ADD CONSTRAINT "feature_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."feature_entitlements" ADD CONSTRAINT "feature_entitlements_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."secrets" ADD CONSTRAINT "secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."workflows" ADD CONSTRAINT "workflows_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "admin"."secrets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."workflows" ADD CONSTRAINT "workflows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "command_names_command_idx" ON "admin"."command_names" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commands_name_uq" ON "admin"."commands" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commands_workflow_idx" ON "admin"."commands" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "feature_commands_command_idx" ON "admin"."feature_commands" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "feature_entitlements_tenant_active_idx" ON "admin"."feature_entitlements" USING btree ("tenant_id","feature_id") WHERE "admin"."feature_entitlements"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_name_uq" ON "admin"."secrets" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_key_uq" ON "admin"."workflows" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workflows_secret_idx" ON "admin"."workflows" USING btree ("secret_id");--> statement-breakpoint
ALTER TABLE "admin"."features" ADD CONSTRAINT "features_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;