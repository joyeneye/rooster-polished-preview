ALTER TABLE "founder_announcements" ALTER COLUMN "author_title" SET DEFAULT 'Founder of kon-nekt.';
--> statement-breakpoint
-- Announcements already sent still carry the old brand in their author title.
UPDATE "founder_announcements" SET "author_title" = 'Founder of kon-nekt.' WHERE "author_title" = 'Founder of JSPACE';
--> statement-breakpoint
-- Rows the platform seeds for itself were written with the old brand and are
-- inserted with ON CONFLICT DO NOTHING, so they will never pick the new copy up
-- on their own. Rewrite the brand in place; the nested replace stops the
-- brand's own trailing period from doubling up.
UPDATE "founder_announcements" SET
	"subject" = replace(replace("subject", 'JSPACE', 'kon-nekt.'), 'kon-nekt..', 'kon-nekt.'),
	"body" = replace(replace("body", 'JSPACE', 'kon-nekt.'), 'kon-nekt..', 'kon-nekt.')
WHERE "subject" LIKE '%JSPACE%' OR "body" LIKE '%JSPACE%';
--> statement-breakpoint
UPDATE "opportunities" SET
	"title" = replace(replace("title", 'JSPACE', 'kon-nekt.'), 'kon-nekt..', 'kon-nekt.'),
	"headline" = replace(replace("headline", 'JSPACE', 'kon-nekt.'), 'kon-nekt..', 'kon-nekt.'),
	"description" = replace(replace("description", 'JSPACE', 'kon-nekt.'), 'kon-nekt..', 'kon-nekt.')
WHERE "slug" = 'jspace-female-group-2026';
