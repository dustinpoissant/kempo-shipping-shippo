import authorize from '../../../../../../../server/utils/authorize.js';
import { getLabel, updateLabel } from '../../../../../../../server/utils/labelRows.js';
import { loadContext, noteOnOrder } from '../../../../../../../server/utils/orderContext.js';
import { refundLabel } from '../../../../../../../server/utils/purchase.js';

/* Asks Shippo to refund a label that was not used. Shippo and the carrier decide whether it is refunded; the answer is kept on the label. */
export default async (request, response) => {
  const [authError, who] = await authorize(request, 'manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, context] = await loadContext(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  if(!context.configured) return response.status(409).json({ error: 'Save a Shippo API key on the Shippo tab of the Shipping page first' });
  const [labelError, label] = await getLabel(context.order.id, request.params.labelId);
  if(labelError) return response.status(labelError.code).json({ error: labelError.msg });

  const [refundError, row] = await refundLabel({ client: context.client, label, update: updateLabel, note: noteOnOrder(context.order.id, who.userId) });
  if(refundError) return response.status(refundError.code).json({ error: refundError.msg });
  response.json({ label: row });
};
