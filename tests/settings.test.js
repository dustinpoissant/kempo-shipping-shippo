import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSettings, fromEmailFor, fromStored, isConfigured, looksLikeTestKey, DEFAULTS } from '../server/utils/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));

test('stored settings become the shape the extension uses, with a safe fallback for anything unreadable', () => {
  const settings = fromStored({ shippo_api_key: 'shippo_test_1', shippo_from_email: ' me@example.com ', shippo_services: 'USPS:usps_priority, junk ,UPS:ups_ground,USPS:usps_priority', shippo_other_services: 'true', shippo_residential: 'false', shippo_cache_minutes: '15' });
  assert.deepEqual(settings, { apiKey: 'shippo_test_1', services: ['USPS:usps_priority', 'UPS:ups_ground'], otherServices: true, fromEmail: 'me@example.com', residential: false, cacheMinutes: 15 });
  const fallback = fromStored({ shippo_cache_minutes: 'many', shippo_residential: 'maybe' });
  assert.equal(fallback.cacheMinutes, DEFAULTS.cacheMinutes);
  assert.equal(fallback.residential, DEFAULTS.residential);
  assert.deepEqual(fallback.services, DEFAULTS.services);
  assert.equal(fromStored({ shippo_services: '' }).services.length, 0, 'turning every service off is allowed');
});

test('it is only configured with a key, and a test key is recognised', () => {
  assert.equal(isConfigured({ apiKey: 'k' }), true);
  assert.equal(isConfigured({ apiKey: '' }), false);
  assert.equal(looksLikeTestKey('shippo_test_1234'), true);
  assert.equal(looksLikeTestKey('shippo_live_1234'), false);
});

test('a blank key leaves the stored one alone, and only null clears it', () => {
  assert.deepEqual(cleanSettings({ apiKey: '' })[1], {});
  assert.deepEqual(cleanSettings({ apiKey: '   ' })[1], {});
  assert.deepEqual(cleanSettings({ apiKey: ' shippo_test_1 ' })[1], { shippo_api_key: 'shippo_test_1' });
  assert.deepEqual(cleanSettings({ apiKey: null })[1], { shippo_api_key: '' });
  for(const apiKey of [5, 'two words', 'x'.repeat(201)]) assert.equal(cleanSettings({ apiKey })[0].code, 400, String(apiKey));
});

test('the other settings are checked before they are saved', () => {
  assert.deepEqual(cleanSettings({ services: ['USPS:usps_priority', 'USPS:usps_priority', 'UPS:ups_ground'], otherServices: true, fromEmail: ' a@b.co ', residential: false, cacheMinutes: 30 })[1], {
    shippo_services: 'USPS:usps_priority,UPS:ups_ground', shippo_other_services: true, shippo_from_email: 'a@b.co', shippo_residential: false, shippo_cache_minutes: 30,
  });
  assert.deepEqual(cleanSettings({ fromEmail: '' })[1], { shippo_from_email: '' });
  assert.deepEqual(cleanSettings({ services: [] })[1], { shippo_services: '' });
  for(const body of [{ services: 'USPS:Priority' }, { services: ['Priority'] }, { services: ['A:B:C'] }, { services: [5] }, { otherServices: 'yes' }, { fromEmail: 'not an email' }, { fromEmail: 5 }, { residential: 1 }, { cacheMinutes: -1 }, { cacheMinutes: 1.5 }, { cacheMinutes: 99999 }]){
    assert.equal(cleanSettings(body)[0]?.code, 400, JSON.stringify(body));
  }
});

test('the key is a secret setting, every setting the code writes is declared, the default services match, and the hook is registered', async () => {
  const types = new Map(config.settings.map(setting => [setting.name, setting.type]));
  assert.equal(types.get('shippo_api_key'), 'secret');
  const writes = Object.keys(cleanSettings({ apiKey: 'k', services: [], otherServices: true, fromEmail: 'a@b.co', residential: true, cacheMinutes: 1 })[1]);
  for(const name of writes) assert.ok(types.has(name), `${name} is declared in kempo-config.json`);
  const declaredServices = config.settings.find(setting => setting.name === 'shippo_services').value.split(',');
  assert.deepEqual(declaredServices, DEFAULTS.services, 'the config default and the code default agree');
  assert.deepEqual(config.dependencies, ['kempo-commerce', 'kempo-shipping']);
  assert.equal(config.schema, './server/db/schema.js');
  assert.equal(config.hooks['kempo-shipping:rates'], './hooks/rates.js');
  assert.ok(existsSync(path.join(root, 'hooks', 'rates.js')));
});

test('the files the package says it ships exist, the tab fragment names this package, and it is not private', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for(const entry of pkg.files) assert.ok(existsSync(path.join(root, entry)), `${entry} exists`);
  assert.equal(pkg.private, undefined);
  const tab = await readFile(path.join(root, 'admin', 'shipping-tab.global.html'), 'utf8');
  assert.match(tab, /location="shipping-admin-tabs"/);
  assert.match(tab, /location="shipping-admin-scripts"/);
  assert.match(tab, /owner="kempo-shipping-shippo"/);
  const script = /src="\/admin\/extension\/kempo-shipping-shippo\/(components\/[\w]+\.js)"/.exec(tab);
  assert.ok(script && existsSync(path.join(root, 'admin', script[1])), 'the script the tab loads exists');
});

test('the install creates every column and index the labels schema declares', async () => {
  const { readFile } = await import('node:fs/promises');
  const { getTableColumns } = await import('drizzle-orm');
  const { kempoShippoLabel } = await import('../server/db/schema.js');
  const install = await readFile(path.join(root, 'install.js'), 'utf8');
  for(const column of Object.values(getTableColumns(kempoShippoLabel))) assert.ok(install.includes(`"${column.name}"`), `install.js does not create ${column.name}`);
  assert.ok(install.includes('"kempoShippoLabel_order_idx"') && install.includes('UNIQUE INDEX IF NOT EXISTS "kempoShippoLabel_shipment_idx"'));
});

test('the Ship From email is the one set here, else the address the site sends its emails from, else none', () => {
  assert.equal(fromEmailFor({ fromEmail: 'me@example.com' }, 'shop@example.com'), 'me@example.com');
  assert.equal(fromEmailFor({ fromEmail: '' }, 'shop@example.com'), 'shop@example.com');
  assert.equal(fromEmailFor({ fromEmail: '' }, null), '');
  assert.equal(fromEmailFor({}, undefined), '');
});
