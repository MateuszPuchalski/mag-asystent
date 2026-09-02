# Kształt odpowiedzi Allegro

Wynik `npm run sonda` z żywego konta. Dokument opisuje NAZWY PÓL i ich
obecność, nigdy treści — sonda nie wypisuje wiadomości, loginów, nazwisk
ani numerów, a wartości pokazuje tylko dla pól słownikowych (enumów).

Kolumna **niepuste** jest tu najważniejsza: pole obecne w każdym rekordzie,
ale puste w połowie, wygląda w kodzie na pewne i pewne nie jest.

Zdjęto: 2026-09-02. Środowisko: `https://api.allegro.pl`.

## `/messaging/threads` — nagłówki wątków

Rekordów w próbce: **20**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `id` | tekst | 20 | 20 | — |
| `interlocutor` | obiekt | 20 | 20 | — |
| `interlocutor.avatarUrl` | tekst | 20 | 20 | — |
| `interlocutor.login` | tekst | 20 | 20 | — |
| `lastMessageDateTime` | tekst | 20 | 20 | — |
| `read` | logiczna | 20 | 20 | `false` ×17, `true` ×3 |

## `/messaging/threads/{id}/messages` — wiadomości

Rekordów w próbce: **33**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `attachments` | tablica | 33 | 1 | — |
| `attachments[].fileName` | tekst | 2 | 2 | — |
| `attachments[].mimeType` | tekst | 2 | 2 | — |
| `attachments[].status` | tekst | 2 | 2 | `SAFE` ×2 |
| `attachments[].url` | tekst | 2 | 2 | — |
| `author` | obiekt | 33 | 33 | — |
| `author.isInterlocutor` | logiczna | 33 | 33 | `true` ×18, `false` ×15 |
| `author.login` | tekst | 33 | 33 | — |
| `createdAt` | tekst | 33 | 33 | — |
| `hasAdditionalAttachments` | logiczna | 33 | 33 | `false` ×33 |
| `id` | tekst | 33 | 33 | — |
| `relatesTo` | obiekt | 33 | 33 | — |
| `relatesTo.offer` | null, obiekt | 33 | 5 | — |
| `relatesTo.offer.id` | tekst | 5 | 5 | — |
| `relatesTo.order` | null, obiekt | 33 | 7 | — |
| `relatesTo.order.id` | tekst | 7 | 7 | — |
| `status` | tekst | 33 | 33 | `DELIVERED` ×33 |
| `subject` | null, tekst | 33 | 12 | — |
| `text` | tekst | 33 | 33 | — |
| `thread` | obiekt | 33 | 33 | — |
| `thread.id` | tekst | 33 | 33 | — |
| `type` | tekst | 33 | 33 | `ASK_QUESTION` ×12, `MAIL` ×12, `MESSAGE_CENTER` ×9 |

## `/sale/issues` — dyskusje

