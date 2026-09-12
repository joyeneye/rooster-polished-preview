INSERT INTO "booking_categories" ("slug", "name", "description", "icon", "active", "sort_order") VALUES
('live-performances', 'Shows & live performances', 'Live shows, concerts, artist sets, and other stage performances.', 'music', true, 140),
('podcast-interviews', 'Podcast interviews', 'Podcast guest appearances, interviews, and recorded conversations.', 'mic', true, 150),
('speaking', 'Speaking engagements', 'Keynotes, talks, workshops, and speaking appearances.', 'message-circle', true, 160),
('hosting-panels', 'Hosting & panels', 'Event hosts, emcees, panel moderators, and panel guests.', 'users', true, 170),
('church-community', 'Church & community events', 'Church engagements, community gatherings, and ministry events.', 'heart', true, 180),
('radio-media', 'Radio & media appearances', 'Radio interviews, broadcasts, and media guest appearances.', 'radio', true, 190)
ON CONFLICT ("slug") DO NOTHING;
