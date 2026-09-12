INSERT INTO "booking_categories" ("slug", "name", "description", "icon", "active", "sort_order") VALUES
('beauty-products', 'Beauty & Hair Products', 'Hair products, beauty brands, creator shops, and lifestyle businesses.', 'shopping-bag', true, 25)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "active" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = NOW();
