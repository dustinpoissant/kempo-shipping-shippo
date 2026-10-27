import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Toggle.js';
import Toast from '/kempo-ui/components/Toast.js';

/*
  The Shippo tab on the Shipping page, served at /admin/extension/kempo-shipping-shippo/components/ShippoSettings.js
  and added through the `shipping-admin-tabs` location (see admin/shipping-tab.global.html).

    <k-shippo-settings></k-shippo-settings>

  The API key is replace-only: it is never sent back, so its field is always empty and a blank field on save leaves the
  stored one alone. "Test Shippo" creates one shipment (nothing is bought) and lists every rate that came back.
*/
const TAG = 'k-shippo-settings';

export class ShippoSettings extends ShadowComponent {
  static properties = {
    settings: { state: true },
    apiKey: { state: true },
    loading: { state: true },
    saving: { state: true },
    testing: { state: true },
    testZip: { state: true },
    testResult: { state: true },
    origin: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.settings = null;
    this.apiKey = '';
    this.loading = true;
    this.saving = false;
    this.testing = false;
    this.testZip = '';
    this.testResult = null;
    this.origin = null;
    this.error = '';
  }

  connectedCallback(){
    super.connectedCallback();
    this.shippingPage = this.closest('#shipping');
    this.shippingPage?.addEventListener('origin-change', this.changeOrigin);
    // The page opens each carrier's tab on first show, so an unopened carrier makes no requests.
    const pane = this.closest('k-tab-content');
    if(!pane || pane.active) this.showTab();
    else this.closest('k-tabs')?.addEventListener('tabfirstshown', ({ detail }) => {
      if(detail.tab === pane.name) this.showTab();
    });
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    this.shippingPage?.removeEventListener('origin-change', this.changeOrigin);
  }

  /* The Ship From address as saved on the General tab, which the shipping settings announce when it loads and when it is saved. */
  changeOrigin = event => {
    this.origin = event.detail;
  };

  /* What the Ship From address still needs before the test can price a parcel from it. */
  get missingOrigin(){
    const fields = { 'street address': 'line1', 'city': 'city', 'state': 'state', 'postal code': 'postalCode' };
    return Object.entries(fields).filter(([, key]) => !String(this.origin?.[key] ?? '').trim()).map(([label]) => label);
  }

  /*
    Loading and saving
  */

  showTab = () => {
    this.loadOrigin();
    this.load();
  };

  /* The Ship From address as saved, for the first show; changes after that come as origin-change. */
  loadOrigin = async () => {
    const settings = await fetch('/shipping/api/settings', { credentials: 'same-origin' }).then(response => response.json());
    this.origin = settings.origin ?? null;
  };

  load = async () => {
    try {
      const response = await fetch('/shippo/api/settings', { credentials: 'same-origin' });
      const body = await response.json();
      if(!response.ok) throw new Error(body.error);
      this.settings = body;
    } catch {
      this.error = 'The Shippo settings could not be loaded.';
    }
    this.loading = false;
  };

