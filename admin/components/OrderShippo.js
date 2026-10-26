import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Table.js';
import './OrderAction.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Timestamp.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import Toast from '/kempo-ui/components/Toast.js';
import { loadFormat } from '/commerce/utils/format.js';

/*
  The Shippo tab of the admin order page, served at /admin/extension/kempo-shipping-shippo/components/OrderShippo.js.

    <k-shippo-order></k-shippo-order>

  It is the content of a `k-commerce-order-tab` that admin/order-tab.global.html puts on the page. It lists the labels already
  bought for the order (print again, tracking number, what it cost and when, a button to the carrier's tracking page, and a refund
  request for one that was not used) and lets staff buy more: each box the order was packed into starts as a row to price (its
  size and weight can be changed), "Get prices" asks Shippo for every carrier's price, and "Buy" buys one. Nothing is bought until
  Buy is confirmed. On a test key nothing is charged and the labels are not valid for posting.
*/
const BUY_COOLDOWN_MS = 1500;
const TAG = 'k-shippo-order';
const API = id => `/shippo/api/orders/${encodeURIComponent(id)}`;

const request = async (url, options) => {
  try {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
    const body = await response.json().catch(() => ({}));
    return response.ok ? [null, body] : [body.error || `The request failed (${response.status})`, null];
  } catch {
    return ['The request could not be made', null];
  }
};

export class OrderShippo extends ShadowComponent {
  static properties = {
    data: { state: true },
    rows: { state: true },
    loading: { state: true },
    error: { state: true },
    locked: { state: true },
  };

  constructor(){
    super();
    this.data = null;
    this.rows = [];
    this.loading = true;
    this.locked = false;
    this.error = '';
    this.money = minor => String(minor);
    this.orderId = '';
  }

  /*
    Lifecycle
  */
  connectedCallback(){
    super.connectedCallback();
    this.orderId = new URLSearchParams(location.search).get('id') ?? '';
    this.load();
  }

  load = async () => {
    const [[error, data], format] = await Promise.all([request(`${API(this.orderId)}/labels`), loadFormat()]);
    this.money = format.money;
    this.loading = false;
    if(error){
      this.error = error;
      return;
    }
    this.data = data;
    if(!this.rows.length) this.rows = (data.parcels.length ? data.parcels : [{ name: '', length: '', width: '', height: '', weight: '', items: 0 }]).map(parcel => this.newRow(parcel));
  };

  /*
    Parcels to price
  */
  newRow = parcel => ({ ...parcel, length: parcel.length || '', width: parcel.width || '', height: parcel.height || '', weight: parcel.weight || '', quote: null, pricing: false, buying: null, problem: '' });

  setRow = (index, changes) => {
    this.rows = this.rows.map((row, at) => (at === index ? { ...row, ...changes } : row));
  };

  addRow = () => {
    this.rows = [...this.rows, this.newRow({ name: '', length: '', width: '', height: '', weight: '', items: 0 })];
  };

  removeRow = index => {
    this.rows = this.rows.filter((row, at) => at !== index);
  };

  price = async index => {
    const row = this.rows[index];
    this.setRow(index, { pricing: true, problem: '', quote: null });
    const [error, quote] = await request(`${API(this.orderId)}/rates`, { method: 'POST', body: JSON.stringify({ parcel: { length: row.length, width: row.width, height: row.height, weight: row.weight }, units: this.data.units }) });
    this.setRow(index, error ? { pricing: false, problem: error } : { pricing: false, quote });
  };

  /*
    Buying and refunding
  */
  confirmed = (text, title, confirmText) => new Promise(resolve => {
    Dialog.confirm(text, resolve, { title, confirmText, confirmClasses: 'primary ml', cancelText: 'Cancel', cancelClasses: '' });
  });

  /*
    One click is one purchase. The first click on any Buy label locks every one of them at once, before the confirmation even opens, and
    the lock stays for a moment after the answer (BUY_COOLDOWN_MS), so a double click, an impatient third click or a click that lands
    as the dialog closes all count as that first click and nothing more. The server refuses a second purchase of the same shipment that
    is still running, so a second tab cannot get around this.
  */
  buy = async (index, rate) => {
    if(this.locked) return;
    this.locked = true;
    try {
      await this.purchase(index, rate);
    } finally {
      setTimeout(() => { this.locked = false; }, BUY_COOLDOWN_MS);
    }
  };

