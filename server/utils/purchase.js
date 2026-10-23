import { labelRow } from './labels.js';

/*
  Buying a label, and asking for the money back. Everything outside Shippo's answer is handed in (`client`, `save`, `used`, `note`,
  `newId`), so this is tested with fakes and never needs Shippo or a database.

  The browser sends only the shipment and the rate it chose. What is checked here, because the browser can send anything:
  the shipment belongs to this order (it was created with the order's id as its `metadata`), no label of this site was bought for
  it yet (Shippo would sell a second one for the same rate), and the rate is one of its own. The cost kept is the one the
  shipment lists for that rate, never one the browser sent.
*/
const buyOnce = async ({ client, orderId, shipmentId, rateId, userId, save, used, note, newId, now = () => new Date() }) => {
  if(typeof shipmentId !== 'string' || typeof rateId !== 'string' || !shipmentId || !rateId) return [{ code: 400, msg: 'Choose a service to buy' }, null];

  const [lookupError, shipment] = await client.shipment(shipmentId);
  if(lookupError) return [lookupError, null];
  if(shipment?.metadata !== orderId) return [{ code: 409, msg: 'These prices were not for this order. Get the prices again' }, null];
  if(await used(shipmentId)) return [{ code: 409, msg: 'A label was already bought for this shipment' }, null];
  const rate = (shipment.rates ?? []).find(entry => entry?.object_id === rateId);
  if(!rate) return [{ code: 409, msg: 'That price is no longer available. Get the prices again' }, null];

  const [buyError, transaction] = await client.buy(rateId);
  if(buyError) return [buyError, null];

  const row = labelRow({ transaction, rate, shipment }, { id: newId(), orderId, userId, now: now() });
  if(!row) return [{ code: 502, msg: `Shippo answered without a label. Check transaction ${transaction?.object_id ?? ''} in your Shippo dashboard` }, null];

  const [saveError] = await save(row);
  if(saveError) return [{ code: 500, msg: `${saveError.msg} Tracking number ${row.trackingCode}; find it in your Shippo dashboard (${row.transactionRef}).` }, null];

  await note(row, `Label bought: ${row.carrier} ${row.serviceLabel}, ${new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(row.cost / 100)}${row.mode === 'test' ? ' (test, not charged)' : ''}. Tracking ${row.trackingCode}`);
  return [null, row];
};

/*
  A shipment being bought is locked in this process until the purchase is finished, so two requests for the same shipment that arrive
  together (a double click, a second tab) cannot both reach the carrier: the second is refused while the first is running, and after
  it the usual check (a label already exists) refuses it. Several processes sharing one site would need the database to do this.
*/
const inFlight = new Set();

export const buyLabel = async args => {
  const { shipmentId } = args;
  if(typeof shipmentId === 'string' && shipmentId){
    if(inFlight.has(shipmentId)) return [{ code: 409, msg: 'This label is already being bought' }, null];
    inFlight.add(shipmentId);
  }
  try {
    return await buyOnce(args);
  } finally {
    inFlight.delete(args.shipmentId);
  }
};

/* Asks Shippo to refund an unused label. The answer is kept as the label's `refundStatus`; Shippo and the carrier decide the rest. */
export const refundLabel = async ({ client, label, update, note }) => {
  if(label.refundStatus) return [{ code: 409, msg: 'A refund was already asked for' }, null];
  const [error, answer] = await client.refund(label.transactionRef);
  if(error) return [error, null];
  const refundStatus = String(answer?.status ?? 'queued').toLowerCase();
  const [updateError, row] = await update(label.id, { refundStatus, status: 'refund_requested' });
  if(updateError) return [updateError, null];
  await note(label, `Label refund asked for: ${label.carrier} ${label.serviceLabel}, tracking ${label.trackingCode} (${refundStatus})`);
  return [null, row];
};
