/** QR code generation — a real, scannable QR of the Stellar address. */
import QRCode from 'qrcode';

/**
 * `H` when something is drawn over the code's centre (Receive's network mark): it survives about
 * 30% of the modules hidden, where `M` survives 15%. A denser code, so only where it is needed.
 */
export async function qrDataUrl(text: string, ecc: 'M' | 'H' = 'M'): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: ecc,
    margin: 1,
    width: 384,
    color: { dark: '#0a0c0b', light: '#ffffff' },
  });
}
