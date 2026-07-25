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
  DataList,
  EmptyState,
  PageHeader,
  PaginationBar,
  Select,
  Tabs,
  type DataListColumn,
  type TabItem,
} from '@/components/ui';

type Tab = 'appointments' | 'orders' | 'tickets' | 'activity';

const TABS: readonly TabItem<Tab>[] = [
  { key: 'appointments', label: 'Appointments', panelId: 'ops-panel' },
  { key: 'orders', label: 'Orders', panelId: 'ops-panel' },
  { key: 'tickets', label: 'Tickets', panelId: 'ops-panel' },
  { key: 'activity', label: 'AI activity', panelId: 'ops-panel' },
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

/** `IN_PROGRESS` → `In progress` — never show a raw enum to a user (§8). */
function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
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

  async function changeAppointmentStatus(
    id: string,
    status: AppointmentStatus,
  ) {
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

  const appointmentColumns: DataListColumn<Appointment>[] = [
    {
      key: 'when',
      header: 'Scheduled for',
      primary: true,
      cell: (a) => (
        <span className="font-medium text-slate-900">
          {formatWhen(a.scheduledAt)}
          {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
        </span>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      cell: (a) => a.notes || '—',
    },
    {
      key: 'via',
      header: 'Booked via',
      cell: (a) => statusLabel(a.createdVia),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (a) => `${relativeTime(a.createdAt)} ago`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <Badge color={APPOINTMENT_COLORS[a.status]}>
          {statusLabel(a.status)}
        </Badge>
      ),
    },
  ];

  const orderColumns: DataListColumn<Order>[] = [
    {
      key: 'items',
      header: 'Items',
      primary: true,
      cell: (o) => (
        <span className="font-medium text-slate-900">
          {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') ||
            'No items'}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      className: 'tabular-nums',
      cell: (o) => (o.totalAmount ? `${o.totalAmount} ${o.currency}` : '—'),
    },
    {
      key: 'notes',
      header: 'Notes',
      cell: (o) => o.notes || '—',
    },
    {
      key: 'created',
      header: 'Created',
      cell: (o) => `${relativeTime(o.createdAt)} ago`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (o) => (
        <Badge color={ORDER_COLORS[o.status]}>{statusLabel(o.status)}</Badge>
      ),
    },
  ];

  const ticketColumns: DataListColumn<SupportTicket>[] = [
    {
      key: 'subject',
      header: 'Subject',
      primary: true,
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{t.subject}</p>
          {t.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
              {t.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (t) => statusLabel(t.priority),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (t) => `${relativeTime(t.createdAt)} ago`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <Badge color={TICKET_COLORS[t.status]}>{statusLabel(t.status)}</Badge>
      ),
    },
  ];

  const executionColumns: DataListColumn<AIActionExecution>[] = [
    {
      key: 'action',
      header: 'Action',
      primary: true,
      cell: (ex) => (
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
          {ex.actionKey}
        </code>
      ),
    },
    {
      key: 'detail',
      header: 'Detail',
      cell: (ex) => (
        <span className="break-words">
          {ex.status === 'completed'
            ? (ex.result?.summary ?? 'Completed')
            : (ex.errorMessage ?? 'No details recorded')}
        </span>
      ),
    },
    {
      key: 'when',
      header: 'When',
      cell: (ex) => `${relativeTime(ex.createdAt)} ago`,
    },
    {
      key: 'status',
      header: 'Outcome',
      cell: (ex) => (
        <Badge color={EXECUTION_COLORS[ex.status] ?? 'slate'}>
          {statusLabel(ex.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Operations"
        description="Appointments, orders and tickets the AI created for you — plus its full action log."
      />

      <div className="space-y-6">
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={switchTab}
          label="Operations sections"
          idPrefix="ops-tab"
        />

        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} This list could not be loaded.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
                className="sm:shrink-0"
              >
                Try again
              </Button>
            </div>
          </Alert>
        )}

        <div id="ops-panel" role="tabpanel" aria-labelledby={`ops-tab-${tab}`}>
          {tab === 'appointments' && (
            <DataList
              items={appointments}
              loading={loading}
              keyOf={(a) => a.id}
              columns={appointmentColumns}
              caption="Appointments"
              actionsHeader="Change status"
              actions={(a) => (
                <>
                  <label htmlFor={`appt-status-${a.id}`} className="sr-only">
                    Change status for the appointment on{' '}
                    {formatWhen(a.scheduledAt)}
                  </label>
                  <Select
                    id={`appt-status-${a.id}`}
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
                </>
              )}
              empty={
                <EmptyState
                  title="No appointments yet"
                  description="When the AI books an appointment for a customer, it appears here for your team to confirm."
                />
              }
            />
          )}

          {tab === 'orders' && (
            <DataList
              items={orders}
              loading={loading}
              keyOf={(o) => o.id}
              columns={orderColumns}
              caption="Orders"
              actionsHeader="Change status"
              actions={(o) => (
                <>
                  <label htmlFor={`order-status-${o.id}`} className="sr-only">
                    Change order status
                  </label>
                  <Select
                    id={`order-status-${o.id}`}
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
                </>
              )}
              empty={
                <EmptyState
                  title="No orders yet"
                  description="Orders the AI creates from customer conversations appear here, ready for you to confirm and fulfil."
                />
              }
            />
          )}

          {tab === 'tickets' && (
            <DataList
              items={tickets}
              loading={loading}
              keyOf={(t) => t.id}
              columns={ticketColumns}
              caption="Support tickets"
              actionsHeader="Change status"
              actions={(t) => (
                <>
                  <label htmlFor={`ticket-status-${t.id}`} className="sr-only">
                    Change status for “{t.subject}”
                  </label>
                  <Select
                    id={`ticket-status-${t.id}`}
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
                </>
              )}
              empty={
                <EmptyState
                  title="No tickets yet"
                  description="Support tickets the AI opens for customer issues it cannot resolve appear here."
                />
              }
            />
          )}

          {tab === 'activity' && (
            <DataList
              items={executions}
              loading={loading}
              keyOf={(ex) => ex.id}
              columns={executionColumns}
              caption="AI action log"
              empty={
                <EmptyState
                  title="No AI activity yet"
                  description="Every action the AI attempts — completed, failed or rejected — is logged here so you can audit it."
                />
              }
            />
          )}
        </div>

        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          total={pagination?.total}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