  purchase = async (index, rate) => {
    const row = this.rows[index];
    const test = this.data.mode === 'test';
    const already = this.data.labels.filter(label => !label.refundStatus).length;
    const second = already ? `This order already has ${already === 1 ? 'a label' : `${already} labels`}. Are you sure you want ${already === 1 ? 'a second one' : 'another'}? ` : '';
    const ok = await this.confirmed(
      second + (test
        ? `Buy a test ${rate.carrier} ${rate.label} label for ${this.money(rate.cents)}? Your key is a test key, so nothing is charged and the label cannot be used to post anything.`
        : `Buy a ${rate.carrier} ${rate.label} label for ${this.money(rate.cents)}? This is charged to your Shippo account now.`),
      already ? 'Buy another label?' : 'Buy label',
      'Buy label',
    );
    if(!ok) return;
    this.setRow(index, { buying: rate.id, problem: '' });
    const [error, bought] = await request(`${API(this.orderId)}/labels`, { method: 'POST', body: JSON.stringify({ shipmentId: row.quote.shipmentId, rateId: rate.id }) });
    if(error){
      this.setRow(index, { buying: null, problem: error });
      return;
    }
    Toast.success(`Label bought. Tracking ${bought.label.trackingCode}`);
    this.setRow(index, { buying: null, quote: null });
    this.data = { ...this.data, labels: [...this.data.labels, bought.label] };
  };

  refund = async label => {
    const ok = await this.confirmed(`Ask Shippo to refund the ${label.carrier} ${label.serviceLabel} label ${label.trackingCode}? A label that was already scanned by the carrier is not refunded.`, 'Refund label', 'Ask for refund');
    if(!ok) return;
    const [error, result] = await request(`${API(this.orderId)}/labels/${encodeURIComponent(label.id)}/refund`, { method: 'POST', body: '{}' });
    if(error){
      Toast.error(error);
      return;
    }
    Toast.success('Refund asked for');
    this.data = { ...this.data, labels: this.data.labels.map(entry => (entry.id === label.id ? result.label : entry)) };
  };

  /*
    Rendering
  */
  mode = mode => (mode === 'test' ? html`<span class="tc-warning">Test</span>` : nothing);

  /* A row's track or refund action, from the labels table. */
  labelAction = ({ action, record }) => {
    if(action === 'track') window.open(record.trackingUrl || record.publicTrackingUrl, '_blank', 'noopener');
    else if(action === 'refund') this.refund(record);
  };


  renderLabels(){
    const { labels } = this.data;
    if(!labels.length) return html`<p class="tc-muted mb">No label has been bought for this order.</p>`;
    return html`
      <k-table .records=${labels.map(label => ({ ...label, actions: [label.trackingUrl || label.publicTrackingUrl ? 'track' : null, label.refundStatus ? null : 'refund'].filter(Boolean), _url: label.labelPdfUrl || label.labelUrl, trackLabel: 'Track', refundLabel: 'Ask for refund' }))} .fields=${[{ name: 'service', label: 'Service', size: 240, editable: false, calculator: label => `${label.carrier} ${label.serviceLabel} ${this.mode(label.mode)}` }, { name: 'trackingCode', label: 'Tracking number', editable: false, calculator: label => `${label.trackingCode}${label.refundStatus ? ` · Refund ${label.refundStatus}` : ''}` }, { name: 'cost', label: 'Cost', size: 120, editable: false, calculator: label => this.money(label.cost) }, { name: 'purchasedAt', label: 'Bought', size: 190, editable: false, formatter: value => new Date(value).toLocaleString() }]} @orderAction=${event => this.labelAction(event.detail)}><kc-tc-open slot="after" target="_blank">Print label</kc-tc-open><k-shippo-order-action slot="after" action="track" label="Track"></k-shippo-order-action><k-shippo-order-action slot="after" action="refund" label="Ask for refund"></k-shippo-order-action></k-table>
    `;
  }

