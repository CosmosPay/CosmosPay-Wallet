# On-ramp through El Dorado

How local currency gets into the wallet without Cosmos Pay holding a licence, touching pesos, or storing anybody's ID.

Status: design, not built. Everything under [Open questions](#open-questions) has to be answered by El Dorado before a line of code is worth writing.

## Why this provider

We need a fiat on-ramp for Argentina. We cannot be the one converting pesos: in Argentina that is PSAV activity under the CNV register, which carries a minimum net worth we do not have, and [RG 1172/2026](https://www.argentina.gob.ar/noticias/regulacion-de-los-proveedores-de-servicios-de-activos-virtuales-psav) (15 Oct 2026) widened the definition further. So the provider must be the licensed counterparty and must run KYC on the user.

[El Dorado](https://api.eldorado.io) is a P2P trading platform with an API and a prebuilt widget. What its documentation states, as of 25 Oct 2026:

| | |
|---|---|
| Model | P2P trading between fiat and crypto, with compliance built in |
| Currencies | USD, **ARS**, BRL, COP, PEN, plus crypto |
| KYC | Performed by El Dorado, not by the integrator |
| Auth | Token based, tokens expire on their own; client credentials |
| API | `https://api-testnet.eldorado.io/api/` and `https://api.eldorado.io/api/` |
| Widget | Prebuilt on-ramp and off-ramp UI at `https://widget.eldorado.io/exchange` |

Two other providers are worth a conversation before we commit: **Payex**, an Argentine company already registered as a PSAV with the CNV, and **Peer2Peer SA**, an OTC desk with a liquidity API. This document covers El Dorado because it is the only one of the three that publishes a self-service sandbox.

## What we are and are not

| | |
|---|---|
| Cosmos Pay holds | The user's Stellar keys, locally. Nothing else |
| Cosmos Pay never holds | Pesos, the user's documents, the provider's float |
| Cosmos Pay never does | Identity verification, sanctions screening, fiat settlement |
| El Dorado does | KYC, the peso leg, the counterparty matching, the payout |

If any of that inverts, the design is wrong and the regulatory exposure moves to us. That is the line this integration must not cross.

## The flow

The user wants pesos in their bank account to become USDC in their wallet.

```
 wallet (client)            our backend            El Dorado              Stellar
      |                          |                     |                     |
 1.   | tap "Add money"          |                     |                     |
      |------------------------->|                     |                     |
 2.   |                          | POST /onramp/session|                     |
      |                          |-------------------->|                     |
      |                          |   session + url     |                     |
      |                          |<--------------------|                     |
 3.   | open widget in a tab     |                     |                     |
      |--------------------------------------------- >|                     |
 4.   |          user verifies identity (first time only), picks amount      |
      |          and payment method, transfers pesos from their bank         |
      |                          |                     |                     |
 5.   |                          |   webhook: paid     |                     |
      |                          |<--------------------|                     |
 6.   |                          |                     | sends USDC to the   |
      |                          |                     | user's address      |
      |                          |                     |-------------------->|
 7.   | balance updates from the chain, not from us                          |
      |<---------------------------------------------------------------------|
```

Step by step, with what each side owns:

1. **The user taps "Add money"** in `Money.tsx`. The wallet already knows their Stellar address; nothing else is needed from them yet.
2. **Our backend opens a session** against El Dorado with client credentials, passing the destination address, the asset and, if the user typed one, the amount. Credentials live on the server. They never ship in the extension, the web app or the APK, because anyone can read those.
3. **The widget opens** in a browser tab or an in-app browser. From here on the user is dealing with El Dorado, and the UI says so: this is their flow, their brand, their terms.
4. **The user verifies and pays.** First time, they complete KYC with El Dorado. After that they pick an amount and a payment method and send pesos from their own bank account. We see none of this.
5. **El Dorado calls our webhook** when the payment settles. We record the order against the user so the history screen can show it, and so support has something to look at when a user writes in.
6. **El Dorado delivers the crypto** to the address from step 2.
7. **The wallet notices the balance** the way it notices any other payment: by reading the chain. There is deliberately no path where our backend tells the wallet it has money.

The off-ramp is the same picture with the arrows reversed, and one difference that matters: the user signs a transaction sending USDC to the address El Dorado gives them, and that signature happens locally in the wallet.

### What the user sees

1. Add money.
2. A screen that says they are about to leave for El Dorado, who handles the peso leg, with the amount they asked for.
3. El Dorado's flow: identity the first time, then amount, payment method, bank transfer.
4. Back in the wallet, a pending row in the history.
5. The balance moves when the chain says so.

Four screens, one of them ours. The first time is slower because of the verification; after that it is three taps and a bank transfer.

## What changes in this repo

Nothing exists yet. When it does, it goes here:

| Where | What |
|---|---|
| `src/lib/onramp.ts` (new) | Client for our own backend endpoints. Never talks to El Dorado directly |
| `src/components/screens/Money.tsx` | The "Add money" entry point and the hand-off screen |
| `src/lib/config.ts` | Provider base URL and the public, non-secret bits of the session |
| Backend (separate repo) | `POST /onramp/session`, the webhook receiver, and the order table |

The wallet stays able to run without any of it: an on-ramp that is down must not break a wallet that can still receive, send and sign.

## Open questions

These are blocking. Most cannot be answered from the public docs, which render client side and do not expose endpoint detail without a browser.

1. **Does El Dorado deliver on Stellar?** Their docs advertise multiple networks but do not list them in text. If USDC only lands on an EVM chain or Tron, this integration needs a bridge step and the whole design changes. **Ask first; the answer decides whether we continue.**
2. **Endpoints and payloads** for creating a session, quoting and reading order status.
3. **Widget contract**: the embed URL and its parameters, how we pass the destination address and our partner reference, and how completion comes back, whether by redirect, `postMessage` or webhook only.
4. **Webhooks**: events, retry policy and how the signature is verified.
5. **KYC tiers**: what the first level asks for and what limits it carries. This is the number that decides how many users finish the flow.
6. **Limits and fees**: minimum and maximum per operation and per month, the spread they take, and whether an integrator can add a margin.
7. **Revenue share**: what the integrator earns. Nothing is published.
8. **Onboarding**: what they need from us to issue production credentials, and whether they require a company, a contract or any registration on our side.

## Next steps

1. Ask El Dorado the eight questions above, question 1 first.
2. In parallel, ask Payex for the same, since they are already a registered PSAV and that may be worth more than a better API.
3. Build against the sandbox only once question 1 is answered.
4. Have a lawyer read the final design against RG 1172/2026 before it ships. A written opinion costs a fraction of a registration, and this design is built to stay outside it.

## Sources

- El Dorado API docs: https://api-testnet.eldorado.io (read 25 Oct 2026; pages beyond the index render client side)
- Widget: https://widget.eldorado.io/exchange
- CNV, PSAV register: https://www.argentina.gob.ar/noticias/regulacion-de-los-proveedores-de-servicios-de-activos-virtuales-psav
- Payex, listed as a CNV-registered VASP: https://partners.circle.com/partner/payex-srl
- Peer2Peer SA: https://partners.circle.com/partner/peer2peer-sa
