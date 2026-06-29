/**
 * Lightweight i18n. Five languages: Spanish, English, Portuguese, German, French.
 * The active language is auto-detected from the device on first run and can be
 * overridden by the user (persisted in localStorage). `t(key, params)` resolves
 * a string for the active language, falling back to English then the key itself.
 */
export type Lang = 'es' | 'en' | 'pt' | 'de' | 'fr';

export const LANGUAGES: { code: Lang; name: string; flag: string }[] = [
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
];

const LANG_KEY = 'cosmos.lang';
const SUPPORTED: Lang[] = ['es', 'en', 'pt', 'de', 'fr'];

/** Map a navigator.language like "pt-BR" to one of the supported languages. */
export function detectLang(): Lang {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const base = (l || '').slice(0, 2).toLowerCase() as Lang;
      if (SUPPORTED.includes(base)) return base;
    }
  } catch {
    /* non-browser */
  }
  return 'en';
}

export function savedLang(): Lang {
  try {
    const l = localStorage.getItem(LANG_KEY) as Lang | null;
    if (l && SUPPORTED.includes(l)) return l;
  } catch {
    /* ignore */
  }
  return detectLang();
}

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** Locale tag for Intl (dates, numbers) derived from the language. */
export function localeOf(lang: Lang): string {
  return { es: 'es-ES', en: 'en-US', pt: 'pt-BR', de: 'de-DE', fr: 'fr-FR' }[lang];
}

