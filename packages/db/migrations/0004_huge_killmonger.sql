CREATE TYPE "public"."walk_in_link_type" AS ENUM('corporate_office', 'project_site', 'broker', 'sales_team');--> statement-breakpoint
ALTER TYPE "public"."unit_status" ADD VALUE 'sold';--> statement-breakpoint
CREATE TABLE "walk_in_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"link_type" "walk_in_link_type" NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"passcode_hash" text NOT NULL,
	"project_id" uuid,
	"owner_user_id" uuid,
	"extra_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"last_submission_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "walk_in_link_id" uuid;--> statement-breakpoint
ALTER TABLE "walk_in_links" ADD CONSTRAINT "walk_in_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_in_links" ADD CONSTRAINT "walk_in_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_in_links" ADD CONSTRAINT "walk_in_links_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_in_links" ADD CONSTRAINT "walk_in_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "walk_in_links_slug_idx" ON "walk_in_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "walk_in_links_org_idx" ON "walk_in_links" USING btree ("org_id","is_active");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_walk_in_link_id_walk_in_links_id_fk" FOREIGN KEY ("walk_in_link_id") REFERENCES "public"."walk_in_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_walk_in_link_idx" ON "visits" USING btree ("walk_in_link_id","arrived_at");--> statement-breakpoint
-- Deny-by-default, matching 0002. A new table is exposed over PostgREST with
-- the publishable anon key the moment it exists, and this one holds passcode
-- hashes and channel-partner phone numbers.
ALTER TABLE "walk_in_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "walk_in_links" FROM anon, authenticated;--> statement-breakpoint
COMMENT ON TABLE "walk_in_links" IS 'Passcode-gated public walk-in forms, one per acquisition channel; visits.walk_in_link_id carries the attribution downstream';--> statement-breakpoint
COMMENT ON COLUMN "walk_in_links"."passcode_hash" IS 'SHA-256 of the passcode; the plaintext is shown once at creation and never stored';