import { MERCHANTDISCOUNTTYPE } from '@prisma/client';
import MerchantAdsRepository from './merchantAds.repository';
import StoreService, { filterLiveAds, type MerchantAdWithProducts } from '../stores/store.service';
import type { NearbyStore } from '../stores/store.repository';
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';
import { deriveAdState, windowsOverlap, START_GRACE_MS, type AdWindowState } from './adWindow';
import { publish } from '../../infrastructure/rabbitmq/publisher';
import { assertStoreInScope, resolveAccessibleStoreIds } from '../organization/storeAccess';
import type { AuthUser } from '../auth/auth.repository';

async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

interface AdFields {
  kind?: 'PROMO' | 'JOB' | 'EVENT';
  title: string;
  description: string;
  imageUrl?: string;
  badgeId?: string | null;
  badgeLabel?: string | null;
  ctaLabel?: string;
  salaryLabel?: string;
  buyQuantity?: number;
  freeQuantity?: number;
  discountType?: MERCHANTDISCOUNTTYPE;
  discountValue?: number;
  goal?: 'STORE_VISITS' | 'IMPRESSIONS' | 'PURCHASES';
  format?: 'MAP_FLOATING_CARD' | 'PROMOTED_PIN' | 'DISCOVERY_CAROUSEL' | 'SPONSORED_SEARCH';
  radiusKm?: number;
  targetLat?: number;
  targetLng?: number;
  dailyBudget?: number;
  totalBudget?: number;
  startAt?: Date | null;
  expiresAt?: Date | null;
  products?: { productId: string; variantId?: string }[];
}

interface CreateAdPayload extends AdFields {
  storeId: string;
}

type ProductLink = { productId: string; variantId: string | null };

/**
 * Two ads collide on stock if they share a product and their variant scopes
 * intersect. A link with variantId NULL covers the whole product, so it
 * collides with every variant of it.
 */
function productScopesIntersect(a: ProductLink[], b: ProductLink[]): ProductLink[] {
  return a.filter((x) =>
    b.some(
      (y) =>
        x.productId === y.productId &&
        (x.variantId === null || y.variantId === null || x.variantId === y.variantId),
    ),
  );
}

function formatWindow(startAt: Date | null, expiresAt: Date | null, timeZone: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(d);

  if (startAt && expiresAt) return `from ${fmt(startAt)} to ${fmt(expiresAt)}`;
  if (expiresAt) return `until ${fmt(expiresAt)}`;
  if (startAt) return `from ${fmt(startAt)} onwards`;
  return 'with no end date';
}

export default class MerchantAdsService {
  /**
   * Which stores the caller may run promotions for.
   *
   * A `SELLER_ADMIN` reaches every store the organization owns, a `SELLER_USER`
   * only the stores explicitly assigned to them, and a pre-organization seller
   * their own. The previous check demanded a `Sellers` row and then compared it
   * against `store.sellerId` — an IDENTITY test that organization staff can
   * never satisfy, since they deliberately have no `Sellers` row of their own.
   *
   * Out-of-scope is 404 rather than 403, matching the convention in
   * storeAccess.ts: a store outside your scope must be indistinguishable from
   * one that does not exist, so ids cannot be probed.
   */
  private static assertOwnership(user: AuthUser, storeId: string) {
    return assertStoreInScope(user, storeId);
  }

  /**
   * Reject any product that does not belong to the store the ad runs for.
   *
   * The product links were written straight through, so a promotion could
   * reference another store's product — including one in a different
   * organization. Nothing reads those rows without re-asserting the store, so
   * it was never directly exploitable, but it is cross-tenant data one filter
   * away from being so.
   */
  private static async assertProductsInStore(storeId: string, products: ProductLink[]) {
    if (products.length === 0) return;

    const ids = [...new Set(products.map((p) => p.productId))];
    const owned = await MerchantAdsRepository.countProductsInStore(storeId, ids);
    if (owned !== ids.length) {
      throw { status: 404, message: 'Product not found.' };
    }
  }

  /**
   * Rejects a start time already in the past, allowing START_GRACE_MS of slack
   * for clock skew between the seller's device and this server.
   *
   * On update the stored value is passed as `storedStartAt`: a running ad's
   * start is in the past by definition, and editing its title must not fail
   * validation on a field the seller never touched.
   */
  private static assertStartNotPast(startAt: Date | null | undefined, storedStartAt?: Date | null) {
    if (!startAt) return;
    if (storedStartAt && startAt.getTime() === storedStartAt.getTime()) return;

    if (startAt.getTime() < Date.now() - START_GRACE_MS) {
      throw {
        status: 400,
        code: 'AD_START_IN_PAST',
        message: 'That start time has already passed. Pick a future time, or start it now.',
      };
    }
  }

