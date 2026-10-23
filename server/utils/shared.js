import { createClient } from './shippo.js';
import { createCache } from './quotes.js';

/*
  The one Shippo client and price cache of this server process, rebuilt when the key changes (so a new key takes effect
  without a restart). They live here so the prices survive from one checkout request to the next, which is the point.
*/
export const cache = createCache();

let current = { id: null, client: null };

export const clientFor = settings => {
  if(current.id !== settings.apiKey) current = { id: settings.apiKey, client: createClient({ apiKey: settings.apiKey }) };
  return current.client;
};
