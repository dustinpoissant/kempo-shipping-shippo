import { getShippingSettings } from 'kempo-shipping/sdk';
import authorize from '../../../server/utils/authorize.js';
import { readSettings } from '../../../server/utils/config.js';
import { isConfigured } from '../../../server/utils/settings.js';
import { buildShipment } from '../../../server/utils/shippo.js';
import { isOffered, zipOf } from '../../../server/utils/quotes.js';
import { labelFor } from '../../../server/utils/services.js';
import { clientFor } from '../../../server/utils/shared.js';

/*
  Tries the saved key: creates one Shippo shipment (nothing is bought) for a 1 lb 6 x 4 x 2 in parcel from the Ship
  From address to the ZIP code sent (the Ship From one when none is), and says every rate Shippo returned with the
  service name it used, whether this extension would offer it, and any carrier that failed. Bypasses the price cache.
*/
export default async (request, response) => {
  const [authError] = await authorize(request, 'manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const settings = await readSettings();
  if(!isConfigured(settings)) return response.status(409).json({ error: 'Save an API key first' });

  const { origin } = await getShippingSettings();
  const originZip = zipOf(origin?.postalCode);
  if(!originZip) return response.status(409).json({ error: 'Set the Ship From address (with its postal code) on the General tab first' });
  const destinationZip = zipOf(request.body?.zip) ?? originZip;

  const [error, found] = await clientFor(settings).rates(buildShipment({
    origin: { ...origin, postalCode: originZip, country: origin.country || 'US' },
    destination: { name: 'Test Recipient', postalCode: destinationZip, country: 'US' },
    ounces: 16,
    inches: [6, 4, 2],
    residential: settings.residential,
  }));
  if(error) return response.json({ ok: false, error: error.msg, originZip, destinationZip, results: [] });

  response.json({
    ok: true,
    mode: found.mode,
    originZip,
    destinationZip,
    messages: found.messages,
    results: found.rates.map(rate => ({ carrier: rate.carrier, service: rate.service, label: labelFor(rate.carrier, rate.service, rate.label), dollars: rate.dollars, days: rate.days, offered: isOffered(rate, settings) })),
  });
};
