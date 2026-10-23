import { buildShipment } from './shippo.js';
import { KNOWN, labelFor, tokenOf } from './services.js';
import { toInches, toOunces } from './units.js';

/*
  Turning the parcels kempo-shipping packed into carrier quotes. Pure apart from the client and cache it is given, so it is
  tested with a fake client.

  `ready` is whether the customer has finished entering the address (kempo-shipping says so). While it is false nothing is asked of
  the carrier, because every request can cost money; a price already in the cache is still used, and a parcel that needed a
  request is left unpriced and reported as `pending`, which the hook passes back so kempo-shipping waits instead of falling back.
  One Shippo shipment prices a parcel with every carrier on the account, so a parcel costs one request however many
  services the seller offers, and the answer is kept per route, weight and size. A quote is added for each service the seller
  offers; kempo-shipping then offers the customer every carrier and service that has a quote for every parcel. A parcel that
  cannot be priced (no weight, too heavy, no ZIP code, not a US address) gets no quote from here, and the store's own table
  or the flat rate covers it.
*/
const DOMESTIC = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP']);
const MAX_POUNDS = 150;
const KNOWN_TOKENS = new Set(KNOWN.map(entry => tokenOf(entry.carrier, entry.service)));

export const zipOf = value => /^(\d{5})/.exec(String(value ?? '').trim())?.[1] ?? null;

/* Prices kept for a while, by route, weight and size, so a checkout re-priced on every keystroke is not a request each time. */
export const createCache = ({ now = Date.now } = {}) => {
  const entries = new Map();
  return {
    get: key => {
      const entry = entries.get(key);
      if(!entry) return null;
      if(entry.expires <= now()){
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    set: (key, value, ttlMs) => {
      if(entries.size > 2000) entries.clear();
      entries.set(key, { value, expires: now() + ttlMs });
    },
    get size(){ return entries.size; },
  };
};

/*
  A parcel in Shippo's units, rounded up: weight to the next whole ounce and sizes to the next tenth of an inch (what makes
  the cache hit for an order of the same box again), longest side first. Null when it has no weight or size, or is over what
  carriers take.
*/
export const measuresOf = (parcel, units) => {
  if(parcel?.weight === null || parcel?.weight === undefined) return null;
  const ounces = toOunces(parcel.weight, units.weight);
  const sides = [parcel.box?.length, parcel.box?.width, parcel.box?.height].map(side => (Number.isFinite(side) && side > 0 ? toInches(side, units.dimension) : null));
  if(ounces === null || ounces <= 0 || sides.some(side => side === null)) return null;
  const rounded = Math.max(1, Math.ceil(ounces - 1e-9));
  if(rounded > MAX_POUNDS * 16) return null;
  return { ounces: rounded, inches: sides.map(side => Math.max(0.1, Math.ceil(side * 10 - 1e-9) / 10)).sort((a, b) => b - a) };
};

/* Whether a rate is one the seller offers: a service they ticked, or (with "other services") one that is not in the known list. */
export const isOffered = (rate, settings) => {
  const token = tokenOf(rate.carrier, rate.service);
  return settings.services.includes(token) || (settings.otherServices && !KNOWN_TOKENS.has(token));
};

export const quoteParcels = async ({ parcels, address, origin, units, currency, settings, client, cache, ready = true, now = Date.now }) => {
  const result = { quoted: 0, skipped: 0, pending: false };
  const destinationZip = DOMESTIC.has(address?.country) ? zipOf(address?.postalCode) : null;
  const originZip = !origin?.country || DOMESTIC.has(origin.country) ? zipOf(origin?.postalCode) : null;
  if(String(currency).toLowerCase() !== 'usd' || !destinationZip || !originZip || (!settings.services.length && !settings.otherServices)){
    result.skipped = parcels.length;
    return result;
  }

  const ttl = Math.max(0, settings.cacheMinutes) * 60 * 1000;
  const from = { name: origin.name, line1: origin.line1, line2: origin.line2, city: origin.city, state: origin.state, postalCode: originZip, country: origin.country || 'US', phone: origin.phone };
  const to = { name: address.name, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: destinationZip, country: address.country };

  for(const parcel of parcels){
    const measures = measuresOf(parcel, units);
    if(!measures){
      result.skipped++;
      continue;
    }
    const key = [settings.residential, originZip, destinationZip, address.country, measures.ounces, ...measures.inches].join('|');
    let rates = cache.get(key);
    if(rates === null){
      if(!ready){
        result.pending = true;
        continue;
      }
      const [error, found] = await client.rates(buildShipment({ origin: from, destination: to, ...measures, residential: settings.residential }));
      if(error){
        console.warn(`[kempo-shipping-shippo] No Shippo prices: ${error.msg}`);
        result.skipped++;
        continue;
      }
      rates = found.rates;
      if(ttl) cache.set(key, rates, ttl);
    }
    for(const rate of rates){
      if(!isOffered(rate, settings)) continue;
      parcel.quotes.push({ carrier: rate.carrier, service: labelFor(rate.carrier, rate.service, rate.label), price: Math.round(rate.dollars * 100), ...(rate.days ? { days: rate.days } : {}) });
      result.quoted++;
    }
  }
  return result;
};
