import * as kempo from 'kempo/server/sdk.js';
import { getOrder, addOrderEvent } from 'kempo-commerce/sdk';
import { getShippingSettings } from 'kempo-shipping/sdk';
import { readSettings } from './config.js';
import { fromEmailFor, isConfigured } from './settings.js';
import { clientFor } from './shared.js';
import { keyMode, parcelsFromFee } from './labels.js';

/*
  What the routes of the order's Shippo tab all need: the order, its shipping fee (which kept the boxes, the units and the
  method the customer chose), the Shippo settings and the shipping settings. Resolves to [error, context].
*/
export const loadContext = async orderId => {
  const [orderError, order] = await getOrder(orderId);
  if(orderError) return [orderError, null];
  const settings = await readSettings();
  const shipping = await getShippingSettings();
  const configured = isConfigured(settings);
  const fee = order.adjustments?.find(adjustment => adjustment.type === 'fee' && adjustment.code === 'shipping' && adjustment.source === 'kempo-shipping') ?? null;
  const { units, parcels } = parcelsFromFee(fee);
  return [null, {
    order,
    fee,
    shipping,
    settings,
    configured,
    fromEmail: fromEmailFor(settings, await kempo.getSenderEmail?.()),
    mode: configured ? keyMode(settings.apiKey) : null,
    client: configured ? clientFor(settings) : null,
    parcels,
    units: units ?? { weight: shipping.weightUnit, dimension: shipping.dimensionUnit },
    selected: fee?.data?.selected ?? '',
  }];
};

/* A line in the order's history, private to staff. A failure to write it never undoes a label that was already bought. */
export const noteOnOrder = (orderId, userId) => async (row, summary) => {
  const [error] = await addOrderEvent(orderId, 'shippo_label', { actor: userId ?? 'system', data: { summary, labelId: row.id, trackingCode: row.trackingCode } });
  if(error) console.warn(`[kempo-shipping-shippo] The label was not noted in the order history: ${error.msg}`);
};
