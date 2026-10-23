import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, buildShipment, createClient, messagesFrom, ratesFrom } from '../server/utils/shippo.js';
import { toInches, toOunces } from '../server/utils/units.js';
import { KNOWN, cleanName, labelFor, parseServices, readable, tokenOf } from '../server/utils/services.js';

/* A fake fetch that answers from a list, in order, and remembers what it was asked (a GET has no body). */
const fakeFetch = answers => {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if(answer instanceof Error) throw answer;
    const [status, body] = answer;
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
};

/* The shape of a real answer: a rate as Shippo lists it. */
const rate = (provider, token, name, amount, extra = {}) => ({ object_id: `rate_${token}`, provider, servicelevel: { name, token }, amount, currency: 'USD', estimated_days: 3, ...extra });
const SHIPMENT = [201, { object_id: 'shp_1', status: 'SUCCESS', test: true, metadata: 'ord_1', messages: [], rates: [rate('USPS', 'usps_ground_advantage', 'Ground Advantage', '8.20'), rate('USPS', 'usps_priority', 'Priority Mail', '11.01', { estimated_days: 2 }), rate('UPS', 'ups_next_day_air_saver', 'Next Day Air Saver®', '34.18', { estimated_days: 1 })] }];
const origin = { name: 'Kempo Store', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78664', country: 'US' };
const shipment = buildShipment({ origin, destination: { postalCode: '10001', country: 'US' }, ounces: 20, inches: [9, 6, 3.5] });

test('weights and sizes are converted to the ounces and inches Shippo prices in', () => {
  assert.equal(toOunces(1, 'lb'), 16);
  assert.ok(Math.abs(toOunces(1000, 'g') - 35.274) < 0.001);
  assert.equal(toInches(2.54, 'cm'), 1);
  assert.equal(toOunces(1, 'stone'), null);
});

test('a shipment request names both addresses and the parcel in ounces and inches, as strings, and asks for the rates at once', () => {
  assert.deepEqual(shipment, {
    address_from: { name: 'Kempo Store', street1: '1 Main St', city: 'Austin', state: 'TX', zip: '78664', country: 'US' },
    address_to: { zip: '10001', country: 'US', is_residential: true },
    parcels: [{ length: '9', width: '6', height: '3.5', distance_unit: 'in', weight: '20', mass_unit: 'oz' }],
    async: false,
  });
  const business = buildShipment({ origin: { ...origin, email: 'me@example.com' }, destination: { name: 'Buyer', line1: '5 Oak', line2: 'Apt 2', city: 'New York', state: 'NY', postalCode: '10001', country: 'US', email: 'buyer@example.com' }, ounces: 5, inches: [1, 1, 1], residential: false, reference: 'ord_9' });
  assert.deepEqual(business.address_to, { name: 'Buyer', street1: '5 Oak', street2: 'Apt 2', city: 'New York', state: 'NY', zip: '10001', country: 'US', email: 'buyer@example.com' });
  assert.equal(business.address_from.email, 'me@example.com');
  assert.equal(business.metadata, 'ord_9');
});

test('every rate in the answer is read, dollars only, with its name and days when Shippo says, and bad ones are dropped', () => {
  const body = { rates: [
    rate('USPS', 'usps_ground_advantage', 'Ground Advantage', '8.20'), rate('UPS', 'ups_next_day_air_saver', 'Next Day Air Saver®', '12.5', { estimated_days: null }),
    rate('USPS', 'usps_priority', 'Priority Mail', '0'), rate('USPS', 'usps_media_mail', 'Media Mail', 'free'), rate('DHL Express', 'dhl_x', 'X', '20', { currency: 'EUR' }),
    { provider: 'UPS', amount: '5.00', currency: 'USD' }, null,
  ] };
  assert.deepEqual(ratesFrom(body), [
    { id: 'rate_usps_ground_advantage', carrier: 'USPS', service: 'usps_ground_advantage', label: 'Ground Advantage', dollars: 8.2, days: 3 },
    { id: 'rate_ups_next_day_air_saver', carrier: 'UPS', service: 'ups_next_day_air_saver', label: 'Next Day Air Saver', dollars: 12.5, days: null },
  ]);
  assert.deepEqual(ratesFrom({}), []);
  assert.deepEqual(ratesFrom(null), []);
});

test('the sentences of a failure come from the messages, a list of strings or nothing', () => {
  assert.deepEqual(messagesFrom({ messages: [{ source: 'UPS', text: 'Not registered' }, { source: '', text: 'Plain' }, { text: '' }] }), ['UPS: Not registered', 'Plain']);
  assert.deepEqual(messagesFrom(['Refund requests are only available for labels']), ['Refund requests are only available for labels']);
  assert.deepEqual(messagesFrom({}), []);
  assert.deepEqual(messagesFrom(null), []);
});

test('it asks with the token header, reads the rates and the mode, and never buys', async () => {
  const { impl, calls } = fakeFetch([SHIPMENT]);
  const [error, found] = await createClient({ apiKey: 'shippo_test_abc', fetchImpl: impl }).rates(shipment);
  assert.equal(error, null);
  assert.equal(found.mode, 'test');
  assert.deepEqual(found.rates.map(entry => entry.service), ['usps_ground_advantage', 'usps_priority', 'ups_next_day_air_saver']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/shipments/`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'ShippoToken shippo_test_abc');
  assert.deepEqual(calls[0].body, shipment);
  const [, live] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[201, { ...SHIPMENT[1], test: false }]]).impl }).rates(shipment);
  assert.equal(live.mode, 'production');
});

test('create also gives the shipment id, which buying needs', async () => {
  const [, found] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([SHIPMENT]).impl }).create(shipment);
  assert.equal(found.id, 'shp_1');
});

test('a 429 stops every call for a minute, then calls resume', async () => {
  let time = 1000;
  const { impl, calls } = fakeFetch([[429, {}], SHIPMENT]);
  const client = createClient({ apiKey: 'k', fetchImpl: impl, now: () => time });
  assert.equal((await client.rates(shipment))[0].code, 429);
  assert.equal((await client.rates(shipment))[0].code, 429);
  assert.equal(calls.length, 1, 'no second request while backing off');
  time += 61000;
  assert.equal((await client.rates(shipment))[0], null);
});

test('a bad token, a Shippo error, no rates and a network failure are errors in plain words, never thrown', async () => {
  const code = async answers => (await createClient({ apiKey: 'k', fetchImpl: fakeFetch(answers).impl }).rates(shipment))[0];
  assert.deepEqual(await code([[401, { detail: 'Token does not exist' }]]), { code: 401, msg: 'Shippo did not accept the API key' });
  assert.deepEqual(await code([[400, { messages: [{ source: 'USPS', text: 'Bad address' }] }]]), { code: 400, msg: 'USPS: Bad address' });
  assert.deepEqual(await code([[404, { detail: 'Not found' }]]), { code: 404, msg: 'Not found' });
  assert.equal((await code([[201, { object_id: 's', rates: [], messages: [{ source: 'UPS', text: 'Out of service area' }] }]])).code, 422);
  assert.match((await code([[201, { object_id: 's', rates: [], messages: [{ source: 'UPS', text: 'Out of service area' }] }]])).msg, /UPS: Out of service area/);
  assert.equal((await code([[500, 'not json']])).code, 500);
  assert.deepEqual(await createClient({ apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } }).rates(shipment).then(result => result[0]), { code: 502, msg: 'offline' });
});

test('the client reads a shipment, buys a rate with a PDF label, and refunds a transaction with the right calls', async () => {
  const transaction = { object_id: 'tx_1', status: 'SUCCESS', tracking_number: '94001', label_url: 'https://x/l.pdf' };
  const { impl, calls } = fakeFetch([[200, SHIPMENT[1]], [201, transaction], [201, { status: 'QUEUED' }]]);
  const client = createClient({ apiKey: 'k', fetchImpl: impl });
  assert.equal((await client.shipment('shp_1'))[1].object_id, 'shp_1');
  assert.equal((await client.buy('rate_1'))[1].tracking_number, '94001');
  assert.equal((await client.refund('tx_1'))[1].status, 'QUEUED');
  assert.deepEqual(calls.map(call => [call.method, call.url.replace(BASE, '')]), [['GET', '/shipments/shp_1'], ['POST', '/transactions/'], ['POST', '/refunds/']]);
  assert.deepEqual(calls[1].body, { rate: 'rate_1', label_file_type: 'PDF_4x6', async: false });
  assert.deepEqual(calls[2].body, { transaction: 'tx_1', async: false });
});

test('a purchase Shippo answers with 201 and ERROR is an error carrying its messages', async () => {
  const failed = { status: 'ERROR', messages: [{ source: 'UPS', code: 'ups_registration_error', text: 'The UPS account is not yet registered.' }] };
  const client = createClient({ apiKey: 'k', fetchImpl: fakeFetch([[201, failed], [201, { status: 'ERROR' }], [201, { status: 'QUEUED' }]]).impl });
  assert.deepEqual(await client.buy('r'), [{ code: 422, msg: 'UPS: The UPS account is not yet registered.' }, null]);
  assert.match((await client.buy('r'))[0].msg, /did not make the label \(error\)/);
  assert.match((await client.buy('r'))[0].msg, /\(queued\)/);
});

test('a refund Shippo refuses is an error, and an ERROR status is too', async () => {
  const client = createClient({ apiKey: 'k', fetchImpl: fakeFetch([[400, ['Refund requests are only available for labels that were bought']], [201, { status: 'ERROR' }]]).impl });
  assert.deepEqual(await client.refund('tx'), [{ code: 400, msg: 'Refund requests are only available for labels that were bought' }, null]);
  assert.equal((await client.refund('tx'))[0].code, 422);
});

test('a service is shown by its known name, the name Shippo gave, or made readable', () => {
  assert.equal(labelFor('USPS', 'usps_ground_advantage'), 'Ground Advantage');
  assert.equal(labelFor('UPS', 'ups_next_day_air_saver', 'ignored'), 'Next Day Air Saver');
  assert.equal(labelFor('DHL Express', 'dhl_express_domestic', 'Express Domestic®'), 'Express Domestic');
  assert.equal(labelFor('DHL Express', 'dhl_express_domestic'), 'Dhl Express Domestic');
  assert.equal(cleanName('  Priority   Mail™ '), 'Priority Mail');
  assert.equal(readable('fedex_2_day'), 'Fedex 2 Day');
  assert.equal(tokenOf('USPS', 'usps_priority'), 'USPS:usps_priority');
  assert.ok(KNOWN.every(entry => entry.service.startsWith(entry.carrier.toLowerCase())), 'every token starts with its carrier');
});

test('a list of services is read as carrier:token pairs, once each', () => {
  assert.deepEqual(parseServices('USPS:usps_priority, junk ,UPS:ups_ground,USPS:usps_priority,A:B:C'), ['USPS:usps_priority', 'UPS:ups_ground']);
  assert.deepEqual(parseServices(undefined), []);
});