  /**
   * A promotion that is already running cannot have its start rewritten:
   * impressions, clicks and spend were attributed against the original start,
   * so moving it would make the analytics describe a window that never existed.
   */
  private static assertStartNotLocked(
    ad: { startAt: Date | null; expiresAt: Date | null; isActive: boolean },
    nextStartAt: Date | null | undefined,
    hasStartAtKey: boolean,
  ) {
    if (!hasStartAtKey) return;

    const state = deriveAdState(ad);
    if (state === 'SCHEDULED') return;

    const unchanged =
      (ad.startAt === null && nextStartAt == null) ||
      (ad.startAt !== null &&
        nextStartAt != null &&
        ad.startAt.getTime() === nextStartAt.getTime());

    if (!unchanged) {
      throw {
        status: 409,
        code: 'AD_START_LOCKED',
        message:
          'This promotion has already started, so its start time is locked. ' +
          'You can still change when it ends.',
      };
    }
  }

  /**
   * Blocks only the case that actually breaks pricing: two discount promotions
   * applying competing prices to the same product at the same instant. Ads with
   * no discount, or touching different products, are free to overlap.
   */
  private static async assertNoWindowConflict(
    storeId: string,
    candidate: {
      kind?: string;
      discountType?: MERCHANTDISCOUNTTYPE | null;
      startAt: Date | null;
      expiresAt: Date | null;
      products: ProductLink[];
    },
    excludeAdId?: string,
  ) {
    if (candidate.kind !== 'PROMO' || !candidate.discountType) return;
    if (candidate.products.length === 0) return;

    const conflicts = await MerchantAdsRepository.findWindowConflicts(
      storeId,
      { startAt: candidate.startAt, expiresAt: candidate.expiresAt },
      candidate.products.map((p) => p.productId),
      excludeAdId,
    );

    for (const other of conflicts) {
      // The SQL filter is a coarse pre-selection; confirm with the exact
      // half-open test so a window merely touching another isn't rejected.
      if (!windowsOverlap(candidate, other)) continue;

      const shared = productScopesIntersect(candidate.products, other.products);
      if (shared.length === 0) continue;

      const timezone = await MerchantAdsRepository.getStoreTimezone(storeId);
      throw {
        status: 409,
        code: 'PROMO_WINDOW_CONFLICT',
        message:
          `"${other.title}" already discounts one of these products ` +
          `${formatWindow(other.startAt, other.expiresAt, timezone)}. ` +
          'End that promotion first, or pick a window outside it.',
        details: {
          adId: other.id,
          title: other.title,
          startAt: other.startAt,
          expiresAt: other.expiresAt,
          productIds: [...new Set(shared.map((p) => p.productId))],
          timezone,
        },
      };
    }
  }

  /**
   * A preset (`badgeId` set) always wins: `badgeLabel` is overwritten from the
   * badge row so a client-sent label can never drift from the seller's actual
   * pick. Otherwise the trimmed `badgeLabel` is treated as a custom string.
   * Throws 400 on an unknown or inactive badge id.
   */
  private static async lookupBadgeChoice(input: {
    badgeId?: string | null;
    badgeLabel?: string | null;
  }): Promise<{ badgeLabel: string | null; badgeRowId: string | null }> {
    if (input.badgeId) {
      const badge = await MerchantAdsRepository.getBadgeById(input.badgeId);
      if (!badge || !badge.isActive) {
        throw {
          status: 400,
          code: 'BADGE_NOT_FOUND',
          message: 'Select a valid badge from the list.',
        };
      }
      return { badgeLabel: badge.label, badgeRowId: badge.id };
    }

    return { badgeLabel: input.badgeLabel?.trim() || null, badgeRowId: null };
  }

  /**
   * Returns `undefined` when the caller's payload had neither key of its own
   * (checked by the caller against the *original* payload — an object
   * literal like `{ badgeId, badgeLabel }` always has both keys, even when
   * both values are `undefined`, so that check can't be done in here),
   * so createAd leaves the column at its nullable default.
   */
  private static async resolveBadgeForCreate(
    input: { badgeId?: string | null; badgeLabel?: string | null },
    hasBadgeField: boolean,
  ): Promise<{ badgeLabel: string | null; badge?: { connect: { id: string } } } | undefined> {
    if (!hasBadgeField) return undefined;

    const { badgeLabel, badgeRowId } = await this.lookupBadgeChoice(input);
    return { badgeLabel, ...(badgeRowId ? { badge: { connect: { id: badgeRowId } } } : {}) };
  }

