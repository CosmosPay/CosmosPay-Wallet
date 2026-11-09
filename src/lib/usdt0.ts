/**
 * USDT0, Tether's omnichain USDT, out of Stellar: the bridge's OFT moves it 1:1 to the networks
 * the gateway lists (`GET /v1/usdt0/routes`), as native USDT on Ethereum and as USDT0 elsewhere.
 * The holder signs one Soroban transaction and pays the bridge's fee in XLM. The developer
 * platform's `usdt0.ts`, shaped for a wallet that receives on its own addresses. Pure.
 */
import { USDT0_STELLAR } from '@/constants/usdt0';

/** One destination the bridge reaches from Stellar, as `GET /v1/usdt0/routes` lists it. */
export interface Usdt0Route {
  /** The gateway's network id: the wallet's own `NetworkId` where it knows the network. */
  chain: string;
  name: string;
  /** The destination's messaging endpoint id: what the transaction names it by. */
  eid: number;
  /** What arrives: native USDT on Ethereum, USDT0 elsewhere. */
  receives: 'USDT' | 'USDT0';
}

/** Is the token Tether's USDT0 on Stellar (code AND issuer — never a bare code)? */
export const isUsdt0OnStellar = (t: { chain: string; symbol: string; contract: string | null }): boolean =>
  t.chain === 'stellar' && t.symbol === USDT0_STELLAR.code && t.contract === USDT0_STELLAR.issuer;

/**
 * The amount that crosses: `amount` cut to the bridge's 6 decimals (the seventh stays in the
 * account), as a decimal string, or null when nothing would cross.
 */
export function bridgedAmount(amount: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').slice(0, 6).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return Number(out) > 0 ? out : null;
}

/**
 * An EVM address as the bridge carries every recipient: 32 bytes, the 20 of the address
 * right-aligned behind 12 zero bytes. Null on anything that is not 0x + 40 hex — this is the
 * field that decides where the money goes.
 */
export function evmAddressToBytes32(address: string): Uint8Array | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 20; i += 1) out[12 + i] = parseInt(address.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}
