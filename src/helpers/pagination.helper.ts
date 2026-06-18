/**
 * Pagination helpers. Parses query params into safe ints, formats list
 * results into the standard page envelope.
 *
 * ── Usage (new endpoints) ─────────────────────────────────────────────────
 *
 *   import { parsePagination, buildPage } from "../helpers/pagination.helper";
 *   import { responseSuccess } from "../helpers/response.helper";
 *
 *   const { page, limit, skip } = parsePagination(req.query);
 *   const [items, total] = await Promise.all([
 *     prisma.user.findMany({ where, skip, take: limit }),
 *     prisma.user.count({ where }),
 *   ]);
 *   return responseSuccess(res, 200, buildPage(items, total, { page, limit }));
 *
 * ── Usage (repos that already return { data, total, page, limit }) ────────
 *
 *   import { pageFromRepo } from "../helpers/pagination.helper";
 *   const result = await UserService.listUsers(page, limit);
 *   return responseSuccess(res, 200, pageFromRepo(result));
 *
 * ── Response shape ────────────────────────────────────────────────────────
 *
 *   {
 *     "status": "success",
 *     "statusCode": 200,
 *     "data": {
 *       "items":      [ ... ],
 *       "total":      87,
 *       "page":       1,
 *       "limit":      20,
 *       "totalPages": 5
 *     }
 *   }
 *
 * ── Defaults ─────────────────────────────────────────────────────────────
 *   page  → 1
 *   limit → 20  (clamped to maxLimit = 100)
 */

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, unknown>;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, unknown>;
}

const DEFAULTS = { page: 1, limit: 20, maxLimit: 100 };

/**
 * Reads `page` / `limit` from `req.query`, clamps to sane bounds, returns
 * `{ page, limit, skip }` ready for Prisma's `skip` and `take`.
 */
export function parsePagination(
  query: Record<string, unknown> | undefined | null,
  opts: Partial<typeof DEFAULTS> = {},
): PaginationParams {
  const { page: defPage, limit: defLimit, maxLimit } = { ...DEFAULTS, ...opts };

  const rawPage = parseInt(String(query?.page), 10);
  const rawLimit = parseInt(String(query?.limit), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defPage;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defLimit;

  let sortBy: string | undefined;
  let sortOrder: "asc" | "desc" | undefined;
  let search: string | undefined;
  const filters: Record<string, unknown> = {};

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === "sortBy") {
        sortBy = String(value);
      } else if (key === "sortOrder") {
        const lower = String(value).toLowerCase();
        sortOrder =
          lower === "desc" ? "desc" : lower === "asc" ? "asc" : undefined;
      } else if (key === "search") {
        search = String(value);
      } else if (key !== "page" && key !== "limit") {
        filters[key] = value;
      }
    }
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sortBy,
    sortOrder,
    search,
    filters: Object.keys(filters).length ? filters : undefined,
  };
}

/**
 * Formats a raw Prisma findMany + count result into the standard page envelope.
 */
export function buildPage<T>(
  items: T[],
  total: number,
  params: {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
    filters?: Record<string, unknown>;
  },
): PageResult<T> {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: params.limit > 0 ? Math.ceil(total / params.limit) : 0,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    search: params.search,
    filters: params.filters,
  };
}

/**
 * Adapter for repositories that already return `{ data, total, page, limit }`.
 * Maps `data → items` and adds `totalPages` so existing services don't need
 * to change.
 */
export function pageFromRepo<T>(result: {
  users?: T[];
  data?: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, unknown>;
}): PageResult<T> {
  // Handle both `data` and `users` (common repo naming differences)
  const items = (result.data ?? result.users ?? []) as T[];
  return buildPage(items, result.total, {
    page: result.page,
    limit: result.limit,
    sortBy: result.sortBy,
    sortOrder: result.sortOrder,
    search: result.search,
    filters: result.filters,
  });
}
