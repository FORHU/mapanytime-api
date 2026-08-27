-- CheckConstraint (F43/F75, see OPEN-FLAGS.md): neither stock counter may go
-- negative. The release paths used to decrement "quantityReserved" straight
-- from an order's items, so a hold the TTL sweeper had already given back was
-- subtracted a second time. Nothing failed at the time — the row simply went
-- negative, and since availability is computed as
-- ("quantityOnHand" - "quantityReserved") the product then read as having more
-- stock than it had. This makes a recurrence fail at the write instead.

-- Existing damage has to be cleared first or the constraint cannot be added.
-- A negative reserved count means holds were released more often than taken;
-- for a hold that no longer exists, zero is the only defensible value.
UPDATE "Inventory" SET "quantityReserved" = 0 WHERE "quantityReserved" < 0;
UPDATE "Inventory" SET "quantityOnHand" = 0 WHERE "quantityOnHand" < 0;

ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_quantity_reserved_nonnegative" CHECK ("quantityReserved" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_quantity_on_hand_nonnegative" CHECK ("quantityOnHand" >= 0);
