import { cleanName } from './services.js';

/*
  Talking to the Shippo API (docs.goshippo.com). Nothing here reads settings or the database: it is given the key and a
  `fetch`, so it can be tested with a fake one and Shippo is never needed.

  Verified against a test key (October 2026):

  - Base URL https://api.goshippo.com, every request `Authorization: ShippoToken <key>`. A test key (`shippo_test_...`) and a live
    key use the same URL, and every object says `test: true` or `false`. A bad key is 401 `{ detail: "Token does not exist" }`, a
    missing object 404 `{ detail: "Not found" }`.
  - POST /shipments/ with `{ address_from, address_to, parcels: [{ length, width, height, distance_unit: 'in', weight,
    mass_unit: 'oz' }], metadata, async: false }` answers 201 with the shipment: `object_id`, `status` ('SUCCESS'), `metadata`, `messages`
    (carriers that could not rate say why) and `rates`: `object_id`, `provider`, `servicelevel: { name, token }`, `amount` (dollars
    as a string), `currency`, `estimated_days`. Creating buys nothing. Addresses take `name street1 street2 city state zip country
    phone email`, and the to-address `is_residential`.
  - POST /transactions/ with `{ rate: <rate object_id>, label_file_type: 'PDF_4x6', async: false }` buys the label. It answers **201 even
    when it fails**: read `status` ('SUCCESS' or 'ERROR') and `messages`. A success has `object_id`, `tracking_number`, `label_url` (the
    PDF itself) and `tracking_url_provider` (a general page of the carrier, not one for the number). The charged amount is on the rate, not
    the transaction. The sender must have an `email` or the buy fails ("Attribute address_from.email must not be empty").
  - POST /refunds/ with `{ transaction, async: false }` answers 201 `{ status }`. A transaction that is not a label is a 400 with a list of messages.
*/
export const BASE = 'https://api.goshippo.com';

const BACKOFF_MS = 60 * 1000;

const addressOf = ({ name, line1, line2, city, state, postalCode, country, phone, email }) => ({
  ...(name ? { name: String(name).slice(0, 60) } : {}),
  ...(line1 ? { street1: String(line1).slice(0, 100) } : {}),
  ...(line2 ? { street2: String(line2).slice(0, 100) } : {}),
  ...(city ? { city: String(city).slice(0, 60) } : {}),
  ...(state ? { state: String(state).slice(0, 30) } : {}),
  zip: String(postalCode),
  country: String(country || 'US'),
  ...(phone ? { phone: String(phone).slice(0, 30) } : {}),
  ...(email ? { email: String(email).slice(0, 100) } : {}),
});

/* The shipment to create to get a parcel's rates. `ounces` and `inches` are numbers; Shippo takes them as strings. */
export const buildShipment = ({ origin, destination, ounces, inches, residential = true, reference }) => ({
  address_from: addressOf(origin),
  address_to: { ...addressOf(destination), ...(residential ? { is_residential: true } : {}) },
  parcels: [{ length: String(inches[0]), width: String(inches[1]), height: String(inches[2]), distance_unit: 'in', weight: String(ounces), mass_unit: 'oz' }],
  ...(reference ? { metadata: String(reference) } : {}),
  async: false,
});

const asNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/*
  The rates in a shipment answer: [{ id, carrier, service, label, dollars, days }], dollars only, dropping anything unreadable.
  `carrier` is Shippo's provider and `service` its service level token; `label` is the name Shippo gave the service.
*/
export const ratesFrom = body => (Array.isArray(body?.rates) ? body.rates : []).flatMap(rate => {
  const dollars = asNumber(rate?.amount);
  const token = rate?.servicelevel?.token;
  if(typeof rate?.provider !== 'string' || typeof token !== 'string' || dollars === null || String(rate.currency ?? 'USD').toUpperCase() !== 'USD') return [];
  const days = Number(rate.estimated_days);
  return [{ ...(typeof rate.object_id === 'string' ? { id: rate.object_id } : {}), carrier: rate.provider, service: token, label: cleanName(rate.servicelevel?.name), dollars, days: Number.isFinite(days) && days > 0 ? days : null }];
});

