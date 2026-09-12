ALTER TABLE "founder_announcements" ALTER COLUMN "author_title" SET DEFAULT 'Founder of KON-NEKT';
--> statement-breakpoint
-- Announcements already sent still carry a retired brand in their author title.
UPDATE "founder_announcements" SET "author_title" = 'Founder of KON-NEKT'
WHERE "author_title" IN ('Founder of JSPACE', 'Founder of kon-nekt.');
--> statement-breakpoint
-- Rows the platform seeds for itself were written under a retired brand and are
-- inserted with ON CONFLICT DO NOTHING, so they will never pick the new copy up
-- on their own. Rewrite the brand in place. The retired brand ended in a period
-- the new one does not carry, so the regexp_replace first pins the periods that
-- were also ending a sentence and the plain replaces then drop the decorative
-- ones. This is the rule rebrand() applies to copy on its way out.
UPDATE "founder_announcements" SET
	"subject" = replace(replace(replace(regexp_replace("subject", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'KON-NEKT'), 'kon-nekt', 'KON-NEKT'), 'JSPACE', 'KON-NEKT'),
	"body" = replace(replace(replace(regexp_replace("body", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'KON-NEKT'), 'kon-nekt', 'KON-NEKT'), 'JSPACE', 'KON-NEKT')
WHERE "subject" LIKE '%JSPACE%' OR "subject" LIKE '%kon-nekt%'
	OR "body" LIKE '%JSPACE%' OR "body" LIKE '%kon-nekt%';
--> statement-breakpoint
UPDATE "opportunities" SET
	"title" = replace(replace(replace(regexp_replace("title", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'KON-NEKT'), 'kon-nekt', 'KON-NEKT'), 'JSPACE', 'KON-NEKT'),
	"headline" = replace(replace(replace(regexp_replace("headline", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'KON-NEKT'), 'kon-nekt', 'KON-NEKT'), 'JSPACE', 'KON-NEKT'),
	"description" = replace(replace(replace(regexp_replace("description", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'KON-NEKT'), 'kon-nekt', 'KON-NEKT'), 'JSPACE', 'KON-NEKT')
WHERE "title" LIKE '%JSPACE%' OR "title" LIKE '%kon-nekt%'
	OR "headline" LIKE '%JSPACE%' OR "headline" LIKE '%kon-nekt%'
	OR "description" LIKE '%JSPACE%' OR "description" LIKE '%kon-nekt%';
