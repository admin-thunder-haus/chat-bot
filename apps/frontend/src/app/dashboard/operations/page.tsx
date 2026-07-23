'use client';

import { useCallback, useEffect, useState } from 'react';
import { actionsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { relativeTime } from '@/lib/format';
import { useToast } from '@/components/toast';
import type {
  AIActionExecution,
  Appointment,
  AppointmentStatus,
  Order,
  OrderStatus,
  Pagination,
  SupportTicket,
  TicketStatus,
} from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Select,
  Skeleton,
} from '@/components/ui';

type Tab = 'appointments' | 'orders' | 'tickets' | 'activity';

const TABS: { key: Tab; label: string }[] = [
  { key: 'appointments', label: 'Appointments' },
  { key: 'orders', label: 'Orders' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'activity', label: 'AI Activity' },
];

type BadgeColor = 'slate' | 'green' | 'red' | 'amber' | 'blue';

const APPOINTMENT_COLORS: Record<AppointmentStatus, BadgeColor> = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  CANCELLED: 'red',
  COMPLETED: 'blue',
};
const ORDER_COLORS: Record<OrderStatus, BadgeColor> = {
  NEW: 'amber',
  CONFIRMED: 'green',
  CANCELLED: 'red',
  FULFILLED: 'blue',
};
const TICKET_COLORS: Record<TicketStatus, BadgeColor> = {
  OPEN: 'amber',
  IN_PROGRESS: 'blue',
  RESOLVED: 'green',
  CLOSED: 'slate',
};
const EXECUTION_COLORS: Record<string, BadgeColor> = {
  completed: 'green',
  failed: 'red',
  rejected: 'amber',
};

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
];
const ORDER_STATUSES: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'CANCELLED',
  'FULFILLED',
];
const TICKET_STATUSES: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

function Pager({
  pagination,
  onPage,
}: {
  pagination: Pagination | null;
  onPage: (page: number) => void;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-xs text-slate-500">
        Page {pagination.page} of {pagination.totalPages} ({pagination.total}{' '}
        total)
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPage(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function OperationsPage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>('appointments');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<Pagination | null>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [executions, setExecutions] = useState<AIActionExecution[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'appointments') {
        const res = await actionsApi.appointments({ page, limit: 20 });
        setAppointments(res.items);
        setPagination(res.pagination);
      } else if (tab === 'orders') {
        const res = await actionsApi.orders({ page, limit: 20 });
        setOrders(res.items);
        setPagination(res.pagination);
      } else if (tab === 'tickets') {
        const res = await actionsApi.tickets({ page, limit: 20 });
        setTickets(res.items);
        setPagination(res.pagination);
      } else {
        const res = await actionsApi.executions({ page, limit: 20 });
        setExecutions(res.items);
        setPagination(res.pagination);
      }
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  async function changeAppointmentStatus(id: string, status: AppointmentStatus) {
    try {
      const res = await actionsApi.setAppointmentStatus(id, status);
      setAppointments((rows) =>
        rows.map((r) => (r.id === id ? res.appointment : r)),
      );
      notify('Appointment updated', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  async function changeOrderStatus(id: string, status: OrderStatus) {
    try {
      const res = await actionsApi.setOrderStatus(id, status);
      setOrders((rows) => rows.map((r) => (r.id === id ? res.order : r)));
      notify('Order updated', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  async function changeTicketStatus(id: string, status: TicketStatus) {
    try {
      const res = await actionsApi.setTicketStatus(id, status);
      setTickets((rows) => rows.map((r) => (r.id === id ? res.ticket : r)));
      notify('Ticket updated', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Appointments, orders and tickets the AI created for you — plus its full action log."
      />

      <div className="mb-4 flex border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`px-4 py-3 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {loading ? (
        <Panel>
          <div className="space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-6 w-3/5" />
          </div>
        </Panel>
      ) : (
        <>
          {tab === 'appointments' &&
            (appointments.length === 0 ? (
              <EmptyState
                title="No appointments yet"
                description="When the AI books an appointment for a customer, it appears here for your team to confirm."
              />
            ) : (
              <Panel className="!p-0">
                <ul className="divide-y divide-slate-100">
                  {appointments.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {formatWhen(a.scheduledAt)}
                          {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {a.notes || 'No notes'} · via {a.createdVia} ·{' '}
                          {relativeTime(a.createdAt)} ago
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge color={APPOINTMENT_COLORS[a.status]}>
                          {statusLabel(a.status)}
                        </Badge>
                        <Select
                          aria-label="Change appointment status"
                          value={a.status}
                          className="!w-auto"
                          onChange={(e) =>
                            void changeAppointmentStatus(
                              a.id,
                              e.target.value as AppointmentStatus,
                            )
                          }
                        >
                          {APPOINTMENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel(s)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}

          {tab === 'orders' &&
            (orders.length === 0 ? (
              <EmptyState
                title="No orders yet"
                description="Orders the AI creates from customer conversations appear here."
              />
            ) : (
              <Panel className="!p-0">
                <ul className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {o.items
                            .map((i) => `${i.quantity}× ${i.name}`)
                            .join(', ') || 'No items'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {o.totalAmount
                            ? `Total ${o.totalAmount} ${o.currency}`
                            : 'No total'}
                          {o.notes ? ` · ${o.notes}` : ''} ·{' '}
                          {relativeTime(o.createdAt)} ago
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge color={ORDER_COLORS[o.status]}>
                          {statusLabel(o.status)}
                        </Badge>
                        <Select
                          aria-label="Change order status"
                          value={o.status}
                          className="!w-auto"
                          onChange={(e) =>
                            void changeOrderStatus(
                              o.id,
                              e.target.value as OrderStatus,
                            )
                          }
                        >
                          {ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel(s)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}

          {tab === 'tickets' &&
            (tickets.length === 0 ? (
              <EmptyState
                title="No tickets yet"
                description="Support tickets the AI opens for customer issues appear here."
              />
            ) : (
              <Panel className="!p-0">
                <ul className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {t.subject}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Priority {statusLabel(t.priority)}
                          {t.description ? ` · ${t.description}` : ''} ·{' '}
                          {relativeTime(t.createdAt)} ago
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge color={TICKET_COLORS[t.status]}>
                          {statusLabel(t.status)}
                        </Badge>
                        <Select
                          aria-label="Change ticket status"
                          value={t.status}
                          className="!w-auto"
                          onChange={(e) =>
                            void changeTicketStatus(
                              t.id,
                              e.target.value as TicketStatus,
                            )
                          }
                        >
                          {TICKET_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel(s)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}

          {tab === 'activity' &&
            (executions.length === 0 ? (
              <EmptyState
                title="No AI activity yet"
                description="Every action the AI attempts (completed, failed or rejected) is logged here."
              />
            ) : (
              <Panel className="!p-0">
                <ul className="divide-y divide-slate-100">
                  {executions.map((ex) => (
                    <li
                      key={ex.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                            {ex.actionKey}
                          </code>
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {ex.status === 'completed'
                            ? ex.result?.summary ?? 'Completed'
                            : ex.errorMessage ?? 'No details'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge color={EXECUTION_COLORS[ex.status] ?? 'slate'}>
                          {ex.status}
                        </Badge>
                        <span className="text-xs text-slate-400">
                          {relativeTime(ex.createdAt)} ago
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}

          <Pager pagination={pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
