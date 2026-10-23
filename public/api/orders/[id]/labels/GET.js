import authorize from '../../../../../server/utils/authorize.js';
import { listLabels } from '../../../../../server/utils/labelRows.js';
import { destinationFrom } from '../../../../../server/utils/labels.js';
import { loadContext } from '../../../../../server/utils/orderContext.js';

/* What the Shippo tab of the admin order page starts from: the labels already bought, and the boxes the order was packed into to buy more. */
export default async (request, response) => {
  const [authError] = await authorize(request, 'view');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, context] = await loadContext(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  const [labelsError, labels] = await listLabels(context.order.id);
  if(labelsError) return response.status(labelsError.code).json({ error: labelsError.msg });

  response.json({
    configured: context.configured,
    mode: context.mode,
    labels,
    parcels: context.parcels,
    units: context.units,
    chosen: context.selected,
    paid: context.fee?.amount ?? null,
    hasAddress: destinationFrom(context.order) !== null,
    hasOrigin: Boolean(context.shipping.origin?.line1 && context.shipping.origin?.postalCode),
  });
};
