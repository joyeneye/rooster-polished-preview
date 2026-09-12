ALTER TABLE "founder_announcements" ALTER COLUMN "author_title" SET DEFAULT 'Founder of ROSTER';
--> statement-breakpoint
-- Announcements already sent still carry a retired brand in their author title.
UPDATE "founder_announcements" SET "author_title" = 'Founder of ROSTER'
WHERE "author_title" IN ('Founder of KON-NEKT', 'Founder of JSPACE', 'Founder of kon-nekt.');
--> statement-breakpoint
-- Rows the platform seeds for itself were written under a retired brand and are
-- inserted with ON CONFLICT DO NOTHING, so they will never pick the new copy up
-- on their own. Rewrite the brand in place. This only touches brand words in
-- copy; no row is removed and no member data is reset. The retired lowercase
-- brand ended in a period the new one does not carry, so the regexp_replace
-- first pins the periods that were also ending a sentence and the plain
-- replaces then drop the decorative ones.
UPDATE "founder_announcements" SET
	"subject" = replace(replace(replace(replace(regexp_replace("subject", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'ROSTER'), 'kon-nekt', 'ROSTER'), 'KON-NEKT', 'ROSTER'), 'JSPACE', 'ROSTER'),
	"body" = replace(replace(replace(replace(regexp_replace("body", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'ROSTER'), 'kon-nekt', 'ROSTER'), 'KON-NEKT', 'ROSTER'), 'JSPACE', 'ROSTER')
WHERE "subject" LIKE '%JSPACE%' OR "subject" LIKE '%kon-nekt%' OR "subject" LIKE '%KON-NEKT%'
	OR "body" LIKE '%JSPACE%' OR "body" LIKE '%kon-nekt%' OR "body" LIKE '%KON-NEKT%';
--> statement-breakpoint
UPDATE "opportunities" SET
	"title" = replace(replace(replace(replace(regexp_replace("title", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'ROSTER'), 'kon-nekt', 'ROSTER'), 'KON-NEKT', 'ROSTER'), 'JSPACE', 'ROSTER'),
	"headline" = replace(replace(replace(replace(regexp_replace("headline", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'ROSTER'), 'kon-nekt', 'ROSTER'), 'KON-NEKT', 'ROSTER'), 'JSPACE', 'ROSTER'),
	"description" = replace(replace(replace(replace(regexp_replace("description", 'kon-nekt\.([[:space:]]+[[:upper:]])', 'KON-NEKT.\1', 'g'), 'kon-nekt.', 'ROSTER'), 'kon-nekt', 'ROSTER'), 'KON-NEKT', 'ROSTER'), 'JSPACE', 'ROSTER')
WHERE "title" LIKE '%JSPACE%' OR "title" LIKE '%kon-nekt%' OR "title" LIKE '%KON-NEKT%'
	OR "headline" LIKE '%JSPACE%' OR "headline" LIKE '%kon-nekt%' OR "headline" LIKE '%KON-NEKT%'
	OR "description" LIKE '%JSPACE%' OR "description" LIKE '%kon-nekt%' OR "description" LIKE '%KON-NEKT%';
