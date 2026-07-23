import type {
  AIActionExecution,
  Appointment,
  AppointmentStatus,
  BusinessService,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  Product,
  SupportTicket,
  TicketStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';

export type OrderWithItems = Order & { items: OrderItem[] };

/**
 * Data-access for the AI actions module: the business records handlers create
 * (appointments, orders, tickets), the execution audit trail, and the
 * catalog lookups handlers resolve names against. EVERY query is scoped by
 * companyId; updates use the updateMany-then-read pattern so a foreign id can
 * never touch another tenant's rows.
 */
export const actionsRepository = {
  /* ---------------------------- catalog lookups --------------------------- */

  /** Active service whose name contains the query (case-insensitive). */
  findServiceByName(
    companyId: string,
    name: string,
  ): Promise<BusinessService | null> {
    return prisma.businessService.findFirst({
      where: {
        companyId,
        isActive: true,
        name: { contains: name, mode: 'insensitive' },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  /** Active product whose name contains the query (case-insensitive). */
  findProductByName(companyId: string, name: string): Promise<Product | null> {
    return prisma.product.findFirst({
      where: {
        companyId,
        isActive: true,
        name: { contains: name, mode: 'insensitive' },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  /* ----------------------------- appointments ----------------------------- */

  createAppointment(
    companyId: string,
    data: Omit<Prisma.AppointmentUncheckedCreateInput, 'companyId'>,
  ): Promise<Appointment> {
    return prisma.appointment.create({ data: { ...data, companyId } });
  },

  async listAppointments(
    companyId: string,
    filters: { page: number; limit: number; status?: AppointmentStatus },
  ): Promise<{ items: Appointment[]; total: number }> {
    const where: Prisma.AppointmentWhereInput = { companyId };
    if (filters.status) where.status = filters.status;
    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const [items, total] = await prisma.$transaction([
      prisma.appointment.findMany({
        where,
        // Upcoming first: soonest scheduled date at the top.
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      prisma.appointment.count({ where }),
    ]);
    return { items, total };
  },

  async updateAppointmentStatus(
    companyId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<Appointment | null> {
    const result = await prisma.appointment.updateMany({
      where: { id, companyId },
      data: { status },
    });
    if (result.count === 0) return null;
    return prisma.appointment.findFirst({ where: { id, companyId } });
  },

  /* --------------------------------- orders -------------------------------- */

  /** Create the order and its items in ONE transaction (nested create). */
  createOrder(
    companyId: string,
    data: Omit<Prisma.OrderUncheckedCreateInput, 'companyId' | 'items'>,
    items: Omit<Prisma.OrderItemUncheckedCreateInput, 'companyId' | 'orderId'>[],
  ): Promise<OrderWithItems> {
    return prisma.order.create({
      data: {
        ...data,
        companyId,
        items: { create: items.map((item) => ({ ...item, companyId })) },
      },
      include: { items: true },
    });
  },

  async listOrders(
    companyId: string,
    filters: { page: number; limit: number; status?: OrderStatus },
  ): Promise<{ items: OrderWithItems[]; total: number }> {
    const where: Prisma.OrderWhereInput = { companyId };
    if (filters.status) where.status = filters.status;
    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const [items, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.order.count({ where }),
    ]);
    return { items, total };
  },

  async updateOrderStatus(
    companyId: string,
    id: string,
    status: OrderStatus,
  ): Promise<OrderWithItems | null> {
    const result = await prisma.order.updateMany({
      where: { id, companyId },
      data: { status },
    });
    if (result.count === 0) return null;
    return prisma.order.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
  },

  /* -------------------------------- tickets -------------------------------- */

  createTicket(
    companyId: string,
    data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'companyId'>,
  ): Promise<SupportTicket> {
    return prisma.supportTicket.create({ data: { ...data, companyId } });
  },

  async listTickets(
    companyId: string,
    filters: { page: number; limit: number; status?: TicketStatus },
  ): Promise<{ items: SupportTicket[]; total: number }> {
    const where: Prisma.SupportTicketWhereInput = { companyId };
    if (filters.status) where.status = filters.status;
    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const [items, total] = await prisma.$transaction([
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.supportTicket.count({ where }),
    ]);
    return { items, total };
  },

  async updateTicketStatus(
    companyId: string,
    id: string,
    status: TicketStatus,
  ): Promise<SupportTicket | null> {
    const result = await prisma.supportTicket.updateMany({
      where: { id, companyId },
      data: { status },
    });
    if (result.count === 0) return null;
    return prisma.supportTicket.findFirst({ where: { id, companyId } });
  },

  /* --------------------------- execution audit log -------------------------- */

  createExecution(
    companyId: string,
    data: {
      conversationId?: string | null;
      generationId?: string | null;
      actionKey: string;
      input: Prisma.InputJsonValue;
      result?: Prisma.InputJsonValue;
      status: 'completed' | 'failed' | 'rejected';
      errorMessage?: string | null;
    },
  ): Promise<AIActionExecution> {
    return prisma.aIActionExecution.create({
      data: {
        companyId,
        conversationId: data.conversationId ?? null,
        generationId: data.generationId ?? null,
        actionKey: data.actionKey,
        input: data.input,
        result: data.result,
        status: data.status,
        errorMessage: data.errorMessage ?? null,
      },
    });
  },

  async listExecutions(
    companyId: string,
    filters: {
      page: number;
      limit: number;
      actionKey?: string;
      status?: string;
    },
  ): Promise<{ items: AIActionExecution[]; total: number }> {
    const where: Prisma.AIActionExecutionWhereInput = { companyId };
    if (filters.actionKey) where.actionKey = filters.actionKey;
    if (filters.status) where.status = filters.status;
    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const [items, total] = await prisma.$transaction([
      prisma.aIActionExecution.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.aIActionExecution.count({ where }),
    ]);
    return { items, total };
  },
};
