/**
 * What the scanner says about a QR it decoded but cannot open (`features/extras/ScanQR.tsx`).
 *
 * The scanner opens a Stellar address or payment request (into Send) and, where WalletConnect is
 * on, a site's `wc:` link. Anything else used to end in silence or in "no valid QR code found",
 * which is false for a perfectly good QR of an Ethereum address: the person was never told what
 * the scanner reads, nor where an address of another network goes instead (Send, its asset
 * first). Loaded only when a scan is refused: it reads every family's address rules.
 */
import { isNetworkAddress } from '@/lib/networkSend';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import type { ChainNet } from '@/constants/chains';

/** Why a decoded QR was not opened. */
export type ScanRefusal = 'otherNetwork' | 'unsupported';

/**
 * The address inside a QR from another network's wallet: a bare address, or a payment URI around
 * one (`ethereum:0x…@1?value=…`, `bitcoin:bc1…?amount=…`, `tron:T…`).
 */
export function scannedAddress(text: string): string {
  const s = text.trim();
  const body = /^[a-z][a-z0-9+.-]*:(?!\/\/)/i.test(s) ? s.slice(s.indexOf(':') + 1) : s;
  return body.split(/[?@/]/)[0].trim();
}

/** Why the scanner does not open `text`: an address it knows on another network, or nothing it reads. */
export function scanRefusal(text: string, env: ChainNet): ScanRefusal {
  const address = scannedAddress(text);
  if (!address) return 'unsupported';
  const known = (id: NetworkId) => {
    // A NEAR name is any lowercase word ("hello" is a valid main-network account), so a name
    // without a level (`alice.near`) says nothing about what the QR holds.
    if (NETWORKS[id].address === 'near' && NEAR_BARE_NAME.test(address)) return false;
    try {
      return isNetworkAddress(id, address, env);
    } catch {
      return false;
    }
  };
  return NETWORK_IDS.some((id) => id !== 'stellar' && known(id)) ? 'otherNetwork' : 'unsupported';
}

/** A NEAR account name with no `.`: valid syntax, and also just a word. */
const NEAR_BARE_NAME = /^[a-z\d_-]+$/;
