import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, isOffered, measuresOf, quoteParcels, zipOf } from '../server/utils/quotes.js';

const settings = { apiKey: 'k', services: ['USPS:usps_ground_advantage', 'USPS:usps_priority', 'UPS:ups_ground'], otherServices: false, fromEmail: '', residential: true, cacheMinutes: 60 };
const units = { weight: 'lb', dimension: 'in' };
const origin = { name: 'Kempo Store', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78664', country: 'US' };
const address = { name: 'Buyer', line1: '5 Oak', city: 'New York', state: 'NY', postalCode: '10001-1234', country: 'US' };

const parcel = (overrides = {}) => ({ id: 'parcel-1', box: { name: 'Small', length: 7, width: 6, height: 5 }, items: 1, weight: 1.22, quotes: [], ...overrides });

const RATES = [
  { carrier: 'USPS', service: 'usps_ground_advantage', label: 'Ground Advantage', dollars: 8.2, days: 3 },
  { carrier: 'USPS', service: 'usps_priority_express', label: 'Priority Mail Express', dollars: 51.2, days: null },
  { carrier: 'UPS', service: 'ups_ground', label: 'Ground', dollars: 12.5, days: 4 },
  { carrier: 'DHL Express', service: 'dhl_express_domestic', label: 'Express Domestic', dollars: 30, days: null },
];

/* A client that answers every carrier for a parcel in one call, and records every shipment it was asked to rate. */
const fakeClient = (rates = RATES) => {
  const requests = [];
  return { requests, rates: async shipment => { requests.push(shipment); return [null, { rates, mode: 'test', messages: [] }]; } };
};

const run = (overrides = {}) => {
  const client = overrides.client ?? fakeClient();
  const parcels = overrides.parcels ?? [parcel()];
  const cache = overrides.cache ?? createCache();
  return quoteParcels({ parcels, address, origin, units, currency: 'usd', settings, client, cache, ...overrides.input }).then(result => ({ result, parcels, client, cache }));
};

test('the ZIP code is the first five digits, or nothing', () => {
  assert.equal(zipOf('10001-1234'), '10001');
  assert.equal(zipOf('SW1A 1AA'), null);
  assert.equal(zipOf(undefined), null);
});

test('a parcel is measured in ounces to the next whole ounce and inches to the next tenth, longest side first', () => {
  assert.deepEqual(measuresOf(parcel({ weight: 1.22 }), units), { ounces: 20, inches: [7, 6, 5] });
  assert.deepEqual(measuresOf(parcel({ weight: 0.01, box: { length: 5, width: 20, height: 10.01 } }), units), { ounces: 1, inches: [20, 10.1, 5] });
  assert.deepEqual(measuresOf(parcel({ weight: 1000, box: { length: 25.4, width: 10, height: 5 } }), { weight: 'g', dimension: 'cm' }), { ounces: 36, inches: [10, 4, 2] });
});

test('a parcel with no weight, no size or over 150 pounds cannot be measured', () => {
  assert.equal(measuresOf(parcel({ weight: null }), units), null);
  assert.equal(measuresOf(parcel({ weight: 0 }), units), null);
  assert.equal(measuresOf(parcel({ box: { length: 7, width: 0, height: 5 } }), units), null);
  assert.equal(measuresOf(parcel({ weight: 150.1 }), units), null);
  assert.ok(measuresOf(parcel({ weight: 150 }), units));
});

test('one shipment prices a parcel for every carrier, and only the services the seller offers are quoted, in cents, with days when known', async () => {
  const { parcels, result, client } = await run();
  assert.equal(client.requests.length, 1);
  assert.equal(result.quoted, 2);
  assert.deepEqual(parcels[0].quotes, [{ carrier: 'USPS', service: 'Ground Advantage', price: 820, days: 3 }, { carrier: 'UPS', service: 'Ground', price: 1250, days: 4 }]);
  const shipment = client.requests[0];
  assert.equal(shipment.address_to.zip, '10001');
  assert.equal(shipment.address_to.city, 'New York');
  assert.equal(shipment.address_from.zip, '78664');
  assert.deepEqual(shipment.parcels, [{ length: '7', width: '6', height: '5', distance_unit: 'in', weight: '20', mass_unit: 'oz' }]);
  assert.equal(shipment.async, false);
});

test('"other services" adds the ones that are not in the known list, and never a known one that was left unticked', () => {
  const rate = (carrier, service) => ({ carrier, service });
  assert.equal(isOffered(rate('USPS', 'usps_priority'), settings), true);
  assert.equal(isOffered(rate('USPS', 'usps_priority_express'), settings), false);
  assert.equal(isOffered(rate('DHL Express', 'dhl_express_domestic'), settings), false);
  const withOthers = { ...settings, otherServices: true };
  assert.equal(isOffered(rate('DHL Express', 'dhl_express_domestic'), withOthers), true);
  assert.equal(isOffered(rate('USPS', 'usps_priority_express'), withOthers), false);
});

test('a price that Shippo gives is reused for the same route, weight and size, and a refusal is not quoted or kept', async () => {
  const cache = createCache();
  const client = fakeClient();
  await run({ cache, client });
  await run({ cache, client });
  assert.equal(client.requests.length, 1, 'the second order made no Shippo request');

  const refusing = { requests: 0, rates: async () => { refusing.requests++; return [{ code: 422, msg: 'no price' }, null]; } };
  const { parcels, result } = await run({ client: refusing });
  assert.equal(parcels[0].quotes.length, 0);
  assert.equal(result.skipped, 1);
  await run({ client: refusing, cache: createCache() });
  assert.equal(refusing.requests, 2);
});

test('prices are not reused after the time is up, or when it is set to zero', async () => {
  let clock = 0;
  const cache = createCache({ now: () => clock });
  const client = fakeClient();
  await run({ cache, client, input: { now: () => clock } });
  clock = 61 * 60 * 1000;
  await run({ cache, client, input: { now: () => clock } });
  assert.equal(client.requests.length, 2);

  const uncached = fakeClient();
  await run({ client: uncached, input: { settings: { ...settings, cacheMinutes: 0 } } });
  await run({ client: uncached, input: { settings: { ...settings, cacheMinutes: 0 } } });
  assert.equal(uncached.requests.length, 2);
});

test('a different box, weight or home or business address is its own price', async () => {
  const client = fakeClient();
  await run({ client, parcels: [parcel(), parcel({ id: 'parcel-2', weight: 5 })] });
  assert.equal(client.requests.length, 2);
  const cache = createCache();
  const shared = fakeClient();
  await run({ cache, client: shared });
  await run({ cache, client: shared, input: { settings: { ...settings, residential: false } } });
  assert.equal(shared.requests.length, 2);
  assert.equal('is_residential' in shared.requests[1].address_to, false);
});

test('no service offered means nothing is asked, unless other services are on', async () => {
  const { client } = await run({ input: { settings: { ...settings, services: [] } } });
  assert.equal(client.requests.length, 0);
  const others = await run({ input: { settings: { ...settings, services: [], otherServices: true } } });
  assert.equal(others.client.requests.length, 1);
  assert.deepEqual(others.parcels[0].quotes.map(quote => quote.carrier), ['DHL Express']);
  assert.equal(others.parcels[0].quotes[0].service, 'Express Domestic');
});

test('nothing is priced for a non-US address, a missing ZIP code, a missing Ship From, or a currency other than dollars', async () => {
  for(const input of [{ address: { postalCode: '10001', country: 'GB' } }, { address: { postalCode: '', country: 'US' } }, { address: null }, { origin: { postalCode: '', country: 'US' } }, { origin: { postalCode: '78664', country: 'GB' } }, { currency: 'eur' }]){
    const { result, client, parcels } = await run({ input });
    assert.equal(client.requests.length, 0, JSON.stringify(input));
    assert.equal(parcels[0].quotes.length, 0);
    assert.equal(result.skipped, 1);
  }
});

test('a parcel that cannot be measured is skipped and the others are still priced', async () => {
  const { parcels, result } = await run({ parcels: [parcel({ weight: null }), parcel({ id: 'parcel-2' })] });
  assert.equal(parcels[0].quotes.length, 0);
  assert.equal(parcels[1].quotes.length, 2);
  assert.deepEqual(result, { quoted: 2, skipped: 1, pending: false });
});

test('the cache forgets entries after they expire', () => {
  let clock = 0;
  const cache = createCache({ now: () => clock });
  cache.set('a', 1, 1000);
  assert.equal(cache.get('a'), 1);
  clock = 1001;
  assert.equal(cache.get('a'), null);
  assert.equal(cache.size, 0);
});

test('nothing is asked of Shippo until the address is finished: a price already known is used, and the rest is pending', async () => {
  const cache = createCache();
  const client = fakeClient();
  const waiting = await run({ cache, client, input: { ready: false } });
  assert.equal(client.requests.length, 0, 'no request while the customer is typing');
  assert.equal(waiting.result.pending, true);
  assert.equal(waiting.parcels[0].quotes.length, 0);

  await run({ cache, client });
  const known = await run({ cache, client, input: { ready: false } });
  assert.equal(client.requests.length, 1, 'only the finished address made a request');
  assert.equal(known.result.pending, false);
  assert.equal(known.parcels[0].quotes.length, 2, 'a cached price is free to use at any time');
});
