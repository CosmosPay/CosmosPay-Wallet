/** QR code generation — a real, scannable QR of the Stellar address. */
import QRCode from 'qrcode';

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 384,
    color: { dark: '#0a0c0b', light: '#ffffff' },
  });
}