  /**
   * Returns `undefined` when the caller's payload had neither key of its own,
   * so updateAd leaves the badge untouched — Prisma ignores undefined fields
   * on update. Clearing a preset needs an explicit `disconnect`, since a
   * stale connect otherwise survives.
   */
  private static async resolveBadgeForUpdate(
    input: { badgeId?: string | null; badgeLabel?: string | null },
    hasBadgeField: boolean,
  ): Promise<
    | { badgeLabel: string | null; badge: { connect: { id: string } } | { disconnect: true } }
    | undefined
  > {
    if (!hasBadgeField) return undefined;

    const { badgeLabel, badgeRowId } = await this.lookupBadgeChoice(input);
    return {
      badgeLabel,
      badge: badgeRowId ? { connect: { id: badgeRowId } } : { disconnect: true as const },
    };
  }

  static async listBadges() {
    return MerchantAdsRepository.listActiveBadges();
  }

  /** Attaches the derived window state and the store's zone to an ad row. */
  private static decorate<
    T extends { startAt: Date | null; expiresAt: Date | null; isActive: boolean },
  >(ad: T, timezone: string, now: Date): T & { state: AdWindowState; storeTimezone: string } {
    return { ...ad, state: deriveAdState(ad, now), storeTimezone: timezone };
  }

  static async listMyAds(user: AuthUser, storeId: string) {
    await this.assertOwnership(user, storeId);

    const now = new Date();
    const [ads, timezone] = await Promise.all([
      MerchantAdsRepository.getAdsByStoreId(storeId),
      MerchantAdsRepository.getStoreTimezone(storeId),
    ]);

    return {
      // Lets the seller UI measure its own clock drift instead of trusting the
      // browser for countdowns and past-time checks.
      serverTime: now.toISOString(),
      items: ads.map((ad) => this.decorate(ad, timezone, now)),
    };
  }

  static async listAllMyAds(user: AuthUser) {
    const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(user);
    if (!hasOrg && !hasSellerRow) {
      throw { status: 403, message: 'Only sellers can access merchant ads.' };
    }

    const now = new Date();
    // An empty scope yields no ads rather than every ad — the state a member
    // with no store assigned yet lands in.
    const ads = await MerchantAdsRepository.getAdsByStoreIds(storeIds);

    // One seller can own stores in different zones, so the listing resolves a
    // zone per row rather than assuming a single one for the whole page.
    const timezones = await MerchantAdsRepository.getStoreTimezones([
      ...new Set(ads.map((ad) => ad.storeId)),
    ]);

    return {
      serverTime: now.toISOString(),
      items: ads.map((ad) => this.decorate(ad, timezones.get(ad.storeId) ?? 'Asia/Manila', now)),
    };
  }

  static async createAd(user: AuthUser, payload: CreateAdPayload) {
    await this.assertOwnership(user, payload.storeId);

    const { storeId, products, badgeId, badgeLabel, ...adFields } = payload;

    await this.assertProductsInStore(
      storeId,
      (products ?? []).map((p) => ({ productId: p.productId, variantId: p.variantId ?? null })),
    );

    this.assertStartNotPast(adFields.startAt);
    await this.assertNoWindowConflict(storeId, {
      kind: adFields.kind ?? 'PROMO',
      discountType: adFields.discountType,
      startAt: adFields.startAt ?? null,
      expiresAt: adFields.expiresAt ?? null,
      products: (products ?? []).map((p) => ({
        productId: p.productId,
        variantId: p.variantId ?? null,
      })),
    });

    const hasBadgeField =
      Object.prototype.hasOwnProperty.call(payload, 'badgeId') ||
      Object.prototype.hasOwnProperty.call(payload, 'badgeLabel');
    const resolvedBadge = await this.resolveBadgeForCreate({ badgeId, badgeLabel }, hasBadgeField);

    return MerchantAdsRepository.createAd({
      ...adFields,
      ...resolvedBadge,
      kind: adFields.kind || 'PROMO',
      store: { connect: { id: storeId } },
      products:
        products && products.length > 0
          ? {
              create: products.map((p) => ({
                product: { connect: { id: p.productId } },
                ...(p.variantId ? { variant: { connect: { id: p.variantId } } } : {}),
              })),
            }
          : undefined,
    });
  }