Rekordów w próbce: **100**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `attachments` | tablica | 100 | 57 | — |
| `attachments[].fileName` | tekst | 153 | 153 | — |
| `attachments[].url` | tekst | 153 | 153 | — |
| `buyer` | obiekt | 100 | 100 | — |
| `buyer.id` | tekst | 100 | 100 | — |
| `buyer.login` | tekst | 100 | 100 | — |
| `chat` | obiekt | 100 | 100 | — |
| `chat.initialMessage` | obiekt | 100 | 100 | — |
| `chat.initialMessage.attachments` | tablica | 100 | 45 | — |
| `chat.initialMessage.attachments[].fileName` | tekst | 45 | 45 | — |
| `chat.initialMessage.attachments[].url` | tekst | 45 | 45 | — |
| `chat.initialMessage.author` | obiekt | 100 | 100 | — |
| `chat.initialMessage.author.login` | tekst | 100 | 100 | — |
| `chat.initialMessage.author.role` | tekst | 100 | 100 | `BUYER` ×100 |
| `chat.initialMessage.createdAt` | tekst | 100 | 100 | — |
| `chat.initialMessage.id` | tekst | 100 | 100 | — |
| `chat.initialMessage.text` | tekst | 100 | 100 | — |
| `chat.lastMessage` | obiekt | 100 | 100 | — |
| `chat.lastMessage.createdAt` | tekst | 100 | 100 | — |
| `chat.lastMessage.status` | tekst | 100 | 100 | `ALLEGRO_ADVISOR_REPLIED` ×61, `SELLER_REPLIED` ×29, `BUYER_REPLIED` ×9 |
| `chat.messagesCount` | liczba | 100 | 100 | — |
| `checkoutForm` | obiekt | 100 | 100 | — |
| `checkoutForm.createdAt` | tekst | 100 | 100 | — |
| `checkoutForm.id` | tekst | 100 | 100 | — |
| `currentState` | obiekt | 100 | 100 | — |
| `currentState.chatActive` | logiczna | 100 | 100 | `true` ×90, `false` ×10 |
| `currentState.returnRequired` | logiczna, null | 100 | 53 | `true` ×38, `false` ×15 |
| `currentState.status` | tekst | 100 | 100 | `CLAIM_ACCEPTED` ×33, `DISPUTE_ONGOING` ×25, `CLAIM_SUBMITTED` ×20, `CLAIM_REJECTED` ×12, `DISPUTE_CLOSED` ×10 |
| `currentState.statusDueDate` | tekst | 100 | 100 | — |
| `decisionDueDate` | null, tekst | 100 | 65 | — |
| `description` | null, tekst | 100 | 1 | — |
| `expectations` | null, tablica | 100 | 65 | — |
| `expectations[].name` | tekst | 66 | 66 | — |
| `expectations[].refund` | null, obiekt | 66 | 31 | — |
| `expectations[].refund.amount` | tekst | 31 | 31 | — |
| `expectations[].refund.currency` | tekst | 31 | 31 | `PLN` ×27, `CZK` ×2 |
| `id` | tekst | 100 | 100 | — |
| `offer` | null, obiekt | 100 | 65 | — |
| `offer.id` | tekst | 65 | 65 | — |
| `offer.quantity` | liczba | 65 | 65 | — |
| `openedDate` | tekst | 100 | 100 | — |
| `product` | null, obiekt | 100 | 65 | — |
| `product.id` | tekst | 65 | 65 | — |
| `reason` | null, obiekt | 100 | 65 | — |
| `reason.description` | tekst | 65 | 65 | — |
| `reason.type` | tekst | 65 | 65 | `DEFECT_FOUND_DURING_USE` ×34, `NOT_AS_DESCRIBED` ×17, `OTHER` ×6, `MISSING_PRODUCT_ELEMENT` ×5, `PRODUCT_DAMAGED_PARCEL_INTACT` ×3 |
| `referenceNumber` | null, tekst | 100 | 65 | — |
| `right` | null, tekst | 100 | 65 | `COMPLAINT` ×65 |
| `subject` | tekst | 100 | 100 | — |
| `type` | tekst | 100 | 100 | `CLAIM` ×65, `DISPUTE` ×35 |

## `/sale/issues/{id}/messages` — rozmowa dyskusji

Pusta odpowiedź — nie ma czego opisać (rekordów: 0).

## `/sale/user-ratings` — opinie

**Nie udało się pobrać.** Brak uprawnienia (403) — aplikacja na developer.allegro.pl musi mieć scope allegro:api:ratings. Po dodaniu uprawnienia sparuj konto ponownie: token wydany pod stary zakres sam się nie rozszerzy.

## `/order/checkout-forms` — zamówienia

