import { readSettings } from '../server/utils/config.js';
import { isConfigured } from '../server/utils/settings.js';
import { quoteParcels } from '../server/utils/quotes.js';
import { cache, clientFor } from '../server/utils/shared.js';

/*
  The `kempo-shipping:rates` hook: adds a quote for each parcel and each carrier service the seller offers (see
  server/utils/quotes.js). It does nothing until a Shippo API key is saved, and it never throws: a Shippo problem
  means no quote from it, which kempo-shipping covers with the store's own table or the flat rate, whereas a thrown error
  would make the whole order unable to be priced.
*/
export default async ({ parcels, address, origin, units, currency, ready, charge }) => {
  try {
    if(!parcels?.length) return;
    const settings = await readSettings();
    if(!isConfigured(settings)) return;
    const result = await quoteParcels({ parcels, address, origin, units, currency, settings, client: clientFor(settings), cache, ready: ready !== false });
    if(result.pending && charge) charge.pending = true;
  } catch(error) {
    console.error('[kempo-shipping-shippo] Could not price the parcels:', error);
  }
};
