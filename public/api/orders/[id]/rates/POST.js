import authorize from '../../../../../server/utils/authorize.js';
import { buildShipment } from '../../../../../server/utils/shippo.js';
import { destinationFrom, measuresFrom, ratesView } from '../../../../../server/utils/labels.js';
import { loadContext } from '../../../../../server/utils/orderContext.js';

/*
  Prices one parcel of an order with every carrier on the Shippo account. Nothing is bought. The shipment is created with the
  order's id as its `reference`, which is how buying checks the prices were for this order. Body: `{ parcel: { length, width,
  height, weight }, units: { weight, dimension } }`, in the units sent.
*/
export default async (request, response) => {
  const [authError] = await authorize(request, 'manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, context] = await loadContext(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  if(!context.configured) return response.status(409).json({ error: 'Save a Shippo API key on the Shippo tab of the Shipping page first' });

  const destination = destinationFrom(context.order);
  if(!destination) return response.status(409).json({ error: 'This order has no shipping address to send to. Add one on the Shipping tab' });
  const { origin } = context.shipping;
  if(!origin?.line1 || !origin?.postalCode) return response.status(409).json({ error: 'Set the Ship From address on the General tab of the Shipping page first' });
  if(!context.fromEmail) return response.status(409).json({ error: 'Shippo needs an email address for the Ship From address. Set the Email from setting for the site, or add one on the Shippo tab of the Shipping page' });

  const [measureError, measures] = measuresFrom(request.body?.parcel, request.body?.units);
  if(measureError) return response.status(400).json({ error: measureError });

  const shipment = buildShipment({ origin: { ...origin, country: origin.country || 'US', email: context.fromEmail }, destination, ...measures, residential: context.settings.residential, reference: context.order.id });
  const [createError, found] = await context.client.create(shipment);
  if(createError) return response.status(createError.code === 401 || createError.code === 429 ? createError.code : 502).json({ error: createError.msg });

  response.json({ shipmentId: found.id, mode: found.mode, rates: ratesView(found.rates, context.selected), messages: found.messages });
};
