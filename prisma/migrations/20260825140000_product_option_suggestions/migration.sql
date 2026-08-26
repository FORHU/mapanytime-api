-- Product option tier: category-driven suggestions for the option builder,
-- plus DB backstops on the option tables themselves.
--
-- SAFETY / PRECONDITION for the two unique indexes below.
-- The option tables are NOT empty: marketplace_data.seeder.ts seeds one
-- ProductOptions row ("Size / Weight") with three ProductOptionValues. They
-- were verified free of duplicates before this migration was written:
--
--   SELECT "productId", "name",  count(*) FROM "ProductOptions"
--     GROUP BY 1,2 HAVING count(*) > 1;   -- must return 0 rows
--   SELECT "optionId",  "value", count(*) FROM "ProductOptionValues"
--     GROUP BY 1,2 HAVING count(*) > 1;   -- must return 0 rows
--
-- Re-run both before applying anywhere with real seller data. A duplicate makes
-- CREATE UNIQUE INDEX fail and aborts the whole migration.
--
-- These indexes are a backstop, not the primary defence: Postgres uniques are
-- case- and whitespace-sensitive, so "Size" / "size" / "Size " all pass.
-- normalizeProductOptions() in src/modules/products/product-options.helper.ts
-- is what actually enforces uniqueness; if it is ever bypassed, this index
-- turns a silent data problem into a P2002. That trade is deliberate.

-- CreateTable
CREATE TABLE "CategoryVariantSuggestions" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryVariantSuggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryVariantSuggestions_categoryId_position_idx" ON "CategoryVariantSuggestions"("categoryId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryVariantSuggestions_categoryId_name_key" ON "CategoryVariantSuggestions"("categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionValues_optionId_value_key" ON "ProductOptionValues"("optionId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptions_productId_name_key" ON "ProductOptions"("productId", "name");

-- AddForeignKey
-- CASCADE, not Prisma's default RESTRICT: CategoryService.deleteCategory
-- hard-deletes a category with no subCategories/products/stores, and a
-- suggestion row would otherwise block that with an FK error. Suggestions are
-- platform metadata restored by re-seeding, so they must never gate a delete.
ALTER TABLE "CategoryVariantSuggestions" ADD CONSTRAINT "CategoryVariantSuggestions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