  save = async () => {
    this.saving = true;
    const { services, otherServices, fromEmail, residential, cacheMinutes } = this.settings;
    const response = await fetch('/shippo/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ apiKey: this.apiKey, services, otherServices, fromEmail, residential, cacheMinutes: Number(cacheMinutes) }),
    });
    this.saving = false;
    const body = await response.json().catch(() => ({}));
    if(!response.ok){
      Toast.error(body.error || 'The Shippo settings could not be saved.');
      return;
    }
    this.apiKey = '';
    Toast.success('Shippo settings saved');
    await this.load();
  };

  test = async () => {
    this.testing = true;
    this.testResult = null;
    const response = await fetch('/shippo/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ zip: this.testZip }),
    });
    this.testing = false;
    const body = await response.json().catch(() => ({}));
    this.testResult = response.ok ? body : { ok: false, error: body.error || 'The test could not be run.', results: [] };
  };

  /*
    Event handlers
  */

  set = (name, value) => {
    this.settings = { ...this.settings, [name]: value };
  };

  toggleService = (token, on) => {
    const next = this.settings.services.filter(entry => entry !== token);
    this.set('services', on ? [...next, token] : next);
  };

  /*
    Rendering
  */

  renderTest(){
    const result = this.testResult;
    if(!result) return nothing;
    if(!result.ok) return html`<p class="tc-danger" role="alert">${result.error}</p>`;
    return html`
      <p class="tc-success">Shippo answered${result.mode ? ` in ${result.mode} mode` : ''}. Prices for a 1 lb, 6 × 4 × 2 in parcel from ${result.originZip} to ${result.destinationZip}:</p>
      <ul>${result.results.map(item => html`<li>${item.carrier} ${item.label}: $${item.dollars.toFixed(2)}${item.days ? ` (${item.days} ${item.days === 1 ? 'day' : 'days'})` : ''} <span class="tc-muted">${item.offered ? '' : '(not offered to customers) '}[${item.carrier}:${item.service}]</span></li>`)}</ul>
      ${result.messages?.length ? html`<p class="tc-muted">Carriers that did not rate: ${result.messages.map(message => `${message.carrier ? `${message.carrier}: ` : ''}${message.message}`).join('; ')}</p>` : nothing}
    `;
  }

  renderServices(){
    const carriers = [...new Set(this.settings.knownServices.map(service => service.carrier))];
    return carriers.map(carrier => html`
      <h4 class="h6">${carrier}</h4>
      ${this.settings.knownServices.filter(service => service.carrier === carrier).map(service => html`<label class="checkbox d-b mb"><input type="checkbox" .checked=${this.settings.services.includes(service.token)} @change=${event => this.toggleService(service.token, event.target.checked)}> ${service.label}</label>`)}
    `);
  }

  render(){
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(!this.settings) return html`<p class="tc-danger" role="alert">${this.error}</p>`;
    const settings = this.settings;
    return html`
      <h2 class="h4">Shippo</h2>
      <p class="tc-muted">Prices each parcel with the carriers on your Shippo account (USPS, UPS, FedEx and more) and lets the customer choose between the services you turn on. Get an API key from the Shippo dashboard. Nothing is bought: only rates are asked for. A parcel Shippo cannot price (no weight, over 150 lb, a non-US address) is priced by your boxes or the flat rate instead.</p>
      ${settings.encryptionConfigured ? nothing : html`<p class="tc-danger" role="alert">SETTINGS_ENCRYPTION_KEY is not set on this server, so the API key cannot be stored. Add it to the environment and restart.</p>`}

      <label class="mb">
        API key
        <span class="d-b tc-muted">${settings.hasKey ? `A key is saved${settings.testKey ? ' (a test key, so prices are samples)' : ''}. Type a new one to replace it.` : 'Not saved yet. A test key is fine to try it.'}</span>
        <input type="password" autocomplete="off" .value=${this.apiKey} @input=${event => { this.apiKey = event.target.value; }}>
      </label>

      <label class="mb">
        Email for the Ship From address
        <span class="d-b tc-muted">Shippo will not make a label without an email on the sender, and carriers may send tracking updates to it. Leave it empty to use ${settings.defaultFromEmail ? html`<strong>${settings.defaultFromEmail}</strong>, the address this site sends its emails from` : 'the address this site sends its emails from (not set: set the Email from setting, or type one here)'}. Not needed to get prices.</span>
        <input type="email" autocomplete="off" .value=${settings.fromEmail ?? ''} @input=${event => this.set('fromEmail', event.target.value)}>
      </label>

      <h3 class="h5">Services to offer</h3>
      <p class="tc-muted">Only carriers set up on your Shippo account return prices. Run the test to see which.</p>
      ${this.renderServices()}
      <label class="checkbox d-f mb"><k-toggle .value=${settings.otherServices} @change=${event => this.set('otherServices', event.currentTarget.value === true)}></k-toggle> Also offer any other service Shippo returns</label>
      <label class="checkbox d-f mb"><k-toggle .value=${settings.residential} @change=${event => this.set('residential', event.currentTarget.value === true)}></k-toggle> Price as delivered to a home (carriers add a residential surcharge)</label>

      <label class="mb">
        Keep prices for (minutes)
        <span class="d-b tc-muted">The same route, weight and size reuses its price for this long. This keeps checkout fast and keeps the number of requests to Shippo down. 0 asks Shippo every time.</span>
        <input type="number" min="0" max="1440" step="1" style="max-width: 10rem;" .value=${String(settings.cacheMinutes)} @input=${event => this.set('cacheMinutes', event.target.value)}>
      </label>

      <div class="d-f mb">
        <button type="button" class="primary mr" ?disabled=${this.saving} @click=${this.save}>${this.saving ? 'Saving…' : 'Save Shippo settings'}</button>
      </div>

      <h3 class="h5">Test Shippo</h3>
      <p class="tc-muted">Asks Shippo for the prices of a sample parcel from your Ship From address and lists every one it returns. Nothing is bought.</p>
      <label class="mb">
        Send it to ZIP code
        <input type="text" inputmode="numeric" maxlength="10" placeholder="Your Ship From ZIP code" style="max-width: 14rem;" .value=${this.testZip} @input=${event => { this.testZip = event.target.value; }}>
      </label>
      <button type="button" class="btn mb" ?disabled=${this.testing || !settings.configured || this.missingOrigin.length > 0} @click=${this.test}>${this.testing ? 'Testing…' : 'Test Shippo'}</button>
      ${settings.configured ? nothing : html`<p class="tc-muted">Save an API key to test.</p>`}
      ${this.missingOrigin.length ? html`<p class="tc-muted">Fill in the Ship from address on the General tab and save it to test (missing: ${this.missingOrigin.join(', ')}).</p>` : nothing}
      ${this.renderTest()}
    `;
  }
}

customElements.define(TAG, ShippoSettings);
