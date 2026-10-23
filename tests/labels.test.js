import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratesFrom } from '../server/utils/shippo.js';
import { choiceKey, destinationFrom, keyMode, labelRow, measuresFrom, parcelsFromFee, ratesView, trackingUrl } from '../server/utils/labels.js';
import { buyLabel, refundLabel } from '../server/utils/purchase.js';

/* What Shippo answered to a real purchase on a test token, trimmed to the parts that are read. */
const RATE = { object_id: 'rate_1', provider: 'USPS', servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' }, amount: '6.40', currency: 'USD', estimated_days: 3 };
const SHIPMENT = { object_id: 'shp_1', status: 'SUCCESS', test: true, metadata: 'ord_1', parcels: [{ length: '9', width: '6', height: '2', weight: '10', distance_unit: 'in', mass_unit: 'oz' }], rates: [RATE, { ...RATE, object_id: 'rate_2', servicelevel: { name: 'Priority Mail', token: 'usps_priority' }, amount: '11.00' }] };
const TRANSACTION = { object_id: 'tx_1', status: 'SUCCESS', test: true, tracking_number: '9300120845500000713363', label_url: 'https://deliver.example/label.pdf', tracking_url_provider: 'https://tools.usps.com/go/TrackConfirmAction_input' };

test('the carrier tracking page is built for the carriers that have one, with the number escaped', () => {
  assert.equal(trackingUrl('USPS', '9400'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400');
  assert.equal(trackingUrl('UPS', '1Z999'), 'https://www.ups.com/track?tracknum=1Z999');
  assert.equal(trackingUrl('FedEx', '7777'), 'https://www.fedex.com/fedextrack/?trknbr=7777');
  assert.equal(trackingUrl('DHL Express', '123'), 'https://www.dhl.com/en/express/tracking.html?AWB=123');
  assert.equal(trackingUrl('USPS', 'a&b=c'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=a%26b%3Dc');
  assert.equal(trackingUrl('Sendle', '1'), null);
  assert.equal(trackingUrl('constructor', '1'), null);
  assert.equal(trackingUrl('USPS', ''), null);
});

test('the boxes an order was packed into come from its shipping fee, in the units it kept', () => {
  const fee = { data: { units: { weight: 'oz', dimension: 'in' }, shipments: [{ name: 'Small', length: 9, width: 6, height: 3, weight: 12, items: 2 }, { length: '4', width: null }] } };
  const { units, parcels } = parcelsFromFee(fee);
  assert.deepEqual(units, { weight: 'oz', dimension: 'in' });
  assert.deepEqual(parcels[0], { name: 'Small', length: 9, width: 6, height: 3, weight: 12, items: 2 });
  assert.deepEqual(parcels[1], { name: '', length: 4, width: 0, height: 0, weight: 0, items: 0 });
  assert.deepEqual(parcelsFromFee(null), { units: null, parcels: [] });
  assert.deepEqual(parcelsFromFee({ data: { shipments: 'no' } }).parcels, []);
});

test('a typed parcel becomes ounces and inches, and a bad one is explained', () => {
  const [, ok] = measuresFrom({ length: '9', width: 6, height: 2.04, weight: '1' }, { weight: 'lb', dimension: 'in' });
  assert.deepEqual(ok, { ounces: 16, inches: [9, 6, 2] });
  const [, metric] = measuresFrom({ length: 25.4, width: 10, height: 5, weight: 500 }, { weight: 'g', dimension: 'cm' });
  assert.deepEqual(metric.inches, [10, 3.9, 2]);
  assert.equal(metric.ounces, 17.6);
  for(const bad of [{}, { length: 1, width: 1, height: 1 }, { length: 0, width: 1, height: 1, weight: 1 }, { length: 'x', width: 1, height: 1, weight: 1 }, { length: -1, width: 1, height: 1, weight: 1 }]){
    assert.ok(measuresFrom(bad, { weight: 'lb', dimension: 'in' })[0], JSON.stringify(bad));
  }
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 151 }, { weight: 'lb', dimension: 'in' })[0], /heavier/);
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 1 }, { weight: 'stone', dimension: 'in' })[0], /units/);
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 1 }, undefined)[0], /units/);
  assert.equal(measuresFrom({ length: 0.01, width: 0.01, height: 0.01, weight: 0.001 }, { weight: 'oz', dimension: 'in' })[1].ounces, 0.1);
});

test('the destination is the order shipping address, with a phone from billing and the order email, and needs a street and a postal code', () => {
  const order = { email: 'ann@example.com', data: { shipping: { name: 'Ann', line1: '1 Main', postalCode: '05478' } }, billing: { phone: '555' } };
  assert.deepEqual(destinationFrom(order), { name: 'Ann', line1: '1 Main', postalCode: '05478', country: 'US', phone: '555', email: 'ann@example.com' });
  assert.equal(destinationFrom({ data: { shipping: { line1: '1 Main' } } }), null);
  assert.equal(destinationFrom({ data: {} }), null);
  assert.equal(destinationFrom(null), null);
});

