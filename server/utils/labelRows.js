import db from 'kempo/server/db/index.js';
import { and, asc, eq } from 'drizzle-orm';
import { kempoShippoLabel } from '../db/schema.js';

/* The labels in the database: read for an order, saved when bought, and updated when a refund is asked for. */
export const listLabels = async orderId => {
  try {
    return [null, await db.select().from(kempoShippoLabel).where(eq(kempoShippoLabel.orderId, orderId)).orderBy(asc(kempoShippoLabel.purchasedAt))];
  } catch {
    return [{ code: 500, msg: 'The labels could not be read' }, null];
  }
};

export const getLabel = async (orderId, id) => {
  try {
    const [row] = await db.select().from(kempoShippoLabel).where(and(eq(kempoShippoLabel.orderId, orderId), eq(kempoShippoLabel.id, id)));
    return row ? [null, row] : [{ code: 404, msg: 'Label not found' }, null];
  } catch {
    return [{ code: 500, msg: 'The label could not be read' }, null];
  }
};

/* Whether a label of this site was already bought for a Shippo shipment, which Shippo would happily sell twice. */
export const shipmentUsed = async shipmentId => {
  try {
    const [row] = await db.select({ id: kempoShippoLabel.id }).from(kempoShippoLabel).where(eq(kempoShippoLabel.shipmentRef, shipmentId)).limit(1);
    return Boolean(row);
  } catch {
    return true;
  }
};

export const saveLabel = async row => {
  try {
    await db.insert(kempoShippoLabel).values(row);
    return [null, row];
  } catch(error) {
    return [{ code: 500, msg: `The label was bought but could not be saved: ${error.message}` }, null];
  }
};

export const updateLabel = async (id, changes) => {
  try {
    const [row] = await db.update(kempoShippoLabel).set(changes).where(eq(kempoShippoLabel.id, id)).returning();
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'The label could not be updated' }, null];
  }
};
