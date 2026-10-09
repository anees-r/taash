-- Game catalogue. Thulla is playable; the others are planned and cannot be played yet.
INSERT INTO "games" ("id", "name", "status") VALUES
  ('thulla', 'Thulla', 'playable'),
  ('rung', 'Rung', 'workshop'),
  ('bluff', 'Bluff', 'workshop'),
  ('seep', 'Seep', 'workshop')
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "status" = EXCLUDED."status";
