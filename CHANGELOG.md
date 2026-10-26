# Changelog

All notable changes to `kempo-shipping-shippo` are documented in this file.

## [Unreleased]

### Changed

- **One click is one purchase.** The first click on a Buy label locks every Buy button before the confirmation opens and keeps them locked for a moment after, so a double click is treated as one. The server also locks a shipment while it is being bought, so two requests for it at once buy once (the second is refused with "This label is already being bought").
- **Buying a second label for an order asks first:** when the order already has a label that was not refunded, the confirmation says so and asks if you are sure you want a second one (an order with two boxes has two labels, each bought on its own).

### Added

- **Carrier rates for kempo-shipping through Shippo,** the same job as kempo-shipping-easypost. A `kempo-shipping:rates` handler that prices each packed parcel with one Shippo shipment (rates only, nothing is bought), giving the customer a choice between the USPS, UPS, FedEx and other services you turn on at checkout. Nothing is asked of Shippo while the customer is still typing the address (the hook is told `ready`), prices are cached per route, weight and size, a 429 stops requests for a minute, and the handler never throws.
- **A Shippo tab on the Shipping page:** the API token (replace-only, stored encrypted, never sent back), an optional email for the Ship From address (Shippo needs one to make a label; empty uses the address the site sends its emails from, the Email from setting), the services by carrier, other services, residential pricing, how long prices are kept, and **Test Shippo**, which lists every rate Shippo returned.
- **A Shippo tab on the admin order page** (through kempo-commerce's `commerce-admin-order-tabs`): get every carrier's price for each box of the order, buy a label, print it again (a 4x6 PDF), see the tracking number, cost and purchase time, open the carrier's tracking page, and ask for a refund of an unused label. New `kempoShippoLabel` table (created on install and update), routes under `/shippo/api/orders/:id/`, and an order-history line for each purchase and refund request.
- Checked against a Shippo test token: shipments, rates, a USPS label, and its refund. A purchase Shippo answers with 201 and `status: "ERROR"` is reported with its messages, and a shipment that already has a label from this site cannot be bought twice.

## [0.1.3] - 2026-10-26
### Changed
- The labels and the rates for an order are kempo-ui tables. Print label opens the label, and Track, Ask for refund and Buy label are row controls.
- Requires kempo 4.9.7 (the admin lists use kempo-ui tables).