Rekordów w próbce: **100**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `buyer` | obiekt | 100 | 100 | — |
| `buyer.address` | obiekt | 100 | 100 | — |
| `buyer.address.city` | tekst | 100 | 100 | — |
| `buyer.address.countryCode` | tekst | 100 | 100 | `PL` ×93, `CZ` ×4, `HU` ×2 |
| `buyer.address.postCode` | tekst | 100 | 100 | — |
| `buyer.address.street` | tekst | 100 | 100 | — |
| `buyer.companyName` | null, tekst | 100 | 5 | — |
| `buyer.email` | tekst | 100 | 100 | — |
| `buyer.firstName` | null, tekst | 100 | 99 | — |
| `buyer.guest` | logiczna | 100 | 100 | `false` ×100 |
| `buyer.id` | tekst | 100 | 100 | — |
| `buyer.lastName` | null, tekst | 100 | 99 | — |
| `buyer.login` | tekst | 100 | 100 | — |
| `buyer.personalIdentity` | null | 100 | 0 | — |
| `buyer.phoneNumber` | tekst | 100 | 100 | — |
| `buyer.preferences` | obiekt | 100 | 100 | — |
| `buyer.preferences.language` | tekst | 100 | 100 | — |
| `codBookedPayments` | tablica | 100 | 0 | — |
| `delivery` | obiekt | 100 | 100 | — |
| `delivery.address` | null, obiekt | 100 | 85 | — |
| `delivery.address.city` | tekst | 85 | 85 | — |
| `delivery.address.companyName` | null, tekst | 85 | 7 | — |
| `delivery.address.countryCode` | tekst | 85 | 85 | `PL` ×79, `CZ` ×3, `HU` ×2 |
| `delivery.address.firstName` | tekst | 85 | 85 | — |
| `delivery.address.lastName` | tekst | 85 | 85 | — |
| `delivery.address.modifiedAt` | null | 85 | 0 | — |
| `delivery.address.phoneNumber` | tekst | 85 | 85 | — |
| `delivery.address.street` | tekst | 85 | 85 | — |
| `delivery.address.zipCode` | tekst | 85 | 85 | — |
| `delivery.calculatedNumberOfPackages` | liczba | 100 | 100 | — |
| `delivery.cancellation` | null | 100 | 0 | — |
| `delivery.cost` | obiekt | 100 | 100 | — |
| `delivery.cost.amount` | tekst | 100 | 100 | — |
| `delivery.cost.currency` | tekst | 100 | 100 | `PLN` ×92, `CZK` ×4, `EUR` ×2, `HUF` ×2 |
| `delivery.method` | obiekt | 100 | 100 | — |
| `delivery.method.id` | tekst | 100 | 100 | — |
| `delivery.method.name` | tekst | 100 | 100 | — |
| `delivery.pickupPoint` | null, obiekt | 100 | 78 | — |
| `delivery.pickupPoint.address` | obiekt | 78 | 78 | — |
| `delivery.pickupPoint.address.city` | tekst | 78 | 78 | — |
| `delivery.pickupPoint.address.countryCode` | tekst | 78 | 78 | `PL` ×70, `CZ` ×4, `HU` ×2, `SK` ×2 |
| `delivery.pickupPoint.address.street` | tekst | 78 | 78 | — |
| `delivery.pickupPoint.address.zipCode` | tekst | 78 | 78 | — |
| `delivery.pickupPoint.description` | null, tekst | 78 | 74 | — |
| `delivery.pickupPoint.id` | tekst | 78 | 78 | — |
| `delivery.pickupPoint.name` | tekst | 78 | 78 | — |
| `delivery.smart` | logiczna | 100 | 100 | `true` ×66, `false` ×34 |
| `delivery.time` | obiekt | 100 | 100 | — |
| `delivery.time.dispatch` | null, obiekt | 100 | 85 | — |
| `delivery.time.dispatch.from` | tekst | 85 | 85 | — |
| `delivery.time.dispatch.to` | tekst | 85 | 85 | — |
| `delivery.time.from` | null, tekst | 100 | 85 | — |
| `delivery.time.guaranteed` | null | 100 | 0 | — |
| `delivery.time.to` | null, tekst | 100 | 85 | — |
| `fulfillment` | obiekt | 100 | 100 | — |
| `fulfillment.provider` | obiekt | 100 | 100 | — |
| `fulfillment.provider.id` | tekst | 100 | 100 | `SELLER` ×100 |
| `fulfillment.shipmentSummary` | obiekt | 100 | 100 | — |
| `fulfillment.shipmentSummary.lineItemsSent` | tekst | 100 | 100 | `NONE` ×53, `ALL` ×28, `SOME` ×19 |
| `fulfillment.status` | tekst | 100 | 100 | `PROCESSING` ×50, `NEW` ×37, `CANCELLED` ×13 |
| `id` | tekst | 100 | 100 | — |
| `invoice` | obiekt | 100 | 100 | — |
| `invoice.address` | null, obiekt | 100 | 17 | — |
| `invoice.address.city` | tekst | 17 | 17 | — |
| `invoice.address.company` | null, obiekt | 17 | 16 | — |
| `invoice.address.company.ids` | tablica | 16 | 16 | — |
| `invoice.address.company.ids[].type` | tekst | 16 | 16 | `PL_NIP` ×16 |
| `invoice.address.company.ids[].value` | tekst | 16 | 16 | — |
| `invoice.address.company.name` | tekst | 16 | 16 | — |
| `invoice.address.company.taxId` | tekst | 16 | 16 | — |
| `invoice.address.company.vatPayerStatus` | tekst | 16 | 16 | `NOT_APPLICABLE` ×16 |
| `invoice.address.countryCode` | tekst | 17 | 17 | `PL` ×17 |
| `invoice.address.naturalPerson` | null, obiekt | 17 | 1 | — |
| `invoice.address.naturalPerson.firstName` | tekst | 1 | 1 | — |
| `invoice.address.naturalPerson.lastName` | tekst | 1 | 1 | — |
| `invoice.address.street` | tekst | 17 | 17 | — |
| `invoice.address.zipCode` | tekst | 17 | 17 | — |
| `invoice.dueDate` | null | 100 | 0 | — |
| `invoice.features` | null | 100 | 0 | — |
| `invoice.required` | logiczna | 100 | 100 | `false` ×83, `true` ×17 |
| `lineItems` | tablica | 100 | 100 | — |
| `lineItems[].boughtAt` | tekst | 165 | 165 | — |
| `lineItems[].deposit` | null | 165 | 0 | — |
| `lineItems[].discounts` | null, tablica | 165 | 10 | — |
| `lineItems[].discounts[].type` | tekst | 10 | 10 | `BUNDLE` ×5, `UNIT_PERCENTAGE_DISCOUNT` ×4 |
| `lineItems[].id` | tekst | 165 | 165 | — |
| `lineItems[].offer` | obiekt | 165 | 165 | — |
| `lineItems[].offer.external` | obiekt | 165 | 165 | — |
| `lineItems[].offer.external.id` | tekst | 165 | 165 | — |
| `lineItems[].offer.hsNumber` | null | 165 | 0 | — |
| `lineItems[].offer.id` | tekst | 165 | 165 | — |
| `lineItems[].offer.name` | tekst | 165 | 165 | — |
| `lineItems[].offer.productSet` | null, obiekt | 165 | 3 | — |
| `lineItems[].offer.productSet.products` | tablica | 3 | 3 | — |
| `lineItems[].offer.productSet.products[].id` | tekst | 5 | 5 | — |
| `lineItems[].offer.productSet.products[].quantity` | liczba | 5 | 5 | — |
| `lineItems[].originalPrice` | obiekt | 165 | 165 | — |
| `lineItems[].originalPrice.amount` | tekst | 165 | 165 | — |
| `lineItems[].originalPrice.currency` | tekst | 165 | 165 | `PLN` ×149, `CZK` ×9, `HUF` ×5, `EUR` ×2 |
| `lineItems[].price` | obiekt | 165 | 165 | — |
| `lineItems[].price.amount` | tekst | 165 | 165 | — |
| `lineItems[].price.currency` | tekst | 165 | 165 | `PLN` ×149, `CZK` ×9, `HUF` ×5, `EUR` ×2 |
| `lineItems[].quantity` | liczba | 165 | 165 | — |
| `lineItems[].reconciliation` | null | 165 | 0 | — |
| `lineItems[].selectedAdditionalServices` | tablica | 165 | 0 | — |
| `lineItems[].serialNumbers` | obiekt | 165 | 165 | — |
| `lineItems[].serialNumbers.entries` | tablica | 165 | 0 | — |
| `lineItems[].serialNumbers.expected` | logiczna | 165 | 165 | `false` ×165 |
| `lineItems[].tax` | null, obiekt | 165 | 145 | — |
| `lineItems[].tax.exemption` | null | 145 | 0 | — |
| `lineItems[].tax.rate` | tekst | 145 | 145 | — |
| `lineItems[].tax.subject` | null, tekst | 145 | 118 | — |
| `lineItems[].vouchers` | tablica | 165 | 0 | — |
| `marketplace` | obiekt | 100 | 100 | — |
| `marketplace.id` | tekst | 100 | 100 | — |
| `messageToSeller` | null | 100 | 0 | — |
| `note` | null | 100 | 0 | — |
| `payment` | obiekt | 100 | 100 | — |
| `payment.features` | tablica | 100 | 7 | — |
| `payment.finishedAt` | null, tekst | 100 | 87 | — |
| `payment.id` | tekst | 100 | 100 | — |
| `payment.paidAmount` | null, obiekt | 100 | 77 | — |
| `payment.paidAmount.amount` | tekst | 77 | 77 | — |
| `payment.paidAmount.currency` | tekst | 77 | 77 | `PLN` ×72, `CZK` ×3, `HUF` ×2 |
| `payment.provider` | null, tekst | 100 | 91 | `AF` ×90 |
| `payment.reconciliation` | null | 100 | 0 | — |
| `payment.type` | tekst | 100 | 100 | `ONLINE` ×91, `CASH_ON_DELIVERY` ×9 |
| `revision` | tekst | 100 | 100 | — |
| `status` | tekst | 100 | 100 | `READY_FOR_PROCESSING` ×85, `CANCELLED` ×13, `FILLED_IN` ×2 |
| `summary` | obiekt | 100 | 100 | — |
| `summary.totalToPay` | obiekt | 100 | 100 | — |
| `summary.totalToPay.amount` | tekst | 100 | 100 | — |
| `summary.totalToPay.currency` | tekst | 100 | 100 | `PLN` ×92, `CZK` ×4, `EUR` ×2, `HUF` ×2 |
| `surcharges` | tablica | 100 | 0 | — |
| `updatedAt` | tekst | 100 | 100 | — |

