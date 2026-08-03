import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';

export default class AuditService {
  static async logAction(payload: {
    performedById?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }) {
    return prisma.auditLogs.create({
      data: {
        performedById: payload.performedById ?? null,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata ? (payload.metadata as Prisma.InputJsonObject) : undefined,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
        requestId: payload.requestId ?? null,
      },
    });
  }

  static async getLogs(query: {
    performedById?: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    limit?: number;
  }) {
    return prisma.auditLogs.findMany({
      where: {
        ...(query.performedById ? { performedById: query.performedById } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
      },
      take: query.limit ?? 50,
      orderBy: { createdAt: 'desc' },
    });
  }
}