  static async setActive(user: AuthUser, adId: string, isActive: boolean) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(user, ad.storeId);

    const timezone = await MerchantAdsRepository.getStoreTimezone(ad.storeId);

    // Resuming an ad whose window has closed can't bring it back — say so
    // rather than accepting the toggle and leaving the seller wondering why
    // nothing happened. Pausing one is harmless, so it's allowed through.
    if (isActive && deriveAdState(ad) === 'ENDED') {
      throw {
        status: 409,
        code: 'AD_ALREADY_ENDED',
        message:
          'This promotion has already ended, so resuming it has no effect. ' +
          'Change its end time to run it again.',
      };
    }

    const updated = await MerchantAdsRepository.setActive(adId, isActive);
    return this.decorate(updated, timezone, new Date());
  }

  static async updateAd(user: AuthUser, adId: string, payload: AdFields) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(user, ad.storeId);

    const { products, badgeId, badgeLabel, ...adFields } = payload;

    const hasStartAtKey = Object.prototype.hasOwnProperty.call(payload, 'startAt');
    const nextStartAt = hasStartAtKey ? (adFields.startAt ?? null) : ad.startAt;
    const nextExpiresAt = Object.prototype.hasOwnProperty.call(payload, 'expiresAt')
      ? (adFields.expiresAt ?? null)
      : ad.expiresAt;

    this.assertStartNotLocked(ad, adFields.startAt, hasStartAtKey);
    this.assertStartNotPast(hasStartAtKey ? adFields.startAt : undefined, ad.startAt);

    // Pulling the end date into the past is how a seller says "stop this now",
    // not a mistake to reject — but it must still land after the start.
    if (nextExpiresAt && nextStartAt && nextExpiresAt <= nextStartAt) {
      throw {
        status: 400,
        code: 'AD_WINDOW_INVERTED',
        message: 'End time must be after the start time.',
      };
    }

    const nextProducts = (products ?? ad.products).map((p) => ({
      productId: p.productId,
      variantId: p.variantId ?? null,
    }));

    // Against the ad's own store, never a client-supplied one.
    if (products) await this.assertProductsInStore(ad.storeId, nextProducts);

    await this.assertNoWindowConflict(
      ad.storeId,
      {
        kind: adFields.kind ?? ad.kind,
        discountType: adFields.discountType !== undefined ? adFields.discountType : ad.discountType,
        startAt: nextStartAt,
        expiresAt: nextExpiresAt,
        products: nextProducts,
      },
      adId,
    );

    const hasBadgeField =
      Object.prototype.hasOwnProperty.call(payload, 'badgeId') ||
      Object.prototype.hasOwnProperty.call(payload, 'badgeLabel');
    const resolvedBadge = await this.resolveBadgeForUpdate({ badgeId, badgeLabel }, hasBadgeField);

    const updated = await MerchantAdsRepository.updateAd(adId, { ...adFields, ...resolvedBadge });

    if (products) {
      await MerchantAdsRepository.replaceAdProducts(adId, products);
    }

    const timezone = await MerchantAdsRepository.getStoreTimezone(ad.storeId);
    return this.decorate(updated, timezone, new Date());
  }

  static async deleteAd(user: AuthUser, adId: string) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(user, ad.storeId);

    // Ads referenced by past orders are kept so the order history stays
    // readable. Disabling is offered as the alternative rather than performed
    // silently — a delete call that quietly does something else is worse.
    const orderItemCount = await MerchantAdsRepository.countOrderItemsByAdId(adId);
    if (orderItemCount > 0) {
      throw {
        status: 409,
        message:
          'This ad has been applied to past orders and cannot be deleted. Disable it instead.',
      };
    }

    await MerchantAdsRepository.deleteAd(adId);
    return { deleted: true as const };
  }

  /**
   * Emits side effects for ads whose window has opened or closed since the last
   * sweep, then records the state it acted on.
   *
   * This job does NOT decide whether an ad is live — that is derived at read
   * time and is already exact. It exists only for the things that must *happen*
   * at a boundary and which no read can trigger: notifying the seller and
   * telling open buyer maps to refresh.
   *
   * Level-triggered and idempotent: it compares derived state against
   * lastNotifiedState rather than asking what changed in the last minute, so a
   * worker that was down simply catches up on its next tick.
   *
   * Returns the number of transitions acted on.
   */
  static async processWindowTransitions(): Promise<number> {
    const now = new Date();
    const candidates = await MerchantAdsRepository.findAdsNeedingTransition();

    let processed = 0;

    for (const ad of candidates) {
      const state = deriveAdState(ad, now);
      if (state === ad.lastNotifiedState) continue;

      // Published rather than emitted directly: the scheduler runs in the
      // worker process, where the Socket.IO instance is null. The API process
      // consumes this and does the actual broadcast.
      await publish('ad.window.transitioned', {
        adId: ad.id,
        storeId: ad.storeId,
        title: ad.title,
        from: ad.lastNotifiedState,
        to: state,
        startAt: ad.startAt,
        expiresAt: ad.expiresAt,
        occurredAt: now.toISOString(),
      });

      await MerchantAdsRepository.markNotifiedState(ad.id, state);
      processed += 1;
    }

    return processed;
  }

  static async trackEvent(
    adId: string,
    data: {
      eventType: 'IMPRESSION' | 'CLICK' | 'CONVERSION';
      buyerId?: string;
      sessionId?: string;
      orderId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) throw { status: 404, message: 'Merchant ad not found.' };

    // Attributed revenue is read from the order rather than taken from the
    // request: this endpoint is public, and the figure drives ROAS and billing.
    // Only a paid order for the ad's own store counts.
    let revenueAmount = 0;
    if (data.eventType === 'CONVERSION' && data.orderId) {
      const order = await MerchantAdsRepository.getAttributableOrder(data.orderId, ad.storeId);
      revenueAmount = order ? Number(order.totalAmount) : 0;
    }

    await MerchantAdsRepository.recordAdEvent({ adId, ...data, revenueAmount });

    await MerchantAdsRepository.incrementAdMetrics(adId, {
      impressions: data.eventType === 'IMPRESSION' ? 1 : 0,
      clicks: data.eventType === 'CLICK' ? 1 : 0,
      conversions: data.eventType === 'CONVERSION' ? 1 : 0,
      revenue: revenueAmount,
    });
  }

  static async getAnalytics(user: AuthUser, adId: string) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) throw { status: 404, message: 'Merchant ad not found.' };
    await this.assertOwnership(user, ad.storeId);

    return MerchantAdsRepository.getAdAnalytics(adId);
  }

  static async getNearbyDeals(
    north: number,
    south: number,
    east: number,
    west: number,
    userLat?: number,
    userLng?: number,
    limit: number = 20,
  ) {
    const nearbyResult = await StoreService.getNearbyStores(
      north,
      south,
      east,
      west,
      limit,
      0,
      undefined,
      userLat,
      userLng,
    );

    const nearbyStores: NearbyStore[] = nearbyResult.items ?? [];
    if (nearbyStores.length === 0) return [];

    const storeIds = nearbyStores.map((s) => s.id);
    const rawAds = await MerchantAdsRepository.findManyForStores(storeIds, limit * 3);

    // filterLiveAds' parameter type is narrowed to what store.service.ts needs
    // and drops productImages, so the live ids are taken from it and the richer
    // records are kept.
    const liveIds = new Set(
      filterLiveAds(rawAds as unknown as MerchantAdWithProducts[]).map((a) => a.id),
    );
    const liveAds = rawAds.filter((ad) => liveIds.has(ad.id));

    const storeMap = new Map(nearbyStores.map((s) => [s.id, s]));

    const deals = await Promise.all(
      liveAds.slice(0, limit).map(async (ad) => {
        const store = storeMap.get(ad.storeId);
        const firstProduct = ad.products[0]?.product;
        const primaryImage = firstProduct?.productImages?.[0]?.file;
        const productImageUrl = primaryImage ? await resolveImageUrl(primaryImage) : null;

        return {
          id: ad.id,
          storeId: ad.storeId,
          storeName: store?.storeName ?? ad.store.storeName,
          storeSlug: ad.store.slug ?? '',
          distanceKm: store?.distanceKm ?? null,
          title: ad.title,
          description: ad.description,
          badgeLabel: ad.badgeLabel,
          ctaLabel: ad.ctaLabel,
          discountType: ad.discountType,
          discountValue: ad.discountValue ? Number(ad.discountValue) : null,
          buyQuantity: ad.buyQuantity,
          freeQuantity: ad.freeQuantity,
          imageUrl: ad.imageUrl ?? productImageUrl,
          startAt: ad.startAt,
          expiresAt: ad.expiresAt,
          isPromoted: ad.dailyBudget ? Number(ad.dailyBudget) > 0 : false,
        };
      }),
    );

    return deals;
  }
}
