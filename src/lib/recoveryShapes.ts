/**
 * Response contracts for SEP-10 web auth and SEP-30 account recovery. See `lib/apiShape.ts`
 * for why every response has one.
 *
 * What is asserted is what the wallet acts on: the envelopes it is about to decode and
 * sign, the tokens it presents back, the signer keys it puts on chain as signers, and the
 * addresses it checks those against. A `signers[].key` that arrived as something other than
 * a Stellar address would otherwise become a `setOptions` the guard refuses much later,
 * with a message about transaction shape rather than about the server that sent it.
 */
import { account, arrayOf, bool, id, num, object, optional, str, variant, xdr } from '@/lib/apiShape';

export const Sep10ChallengeShape = object({ transaction: xdr, network_passphrase: id });

export const Sep10TokenShape = object({ token: id });

/** One server's identity token, from an ID token or from its own emailed code. */
export const RecoveryIdentityShape = object({ token: id, expires_in: num });

export const RecoveryEmailStartedShape = object({ claim_token: id, expires_in: num });

export const RecoveryEmailResultShape = variant('status', {
  ready: object({ token: id, expires_in: num }),
  invalid: object({ attempts_left: num }),
  expired: object({}),
  locked: object({}),
});

const RecoveryAccountShape = object({
  address: account,
  identities: arrayOf(object({ role: str, authenticated: optional(bool) })),
  signers: arrayOf(object({ key: account, added_at: str })),
});

export const RecoveryRegisteredShape = RecoveryAccountShape;

export const RecoveryAccountListShape = object({ accounts: arrayOf(RecoveryAccountShape) });

/** A raw signature, never a signed envelope — the wallet assembles the transaction. */
export const RecoverySignatureShape = object({ signature: id, network_passphrase: id });

export const RecoverySetupShape = object({ transaction: xdr, sponsor: account, network_passphrase: id });
