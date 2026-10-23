import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/*
  A shipping label bought through Shippo for an order. One order can have several (one per box). Everything the order's
  Shippo tab shows is kept here, so it never has to ask Shippo again: a label can be printed again, tracked, and its
  cost seen long after. `cost` is in the smallest currency unit and is what Shippo charged, which is not what the
  customer paid for shipping. `mode` is whether it was a test key (nothing was charged and the label is not valid) or a
  production one. `shipmentRef` is Shippo's id for the shipment and is unique, so one shipment can never be recorded twice; `transactionRef` is its id for the label itself (what a refund is asked for by).
*/
export const kempoShippoLabel = pgTable('kempoShippoLabel', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  shipmentRef: text('shipmentRef').notNull(),
  transactionRef: text('transactionRef').notNull(),
  rateRef: text('rateRef').notNull().default(''),
  carrier: text('carrier').notNull(),
  service: text('service').notNull(),
  serviceLabel: text('serviceLabel').notNull(),
  trackingCode: text('trackingCode').notNull(),
  trackingUrl: text('trackingUrl'),
  publicTrackingUrl: text('publicTrackingUrl'),
  labelUrl: text('labelUrl').notNull(),
  labelPdfUrl: text('labelPdfUrl'),
  cost: integer('cost').notNull(),
  currency: text('currency').notNull().default('USD'),
  mode: text('mode').notNull().default('test'),
  parcel: jsonb('parcel'),
  status: text('status').notNull().default('purchased'),
  refundStatus: text('refundStatus'),
  purchasedAt: timestamp('purchasedAt').notNull(),
  purchasedBy: text('purchasedBy'),
}, table => [
  index('kempoShippoLabel_order_idx').on(table.orderId),
  uniqueIndex('kempoShippoLabel_shipment_idx').on(table.shipmentRef),
]);