## `/order/customer-returns` — zwroty

Rekordów w próbce: **100**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `buyer` | obiekt | 100 | 100 | — |
| `buyer.email` | null | 100 | 0 | — |
| `buyer.login` | tekst | 100 | 100 | — |
| `createdAt` | tekst | 100 | 100 | — |
| `id` | tekst | 100 | 100 | — |
| `isFulfillment` | logiczna | 100 | 100 | `false` ×100 |
| `items` | tablica | 100 | 100 | — |
| `items[].name` | tekst | 127 | 127 | — |
| `items[].offerId` | tekst | 127 | 127 | — |
| `items[].price` | obiekt | 127 | 127 | — |
| `items[].price.amount` | tekst | 127 | 127 | — |
| `items[].price.currency` | tekst | 127 | 127 | `PLN` ×127 |
| `items[].quantity` | liczba | 127 | 127 | — |
| `items[].reason` | obiekt | 127 | 127 | — |
| `items[].reason.type` | tekst | 127 | 127 | `DONT_LIKE_IT` ×52, `NONE` ×36, `MISTAKE` ×21, `DIFFERENT` ×6, `OTHER_FLAW` ×6, `DAMAGED` ×3, `OVERDUE_DELIVERY` ×3 |
| `items[].reason.userComment` | tekst | 127 | 9 | — |
| `items[].serialNumbers` | tablica | 127 | 0 | — |
| `items[].url` | tekst | 127 | 127 | — |
| `marketplaceId` | tekst | 100 | 100 | — |
| `orderId` | tekst | 100 | 100 | — |
| `parcels` | tablica | 100 | 94 | — |
| `parcels[].carrierId` | tekst | 94 | 94 | `INPOST` ×79, `ALLEGRO` ×6, `DPD` ×6, `UNKNOWN` ×2 |
| `parcels[].createdAt` | tekst | 94 | 94 | — |
| `parcels[].sender` | obiekt | 94 | 94 | — |
| `parcels[].sender.phoneNumber` | tekst | 94 | 94 | — |
| `parcels[].transportingCarrierId` | null | 94 | 0 | — |
| `parcels[].transportingWaybill` | null | 94 | 0 | — |
| `parcels[].waybill` | null, tekst | 94 | 88 | — |
| `referenceNumber` | tekst | 100 | 100 | — |
| `refund` | null | 100 | 0 | — |
| `rejection` | null | 100 | 0 | — |
| `status` | tekst | 100 | 100 | `COMMISSION_REFUNDED` ×95, `COMMISSION_REFUND_CLAIMED` ×3, `DELIVERED` ×2 |