// Each entry: key -> { es, en, pt, de, fr }
const T: Record<string, Record<Lang, string>> = {
  // ---- common ----
  'common.continue': { es: 'Continuar', en: 'Continue', pt: 'Continuar', de: 'Weiter', fr: 'Continuer' },
  'common.cancel': { es: 'Cancelar', en: 'Cancel', pt: 'Cancelar', de: 'Abbrechen', fr: 'Annuler' },
  'common.copy': { es: 'Copiar', en: 'Copy', pt: 'Copiar', de: 'Kopieren', fr: 'Copier' },
  'common.copied': { es: 'Copiado ✓', en: 'Copied ✓', pt: 'Copiado ✓', de: 'Kopiert ✓', fr: 'Copié ✓' },
  'common.share': { es: 'Compartir', en: 'Share', pt: 'Partilhar', de: 'Teilen', fr: 'Partager' },
  'common.delete': { es: 'Borrar', en: 'Delete', pt: 'Apagar', de: 'Löschen', fr: 'Supprimer' },
  'common.send': { es: 'Enviar', en: 'Send', pt: 'Enviar', de: 'Senden', fr: 'Envoyer' },
  'common.receive': { es: 'Recibir', en: 'Receive', pt: 'Receber', de: 'Empfangen', fr: 'Recevoir' },

  // ---- welcome ----
  'welcome.subtitle': {
    es: 'Tu wallet de auto-custodia en Stellar. Tus claves, tus criptos — bajo tu control.',
    en: 'Your self-custody Stellar wallet. Your keys, your crypto — fully in your control.',
    pt: 'A tua wallet de auto-custódia na Stellar. As tuas chaves, as tuas criptos — sob o teu controlo.',
    de: 'Deine Self-Custody-Wallet auf Stellar. Deine Schlüssel, deine Kryptos — ganz unter deiner Kontrolle.',
    fr: 'Ton portefeuille auto-géré sur Stellar. Tes clés, tes cryptos — sous ton contrôle.',
  },
  'welcome.create': { es: 'Crear una wallet nueva', en: 'Create a new wallet', pt: 'Criar uma nova wallet', de: 'Neue Wallet erstellen', fr: 'Créer un nouveau portefeuille' },
  'welcome.import': { es: 'Ya tengo una wallet', en: 'I already have a wallet', pt: 'Já tenho uma wallet', de: 'Ich habe bereits eine Wallet', fr: "J'ai déjà un portefeuille" },
  'welcome.producer': { es: 'Un producto de Cosmos', en: 'A Cosmos product', pt: 'Um produto Cosmos', de: 'Ein Cosmos-Produkt', fr: 'Un produit Cosmos' },

  // ---- backup ----
  'backup.title': { es: 'Frase de recuperación', en: 'Recovery phrase', pt: 'Frase de recuperação', de: 'Wiederherstellungsphrase', fr: 'Phrase de récupération' },
  'backup.desc': {
    es: 'Anota estas 12 palabras en orden y guárdalas en un lugar seguro. Es la única forma de restaurar tu wallet.',
    en: 'Write these 12 words down in order and keep them somewhere safe. This is the only way to restore your wallet.',
    pt: 'Anota estas 12 palavras por ordem e guarda-as num lugar seguro. É a única forma de restaurar a tua wallet.',
    de: 'Schreibe diese 12 Wörter der Reihe nach auf und bewahre sie sicher auf. Nur so kannst du deine Wallet wiederherstellen.',
    fr: 'Note ces 12 mots dans l’ordre et garde-les en lieu sûr. C’est le seul moyen de restaurer ton portefeuille.',
  },
  'backup.warning': {
    es: 'Nunca compartas tu frase. Cualquiera con estas palabras puede robar tus fondos.',
    en: 'Never share your phrase. Anyone with these words can take your funds.',
    pt: 'Nunca partilhes a tua frase. Qualquer pessoa com estas palavras pode roubar os teus fundos.',
    de: 'Teile deine Phrase niemals. Wer diese Wörter hat, kann dein Guthaben stehlen.',
    fr: 'Ne partage jamais ta phrase. Quiconque possède ces mots peut voler tes fonds.',
  },
  'backup.copy': { es: 'Copiar al portapapeles', en: 'Copy to clipboard', pt: 'Copiar para a área de transferência', de: 'In die Zwischenablage kopieren', fr: 'Copier dans le presse-papiers' },
  'backup.saved': {
    es: 'He guardado mi frase de recuperación en un lugar seguro.',
    en: 'I have saved my recovery phrase in a safe place.',
    pt: 'Guardei a minha frase de recuperação num lugar seguro.',
    de: 'Ich habe meine Wiederherstellungsphrase sicher gespeichert.',
    fr: 'J’ai sauvegardé ma phrase de récupération en lieu sûr.',
  },

  // ---- verify ----
  'verify.title': { es: 'Verifica tu frase', en: 'Verify your phrase', pt: 'Verifica a tua frase', de: 'Phrase bestätigen', fr: 'Vérifie ta phrase' },
  'verify.desc': {
    es: 'Toca las palabras para rellenar los huecos y confirmar que guardaste tu frase.',
    en: 'Tap the words to fill the gaps and confirm you saved your phrase.',
    pt: 'Toca nas palavras para preencher os espaços e confirmar que guardaste a frase.',
    de: 'Tippe die Wörter an, um die Lücken zu füllen und zu bestätigen, dass du deine Phrase gespeichert hast.',
    fr: 'Touche les mots pour remplir les blancs et confirmer que tu as sauvegardé ta phrase.',
  },
  'verify.tapToSelect': { es: 'Toca para seleccionar', en: 'Tap to select', pt: 'Toca para selecionar', de: 'Zum Auswählen tippen', fr: 'Touche pour sélectionner' },
  'verify.confirm': { es: 'Confirmar y continuar', en: 'Confirm & continue', pt: 'Confirmar e continuar', de: 'Bestätigen & fortfahren', fr: 'Confirmer et continuer' },

  // ---- import ----
  'import.title': { es: 'Importar wallet', en: 'Import wallet', pt: 'Importar wallet', de: 'Wallet importieren', fr: 'Importer un portefeuille' },
  'import.desc': {
    es: 'Introduce tu frase de recuperación (12/24 palabras) o tu clave secreta de Stellar para restaurar tu wallet.',
    en: 'Enter your recovery phrase (12/24 words) or your Stellar secret key to restore your wallet.',
    pt: 'Introduz a tua frase de recuperação (12/24 palavras) ou a tua chave secreta Stellar para restaurar a wallet.',
    de: 'Gib deine Wiederherstellungsphrase (12/24 Wörter) oder deinen geheimen Stellar-Schlüssel ein, um deine Wallet wiederherzustellen.',
    fr: 'Saisis ta phrase de récupération (12/24 mots) ou ta clé secrète Stellar pour restaurer ton portefeuille.',
  },
  'import.cta': { es: 'Importar wallet', en: 'Import wallet', pt: 'Importar wallet', de: 'Wallet importieren', fr: 'Importer le portefeuille' },
  'import.paste': { es: 'Pegar del portapapeles', en: 'Paste from clipboard', pt: 'Colar da área de transferência', de: 'Aus Zwischenablage einfügen', fr: 'Coller depuis le presse-papiers' },
  'import.valid': { es: '✓ Frase o clave válida', en: '✓ Valid phrase or key', pt: '✓ Frase ou chave válida', de: '✓ Gültige Phrase oder Schlüssel', fr: '✓ Phrase ou clé valide' },
  'import.invalid': {
    es: 'Comprueba tu frase de 12/24 palabras o tu clave secreta (S…)',
    en: 'Check your 12/24-word phrase or your secret key (S…)',
    pt: 'Verifica a tua frase de 12/24 palavras ou a chave secreta (S…)',
    de: 'Prüfe deine 12/24-Wörter-Phrase oder deinen geheimen Schlüssel (S…)',
    fr: 'Vérifie ta phrase de 12/24 mots ou ta clé secrète (S…)',
  },

  // ---- profile setup ----
  'setup.about': { es: 'Sobre ti', en: 'About you', pt: 'Sobre ti', de: 'Über dich', fr: 'À propos de toi' },
  'setup.title': { es: '¿Cómo te llamas?', en: 'What’s your name?', pt: 'Como te chamas?', de: 'Wie heißt du?', fr: 'Comment t’appelles-tu ?' },
  'setup.subtitle': {
    es: 'Así te saludamos cada vez que abres la wallet. Estos datos se guardan solo en tu dispositivo.',
    en: 'This is how we greet you each time you open the wallet. This data stays only on your device.',
    pt: 'É assim que te saudamos sempre que abres a wallet. Estes dados ficam apenas no teu dispositivo.',
    de: 'So begrüßen wir dich jedes Mal, wenn du die Wallet öffnest. Diese Daten bleiben nur auf deinem Gerät.',
    fr: 'C’est ainsi que nous t’accueillons à chaque ouverture du portefeuille. Ces données restent uniquement sur ton appareil.',
  },
  'setup.nameLabel': { es: 'Nombre o apodo', en: 'Name or nickname', pt: 'Nome ou alcunha', de: 'Name oder Spitzname', fr: 'Nom ou pseudo' },
  'setup.dobLabel': { es: 'Fecha de nacimiento (opcional)', en: 'Date of birth (optional)', pt: 'Data de nascimento (opcional)', de: 'Geburtsdatum (optional)', fr: 'Date de naissance (facultatif)' },
  'setup.birthdayNote': {
    es: 'Si la indicas, te felicitaremos el día de tu cumpleaños 🎂',
    en: 'If you add it, we’ll wish you a happy birthday 🎂',
    pt: 'Se a indicares, desejamos-te feliz aniversário 🎂',
    de: 'Wenn du es angibst, gratulieren wir dir zum Geburtstag 🎂',
    fr: 'Si tu l’indiques, on te souhaitera ton anniversaire 🎂',
  },
  'setup.addWallet': { es: 'Añadir wallet', en: 'Add wallet', pt: 'Adicionar wallet', de: 'Wallet hinzufügen', fr: 'Ajouter le portefeuille' },

  // ---- password ----
  'pwd.title': { es: 'Crea una contraseña', en: 'Create a password', pt: 'Cria uma palavra-passe', de: 'Passwort erstellen', fr: 'Créer un mot de passe' },
  'pwd.desc': {
    es: 'Esta contraseña cifra tu wallet en este dispositivo. Se necesita para desbloquearla. No se puede recuperar — guárdala bien.',
    en: 'This password encrypts your wallet on this device and is required to unlock it. It cannot be recovered — keep it safe.',
    pt: 'Esta palavra-passe cifra a tua wallet neste dispositivo e é necessária para a desbloquear. Não pode ser recuperada — guarda-a bem.',
    de: 'Dieses Passwort verschlüsselt deine Wallet auf diesem Gerät und wird zum Entsperren benötigt. Es kann nicht wiederhergestellt werden — bewahre es gut auf.',
    fr: 'Ce mot de passe chiffre ton portefeuille sur cet appareil et est requis pour le déverrouiller. Il est irrécupérable — garde-le précieusement.',
  },
  'pwd.label': { es: 'Contraseña', en: 'Password', pt: 'Palavra-passe', de: 'Passwort', fr: 'Mot de passe' },
  'pwd.min': { es: 'Mínimo 8 caracteres', en: 'At least 8 characters', pt: 'Mínimo de 8 caracteres', de: 'Mindestens 8 Zeichen', fr: 'Au moins 8 caractères' },
  'pwd.repeat': { es: 'Repite la contraseña', en: 'Repeat the password', pt: 'Repete a palavra-passe', de: 'Passwort wiederholen', fr: 'Répète le mot de passe' },
  'pwd.show': { es: 'Mostrar contraseña', en: 'Show password', pt: 'Mostrar palavra-passe', de: 'Passwort anzeigen', fr: 'Afficher le mot de passe' },
  'pwd.lenOk': { es: '✓ Longitud suficiente', en: '✓ Long enough', pt: '✓ Comprimento suficiente', de: '✓ Lang genug', fr: '✓ Assez long' },
  'pwd.lenErr': { es: 'La contraseña debe tener al menos 8 caracteres', en: 'The password must be at least 8 characters', pt: 'A palavra-passe deve ter pelo menos 8 caracteres', de: 'Das Passwort muss mindestens 8 Zeichen haben', fr: 'Le mot de passe doit comporter au moins 8 caractères' },
  'pwd.mismatch': { es: 'Las contraseñas no coinciden', en: 'The passwords don’t match', pt: 'As palavras-passe não coincidem', de: 'Die Passwörter stimmen nicht überein', fr: 'Les mots de passe ne correspondent pas' },
  'pwd.create': { es: 'Crear wallet', en: 'Create wallet', pt: 'Criar wallet', de: 'Wallet erstellen', fr: 'Créer le portefeuille' },

  // ---- unlock ----
  'unlock.subtitle': { es: 'Introduce tu contraseña para entrar a tu wallet.', en: 'Enter your password to open your wallet.', pt: 'Introduz a tua palavra-passe para entrar na wallet.', de: 'Gib dein Passwort ein, um deine Wallet zu öffnen.', fr: 'Saisis ton mot de passe pour ouvrir ton portefeuille.' },
  'unlock.unlock': { es: 'Desbloquear', en: 'Unlock', pt: 'Desbloquear', de: 'Entsperren', fr: 'Déverrouiller' },
  'unlock.forgot': { es: 'Olvidé mi contraseña', en: 'I forgot my password', pt: 'Esqueci-me da palavra-passe', de: 'Passwort vergessen', fr: 'Mot de passe oublié' },
  'unlock.forgotDesc': {
    es: 'Sin la contraseña no se puede descifrar esta wallet. Puedes borrarla de este dispositivo y restaurarla con tu frase de recuperación.',
    en: 'Without the password this wallet cannot be decrypted. You can remove it from this device and restore it with your recovery phrase.',
    pt: 'Sem a palavra-passe não é possível decifrar esta wallet. Podes removê-la deste dispositivo e restaurá-la com a frase de recuperação.',
    de: 'Ohne das Passwort kann diese Wallet nicht entschlüsselt werden. Du kannst sie von diesem Gerät entfernen und mit deiner Wiederherstellungsphrase wiederherstellen.',
    fr: 'Sans le mot de passe, ce portefeuille ne peut pas être déchiffré. Tu peux le supprimer de cet appareil et le restaurer avec ta phrase de récupération.',
  },
  'unlock.deleteRestore': { es: 'Borrar wallet y restaurar con frase', en: 'Delete wallet & restore with phrase', pt: 'Apagar wallet e restaurar com a frase', de: 'Wallet löschen & mit Phrase wiederherstellen', fr: 'Supprimer et restaurer avec la phrase' },
  'unlock.happyDay': { es: '¡Feliz día!', en: 'Happy day!', pt: 'Feliz dia!', de: 'Schönen Tag!', fr: 'Joyeuse journée !' },
  'unlock.yearsOld': { es: '¡{age} años!', en: '{age} years old!', pt: '{age} anos!', de: '{age} Jahre!', fr: '{age} ans !' },

  // ---- greeting ----
  'greet.morning': { es: 'Buenos días', en: 'Good morning', pt: 'Bom dia', de: 'Guten Morgen', fr: 'Bonjour' },
  'greet.afternoon': { es: 'Buenas tardes', en: 'Good afternoon', pt: 'Boa tarde', de: 'Guten Tag', fr: 'Bon après-midi' },
  'greet.evening': { es: 'Buenas noches', en: 'Good evening', pt: 'Boa noite', de: 'Guten Abend', fr: 'Bonsoir' },
  'greet.birthday': { es: '¡Feliz cumpleaños, {name}! 🎉', en: 'Happy birthday, {name}! 🎉', pt: 'Feliz aniversário, {name}! 🎉', de: 'Alles Gute zum Geburtstag, {name}! 🎉', fr: 'Joyeux anniversaire, {name} ! 🎉' },

  // ---- tabs ----
  'tab.home': { es: 'Inicio', en: 'Home', pt: 'Início', de: 'Start', fr: 'Accueil' },
  'tab.earn': { es: 'Ganar', en: 'Earn', pt: 'Ganhar', de: 'Verdienen', fr: 'Gagner' },
  'tab.markets': { es: 'Mercados', en: 'Markets', pt: 'Mercados', de: 'Märkte', fr: 'Marchés' },
  'tab.profile': { es: 'Perfil', en: 'Profile', pt: 'Perfil', de: 'Profil', fr: 'Profil' },

  // ---- home ----
  'home.portfolio': { es: 'Valor del portafolio', en: 'Portfolio value', pt: 'Valor do portfólio', de: 'Portfoliowert', fr: 'Valeur du portefeuille' },
  'home.swap': { es: 'Intercambiar', en: 'Swap', pt: 'Trocar', de: 'Tauschen', fr: 'Échanger' },
  'home.more': { es: 'Más', en: 'More', pt: 'Mais', de: 'Mehr', fr: 'Plus' },
  'home.assets': { es: 'Tus activos', en: 'Your assets', pt: 'Os teus ativos', de: 'Deine Assets', fr: 'Tes actifs' },
  'home.markets': { es: 'Mercados', en: 'Markets', pt: 'Mercados', de: 'Märkte', fr: 'Marchés' },
  'home.viewAll': { es: 'Ver todo ›', en: 'View all ›', pt: 'Ver tudo ›', de: 'Alle ›', fr: 'Tout voir ›' },
  'home.loading': { es: 'Cargando saldos…', en: 'Loading balances…', pt: 'A carregar saldos…', de: 'Guthaben werden geladen…', fr: 'Chargement des soldes…' },
  'home.noAssets': { es: 'Aún no hay activos.', en: 'No assets yet.', pt: 'Ainda não há ativos.', de: 'Noch keine Assets.', fr: 'Aucun actif pour le moment.' },
  'home.activate': { es: 'Activa tu cuenta', en: 'Activate your account', pt: 'Ativa a tua conta', de: 'Konto aktivieren', fr: 'Active ton compte' },
  'home.activateDesc': {
    es: 'En Stellar una cuenta existe cuando recibe al menos 1 XLM (reserva base).',
    en: 'On Stellar an account exists once it receives at least 1 XLM (base reserve).',
    pt: 'Na Stellar uma conta existe quando recebe pelo menos 1 XLM (reserva base).',
    de: 'Auf Stellar existiert ein Konto, sobald es mindestens 1 XLM erhält (Basisreserve).',
    fr: 'Sur Stellar, un compte existe dès qu’il reçoit au moins 1 XLM (réserve de base).',
  },
  'home.activateTestnet': { es: ' En Testnet puedes obtenerlos gratis con Friendbot.', en: ' On Testnet you can get them free via Friendbot.', pt: ' Na Testnet podes obtê-los grátis com o Friendbot.', de: ' Im Testnet bekommst du sie gratis über Friendbot.', fr: ' Sur le Testnet, tu peux les obtenir gratuitement via Friendbot.' },
  'home.activateMainnet': { es: ' Recibe XLM desde otra cuenta o un exchange para activarla.', en: ' Receive XLM from another account or an exchange to activate it.', pt: ' Recebe XLM de outra conta ou exchange para a ativar.', de: ' Erhalte XLM von einem anderen Konto oder einer Börse, um es zu aktivieren.', fr: ' Reçois des XLM d’un autre compte ou d’une plateforme pour l’activer.' },
  'home.getTestXlm': { es: 'Obtener 10.000 XLM de prueba', en: 'Get 10,000 test XLM', pt: 'Obter 10.000 XLM de teste', de: '10.000 Test-XLM erhalten', fr: 'Obtenir 10 000 XLM de test' },
  'home.viewAddress': { es: 'Ver mi dirección', en: 'View my address', pt: 'Ver o meu endereço', de: 'Meine Adresse anzeigen', fr: 'Voir mon adresse' },

  // ---- profile ----
  'profile.myWallets': { es: 'Mis wallets', en: 'My wallets', pt: 'As minhas wallets', de: 'Meine Wallets', fr: 'Mes portefeuilles' },
  'profile.active': { es: 'Activa', en: 'Active', pt: 'Ativa', de: 'Aktiv', fr: 'Active' },
  'profile.switch': { es: 'Cambiar', en: 'Switch', pt: 'Mudar', de: 'Wechseln', fr: 'Changer' },
  'profile.addWallet': { es: 'Añadir o importar wallet', en: 'Add or import wallet', pt: 'Adicionar ou importar wallet', de: 'Wallet hinzufügen oder importieren', fr: 'Ajouter ou importer un portefeuille' },
  'profile.accountDetails': { es: 'Detalles de la cuenta', en: 'Account details', pt: 'Detalhes da conta', de: 'Kontodetails', fr: 'Détails du compte' },
  'profile.exportKeys': { es: 'Exportar claves', en: 'Export keys', pt: 'Exportar chaves', de: 'Schlüssel exportieren', fr: 'Exporter les clés' },
  'profile.receiveAddr': { es: 'Recibir / Mi dirección', en: 'Receive / My address', pt: 'Receber / O meu endereço', de: 'Empfangen / Meine Adresse', fr: 'Recevoir / Mon adresse' },
  'profile.settings': { es: 'Ajustes y red', en: 'Settings & network', pt: 'Definições e rede', de: 'Einstellungen & Netzwerk', fr: 'Réglages et réseau' },
  'profile.about': { es: 'Acerca de Cosmos', en: 'About Cosmos', pt: 'Acerca do Cosmos', de: 'Über Cosmos', fr: 'À propos de Cosmos' },
  'profile.aboutToast': { es: 'Cosmos · wallet no custodial en Stellar (SEP-5).', en: 'Cosmos · non-custodial Stellar wallet (SEP-5).', pt: 'Cosmos · wallet não custodial na Stellar (SEP-5).', de: 'Cosmos · nicht-verwahrte Stellar-Wallet (SEP-5).', fr: 'Cosmos · portefeuille Stellar non dépositaire (SEP-5).' },
  'profile.lock': { es: 'Bloquear wallet', en: 'Lock wallet', pt: 'Bloquear wallet', de: 'Wallet sperren', fr: 'Verrouiller le portefeuille' },
  'profile.years': { es: 'años', en: 'years', pt: 'anos', de: 'Jahre', fr: 'ans' },

  // ---- settings ----
  'settings.title': { es: 'Ajustes', en: 'Settings', pt: 'Definições', de: 'Einstellungen', fr: 'Réglages' },
  'settings.network': { es: 'Red', en: 'Network', pt: 'Rede', de: 'Netzwerk', fr: 'Réseau' },
  'settings.networkDesc': {
    es: 'La misma frase/clave deriva la misma cuenta en ambas redes. Testnet usa XLM de prueba gratis; Mainnet usa fondos reales.',
    en: 'The same phrase/key derives the same account on both networks. Testnet uses free test XLM; Mainnet uses real funds.',
    pt: 'A mesma frase/chave deriva a mesma conta em ambas as redes. Testnet usa XLM de teste grátis; Mainnet usa fundos reais.',
    de: 'Dieselbe Phrase/dasselbe Schlüssel ergibt dasselbe Konto in beiden Netzwerken. Testnet nutzt kostenloses Test-XLM; Mainnet echtes Guthaben.',
    fr: 'La même phrase/clé dérive le même compte sur les deux réseaux. Le Testnet utilise des XLM de test gratuits ; le Mainnet des fonds réels.',
  },
  'settings.appearance': { es: 'Apariencia', en: 'Appearance', pt: 'Aparência', de: 'Darstellung', fr: 'Apparence' },
  'settings.dark': { es: 'Oscuro', en: 'Dark', pt: 'Escuro', de: 'Dunkel', fr: 'Sombre' },
  'settings.light': { es: 'Claro', en: 'Light', pt: 'Claro', de: 'Hell', fr: 'Clair' },
  'settings.language': { es: 'Idioma', en: 'Language', pt: 'Idioma', de: 'Sprache', fr: 'Langue' },
  'settings.myAddress': { es: 'Mi dirección', en: 'My address', pt: 'O meu endereço', de: 'Meine Adresse', fr: 'Mon adresse' },
  'settings.security': { es: 'Seguridad', en: 'Security', pt: 'Segurança', de: 'Sicherheit', fr: 'Sécurité' },
  'settings.exportPhrase': { es: 'Exportar frase / clave', en: 'Export phrase / key', pt: 'Exportar frase / chave', de: 'Phrase / Schlüssel exportieren', fr: 'Exporter la phrase / clé' },
  'settings.changePwd': { es: 'Cambiar contraseña', en: 'Change password', pt: 'Mudar palavra-passe', de: 'Passwort ändern', fr: 'Changer le mot de passe' },
  'settings.cancelChangePwd': { es: 'Cancelar cambio de contraseña', en: 'Cancel password change', pt: 'Cancelar mudança de palavra-passe', de: 'Passwortänderung abbrechen', fr: 'Annuler le changement de mot de passe' },
  'settings.currentPwd': { es: 'Contraseña actual', en: 'Current password', pt: 'Palavra-passe atual', de: 'Aktuelles Passwort', fr: 'Mot de passe actuel' },
  'settings.newPwd': { es: 'Nueva contraseña', en: 'New password', pt: 'Nova palavra-passe', de: 'Neues Passwort', fr: 'Nouveau mot de passe' },
  'settings.savePwd': { es: 'Guardar contraseña', en: 'Save password', pt: 'Guardar palavra-passe', de: 'Passwort speichern', fr: 'Enregistrer le mot de passe' },
  'settings.pwdUpdated': { es: 'Contraseña actualizada.', en: 'Password updated.', pt: 'Palavra-passe atualizada.', de: 'Passwort aktualisiert.', fr: 'Mot de passe mis à jour.' },
  'settings.danger': { es: 'Zona de peligro', en: 'Danger zone', pt: 'Zona de perigo', de: 'Gefahrenzone', fr: 'Zone de danger' },
  'settings.deleteThis': { es: 'Borrar esta wallet del dispositivo', en: 'Delete this wallet from the device', pt: 'Apagar esta wallet do dispositivo', de: 'Diese Wallet vom Gerät löschen', fr: 'Supprimer ce portefeuille de l’appareil' },
  'settings.deleteConfirm': {
    es: 'Se eliminará «{name}» de este dispositivo. Solo podrás restaurarla con su frase de recuperación. Tus otras wallets no se ven afectadas.',
    en: '“{name}” will be removed from this device. You can only restore it with its recovery phrase. Your other wallets are unaffected.',
    pt: '«{name}» será removida deste dispositivo. Só poderás restaurá-la com a frase de recuperação. As tuas outras wallets não são afetadas.',
    de: '„{name}“ wird von diesem Gerät entfernt. Du kannst sie nur mit ihrer Wiederherstellungsphrase wiederherstellen. Deine anderen Wallets sind nicht betroffen.',
    fr: '« {name} » sera supprimé de cet appareil. Tu ne pourras le restaurer qu’avec sa phrase de récupération. Tes autres portefeuilles ne sont pas affectés.',
  },

  // ---- send ----
  'send.title': { es: 'Enviar XLM', en: 'Send XLM', pt: 'Enviar XLM', de: 'XLM senden', fr: 'Envoyer des XLM' },
  'send.to': { es: 'Para', en: 'To', pt: 'Para', de: 'An', fr: 'À' },
  'send.dest': { es: 'Dirección de destino (G…)', en: 'Destination address (G…)', pt: 'Endereço de destino (G…)', de: 'Zieladresse (G…)', fr: 'Adresse de destination (G…)' },
  'send.validAddr': { es: '✓ Dirección válida', en: '✓ Valid address', pt: '✓ Endereço válido', de: '✓ Gültige Adresse', fr: '✓ Adresse valide' },
  'send.invalidAddr': { es: 'Dirección Stellar no válida', en: 'Invalid Stellar address', pt: 'Endereço Stellar inválido', de: 'Ungültige Stellar-Adresse', fr: 'Adresse Stellar invalide' },
  'send.available': { es: 'Disponible', en: 'Available', pt: 'Disponível', de: 'Verfügbar', fr: 'Disponible' },
  'send.memo': { es: 'Memo (opcional)', en: 'Memo (optional)', pt: 'Memo (opcional)', de: 'Memo (optional)', fr: 'Mémo (facultatif)' },
  'send.insufficient': { es: 'Saldo insuficiente', en: 'Insufficient balance', pt: 'Saldo insuficiente', de: 'Unzureichendes Guthaben', fr: 'Solde insuffisant' },

  // ---- confirm ----
  'confirm.title': { es: 'Confirmar envío', en: 'Confirm send', pt: 'Confirmar envio', de: 'Senden bestätigen', fr: 'Confirmer l’envoi' },
  'confirm.from': { es: 'Desde', en: 'From', pt: 'De', de: 'Von', fr: 'De' },
  'confirm.to': { es: 'Para', en: 'To', pt: 'Para', de: 'An', fr: 'À' },
  'confirm.amount': { es: 'Importe', en: 'Amount', pt: 'Montante', de: 'Betrag', fr: 'Montant' },
  'confirm.network': { es: 'Red', en: 'Network', pt: 'Rede', de: 'Netzwerk', fr: 'Réseau' },
  'confirm.fee': { es: 'Comisión', en: 'Fee', pt: 'Taxa', de: 'Gebühr', fr: 'Frais' },
  'confirm.memo': { es: 'Memo', en: 'Memo', pt: 'Memo', de: 'Memo', fr: 'Mémo' },
  'confirm.yourWallet': { es: 'Tu wallet', en: 'Your wallet', pt: 'A tua wallet', de: 'Deine Wallet', fr: 'Ton portefeuille' },
  'confirm.cta': { es: 'Confirmar y enviar', en: 'Confirm & send', pt: 'Confirmar e enviar', de: 'Bestätigen & senden', fr: 'Confirmer et envoyer' },

  // ---- receive ----
  'receive.title': { es: 'Recibir', en: 'Receive', pt: 'Receber', de: 'Empfangen', fr: 'Recevoir' },
  'receive.desc': {
    es: 'Escanea o comparte tu dirección para recibir XLM y cualquier activo de Stellar.',
    en: 'Scan or share your address to receive XLM and any Stellar asset.',
    pt: 'Digitaliza ou partilha o teu endereço para receber XLM e qualquer ativo Stellar.',
    de: 'Scanne oder teile deine Adresse, um XLM und jedes Stellar-Asset zu empfangen.',
    fr: 'Scanne ou partage ton adresse pour recevoir des XLM et tout actif Stellar.',
  },
  'receive.addressLabel': { es: 'Tu dirección pública (G…)', en: 'Your public address (G…)', pt: 'O teu endereço público (G…)', de: 'Deine öffentliche Adresse (G…)', fr: 'Ton adresse publique (G…)' },
  'receive.stellarAddress': { es: 'Dirección Stellar', en: 'Stellar address', pt: 'Endereço Stellar', de: 'Stellar-Adresse', fr: 'Adresse Stellar' },

  // ---- success ----
  'success.viewWallet': { es: 'Ver mi wallet', en: 'View my wallet', pt: 'Ver a minha wallet', de: 'Meine Wallet ansehen', fr: 'Voir mon portefeuille' },
  'success.viewTx': { es: 'Ver transacción en el explorador ↗', en: 'View transaction in explorer ↗', pt: 'Ver transação no explorador ↗', de: 'Transaktion im Explorer ansehen ↗', fr: 'Voir la transaction dans l’explorateur ↗' },
  'success.sent': { es: 'Enviado', en: 'Sent', pt: 'Enviado', de: 'Gesendet', fr: 'Envoyé' },
  'success.sentMsg': { es: 'Tu transacción se confirmó en la red Stellar.', en: 'Your transaction was confirmed on the Stellar network.', pt: 'A tua transação foi confirmada na rede Stellar.', de: 'Deine Transaktion wurde im Stellar-Netzwerk bestätigt.', fr: 'Ta transaction a été confirmée sur le réseau Stellar.' },
  'success.welcome': { es: '¡Bienvenido, {name}!', en: 'Welcome, {name}!', pt: 'Bem-vindo, {name}!', de: 'Willkommen, {name}!', fr: 'Bienvenue, {name} !' },
  'success.added': { es: 'Wallet «{name}» añadida', en: 'Wallet “{name}” added', pt: 'Wallet «{name}» adicionada', de: 'Wallet „{name}“ hinzugefügt', fr: 'Portefeuille « {name} » ajouté' },
  'success.protected': { es: 'Tu wallet de Stellar está protegida y guardada en este dispositivo.', en: 'Your Stellar wallet is protected and saved on this device.', pt: 'A tua wallet Stellar está protegida e guardada neste dispositivo.', de: 'Deine Stellar-Wallet ist geschützt und auf diesem Gerät gespeichert.', fr: 'Ton portefeuille Stellar est protégé et enregistré sur cet appareil.' },
  'success.user': { es: 'Usuario', en: 'User', pt: 'Utilizador', de: 'Benutzer', fr: 'Utilisateur' },
  'success.status': { es: 'Estado', en: 'Status', pt: 'Status', de: 'Status', fr: 'Statut' },
  'success.encrypted': { es: 'Cifrada en el dispositivo', en: 'Encrypted on device', pt: 'Cifrada no dispositivo', de: 'Auf dem Gerät verschlüsselt', fr: 'Chiffré sur l’appareil' },

  // ---- swap ----
  'swap.title': { es: 'Intercambiar', en: 'Swap', pt: 'Trocar', de: 'Tauschen', fr: 'Échanger' },
  'swap.pay': { es: 'Pagas', en: 'You pay', pt: 'Pagas', de: 'Du zahlst', fr: 'Tu paies' },
  'swap.receiveEst': { es: 'Recibes (estimado)', en: 'You receive (estimated)', pt: 'Recebes (estimado)', de: 'Du erhältst (geschätzt)', fr: 'Tu reçois (estimé)' },
  'swap.balance': { es: 'Saldo', en: 'Balance', pt: 'Saldo', de: 'Guthaben', fr: 'Solde' },
  'swap.note': {
    es: 'Stellar incluye una DEX nativa con path payments. El intercambio dentro de la app (con gestión de trustlines) llegará en una próxima versión; el importe mostrado es una estimación según el precio de mercado.',
    en: 'Stellar includes a native DEX with path payments. In-app swapping (with trustline management) is coming in a future version; the amount shown is an estimate based on the market price.',
    pt: 'A Stellar inclui uma DEX nativa com path payments. A troca na app (com gestão de trustlines) chegará numa próxima versão; o valor mostrado é uma estimativa pelo preço de mercado.',
    de: 'Stellar enthält eine native DEX mit Path Payments. Das Tauschen in der App (mit Trustline-Verwaltung) kommt in einer künftigen Version; der angezeigte Betrag ist eine Schätzung nach Marktpreis.',
    fr: 'Stellar inclut une DEX native avec path payments. L’échange dans l’app (avec gestion des trustlines) arrivera dans une prochaine version ; le montant affiché est une estimation au prix du marché.',
  },
  'swap.soon': { es: 'Swaps vía la DEX de Stellar — próximamente.', en: 'Swaps via the Stellar DEX — coming soon.', pt: 'Trocas via DEX da Stellar — em breve.', de: 'Swaps über die Stellar-DEX — bald verfügbar.', fr: 'Échanges via la DEX Stellar — bientôt.' },

  // ---- earn ----
  'earn.title': { es: 'Ganar', en: 'Earn', pt: 'Ganhar', de: 'Verdienen', fr: 'Gagner' },
  'earn.totalAssets': { es: 'Valor total de tus activos', en: 'Total value of your assets', pt: 'Valor total dos teus ativos', de: 'Gesamtwert deiner Assets', fr: 'Valeur totale de tes actifs' },
  'earn.network': { es: 'Red', en: 'Network', pt: 'Rede', de: 'Netzwerk', fr: 'Réseau' },
  'earn.generate': { es: 'Generar rendimiento', en: 'Generate yield', pt: 'Gerar rendimento', de: 'Rendite erzielen', fr: 'Générer du rendement' },
  'earn.lpSub': { es: 'Protocolo nativo de Stellar', en: 'Stellar native protocol', pt: 'Protocolo nativo da Stellar', de: 'Natives Stellar-Protokoll', fr: 'Protocole natif Stellar' },
  'earn.lpDesc': {
    es: 'Stellar incorpora pools de liquidez nativos y una DEX integrada. La participación en pools desde la app llegará en una próxima versión.',
    en: 'Stellar has native liquidity pools and a built-in DEX. Participating in pools from the app is coming in a future version.',
    pt: 'A Stellar tem pools de liquidez nativos e uma DEX integrada. A participação em pools pela app chegará numa próxima versão.',
    de: 'Stellar bietet native Liquiditätspools und eine integrierte DEX. Die Teilnahme an Pools über die App kommt in einer künftigen Version.',
    fr: 'Stellar dispose de pools de liquidité natifs et d’une DEX intégrée. La participation aux pools depuis l’app arrivera dans une prochaine version.',
  },
  'earn.soon': { es: 'Próximamente', en: 'Coming soon', pt: 'Em breve', de: 'Bald verfügbar', fr: 'Bientôt' },
  'earn.note': {
    es: 'Las funciones de rendimiento son informativas. Tu wallet sigue siendo 100% no custodial: las claves nunca salen del dispositivo.',
    en: 'Yield features are informational. Your wallet stays 100% non-custodial: keys never leave the device.',
    pt: 'As funções de rendimento são informativas. A tua wallet continua 100% não custodial: as chaves nunca saem do dispositivo.',
    de: 'Die Rendite-Funktionen sind informativ. Deine Wallet bleibt zu 100 % nicht-verwahrt: Schlüssel verlassen das Gerät nie.',
    fr: 'Les fonctions de rendement sont informatives. Ton portefeuille reste 100 % non dépositaire : les clés ne quittent jamais l’appareil.',
  },

  // ---- markets ----
  'markets.title': { es: 'Mercados', en: 'Markets', pt: 'Mercados', de: 'Märkte', fr: 'Marchés' },
  'markets.all': { es: 'Todos', en: 'All', pt: 'Todos', de: 'Alle', fr: 'Tous' },
  'markets.gainers': { es: 'En alza', en: 'Gainers', pt: 'Em alta', de: 'Gewinner', fr: 'En hausse' },
  'markets.losers': { es: 'En baja', en: 'Losers', pt: 'Em baixa', de: 'Verlierer', fr: 'En baisse' },
  'markets.loading': { es: 'Cargando precios…', en: 'Loading prices…', pt: 'A carregar preços…', de: 'Preise werden geladen…', fr: 'Chargement des prix…' },
  'markets.fail': { es: 'No se pudieron cargar los precios (sin conexión o límite de API).', en: 'Couldn’t load prices (offline or API limit).', pt: 'Não foi possível carregar os preços (offline ou limite da API).', de: 'Preise konnten nicht geladen werden (offline oder API-Limit).', fr: 'Impossible de charger les prix (hors ligne ou limite d’API).' },

  // ---- asset ----
  'asset.balance': { es: 'Tu saldo', en: 'Your balance', pt: 'O teu saldo', de: 'Dein Guthaben', fr: 'Ton solde' },
  'asset.marketPrice': { es: 'Precio de mercado · 24h', en: 'Market price · 24h', pt: 'Preço de mercado · 24h', de: 'Marktpreis · 24h', fr: 'Prix du marché · 24h' },
  'asset.explorer': { es: 'Ver en el explorador ↗', en: 'View in explorer ↗', pt: 'Ver no explorador ↗', de: 'Im Explorer ansehen ↗', fr: 'Voir dans l’explorateur ↗' },

  // ---- export ----
  'export.title': { es: 'Exportar wallet', en: 'Export wallet', pt: 'Exportar wallet', de: 'Wallet exportieren', fr: 'Exporter le portefeuille' },
  'export.warning': {
    es: 'Tu frase y tu clave secreta dan control total de los fondos. Nunca las compartas ni las introduzcas en sitios que no sean de confianza.',
    en: 'Your phrase and secret key give full control of the funds. Never share them or enter them on untrusted sites.',
    pt: 'A tua frase e chave secreta dão controlo total dos fundos. Nunca as partilhes nem as introduzas em sites não confiáveis.',
    de: 'Deine Phrase und dein geheimer Schlüssel geben volle Kontrolle über das Guthaben. Teile sie nie und gib sie nie auf unsicheren Seiten ein.',
    fr: 'Ta phrase et ta clé secrète donnent le contrôle total des fonds. Ne les partage jamais et ne les saisis pas sur des sites non fiables.',
  },
  'export.enterPwd': { es: 'Introduce tu contraseña para revelar tus claves.', en: 'Enter your password to reveal your keys.', pt: 'Introduz a tua palavra-passe para revelar as chaves.', de: 'Gib dein Passwort ein, um deine Schlüssel anzuzeigen.', fr: 'Saisis ton mot de passe pour révéler tes clés.' },
  'export.reveal': { es: 'Revelar claves', en: 'Reveal keys', pt: 'Revelar chaves', de: 'Schlüssel anzeigen', fr: 'Révéler les clés' },
  'export.phraseTitle': { es: 'Frase de recuperación (12 palabras)', en: 'Recovery phrase (12 words)', pt: 'Frase de recuperação (12 palavras)', de: 'Wiederherstellungsphrase (12 Wörter)', fr: 'Phrase de récupération (12 mots)' },
  'export.secretTitle': { es: 'Clave secreta (S…)', en: 'Secret key (S…)', pt: 'Chave secreta (S…)', de: 'Geheimer Schlüssel (S…)', fr: 'Clé secrète (S…)' },
  'export.noPhrase': {
    es: 'Esta wallet se importó desde una clave secreta, por lo que no tiene frase de recuperación asociada.',
    en: 'This wallet was imported from a secret key, so it has no associated recovery phrase.',
    pt: 'Esta wallet foi importada de uma chave secreta, por isso não tem frase de recuperação associada.',
    de: 'Diese Wallet wurde aus einem geheimen Schlüssel importiert und hat daher keine zugehörige Wiederherstellungsphrase.',
    fr: 'Ce portefeuille a été importé depuis une clé secrète, il n’a donc pas de phrase de récupération associée.',
  },
  'export.compat': {
    es: 'Compatible con SEP-5: puedes restaurar esta cuenta en Lobstr, Freighter, Solar y cualquier wallet de Stellar.',
    en: 'SEP-5 compatible: you can restore this account in Lobstr, Freighter, Solar and any Stellar wallet.',
    pt: 'Compatível com SEP-5: podes restaurar esta conta no Lobstr, Freighter, Solar e qualquer wallet Stellar.',
    de: 'SEP-5-kompatibel: Du kannst dieses Konto in Lobstr, Freighter, Solar und jeder Stellar-Wallet wiederherstellen.',
    fr: 'Compatible SEP-5 : tu peux restaurer ce compte dans Lobstr, Freighter, Solar et tout portefeuille Stellar.',
  },

  // ---- toasts ----
  'toast.funded': { es: '¡Cuenta financiada con 10.000 XLM de prueba!', en: 'Account funded with 10,000 test XLM!', pt: 'Conta financiada com 10.000 XLM de teste!', de: 'Konto mit 10.000 Test-XLM aufgeladen!', fr: 'Compte approvisionné avec 10 000 XLM de test !' },
  'toast.friendbotMainnet': { es: 'Friendbot solo funciona en Testnet. En Mainnet recibe XLM de otra cuenta.', en: 'Friendbot only works on Testnet. On Mainnet receive XLM from another account.', pt: 'O Friendbot só funciona na Testnet. Na Mainnet recebe XLM de outra conta.', de: 'Friendbot funktioniert nur im Testnet. Im Mainnet erhalte XLM von einem anderen Konto.', fr: 'Friendbot ne fonctionne que sur le Testnet. Sur le Mainnet, reçois des XLM d’un autre compte.' },
  'toast.network': { es: 'Red: {net}', en: 'Network: {net}', pt: 'Rede: {net}', de: 'Netzwerk: {net}', fr: 'Réseau : {net}' },
  'toast.walletActive': { es: 'Wallet activa: {name}', en: 'Active wallet: {name}', pt: 'Wallet ativa: {name}', de: 'Aktive Wallet: {name}', fr: 'Portefeuille actif : {name}' },
  'toast.walletRemoved': { es: 'Wallet eliminada.', en: 'Wallet removed.', pt: 'Wallet removida.', de: 'Wallet entfernt.', fr: 'Portefeuille supprimé.' },
  'toast.langChanged': { es: 'Idioma: {lang}', en: 'Language: {lang}', pt: 'Idioma: {lang}', de: 'Sprache: {lang}', fr: 'Langue : {lang}' },
};

export function makeT(lang: Lang) {
  return (key: string, params?: Record<string, string | number>): string => {
    const entry = T[key];
    let s = entry ? entry[lang] ?? entry.en : key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

export type TFn = ReturnType<typeof makeT>;