/* The sentences a Shippo answer gives for what went wrong: a `messages` list of `{ source, text }`, or a `detail`, or a list of strings. */
export const messagesFrom = body => {
  if(Array.isArray(body)) return body.map(item => String(item?.text ?? item)).filter(Boolean);
  const list = (Array.isArray(body?.messages) ? body.messages : []).map(message => ({ carrier: message?.source ?? '', message: String(message?.text ?? '') })).filter(message => message.message);
  return list.map(message => (message.carrier ? `${message.carrier}: ${message.message}` : message.message));
};

/*
  A client for one API key. After a 429 it makes no more calls for a minute. It never throws: every method resolves to
  [error, result] like the rest of kempo.
*/
export const createClient = ({ apiKey, fetchImpl = globalThis.fetch, now = Date.now }) => {
  let blockedUntil = 0;

  const send = async (method, path, body) => {
    if(blockedUntil > now()) return [{ code: 429, msg: 'Shippo is limiting requests right now' }, null];
    let answer;
    try {
      const response = await fetchImpl(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `ShippoToken ${apiKey}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* a non-JSON answer is reported by its status */ }
      answer = { status: response.status, ok: response.ok, json };
    } catch(error) {
      return [{ code: 502, msg: error?.message || 'Shippo could not be reached' }, null];
    }
    if(answer.status === 429){
      blockedUntil = now() + BACKOFF_MS;
      return [{ code: 429, msg: 'Shippo is limiting requests right now' }, null];
    }
    if(answer.status === 401) return [{ code: 401, msg: 'Shippo did not accept the API key' }, null];
    if(!answer.ok) return [{ code: answer.status || 502, msg: messagesFrom(answer.json)[0] || answer.json?.detail || `Shippo answered ${answer.status}` }, null];
    return [null, answer.json];
  };

  /* Creates a shipment and reads its rates. Nothing is bought. */
  const create = async shipment => {
    const [error, json] = await send('POST', '/shipments/', shipment);
    if(error) return [error, null];
    const rates = ratesFrom(json);
    const messages = (Array.isArray(json?.messages) ? json.messages : []).map(message => ({ carrier: message?.source ?? '', message: String(message?.text ?? '') })).filter(message => message.message);
    if(!rates.length) return [{ code: 422, msg: messages[0] ? `Shippo gave no prices. ${messages[0].carrier ? `${messages[0].carrier}: ` : ''}${messages[0].message}` : 'Shippo gave no prices for this parcel. Check that a carrier is set up on your Shippo account' }, null];
    return [null, { id: json?.object_id ?? null, rates, mode: json?.test === false ? 'production' : 'test', messages }];
  };

  return {
    create,

    rates: async shipment => {
      const [error, found] = await create(shipment);
      if(error) return [error, null];
      const { rates, mode, messages } = found;
      return [null, { rates, mode, messages }];
    },

    /* One shipment as Shippo holds it (with its rates and `metadata`), to check it before buying. */
    shipment: id => send('GET', `/shipments/${encodeURIComponent(id)}`),

    /*
      Buys the label for one rate. This is the call that spends money on a live key. Shippo answers 201 even when the buy failed,
      so a transaction that is not SUCCESS is turned into an error carrying its messages.
    */
    buy: async rateId => {
      const [error, transaction] = await send('POST', '/transactions/', { rate: rateId, label_file_type: 'PDF_4x6', async: false });
      if(error) return [error, null];
      if(transaction?.status !== 'SUCCESS') return [{ code: 422, msg: messagesFrom(transaction).join(' ') || `Shippo did not make the label (${String(transaction?.status ?? 'no answer').toLowerCase()})` }, null];
      return [null, transaction];
    },

    /* Asks for the money back for a label that was not used. Resolves to the refund (`status`). */
    refund: async transactionId => {
      const [error, refund] = await send('POST', '/refunds/', { transaction: transactionId, async: false });
      if(error) return [error, null];
      if(refund?.status === 'ERROR') return [{ code: 422, msg: 'Shippo could not refund this label' }, null];
      return [null, refund];
    },
  };
};
