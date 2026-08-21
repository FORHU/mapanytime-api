import CategoryRepository from '../../src/modules/categories/category.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: { categories: { findMany: jest.fn() } },
}));

const findMany = prisma.categories.findMany as unknown as jest.Mock;

type Node = { id: string; name: string; parentId: string | null };

/**
 * Stands in for the Categories table: resolves `id IN (...)` against a fixture
 * so the iterative upward walk can be exercised across real generations.
 */
const tableOf = (nodes: Node[]) => {
  findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(nodes.filter((node) => where.id.in.includes(node.id))),
  );
};

const TREE: Node[] = [
  { id: 'root', name: 'Food & Beverage', parentId: null },
  { id: 'mid', name: 'Bakery', parentId: 'root' },
  { id: 'leaf', name: 'Sourdough', parentId: 'mid' },
  { id: 'other-root', name: 'Electronics', parentId: null },
  { id: 'other-leaf', name: 'Audio', parentId: 'other-root' },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CategoryRepository.getAncestorClosure', () => {
  it('walks past the immediate parent to every generation above a leaf', async () => {
    // Products sit on leaves, but the filter renders ancestors as group headers,
    // so a single-hop lookup would drop the root and orphan the branch.
    tableOf(TREE);

    const result = await CategoryRepository.getAncestorClosure(['leaf']);

    expect(result.map((node) => node.id).sort()).toEqual(['leaf', 'mid', 'root']);
  });

  it('merges branches that share ancestors without duplicating them', async () => {
    tableOf(TREE);

    const result = await CategoryRepository.getAncestorClosure(['leaf', 'mid']);

    expect(result.map((node) => node.id).sort()).toEqual(['leaf', 'mid', 'root']);
  });

  it('covers every root when the seller spans unrelated branches', async () => {
    // The All-Stores case: two stores selling under different roots.
    tableOf(TREE);

    const result = await CategoryRepository.getAncestorClosure(['leaf', 'other-leaf']);

    expect(result.map((node) => node.id).sort()).toEqual([
      'leaf',
      'mid',
      'other-leaf',
      'other-root',
      'root',
    ]);
  });

  it('terminates on a parent cycle instead of looping forever', async () => {
    tableOf([
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]);

    const result = await CategoryRepository.getAncestorClosure(['a']);

    expect(result.map((node) => node.id).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing when the ids resolve to no live rows', async () => {
    tableOf([]);

    expect(await CategoryRepository.getAncestorClosure(['ghost'])).toEqual([]);
  });

  it('excludes soft-deleted categories', async () => {
    tableOf(TREE);

    await CategoryRepository.getAncestorClosure(['leaf']);

    expect(findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });
});
