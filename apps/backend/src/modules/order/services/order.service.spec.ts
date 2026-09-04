import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import type { OrderRepository } from '../repositories/order.repository';
import type { AuditService } from '../../audit/services/audit.service';
import type { InventoryService } from '../../inventory/services/inventory.service';
import type { Order } from '../../../shared/database/schema';
import { emptyAttribution } from '../../../shared/attribution/attribution.util';

const orgId = 'org-1';
const storeId = 'store-1';

function makeOrder(status: Order['status'] = 'pending'): Order {
  return {
    id: 'order-1',
    organizationId: orgId,
    storeId,
    orderNumber: 'ORD-001',
    customerId: null,
    customerEmail: 'test@example.com',
    customerName: 'Test User',
    status,
    fulfillmentStatus: 'unfulfilled',
    subtotal: 1000,
    discountAmount: 0,
    taxAmount: 0,
    shippingAmount: 0,
    total: 1000,
    currency: 'USD',
    couponCode: null,
    shippingAddress: {},
    billingAddress: null,
    shippingMethodId: null,
    notes: null,
    source: 'storefront',
    ...emptyAttribution(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(
  repoMethods: Partial<Record<keyof OrderRepository, jest.Mock>> = {},
) {
  const repo = {
    findById: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(null),
    addTimelineEntry: jest.fn().mockResolvedValue(undefined),
    findByIdWithDetails: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue({ orders: [], total: 0 }),
    createOrder: jest.fn(),
    updateFulfillmentStatus: jest.fn(),
    createShipment: jest.fn(),
    markPaid: jest.fn().mockResolvedValue(null),
    ...repoMethods,
  } as unknown as OrderRepository;

  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const eventEmitter = { emit: jest.fn() };

  const inventoryService = {
    adjust: jest.fn().mockResolvedValue(undefined),
    convertReservations: jest.fn().mockResolvedValue(undefined),
  } as unknown as InventoryService;

  const db = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: 'payment-1' }]),
      }),
    }),
    transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };

  const service = new OrderService(
    repo,
    auditService,
    eventEmitter as never,
    inventoryService,
    db as never,
  );
  return { service, repo, auditService, eventEmitter };
}

describe('OrderService.transition (state machine)', () => {
  it('throws NotFoundException when order does not exist', async () => {
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.transition('order-1', 'paid', orgId, storeId, 'admin', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  const validTransitions: Array<[Order['status'], Order['status']]> = [
    ['pending', 'paid'],
    ['pending', 'cancelled'],
    ['paid', 'processing'],
    ['paid', 'refunded'],
    ['processing', 'shipped'],
    ['processing', 'refunded'],
    ['shipped', 'delivered'],
    ['shipped', 'refunded'],
    ['delivered', 'refunded'],
  ];

  test.each(validTransitions)(
    'allows transition from %s → %s',
    async (from, to) => {
      const order = makeOrder(from);
      const updated = { ...order, status: to };
      const { service } = buildService({
        findById: jest.fn().mockResolvedValue(order),
        updateStatus: jest.fn().mockResolvedValue(updated),
      });
      const result = await service.transition(
        'order-1',
        to,
        orgId,
        storeId,
        'admin',
        'user-1',
      );
      expect(result.status).toBe(to);
    },
  );

  const invalidTransitions: Array<[Order['status'], Order['status']]> = [
    ['pending', 'processing'],
    ['pending', 'shipped'],
    ['pending', 'delivered'],
    ['pending', 'refunded'],
    ['paid', 'pending'],
    ['paid', 'shipped'],
    ['paid', 'delivered'],
    ['paid', 'cancelled'],
    ['processing', 'paid'],
    ['processing', 'pending'],
    ['processing', 'cancelled'],
    ['shipped', 'paid'],
    ['shipped', 'processing'],
    ['shipped', 'cancelled'],
    ['delivered', 'pending'],
    ['delivered', 'paid'],
    ['delivered', 'processing'],
    ['delivered', 'shipped'],
    ['delivered', 'cancelled'],
    ['refunded', 'pending'],
    ['cancelled', 'paid'],
  ];

  test.each(invalidTransitions)(
    'throws BadRequestException for invalid transition %s → %s',
    async (from, to) => {
      const order = makeOrder(from);
      const { service } = buildService({
        findById: jest.fn().mockResolvedValue(order),
      });
      await expect(
        service.transition('order-1', to, orgId, storeId, 'admin', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('adds a timeline entry on successful transition', async () => {
    const order = makeOrder('pending');
    const updated = { ...order, status: 'paid' as const };
    const { service, repo } = buildService({
      findById: jest.fn().mockResolvedValue(order),
      updateStatus: jest.fn().mockResolvedValue(updated),
    });
    await service.transition(
      'order-1',
      'paid',
      orgId,
      storeId,
      'admin',
      'user-1',
    );
    expect(repo.addTimelineEntry).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'status_changed' }),
    );
  });

  it('emits an event on successful transition', async () => {
    const order = makeOrder('pending');
    const updated = { ...order, status: 'paid' as const };
    const { service, eventEmitter } = buildService({
      findById: jest.fn().mockResolvedValue(order),
      updateStatus: jest.fn().mockResolvedValue(updated),
    });
    await service.transition(
      'order-1',
      'paid',
      orgId,
      storeId,
      'admin',
      'user-1',
    );
    expect(eventEmitter.emit).toHaveBeenCalled();
  });
});
