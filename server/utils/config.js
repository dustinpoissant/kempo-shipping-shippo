import { getSetting, setSetting } from 'kempo/server/sdk.js';
import { createRequire } from 'node:module';
import { OWNER, cleanSettings, fromStored } from './settings.js';

/*
  Reading and saving the settings in kempo's settings table. The type and description of each come from
  kempo-config.json (setSetting stores exactly what it is given: a missing type would store a credential as plain text).
*/
const declared = new Map(createRequire(import.meta.url)('../../kempo-config.json').settings.map(setting => [setting.name, setting]));

export const readSettings = async () => {
  const stored = {};
  for(const name of declared.keys()){
    const [, value] = await getSetting(OWNER, name, declared.get(name).value);
    stored[name] = value;
  }
  return fromStored(stored);
};

/* Saves what is sent. Resolves to [error, null] or [null, true]. */
export const saveSettings = async body => {
  if(!process.env.SETTINGS_ENCRYPTION_KEY) return [{ code: 500, msg: 'SETTINGS_ENCRYPTION_KEY is not set on this server, so the Shippo API key cannot be stored. Add it to the environment and restart.' }, null];
  const [error, writes] = cleanSettings(body ?? {});
  if(error) return [error, null];
  for(const [name, value] of Object.entries(writes)){
    const { type, description } = declared.get(name);
    const [writeError] = await setSetting(OWNER, name, value, type, false, description);
    if(writeError) return [writeError, null];
  }
  return [null, true];
};
