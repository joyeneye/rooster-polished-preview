INSERT INTO "booking_categories" ("slug", "name", "description", "icon", "active", "sort_order") VALUES
('music-engineers', 'Music Engineers', 'Recording, mixing, mastering, vocal production, and audio engineering sessions.', 'headphones', true, 75),
('studio-time', 'Studio Time', 'Book recording studios, vocal booths, podcast rooms, rehearsal spaces, and production suites.', 'mic', true, 76)
ON CONFLICT ("slug") DO NOTHING;
