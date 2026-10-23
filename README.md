# kempo-shipping-shippo

Carrier rates and shipping labels for [kempo-shipping](https://github.com/dustinpoissant/kempo-shipping) through [Shippo](https://goshippo.com). One API key gives USPS, UPS, FedEx and more, with no carrier sign-ups of your own: Shippo holds the carrier accounts. Each parcel your order is packed into is priced, the customer chooses between the services you turn on at checkout, and staff buy the label from the order page.

It does the same job as [kempo-shipping-easypost](https://github.com/dustinpoissant/kempo-shipping-easypost), with Shippo instead of EasyPost. Both can be installed: kempo-shipping offers each carrier and service once, at the cheapest price any of them quoted.

It adds a **Shippo** tab to the Shipping page and a **Shippo** tab to the admin order page. Nothing is priced until an API key is saved. **Prices are free to ask for; a label is only bought when someone confirms Buy label.**

## Setup

1. Install it from the Extensions screen (it needs kempo-shipping and kempo-commerce).
2. On **Shipping → General**, fill in **Ship from**, including the postal code. Carriers price from there.
3. Set the weight and size of your products and add your boxes on the **Boxes** tab. A box does not need a price of its own: the carrier prices it.
4. In the Shippo dashboard, copy an API token. A **test token** (`shippo_test_...`) is fine to try this: nothing is charged and the labels are not valid.
5. On **Shipping → Shippo**, paste the key, choose the services, **Save**, then **Test Shippo**.

`SETTINGS_ENCRYPTION_KEY` must be set on the server, because the key is stored encrypted. It is never sent back to a browser: the field is always empty, and a blank field on save leaves the stored one alone.

## How it prices

For each parcel kempo-shipping packed (its box, and the weight with the empty box) it creates **one** Shippo shipment, which returns a price for every service of every carrier on your Shippo account, and adds a quote `{ carrier: 'USPS', service: 'Ground Advantage', price, days }` for each service you turned on. kempo-shipping then offers the customer every carrier and service that has a quote for **every** parcel of the order, and the **Shipping method** choice at checkout lists them next to your own box prices, cheapest first.

- **Services** are written `Carrier:token` (Shippo's provider and service level token, such as `USPS:usps_priority`). The settings list the common domestic ones: USPS Ground Advantage, Priority Mail, Priority Mail Express; UPS Ground, 3 Day Select, 2nd Day Air, Next Day Air Saver, Next Day Air; FedEx Ground, Home Delivery, Express Saver, 2Day, Standard and Priority Overnight. **Also offer any other service** adds whatever else Shippo returns, with the name Shippo gives it.
- **Weight and size** are converted to ounces and inches, with the weight rounded up to the next ounce and sizes to the next tenth of an inch.
- **Residential** is on by default, so the price includes the carriers' home delivery surcharge. Turn it off if you mostly ship to businesses.
- **A parcel Shippo cannot price** gets no quote from it: no weight, over 150 lb, no ZIP code, a country this does not serve (US, PR, GU, VI, AS and MP are), or a currency other than USD. Your own box prices or the flat rate cover it.
- **Prices are kept for 60 minutes** (a setting) per route, weight and size, so a checkout that is priced again does not ask Shippo again. A 429 stops all requests for a minute.
- **It never stops an order.** Any Shippo problem means no quote from it, never an error at checkout.

## The Shippo tab on the order

The admin order page gets a **Shippo** tab (after Customer, before History). It lists the labels bought for the order and lets staff buy more:

- **Labels:** the service, the tracking number, what Shippo charged, when it was bought, **Print label** (Shippo makes a 4x6 PDF), **Track** (the carrier's own tracking page: USPS, UPS, FedEx and DHL Express) and **Ask for refund** for a label that was not used.
- **Buy a label:** each box the order was packed into is a row (the size and weight can be changed, or a parcel added). **Get prices** asks Shippo for every carrier's price for that parcel, to the order's shipping address, from the Ship From address; the one the customer chose is marked. **Buy label** asks to confirm, then buys it.
- One order can have several labels: each box is its own shipment, so a second box is bought separately. When the order already has a label that was not refunded, **Buy label** first asks "This order already has a label. Are you sure you want a second one?".
- A test token shows a notice: nothing is charged and the labels cannot be used to post a parcel. A live token spends money when **Buy label** is confirmed.
- Every purchase and refund request is a private line in the order's history. Labels are kept in the `kempoShippoLabel` table, so reprinting and tracking never ask Shippo again.

Getting prices creates a shipment on Shippo; the shipment carries the order's id as its `metadata`. Buying refuses a shipment that is for another order, that already has a label from this site, or that does not have the chosen rate, and the cost kept is the one the shipment lists for that rate. Shippo answers a failed purchase with HTTP 201 and `status: "ERROR"`, so the status is checked and its messages shown. Viewing needs `shipping:view`, buying and refunding `shipping:manage`.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `shippo_api_key` | — | Secret. The API token (test or live) |
| `shippo_from_email` | — | Optional. The email for the Ship From address, which Shippo needs to make a label. Empty uses the address kempo sends its emails from (the Email from setting on the Settings screen, else `EMAIL_FROM`) |
| `shippo_services` | the list above | `Carrier:token` pairs offered |
| `shippo_other_services` | `false` | Also offer services not in the list |
| `shippo_residential` | `true` | Price as delivered to a home |
| `shippo_cache_minutes` | `60` | How long a price is reused |

Permissions are kempo-shipping's: `shipping:view` sees the tabs, `shipping:manage` changes settings, runs the test and buys.

## Checked against the real API

Everything above was run against a Shippo test token (October 2026): creating a shipment returned USPS and UPS rates (the test account has no FedEx), buying a USPS label returned a tracking number and a PDF, and refunding it worked. What the run showed and this relies on:

- a buy needs `address_from.email` (the Ship From email, which is the address the site sends its emails from unless you set another), and a UPS label on the test account fails with "The UPS account is not yet registered" (it is a Shippo account matter; USPS works);
- the amount a label cost is on the rate, not the transaction, so it is read from the shipment's rates before buying;
- `tracking_url_provider` is a general carrier page, not one for the number, so **Track** builds the carrier's tracking address from the tracking number instead;
- not seen: FedEx tokens (`fedex_ground`, `fedex_2_day`... are the ones Shippo documents), and whether a live account bills anything for rates (Shippo bills at label purchase).

## Not built yet

Tracking updates (the tab links to the carrier, it does not show scan events), address validation, insurance, customs and international labels, scan forms, picking a specific carrier account, and other label sizes than 4x6 PDF.

## Tests

`npm test` covers the request and responses, the client (the token header, the mode, a 429 backoff, errors never thrown, a purchase Shippo answers with 201 and `ERROR`) with a fake `fetch`, the quotes (conversion and rounding, caching, skipped parcels, the services offered), the labels (carrier tracking pages, the parcels of an order, the row kept), the purchase and refund flow, and the settings. No Shippo account is needed.
