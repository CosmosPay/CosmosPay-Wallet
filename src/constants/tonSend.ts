/**
 * Paying TON from the wallet's v4R2 contract (`lib/send/ton.ts`): the network it must be, the
 * contract it deploys, the knobs of the message it signs and the pace toncenter allows.
 */

/**
 * The main network's zero state, as toncenter's `getMasterchainInfo` answers it in `init` (hex of
 * its base64 `root_hash` / `file_hash`). These are the hashes TON's published global config pins
 * for mainnet; the test network has its own (`gj+B8wb…` / `Z+IKwYS…`), so a node serving it — or
 * any other network — fails the check before anything is signed.
 */
export const TON_MAINNET_ZEROSTATE = {
  rootHash: '17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569',
  fileHash: '5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e',
} as const;

/**
 * The standard wallet v4R2 code, a bag of cells exactly as `@ton/ton`'s `WalletContractV4` ships
 * it. Its root's hash and depth are the ones `lib/addresses/ton.ts` derives every address from
 * (`tests/unit/sendTon.test.ts` pins both), so the StateInit a first send deploys is the one the
 * wallet has been receiving on.
 */
export const TON_WALLET_V4R2_CODE_BOC =
  'te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA==';

/** wallet_id = 698983191 + workchain (0): the subwallet `lib/addresses/ton.ts` derives with. */
export const TON_V4R2_SUBWALLET_ID = 698983191;

/**
 * The internal message's send mode: 1 (the forwarding fee is paid from the balance, so the
 * recipient gets exactly the amount confirmed) + 2 (an action the balance cannot pay is skipped
 * instead of aborting the transaction). Without the 2, an aborted transaction rolls the seqno back
 * while the fee stays charged, so anyone holding the signed message could replay it until it
 * expires and drain the balance in fees.
 */
export const TON_SEND_MODE = 3;

/** How long a signed message stays valid (`valid_until` = now + this), in seconds. */
export const TON_VALID_FOR_S = 60;

/**
 * The longest text comment carried, in UTF-8 bytes. An exchange deposit memo is a short id;
 * 120 bytes keeps the comment in the message's own cell (4 bytes of op + 123 fit) and its
 * forwarding fee negligible.
 */
export const TON_COMMENT_MAX_BYTES = 120;

/**
 * What a send leaves on the wallet beyond the amount and the fee, in nanotons (0.01 TON).
 * A TON account pays rent for its storage, collected from the balance at its next transaction;
 * a deployed v4R2 wallet (~20 cells, ~5.6 kbit) costs about 0.008 TON a year at basechain prices,
 * and one whose debt passes 0.1 TON is frozen. 0.01 TON keeps an emptied wallet about a year
 * clear of any debt and able to pay the next send's fee.
 */
export const TON_KEEP_ALIVE = 10_000_000n;

/** toncenter without a key answers ~1 request a second; a send's requests are spaced by this. */
export const TON_REQUEST_GAP_MS = 1_100;

/** One toncenter request, from sending it to reading its body. */
export const TON_REQUEST_TIMEOUT_MS = 15_000;

/** How many times a request toncenter rate-limits (HTTP 429, nothing processed) is tried again. */
export const TON_RATE_LIMIT_RETRIES = 2;