test('rates are shown cheapest first, with the one the customer chose marked', () => {
  const rates = ratesFrom({ rates: [
    { object_id: 'r1', provider: 'USPS', servicelevel: { name: 'Priority Mail', token: 'usps_priority' }, amount: '11.01', currency: 'USD', estimated_days: 2 },
    { object_id: 'r2', provider: 'USPS', servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' }, amount: '6.40', currency: 'USD', estimated_days: 3 },
    { object_id: 'r3', provider: 'DHL Express', servicelevel: { name: 'Express Worldwide®', token: 'dhl_express_worldwide' }, amount: '40.00', currency: 'USD', estimated_days: 2 },
  ] });
  assert.equal(choiceKey(rates[1]), 'USPS|Ground Advantage');
  const view = ratesView(rates, 'USPS|Ground Advantage');
  assert.deepEqual(view.map(rate => [rate.id, rate.label, rate.cents, rate.chosen]), [['r2', 'Ground Advantage', 640, true], ['r1', 'Priority Mail', 1101, false], ['r3', 'Express Worldwide', 4000, false]]);
  assert.ok(ratesView(rates, '').every(rate => rate.chosen === false));
});

test('a test token is told from a live one by its prefix alone', () => {
  assert.equal(keyMode('shippo_test_123'), 'test');
  assert.equal(keyMode('shippo_live_123'), 'production');
  assert.equal(keyMode(''), 'production');
});

test('the row kept for a label has the cost in cents, the tracking and the carrier page, and null when the answer is unusable', () => {
  const when = new Date('2026-10-22T12:00:00Z');
  const row = labelRow({ transaction: TRANSACTION, rate: RATE, shipment: SHIPMENT }, { id: 'lbl1', orderId: 'ord_1', userId: 'u1', now: when });
  assert.equal(row.cost, 640);
  assert.equal(row.currency, 'USD');
  assert.equal(row.serviceLabel, 'Ground Advantage');
  assert.equal(row.service, 'usps_ground_advantage');
  assert.equal(row.shipmentRef, 'shp_1');
  assert.equal(row.transactionRef, 'tx_1');
  assert.equal(row.trackingCode, '9300120845500000713363');
  assert.equal(row.trackingUrl, 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9300120845500000713363');
  assert.equal(row.labelUrl, 'https://deliver.example/label.pdf');
  assert.equal(row.labelPdfUrl, 'https://deliver.example/label.pdf');
  assert.equal(row.mode, 'test');
  assert.equal(row.purchasedAt, when);
  assert.deepEqual(row.parcel, { length: 9, width: 6, height: 2, ounces: 10 });
  assert.equal(labelRow({ transaction: { ...TRANSACTION, test: false }, rate: RATE, shipment: SHIPMENT }, { id: 'x', orderId: 'o' }).mode, 'production');
  for(const broken of [{ transaction: { ...TRANSACTION, tracking_number: '' } }, { transaction: { ...TRANSACTION, label_url: '' } }, { transaction: { ...TRANSACTION, object_id: undefined } }, { rate: { ...RATE, amount: 'abc' } }, { shipment: { ...SHIPMENT, object_id: undefined } }, { transaction: null }]){
    assert.equal(labelRow({ transaction: TRANSACTION, rate: RATE, shipment: SHIPMENT, ...broken }, { id: 'x', orderId: 'o' }), null, JSON.stringify(Object.keys(broken)));
  }
});

/* A fake client for the purchase: the shipment as Shippo holds it before buying, and what buying answers. */
const fakeClient = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    shipment: async id => { calls.push(['shipment', id]); return [null, { ...SHIPMENT, object_id: id }]; },
    buy: async rateId => { calls.push(['buy', rateId]); return [null, TRANSACTION]; },
    refund: async id => { calls.push(['refund', id]); return [null, { status: 'QUEUED' }]; },
    ...overrides,
  };
};

const purchase = async (client, extra = {}) => {
  const saved = [];
  const notes = [];
  const result = await buyLabel({ client, orderId: 'ord_1', shipmentId: 'shp_1', rateId: 'rate_1', userId: 'u1', save: async row => { saved.push(row); return [null, row]; }, used: async () => false, note: async (row, text) => { notes.push(text); }, newId: () => 'lbl1', ...extra });
  return { result, saved, notes };
};

