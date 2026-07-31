import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';

export default class AuditService {
  static async logAction(payload: {
    userId?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    return prisma.auditLogs.create({
      data: {
        userId: payload.userId ?? null,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata ? (payload.metadata as Prisma.InputJsonObject) : undefined,
        ipAddress: payload.ipAddress ?? null,
      },
    });
  }

  static async getLogs(query: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
  }) {
    return prisma.auditLogs.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      },
      take: query.limit ?? 50,
      orderBy: { createdAt: 'desc' },
    });
  }
}
