import authorize from '../../../server/utils/authorize.js';
import { readSettings } from '../../../server/utils/config.js';
import * as kempo from 'kempo/server/sdk.js';
import { isConfigured, looksLikeTestKey } from '../../../server/utils/settings.js';
import { KNOWN, tokenOf } from '../../../server/utils/services.js';

/* The settings for the Shippo tab. The API key is never sent, only whether it is set and whether it looks like a test key. */
export default async (request, response) => {
  const [authError] = await authorize(request, 'view');
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const { apiKey, ...settings } = await readSettings();
  response.json({
    ...settings,
    defaultFromEmail: (await kempo.getSenderEmail?.()) ?? '',
    hasKey: Boolean(apiKey),
    testKey: looksLikeTestKey(apiKey),
    configured: isConfigured({ apiKey }),
    knownServices: KNOWN.map(entry => ({ token: tokenOf(entry.carrier, entry.service), carrier: entry.carrier, label: entry.label })),
    encryptionConfigured: Boolean(process.env.SETTINGS_ENCRYPTION_KEY),
  });
};
