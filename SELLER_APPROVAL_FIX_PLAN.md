# Seller Approval Status - Fix Plan

## Problem Overview

When a seller registers, they are created with `applicationStatus: PENDING` and **never get approved**. This prevents them from creating/editing products.

```
User Registration
    ↓
Seller Created with applicationStatus = PENDING (default)
    ↓
Seller stuck in PENDING forever ❌
    ↓
Cannot create/edit products (403 error)
```

---

## Root Cause

**File:** `src/modules/auth/auth.repository.ts` (Lines 24-27)

```typescript
static async createSeller(userId: string) {
  return prisma.sellers.create({
    data: { userId }, // ❌ Only sets userId, applicationStatus defaults to PENDING
  });
}
```

**Default in Schema:** `prisma/schema.prisma`

```prisma
model Sellers {
  applicationStatus     ApplicationStatus       @default(PENDING)
  // ... other fields
}

enum ApplicationStatus {
  PENDING    ← Default when seller registers
  APPROVED   ← Needed to create products
  REJECTED   ← Denied access
}
```

---

## Solution Options

### Option 1: Auto-Approve on Registration (Simple) ⭐ Recommended

**For development/testing purposes**

Change the default to `APPROVED`:

```diff
// prisma/schema.prisma
- applicationStatus     ApplicationStatus       @default(PENDING)
+ applicationStatus     ApplicationStatus       @default(APPROVED)
```

Then create a migration:

```bash
npx prisma migrate dev --name auto_approve_sellers
```

**Pros:** Simple, sellers can immediately create products  
**Cons:** No approval workflow, not suitable for production

---

### Option 2: Create Admin Approval Endpoint (Production) ⭐⭐ Better

**Requires admin to manually approve sellers**

**Files to Create/Modify:**

1. **`src/modules/sellers/seller.controller.ts`** (Create)

```typescript
import { Request, Response, NextFunction } from 'express';
import SellerService from './seller.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class SellerController {
  static async approveSeller(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      sellerId: Joi.string().required(),
      approved: Joi.boolean().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;

      // Check if user is admin
      const user = await getUserWithRoles(userId);
      if (!user.roles.some((r) => r.roleName === 'ADMIN')) {
        return responseError(res, 403, 'Only admins can approve sellers.');
      }

      const seller = await SellerService.approveSeller(value.sellerId, value.approved);

      return responseSuccess(res, 200, seller, 'Seller approval updated.');
    } catch (error) {
      next(error);
    }
  }
}
```

2. **`src/modules/sellers/seller.service.ts`** (Create)

```typescript
export default class SellerService {
  static async approveSeller(sellerId: string, approved: boolean) {
    return prisma.sellers.update({
      where: { id: sellerId },
      data: {
        applicationStatus: approved ? 'APPROVED' : 'REJECTED',
      },
      include: {
        users: true,
        stores: true,
      },
    });
  }

  static async getSellersAwaitingApproval() {
    return prisma.sellers.findMany({
      where: { applicationStatus: 'PENDING' },
      include: {
        users: true,
        documentVerifications: true,
      },
    });
  }
}
```

3. **Route in `src/routes/sellers.ts`** (Create)

```typescript
// POST /api/v1/sellers/:id/approve
// Body: { approved: true }
router.post('/:id/approve', authMiddleware, sellerController.approveSeller);

// GET /api/v1/sellers/pending-approval
router.get('/pending-approval', authMiddleware, sellerController.getPendingApprovals);
```

**Pros:** Professional, audit trail, admin control  
**Cons:** More code, requires admin workflow

---

### Option 3: Auto-Approve + Admin Can Reject (Balanced) ⭐⭐⭐ Best

**Auto-approve on registration, but allow admins to reject**

```diff
// prisma/schema.prisma
- applicationStatus     ApplicationStatus       @default(PENDING)
+ applicationStatus     ApplicationStatus       @default(APPROVED)
```

Then create admin endpoints to manage approvals:

```typescript
// Admin can list and manage sellers
GET /api/v1/admin/sellers
PATCH /api/v1/admin/sellers/:id/status
```

**Pros:** Users can immediately start selling, admins can revoke if needed  
**Cons:** Requires admin oversight

---

## Recommended Fix (Option 1 - For Now)

### Step 1: Update Schema

**File:** `prisma/schema.prisma`

```diff
- applicationStatus     ApplicationStatus       @default(PENDING)
+ applicationStatus     ApplicationStatus       @default(APPROVED)
```

### Step 2: Create Migration

```bash
cd mapanytime-api
npx prisma migrate dev --name auto_approve_new_sellers
```

### Step 3: Apply Migration

The migration will automatically apply. All new sellers will start as APPROVED.

### Step 4: Fix Existing PENDING Sellers (If Any)

```sql
UPDATE "Sellers"
SET "applicationStatus" = 'APPROVED'
WHERE "applicationStatus" = 'PENDING';
```

### Step 5: Test

1. Create a new seller account
2. Try to create a product
3. Should succeed now ✅

---

## Implementation Timeline

| Option   | Effort  | Time    | When to Use                   |
| -------- | ------- | ------- | ----------------------------- |
| Option 1 | 5 min   | 5 min   | Development/Testing           |
| Option 2 | 2 hours | 2 hours | Production with admin control |
| Option 3 | 1 hour  | 1 hour  | Production with balance       |

---

## Files Involved

```
prisma/schema.prisma
  ├─ Sellers model
  └─ ApplicationStatus enum

src/modules/auth/auth.repository.ts
  └─ createSeller() method

src/modules/auth/auth.service.ts
  └─ May need updates for onboarding logic

src/modules/products/product.service.ts
  └─ Checks applicationStatus

src/modules/inventory/inventory.service.ts
  └─ Checks applicationStatus

src/modules/orders/order.service.ts
  └─ Checks applicationStatus
```

---

## Current Status

**Problem:** ❌ Sellers default to PENDING  
**Impact:** Sellers cannot create/edit products  
**Solution:** Change default to APPROVED or create approval workflow  
**Recommendation:** Option 1 (auto-approve) for now, upgrade to Option 3 for production

---

## Next Steps

Choose an option above and I'll implement it for you!

**Option 1 (Quick):** Change default to APPROVED  
**Option 3 (Production):** Auto-approve + admin can reject

Which would you prefer?
