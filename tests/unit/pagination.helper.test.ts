import { parsePagination, buildPage, pageFromRepo } from "../../src/helpers/pagination.helper";

describe("pagination.helper", () => {
  describe("parsePagination", () => {
    it("should return defaults when no query params are provided", () => {
      const result = parsePagination({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(0);
    });

    it("should parse valid page and limit", () => {
      const result = parsePagination({ page: "2", limit: "10" });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.skip).toBe(10); // (2-1) * 10
    });

    it("should clamp limit to maxLimit", () => {
      const result = parsePagination({ limit: "999" });
      expect(result.limit).toBe(100); // default maxLimit
    });

    it("should use 1 for invalid page values", () => {
      const result = parsePagination({ page: "abc" });
      expect(result.page).toBe(1);
    });

    it("should parse sortBy and sortOrder", () => {
      const result = parsePagination({ sortBy: "createdAt", sortOrder: "desc" });
      expect(result.sortBy).toBe("createdAt");
      expect(result.sortOrder).toBe("desc");
    });

    it("should parse search param", () => {
      const result = parsePagination({ search: "john" });
      expect(result.search).toBe("john");
    });
  });

  describe("buildPage", () => {
    it("should build a correct page result", () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = buildPage(items, 45, { page: 1, limit: 20 });
      expect(result.items).toEqual(items);
      expect(result.total).toBe(45);
      expect(result.totalPages).toBe(3);
    });
  });

  describe("pageFromRepo", () => {
    it("should adapt a repo result with data key", () => {
      const repoResult = {
        data: [{ id: 1 }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      const result = pageFromRepo(repoResult);
      expect(result.items).toEqual([{ id: 1 }]);
      expect(result.totalPages).toBe(1);
    });
  });
});
