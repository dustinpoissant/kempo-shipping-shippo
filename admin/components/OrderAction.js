import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';

/*
  One action on a row of this order's labels or rates (track, ask for a refund, buy). It shows only when its
  row's `actions` list names it, and reports the choice as an `orderAction` event on the table: { action, record }.
  The page does the work. A row's own button text can come from the record (`buyLabel`), else from `label`.

    <k-shippo-order-action slot="after" action="track" label="Track"></k-easypost-order-action>
*/
export default class OrderAction extends ButtonControl {
  static properties = {
    ...ButtonControl.properties,
    action: { type: String },
    label: { type: String },
  };

  constructor(){
    super();
    this.action = '';
    this.label = '';
  }

  get record(){
    const index = this.closest('.record')?.dataset?.index;
    return index === undefined ? null : this.host?.records?.[index] ?? null;
  }

  get shown(){
    return Boolean(this.record?.actions?.includes(this.action));
  }

  handleAction(){
    if(!this.shown) return;
    this.host.dispatchEvent(new CustomEvent('orderAction', { detail: { action: this.action, record: this.record } }));
  }

  render(){
    return this.shown ? html`<slot>${this.record?.[`${this.action}Label`] ?? this.label}</slot>` : html``;
  }
}

customElements.define('k-shippo-order-action', OrderAction);