  field(index, name, label){
    const row = this.rows[index];
    return html`<label class="mb mr">${label}<input type="number" min="0" step="any" .value=${String(row[name] ?? '')} @input=${event => this.setRow(index, { [name]: event.target.value })}></label>`;
  }

  renderRates(index){
    const { quote, buying } = this.rows[index];
    if(!quote) return nothing;
    return html`
      <k-table .records=${quote.rates.map(rate => ({ ...rate, actions: this.locked ? [] : ['buy'], buyLabel: buying === rate.id ? 'Buying…' : 'Buy label' }))} .fields=${[{ name: 'service', label: 'Service', editable: false, calculator: rate => `${rate.carrier} ${rate.label}${rate.chosen ? ' · Customer\'s choice' : ''}` }, { name: 'price', label: 'Price', size: 120, editable: false, calculator: rate => this.money(rate.cents) }, { name: 'time', label: 'Time', size: 180, editable: false, calculator: rate => rate.days ? `${rate.days} business day${rate.days === 1 ? '' : 's'}` : 'Not given' }]} @orderAction=${event => { if(!buying) this.buy(index, event.detail.record); }}><k-shippo-order-action slot="after" action="buy" label="Buy label"></k-shippo-order-action></k-table>
      ${quote.messages?.length ? html`<p class="tc-muted mb">${quote.messages.map(message => `${message.carrier ? `${message.carrier}: ` : ''}${message.message}`).join(' ')}</p>` : nothing}
    `;
  }

  renderParcel(row, index){
    const { units } = this.data;
    return html`
      <div class="mb">
        <h4 class="h6">${row.name || `Parcel ${index + 1}`}${row.items ? html` <span class="tc-muted">${row.items} item${row.items === 1 ? '' : 's'}</span>` : nothing}</h4>
        <div class="d-f">
          ${this.field(index, 'length', `Length (${units.dimension})`)}
          ${this.field(index, 'width', `Width (${units.dimension})`)}
          ${this.field(index, 'height', `Height (${units.dimension})`)}
          ${this.field(index, 'weight', `Weight (${units.weight})`)}
        </div>
        <button class="btn mr mb" ?disabled=${row.pricing} @click=${() => this.price(index)}>${row.pricing ? 'Getting prices…' : 'Get prices'}</button>
        ${this.rows.length > 1 ? html`<button class="btn mb" @click=${() => this.removeRow(index)}><k-icon name="delete"></k-icon> Remove</button>` : nothing}
        ${row.problem ? html`<p class="tc-danger mb">${row.problem}</p>` : nothing}
        ${this.renderRates(index)}
      </div>
    `;
  }

  renderBuy(){
    const { hasAddress, hasOrigin, chosen, paid } = this.data;
    if(!hasAddress) return html`<p class="tc-muted mb">This order has no shipping address to send to. Add one on the Shipping tab.</p>`;
    if(!hasOrigin) return html`<p class="tc-muted mb">Set the Ship From address on the General tab of the <a href="/admin/extension/kempo-shipping/">Shipping page</a> first.</p>`;
    return html`
      <h3 class="h6">Buy a label</h3>
      ${paid !== null && paid !== undefined ? html`<p class="tc-muted mb">The customer paid ${this.money(paid)} for shipping${chosen && chosen !== 'flat' ? `, and chose ${chosen.replace('|', ' ')}` : ''}.</p>` : nothing}
      ${this.rows.map((row, index) => this.renderParcel(row, index))}
      <button class="btn mb" @click=${this.addRow}><k-icon name="add"></k-icon> Add a parcel</button>
    `;
  }

  render(){
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.data.configured) return html`<p class="tc-muted">Add your Shippo API key on the Shippo tab of the <a href="/admin/extension/kempo-shipping/">Shipping page</a> to buy labels here.</p>`;
    return html`
      ${this.data.mode === 'test' ? html`<p class="tc-warning mb">Shippo is in test mode: nothing is charged, and these labels cannot be used to post a parcel.</p>` : nothing}
      <h3 class="h6">Labels</h3>
      ${this.renderLabels()}
      ${this.renderBuy()}
    `;
  }
}

customElements.define(TAG, OrderShippo);
