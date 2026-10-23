import authorize from '../../../server/utils/authorize.js';
import { saveSettings } from '../../../server/utils/config.js';

/* Saves what is sent. A blank API key leaves the stored one alone; null clears it. */
export default async (request, response) => {
  const [authError] = await authorize(request, 'manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const [error] = await saveSettings(request.body);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ saved: true });
};
