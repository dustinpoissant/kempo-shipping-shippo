import { parseServices } from './services.js';

/*
  The extension's settings as pure rules (reading and writing them is config.js), so they can be tested alone.

  The API key is a `secret` setting, so kempo encrypts it. It is never sent to a browser: the settings screen is told only
  whether it is set, and a blank field on save means "unchanged", because the field is always empty (saving the form after
  changing the services must not wipe the key). Clearing it is an explicit `null`.
*/
export const OWNER = 'kempo-shipping-shippo';

export const DEFAULTS = {
  services: parseServices('USPS:usps_ground_advantage,USPS:usps_priority,USPS:usps_priority_express,UPS:ups_ground,UPS:ups_3_day_select,UPS:ups_second_day_air,UPS:ups_next_day_air_saver,UPS:ups_next_day_air,FedEx:fedex_ground,FedEx:fedex_home_delivery,FedEx:fedex_express_saver,FedEx:fedex_2_day,FedEx:fedex_standard_overnight,FedEx:fedex_priority_overnight'),
  otherServices: false,
  fromEmail: '',
  residential: true,
  cacheMinutes: 60,
};

const MAX_CACHE_MINUTES = 24 * 60;
const MAX_SERVICES = 200;

const flag = (value, fallback) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback);

/* The settings as stored (every value a string or boolean) in the shape the rest of the extension uses. */
export const fromStored = stored => {
  const minutes = Number(stored.shippo_cache_minutes);
  return {
    apiKey: String(stored.shippo_api_key ?? ''),
    services: parseServices(stored.shippo_services ?? DEFAULTS.services.join(',')),
    otherServices: flag(stored.shippo_other_services, DEFAULTS.otherServices),
    fromEmail: String(stored.shippo_from_email ?? '').trim(),
    residential: flag(stored.shippo_residential, DEFAULTS.residential),
    cacheMinutes: Number.isFinite(minutes) && minutes >= 0 ? Math.min(Math.floor(minutes), MAX_CACHE_MINUTES) : DEFAULTS.cacheMinutes,
  };
};

export const isConfigured = settings => Boolean(settings.apiKey);

/* The email for the Ship From address: the one set here, else the address kempo sends its emails from (`sender`), else none. */
export const fromEmailFor = (settings, sender) => settings.fromEmail || sender || '';

/* Whether the key is a test key, from its prefix (Shippo's test keys start shippo_test_). Only a hint for the screen. */
export const looksLikeTestKey = key => /^shippo_test_/.test(String(key));

/*
  What the settings screen may send, checked. Returns [error, writes] where writes is `{ setting name: value }` for the
  settings to save. `apiKey` is left out when blank (unchanged) and written as '' when null.
*/
export const cleanSettings = body => {
  const writes = {};
  const bad = msg => [{ code: 400, msg }, null];

  if(body.apiKey !== undefined){
    if(body.apiKey === null) writes.shippo_api_key = '';
    else if(typeof body.apiKey !== 'string') return bad('The API key must be text');
    else if(body.apiKey.trim()){
      if(body.apiKey.trim().length > 200 || /\s/.test(body.apiKey.trim())) return bad('That is not a Shippo API key');
      writes.shippo_api_key = body.apiKey.trim();
    }
  }
  if(body.services !== undefined){
    if(!Array.isArray(body.services) || body.services.length > MAX_SERVICES || body.services.some(service => typeof service !== 'string' || parseServices(service).length !== 1)) return bad('Choose from the services listed');
    writes.shippo_services = [...new Set(body.services)].join(',');
  }
  for(const [field, name] of [['otherServices', 'shippo_other_services'], ['residential', 'shippo_residential']]){
    if(body[field] === undefined) continue;
    if(typeof body[field] !== 'boolean') return bad('That choice must be on or off');
    writes[name] = body[field];
  }
  if(body.fromEmail !== undefined){
    if(typeof body.fromEmail !== 'string' || body.fromEmail.length > 200 || (body.fromEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.fromEmail.trim()))) return bad('Enter an email address, or leave it empty');
    writes.shippo_from_email = body.fromEmail.trim();
  }
  if(body.cacheMinutes !== undefined){
    const minutes = Number(body.cacheMinutes);
    if(!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_CACHE_MINUTES) return bad(`Keep prices for a whole number of minutes, from 0 to ${MAX_CACHE_MINUTES}`);
    writes.shippo_cache_minutes = minutes;
  }
  return [null, writes];
};
