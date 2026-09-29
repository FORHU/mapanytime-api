-- Pilot fleet for God's Eye: buyer@example.com drives jeepney PILOT-001.
-- Data only, mirroring prisma/seeders/pilot_driver.seeder.ts (deploys never run
-- the seed). Idempotent, and does nothing where that account doesn't exist.

INSERT INTO "VehicleTypes" ("id", "code", "name", "sortOrder", "updatedAt") VALUES
  ('vt_jeepney', 'JEEPNEY', 'Jeepney', 0, NOW()),
  ('vt_tricycle', 'TRICYCLE', 'Tricycle', 1, NOW()),
  ('vt_taxi', 'TAXI', 'Taxi', 2, NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "TransportOperators" ("id", "name", "updatedAt")
SELECT 'op_mapanytime_pilot', 'MapAnytime Pilot', NOW()
WHERE EXISTS (SELECT 1 FROM "Users" WHERE "email" = 'buyer@example.com')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TransportOperatorMembers" ("id", "operatorId", "userId", "role", "updatedAt")
SELECT 'opm_pilot_buyer', 'op_mapanytime_pilot', u."id", 'DRIVER', NOW()
FROM "Users" u
WHERE u."email" = 'buyer@example.com'
ON CONFLICT ("operatorId", "userId") DO NOTHING;

-- Covers both unique plate and unique driver: if buyer already drives
-- something, it's left alone.
INSERT INTO "Vehicles" ("id", "operatorId", "vehicleTypeId", "driverUserId", "plateNumber", "updatedAt")
SELECT 'veh_pilot_001', 'op_mapanytime_pilot', vt."id", u."id", 'PILOT-001', NOW()
FROM "Users" u
JOIN "VehicleTypes" vt ON vt."code" = 'JEEPNEY'
WHERE u."email" = 'buyer@example.com'
ON CONFLICT DO NOTHING;
