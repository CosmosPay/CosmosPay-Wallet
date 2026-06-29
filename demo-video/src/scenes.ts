export interface SceneData {
  img: string;
  title: string;
  subtitle: string;
}

// One scene per captured screen of the real app flow.
export const SCENES: SceneData[] = [
  { img: "shots/01-welcome.png", title: "Bienvenido a Cosmos Pay", subtitle: "Wallet de auto-custodia en Stellar — tus claves, tu control" },
  { img: "shots/02-backup-seed.png", title: "Tu frase de recuperación", subtitle: "12 palabras generadas en tu dispositivo · BIP-39 / SEP-5" },
  { img: "shots/03-verify.png", title: "Verificá tu frase", subtitle: "Confirmás que la guardaste antes de seguir" },
  { img: "shots/04-verify-filled.png", title: "Verificación correcta", subtitle: "Las palabras coinciden — tu respaldo está seguro" },
  { img: "shots/05-profile.png", title: "Sobre vos", subtitle: "Nombre, correo y fecha — guardados sólo en tu dispositivo" },
  { img: "shots/06-password.png", title: "Creá tu contraseña", subtitle: "Cifrado AES-256-GCM con clave PBKDF2 (210k iter.)" },
  { img: "shots/07-success.png", title: "¡Wallet creada!", subtitle: "Lista, cifrada y protegida" },
  { img: "shots/08-home.png", title: "Tu portafolio", subtitle: "Saldo, precios y acciones en una sola pantalla" },
  { img: "shots/09-home-funded.png", title: "Fondeo en Testnet", subtitle: "10.000 XLM de prueba al instante con Friendbot" },
  { img: "shots/10-receive.png", title: "Recibir", subtitle: "QR escaneable + tu dirección pública de Stellar" },
  { img: "shots/11-send.png", title: "Enviar", subtitle: "Pagos firmados localmente y enviados a la red" },
  { img: "shots/12-swap.png", title: "Intercambiar", subtitle: "Cambiá entre activos de Stellar" },
  { img: "shots/13-markets.png", title: "Mercados", subtitle: "Precios en vivo de XLM, USDC, EURC y más" },
  { img: "shots/14-earn.png", title: "Ganar", subtitle: "Ahorro y rendimiento sobre tus fondos" },
  { img: "shots/15-profile.png", title: "Perfil y ajustes", subtitle: "Multi-wallet, red, idioma y tema — todo a tu medida" },
];

export const FPS = 30;
export const SCENE_DUR = 165; // 5.5s per scene
export const OVERLAP = 18; // cross-fade frames
export const STRIDE = SCENE_DUR - OVERLAP; // distance between scene starts
export const TOTAL = STRIDE * (SCENES.length - 1) + SCENE_DUR;
