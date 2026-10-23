/*
  The services Shippo can return, and what a customer is shown for them. Pure.

  Shippo names a rate by its provider ("USPS", "UPS", "FedEx") and its service level token ("usps_ground_advantage",
  "ups_next_day_air_saver", "fedex_2_day"). A service is written `Carrier:token` in the settings. The USPS and UPS tokens below were
  returned by Shippo's own API when this was built; the FedEx tokens are the ones Shippo documents and are not yet seen
  from a real account, so check them with **Test Shippo** once a FedEx account is connected (a service not in this list is still
  priced when "other services" is turned on, with the name Shippo gives it).
*/
export const KNOWN = [
  { carrier: 'USPS', service: 'usps_ground_advantage', label: 'Ground Advantage' },
  { carrier: 'USPS', service: 'usps_priority', label: 'Priority Mail' },
  { carrier: 'USPS', service: 'usps_priority_express', label: 'Priority Mail Express' },
  { carrier: 'USPS', service: 'usps_media_mail', label: 'Media Mail' },
  { carrier: 'USPS', service: 'usps_parcel_select', label: 'Parcel Select' },
  { carrier: 'UPS', service: 'ups_ground', label: 'Ground' },
  { carrier: 'UPS', service: 'ups_ground_saver', label: 'Ground Saver' },
  { carrier: 'UPS', service: 'ups_3_day_select', label: '3 Day Select' },
  { carrier: 'UPS', service: 'ups_second_day_air', label: '2nd Day Air' },
  { carrier: 'UPS', service: 'ups_second_day_air_am', label: '2nd Day Air A.M.' },
  { carrier: 'UPS', service: 'ups_next_day_air_saver', label: 'Next Day Air Saver' },
  { carrier: 'UPS', service: 'ups_next_day_air', label: 'Next Day Air' },
  { carrier: 'UPS', service: 'ups_next_day_air_early_am', label: 'Next Day Air Early' },
  { carrier: 'FedEx', service: 'fedex_ground', label: 'Ground' },
  { carrier: 'FedEx', service: 'fedex_home_delivery', label: 'Home Delivery' },
  { carrier: 'FedEx', service: 'fedex_smart_post', label: 'Ground Economy' },
  { carrier: 'FedEx', service: 'fedex_express_saver', label: 'Express Saver' },
  { carrier: 'FedEx', service: 'fedex_2_day', label: '2Day' },
  { carrier: 'FedEx', service: 'fedex_2_day_am', label: '2Day A.M.' },
  { carrier: 'FedEx', service: 'fedex_standard_overnight', label: 'Standard Overnight' },
  { carrier: 'FedEx', service: 'fedex_priority_overnight', label: 'Priority Overnight' },
  { carrier: 'FedEx', service: 'fedex_first_overnight', label: 'First Overnight' },
];

export const tokenOf = (carrier, service) => `${carrier}:${service}`;

const LABELS = new Map(KNOWN.map(entry => [tokenOf(entry.carrier, entry.service), entry.label]));

/* Words out of a token: "usps_ground_advantage" becomes "Usps Ground Advantage". Only used when Shippo gave no name either. */
export const readable = service => String(service)
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .trim()
  .split(/\s+/)
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(' ');

/* A name Shippo gave, without the trademark signs it puts on them ("Next Day Air Saver®"), or '' when there is none. */
export const cleanName = name => String(name ?? '').replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim();

/* What the customer is shown for a service ("Ground Advantage"): the list above, else the name Shippo gave, else made readable. */
export const labelFor = (carrier, service, name = '') => LABELS.get(tokenOf(carrier, service)) ?? (cleanName(name) || readable(service));

/* A stored comma list of `Carrier:token` pairs, once each, in order. Anything that is not a pair is dropped. */
export const parseServices = value => [...new Set(String(value ?? '').split(',').map(part => part.trim()).filter(part => /^[^:\s,]+:[^:\s,]+$/.test(part)))];
