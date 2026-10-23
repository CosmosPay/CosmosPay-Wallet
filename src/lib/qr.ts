/**
 * QR code generation — a real, scannable QR of an address or payment link.
 *
 * Error correction Q (25%): the receive screen draws the network's mark over the centre of
 * the code (~5% of its area), and M's 15% left too thin a margin for a worn phone camera.
 */
import QRCode from 'qrcode';

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 384,
    color: { dark: '#0a0c0b', light: '#ffffff' },
  });
}