## `/order/customer-returns/{id}` — szczegół zwrotu

Rekordów w próbce: **10**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `buyer` | obiekt | 10 | 10 | — |
| `buyer.email` | null | 10 | 0 | — |
| `buyer.login` | tekst | 10 | 10 | — |
| `createdAt` | tekst | 10 | 10 | — |
| `id` | tekst | 10 | 10 | — |
| `isFulfillment` | logiczna | 10 | 10 | `false` ×10 |
| `items` | tablica | 10 | 10 | — |
| `items[].name` | tekst | 12 | 12 | — |
| `items[].offerId` | tekst | 12 | 12 | — |
| `items[].price` | obiekt | 12 | 12 | — |
| `items[].price.amount` | tekst | 12 | 12 | — |
| `items[].price.currency` | tekst | 12 | 12 | `PLN` ×12 |
| `items[].quantity` | liczba | 12 | 12 | — |
| `items[].reason` | obiekt | 12 | 12 | — |
| `items[].reason.type` | tekst | 12 | 12 | `NONE` ×5, `DONT_LIKE_IT` ×4, `OTHER_FLAW` ×2 |
| `items[].reason.userComment` | tekst | 12 | 2 | — |
| `items[].serialNumbers` | tablica | 12 | 0 | — |
| `items[].url` | tekst | 12 | 12 | — |
| `marketplaceId` | tekst | 10 | 10 | — |
| `orderId` | tekst | 10 | 10 | — |
| `parcels` | tablica | 10 | 10 | — |
| `parcels[].carrierId` | tekst | 10 | 10 | `INPOST` ×8, `ALLEGRO` ×2 |
| `parcels[].createdAt` | tekst | 10 | 10 | — |
| `parcels[].sender` | obiekt | 10 | 10 | — |
| `parcels[].sender.phoneNumber` | tekst | 10 | 10 | — |
| `parcels[].transportingCarrierId` | null | 10 | 0 | — |
| `parcels[].transportingWaybill` | null | 10 | 0 | — |
| `parcels[].waybill` | tekst | 10 | 10 | — |
| `referenceNumber` | tekst | 10 | 10 | — |
| `refund` | null | 10 | 0 | — |
| `rejection` | null | 10 | 0 | — |
| `status` | tekst | 10 | 10 | `COMMISSION_REFUNDED` ×10 |

