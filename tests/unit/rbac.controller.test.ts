import { Request, Response, NextFunction } from 'express';
import RbacController from '../../src/modules/rbac/rbac.controller';
import RbacService from '../../src/modules/rbac/rbac.service';

jest.mock('../../src/modules/rbac/rbac.service');

describe('RbacController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('GET /permissions', () => {
    it('returns 200 with the permissions from the service', async () => {
      const permissions = [{ id: 'perm-1', code: 'ORDER_READ', name: 'Read orders' }];
      (RbacService.getPermissions as jest.Mock).mockResolvedValue(permissions);

      await RbacController.getPermissions(mockReq as Request, mockRes as Response, next);

      expect(RbacService.getPermissions).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          statusCode: 200,
          data: permissions,
        }),
      );
    });

    it('forwards service errors to next() instead of responding', async () => {
      const boom = new Error('db down');
      (RbacService.getPermissions as jest.Mock).mockRejectedValue(boom);

      await RbacController.getPermissions(mockReq as Request, mockRes as Response, next);

      expect(next).toHaveBeenCalledWith(boom);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('GET /roles', () => {
    it('returns 200 with the roles from the service', async () => {
      const roles = [
        { id: 'role-1', roleName: 'ADMIN', description: null, permissionCodes: ['ORDER_READ'] },
      ];
      (RbacService.getRoles as jest.Mock).mockResolvedValue(roles);

      await RbacController.getRoles(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', statusCode: 200, data: roles }),
      );
    });
  });

  describe('PUT /roles/:roleId/permissions', () => {
    it('returns 400 when permissionCodes is not an array', async () => {
      mockReq.params = { roleId: 'role-1' };
      mockReq.body = { permissionCodes: 'ORDER_READ' };

      await RbacController.updateRolePermissions(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          statusCode: 400,
          message: 'permissionCodes must be an array',
        }),
      );
      expect(RbacService.updateRolePermissions).not.toHaveBeenCalled();
    });

    it('accepts an empty array — clearing every permission is a valid request', async () => {
      mockReq.params = { roleId: 'role-1' };
      mockReq.body = { permissionCodes: [] };
      (RbacService.updateRolePermissions as jest.Mock).mockResolvedValue(undefined);

      await RbacController.updateRolePermissions(mockReq as Request, mockRes as Response, next);

      expect(RbacService.updateRolePermissions).toHaveBeenCalledWith('role-1', []);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('passes roleId and codes through to the service on success', async () => {
      mockReq.params = { roleId: 'role-1' };
      mockReq.body = { permissionCodes: ['ORDER_READ', 'ORDER_WRITE'] };
      (RbacService.updateRolePermissions as jest.Mock).mockResolvedValue(undefined);

      await RbacController.updateRolePermissions(mockReq as Request, mockRes as Response, next);

      expect(RbacService.updateRolePermissions).toHaveBeenCalledWith('role-1', [
        'ORDER_READ',
        'ORDER_WRITE',
      ]);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', statusCode: 200 }),
      );
    });
  });

  describe('POST /roles', () => {
    it('returns 400 when roleName is missing', async () => {
      mockReq.body = { description: 'no name' };

      await RbacController.createRole(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          statusCode: 400,
          message: 'roleName is required',
        }),
      );
      expect(RbacService.createRole).not.toHaveBeenCalled();
    });

    it('returns 201 with the created role', async () => {
      mockReq.body = {
        roleName: 'support',
        description: 'Support staff',
        permissionCodes: ['ORDER_READ'],
      };
      const created = { id: 'role-9', roleName: 'SUPPORT', description: 'Support staff' };
      (RbacService.createRole as jest.Mock).mockResolvedValue(created);

      await RbacController.createRole(mockReq as Request, mockRes as Response, next);

      expect(RbacService.createRole).toHaveBeenCalledWith('support', 'Support staff', [
        'ORDER_READ',
      ]);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', statusCode: 201, data: created }),
      );
    });

    it('forwards service errors to next()', async () => {
      mockReq.body = { roleName: 'support' };
      const boom = new Error('unique constraint');
      (RbacService.createRole as jest.Mock).mockRejectedValue(boom);

      await RbacController.createRole(mockReq as Request, mockRes as Response, next);

      expect(next).toHaveBeenCalledWith(boom);
    });
  });
});
