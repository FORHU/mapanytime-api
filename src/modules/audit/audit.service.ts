import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';
import logger from '../../utils/logger';
import { getRequestId } from '../../utils/async-context';

export interface AuditPayload {
  performedById?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditListQuery {
  performedById?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export default class AuditService {
  static async logAction(payload: AuditPayload) {
    return prisma.auditLogs.create({
      data: {
        performedById: payload.performedById ?? null,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata ? (payload.metadata as Prisma.InputJsonObject) : undefined,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
        requestId: payload.requestId ?? getRequestId() ?? null,
      },
    });
  }

  /**
   * Best-effort audit write for use after a business action has already
   * succeeded: a failed audit insert is logged, never thrown, so it cannot
   * undo or fail the action it describes.
   */
  static async record(payload: AuditPayload): Promise<void> {
    try {
      await AuditService.logAction(payload);
    } catch (error) {
      logger.warn(
        `[Audit] Failed to record ${payload.action} on ${payload.entityType}:${payload.entityId}: ${(error as Error).message}`,
      );
    }
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

  /**
   * Admin audit log search: newest first, paginated, with the acting user's
   * name and email resolved for display.
   */
  static async list(query: AuditListQuery) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const where: Prisma.AuditLogsWhereInput = {
      ...(query.performedById ? { performedById: query.performedById } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLogs.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLogs.count({ where }),
    ]);

    const actorIds = [
      ...new Set(rows.map((r) => r.performedById).filter((id): id is string => !!id)),
    ];
    const actors = actorIds.length
      ? await prisma.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      createdAt: r.createdAt,
      performedBy: r.performedById
        ? {
            id: r.performedById,
            name: actorById.get(r.performedById)?.name ?? null,
            email: actorById.get(r.performedById)?.email ?? null,
          }
        : null,
    }));

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