## `/order/refund-claims` — roszczenia o zwrot prowizji

Rekordów w próbce: **100**.

| pole | typ | obecne | niepuste | wartości słownikowe |
|---|---|---:|---:|---|
| `buyer` | obiekt | 100 | 100 | — |
| `buyer.id` | tekst | 100 | 100 | — |
| `commission` | obiekt | 100 | 100 | — |
| `commission.amount` | liczba | 100 | 100 | — |
| `commission.currency` | tekst | 100 | 100 | `PLN` ×92, `EUR` ×5, `CZK` ×3 |
| `createdAt` | tekst | 100 | 100 | — |
| `id` | tekst | 100 | 100 | — |
| `lineItem` | obiekt | 100 | 100 | — |
| `lineItem.boughtAt` | tekst | 100 | 100 | — |
| `lineItem.id` | tekst | 100 | 100 | — |
| `lineItem.offer` | obiekt | 100 | 100 | — |
| `lineItem.offer.id` | tekst | 100 | 100 | — |
| `lineItem.quantity` | liczba | 100 | 100 | — |
| `quantity` | liczba | 100 | 100 | — |
| `status` | tekst | 100 | 100 | `GRANTED` ×95, `WAITING_FOR_PAYMENT_REFUND` ×3, `REJECTED` ×2 |
| `type` | tekst | 100 | 100 | `MANUAL` ×60, `AUTOMATIC` ×40 |