test('buying checks the shipment, buys the chosen rate, keeps the label with its cost and notes it in the order history', async () => {
  const client = fakeClient();
  const { result: [error, row], saved, notes } = await purchase(client);
  assert.equal(error, null);
  assert.equal(row.id, 'lbl1');
  assert.equal(row.cost, 640);
  assert.equal(saved.length, 1);
  assert.deepEqual(client.calls, [['shipment', 'shp_1'], ['buy', 'rate_1']]);
  assert.match(notes[0], /Label bought: USPS Ground Advantage, \$6\.40 \(test, not charged\)\. Tracking 9300120845500000713363/);
});

test('the price kept is the one the shipment lists for the chosen rate', async () => {
  const { result: [, row] } = await purchase(fakeClient(), { rateId: 'rate_2' });
  assert.equal(row.cost, 1100);
  assert.equal(row.serviceLabel, 'Priority Mail');
});

test('nothing is bought for another order, a shipment already bought, a rate it does not have, or no choice', async () => {
  const cases = [
    [fakeClient({ shipment: async id => [null, { ...SHIPMENT, object_id: id, metadata: 'ord_2' }] }), {}, 409],
    [fakeClient(), { used: async () => true }, 409],
    [fakeClient({ shipment: async id => [null, { ...SHIPMENT, object_id: id, rates: [{ ...RATE, object_id: 'other' }] }] }), {}, 409],
    [fakeClient(), { rateId: undefined }, 400],
    [fakeClient(), { shipmentId: '' }, 400],
    [fakeClient({ shipment: async () => [{ code: 404, msg: 'Not found' }, null] }), {}, 404],
  ];
  for(const [client, extra, code] of cases){
    const { result: [error], saved } = await purchase(client, extra);
    assert.equal(error?.code, code);
    assert.equal(saved.length, 0);
    assert.ok(!client.calls.some(call => call[0] === 'buy'), 'bought anyway');
  }
});

test('a purchase Shippo refuses saves nothing, and an answer with no label is reported with the transaction to look for', async () => {
  const refused = await purchase(fakeClient({ buy: async () => [{ code: 422, msg: 'UPS: not registered' }, null] }));
  assert.deepEqual(refused.result, [{ code: 422, msg: 'UPS: not registered' }, null]);
  assert.equal(refused.saved.length, 0);
  const empty = await purchase(fakeClient({ buy: async () => [null, { object_id: 'tx_9', status: 'SUCCESS' }] }));
  assert.equal(empty.result[0].code, 502);
  assert.match(empty.result[0].msg, /tx_9/);
});

test('a label that was bought but could not be saved gives the tracking number to find it by', async () => {
  const unsaved = await purchase(fakeClient(), { save: async () => [{ code: 500, msg: 'The label was bought but could not be saved.' }, null] });
  assert.equal(unsaved.result[0].code, 500);
  assert.match(unsaved.result[0].msg, /9300120845500000713363/);
  assert.match(unsaved.result[0].msg, /tx_1/);
});

test('a refund is asked for once by the transaction, kept on the label and noted', async () => {
  const label = { id: 'lbl1', shipmentRef: 'shp_1', transactionRef: 'tx_1', carrier: 'USPS', serviceLabel: 'Ground Advantage', trackingCode: '94', status: 'purchased', refundStatus: null };
  const updates = [];
  const notes = [];
  const update = async (id, changes) => { updates.push([id, changes]); return [null, { ...label, ...changes }]; };
  const note = async (row, text) => { notes.push(text); };
  const client = fakeClient();
  const [error, row] = await refundLabel({ client, label, update, note });
  assert.equal(error, null);
  assert.deepEqual(client.calls, [['refund', 'tx_1']]);
  assert.deepEqual(updates, [['lbl1', { refundStatus: 'queued', status: 'refund_requested' }]]);
  assert.equal(row.refundStatus, 'queued');
  assert.match(notes[0], /refund asked for/i);
  assert.equal((await refundLabel({ client: fakeClient(), label: { ...label, refundStatus: 'queued' }, update, note }))[0].code, 409);
  assert.equal((await refundLabel({ client: fakeClient({ refund: async () => [{ code: 422, msg: 'Too late' }, null] }), label, update, note }))[0].msg, 'Too late');
  assert.equal(updates.length, 1);
});

test('two purchases of one shipment at the same moment buy once: the second is refused while the first is running', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient({ buy: async rateId => { client.calls.push(['buy', rateId]); await gate; return [null, TRANSACTION]; } });
  const first = purchase(client);
  const second = purchase(client);
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const [a, b] = await Promise.all([first, second]);
  const results = [a.result, b.result];
  assert.equal(client.calls.filter(call => call[0] === 'buy').length, 1, 'bought twice');
  assert.equal(results.filter(([error]) => error === null).length, 1);
  assert.equal(results.find(([error]) => error)[0].code, 409);
  assert.equal(a.saved.length + b.saved.length, 1);
  const after = await purchase(fakeClient());
  assert.equal(after.result[0], null, 'the lock was not released');
});
