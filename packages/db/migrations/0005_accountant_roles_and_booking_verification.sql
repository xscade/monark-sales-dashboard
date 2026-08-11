CREATE TYPE "public"."booking_verification_status" AS ENUM('pending', 'validated', 'no_match');--> statement-breakpoint
CREATE TYPE "public"."user_role_type" AS ENUM('accountant');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "verification_status" "booking_verification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "verified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "verified_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_type" "user_role_type";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_org_verification_idx" ON "bookings" USING btree ("org_id","verification_status","booked_at");--> statement-breakpoint
-- Every pre-existing booking becomes 'pending' on purpose. None of them has
-- ever been reconciled against a bank statement, so quietly backfilling them as
-- validated would put a finance tick on money nobody in accounts has looked at.
COMMENT ON COLUMN "bookings"."verification_status" IS 'Finance reconciliation, independent of the sales milestone in bookings.status';--> statement-breakpoint
COMMENT ON COLUMN "bookings"."verified_amount" IS 'Net collected at the moment of the decision; the accounts queue re-raises a booking once collections move past it';--> statement-breakpoint
COMMENT ON COLUMN "users"."permissions" IS 'Per-module CRUD grants; NULL means "never customised, fall back to role defaults" and is distinct from an empty object';--> statement-breakpoint
COMMENT ON COLUMN "users"."role_type" IS 'Back-office specialisation layered on the base role; accountant unlocks the booking verification queue';