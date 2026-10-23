import crypto from 'crypto';
import authorize from '../../../../../server/utils/authorize.js';
import { saveLabel, shipmentUsed } from '../../../../../server/utils/labelRows.js';
import { loadContext, noteOnOrder } from '../../../../../server/utils/orderContext.js';
import { buyLabel } from '../../../../../server/utils/purchase.js';

/*
  Buys the label for one price from the rates route. On a production key this spends money. Body: `{ shipmentId, rateId }`;
  the cost kept is the one Shippo charged, never one from the browser.
*/
export default async (request, response) => {
  const [authError, who] = await authorize(request, 'manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, context] = await loadContext(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  if(!context.configured) return response.status(409).json({ error: 'Save a Shippo API key on the Shippo tab of the Shipping page first' });

  const [buyError, label] = await buyLabel({
    client: context.client,
    orderId: context.order.id,
    shipmentId: request.body?.shipmentId,
    rateId: request.body?.rateId,
    userId: who.userId,
    save: saveLabel,
    used: shipmentUsed,
    note: noteOnOrder(context.order.id, who.userId),
    newId: () => crypto.randomBytes(8).toString('hex'),
  });
  if(buyError) return response.status(buyError.code).json({ error: buyError.msg });
  response.status(201).json({ label });
};
