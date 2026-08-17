export async function qrDataUrl(text: string): Promise<string> {
  const mod = await import('qrcode');
  const QRCode = mod.default || mod;
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 384,
    color: { dark: '#0a0c0b', light: '#ffffff' },
  });
}
