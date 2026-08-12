import RbacService from '../../src/modules/rbac/rbac.service';
import RbacRepository from '../../src/modules/rbac/rbac.repository';

jest.mock('../../src/modules/rbac/rbac.repository');

describe('RbacService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRoles', () => {
    it('flattens the nested rolePermissions join into a flat permissionCodes array', async () => {
      (RbacRepository.getAllRolesWithPermissions as jest.Mock).mockResolvedValue([
        {
          id: 'role-1',
          roleName: 'ADMIN',
          description: 'Administrators',
          permissions: [
            { permission: { id: 'p1', code: 'ORDER_READ' } },
            { permission: { id: 'p2', code: 'ORDER_WRITE' } },
          ],
        },
      ]);

      const result = await RbacService.getRoles();

      expect(result).toEqual([
        {
          id: 'role-1',
          roleName: 'ADMIN',
          description: 'Administrators',
          permissionCodes: ['ORDER_READ', 'ORDER_WRITE'],
        },
      ]);
    });

    it('returns an empty permissionCodes array for a role with no permissions', async () => {
      (RbacRepository.getAllRolesWithPermissions as jest.Mock).mockResolvedValue([
        { id: 'role-2', roleName: 'GUEST', description: null, permissions: [] },
      ]);

      const result = await RbacService.getRoles();

      expect(result[0].permissionCodes).toEqual([]);
    });
  });

  describe('updateRolePermissions', () => {
    it('clears existing permissions before assigning the new set', async () => {
      const order: string[] = [];
      (RbacRepository.findPermissionsByCodes as jest.Mock).mockImplementation(async () => {
        order.push('find');
        return [{ id: 'p1' }, { id: 'p2' }];
      });
      (RbacRepository.clearRolePermissions as jest.Mock).mockImplementation(async () => {
        order.push('clear');
      });
      (RbacRepository.assignPermissionsToRole as jest.Mock).mockImplementation(async () => {
        order.push('assign');
      });

      await RbacService.updateRolePermissions('role-1', ['ORDER_READ', 'ORDER_WRITE']);

      expect(order.indexOf('clear')).toBeLessThan(order.indexOf('assign'));
      expect(RbacRepository.clearRolePermissions).toHaveBeenCalledWith('role-1');
      expect(RbacRepository.assignPermissionsToRole).toHaveBeenCalledWith('role-1', ['p1', 'p2']);
    });

    it('clears but does not assign when given an empty code list', async () => {
      (RbacRepository.findPermissionsByCodes as jest.Mock).mockResolvedValue([]);
      (RbacRepository.clearRolePermissions as jest.Mock).mockResolvedValue(undefined);

      await RbacService.updateRolePermissions('role-1', []);

      expect(RbacRepository.clearRolePermissions).toHaveBeenCalledWith('role-1');
      expect(RbacRepository.assignPermissionsToRole).not.toHaveBeenCalled();
    });

    it('still clears when the supplied codes match nothing in the permissions table', async () => {
      (RbacRepository.findPermissionsByCodes as jest.Mock).mockResolvedValue([]);
      (RbacRepository.clearRolePermissions as jest.Mock).mockResolvedValue(undefined);

      await RbacService.updateRolePermissions('role-1', ['DOES_NOT_EXIST']);

      expect(RbacRepository.clearRolePermissions).toHaveBeenCalledWith('role-1');
      expect(RbacRepository.assignPermissionsToRole).not.toHaveBeenCalled();
    });
  });

  describe('createRole', () => {
    it('creates the role and assigns the resolved permission ids', async () => {
      (RbacRepository.createRole as jest.Mock).mockResolvedValue({ id: 'role-9' });
      (RbacRepository.findPermissionsByCodes as jest.Mock).mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
      ]);
      (RbacRepository.assignPermissionsToRole as jest.Mock).mockResolvedValue(undefined);

      const role = await RbacService.createRole('support', 'Support staff', [
        'ORDER_READ',
        'ORDER_WRITE',
      ]);

      expect(RbacRepository.createRole).toHaveBeenCalledWith('support', 'Support staff');
      expect(RbacRepository.assignPermissionsToRole).toHaveBeenCalledWith('role-9', ['p1', 'p2']);
      expect(role).toEqual({ id: 'role-9' });
    });

    it('skips permission assignment entirely when no codes are supplied', async () => {
      (RbacRepository.createRole as jest.Mock).mockResolvedValue({ id: 'role-9' });

      await RbacService.createRole('support');

      expect(RbacRepository.createRole).toHaveBeenCalledWith('support', undefined);
      expect(RbacRepository.findPermissionsByCodes).not.toHaveBeenCalled();
      expect(RbacRepository.assignPermissionsToRole).not.toHaveBeenCalled();
    });

    it('skips permission assignment when given an empty code list', async () => {
      (RbacRepository.createRole as jest.Mock).mockResolvedValue({ id: 'role-9' });

      await RbacService.createRole('support', 'Support staff', []);

      expect(RbacRepository.assignPermissionsToRole).not.toHaveBeenCalled();
    });
  });
});
