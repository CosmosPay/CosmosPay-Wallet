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
  'common.done': { es: 'Listo', en: 'Done', pt: 'Concluído', de: 'Fertig', fr: 'Terminé' },
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
  // Split so the T&C part renders as a link (see Backup): prefix + <a>termsLink</a>.
  'backup.terms': {
    es: 'Entiendo que mis fondos quedan bajo mi única y exclusiva responsabilidad, y acepto los ',
    en: 'I understand my funds are my sole responsibility, and I accept the ',
    pt: 'Entendo que os meus fundos ficam sob a minha exclusiva responsabilidade e aceito os ',
    de: 'Ich verstehe, dass meine Gelder in meiner alleinigen Verantwortung liegen, und akzeptiere die ',
    fr: 'Je comprends que mes fonds relèvent de ma seule responsabilité et j’accepte les ',
  },
  'backup.termsLink': {
    es: 'Términos y Condiciones de uso',
    en: 'Terms and Conditions of use',
    pt: 'Termos e Condições de uso',
    de: 'Nutzungsbedingungen',
    fr: 'Conditions Générales d’Utilisation',
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
  'import.valid': { es: 'Frase o clave válida', en: 'Valid phrase or key', pt: 'Frase ou chave válida', de: 'Gültige Phrase oder Schlüssel', fr: 'Phrase ou clé valide' },
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
  'setup.emailLabel': { es: 'Correo electrónico', en: 'Email', pt: 'E-mail', de: 'E-Mail', fr: 'E-mail' },
  'setup.emailInvalid': { es: 'Introduce un correo válido', en: 'Enter a valid email', pt: 'Introduz um e-mail válido', de: 'Gültige E-Mail eingeben', fr: 'Saisis un e-mail valide' },
  'setup.dobLabel': { es: 'Fecha de nacimiento', en: 'Date of birth', pt: 'Data de nascimento', de: 'Geburtsdatum', fr: 'Date de naissance' },
  'setup.dobFuture': { es: 'La fecha de nacimiento no puede ser futura', en: 'The date of birth can’t be in the future', pt: 'A data de nascimento não pode ser futura', de: 'Das Geburtsdatum darf nicht in der Zukunft liegen', fr: 'La date de naissance ne peut pas être dans le futur' },
  'setup.genderLabel': { es: 'Género', en: 'Gender', pt: 'Género', de: 'Geschlecht', fr: 'Genre' },
  'setup.genderM': { es: 'Masculino', en: 'Male', pt: 'Masculino', de: 'Männlich', fr: 'Masculin' },
  'setup.genderF': { es: 'Femenino', en: 'Female', pt: 'Feminino', de: 'Weiblich', fr: 'Féminin' },
  'setup.genderX': { es: 'Prefiero no decir', en: 'Prefer not to say', pt: 'Prefiro não dizer', de: 'Keine Angabe', fr: 'Je préfère ne pas le dire' },
  'setup.tooYoung': { es: 'Debes tener al menos 13 años para usar Cosmos Pay.', en: 'You must be at least 13 years old to use Cosmos Pay.', pt: 'Tens de ter pelo menos 13 anos para usar o Cosmos Pay.', de: 'Du musst mindestens 13 Jahre alt sein, um Cosmos Pay zu nutzen.', fr: 'Tu dois avoir au moins 13 ans pour utiliser Cosmos Pay.' },
  'setup.metricsOptIn': {
    es: 'Acepto compartir métricas de uso anónimas para mejorar el producto (opcional).',
    en: 'I agree to share anonymous usage metrics to improve the product (optional).',
    pt: 'Aceito partilhar métricas de uso anónimas para melhorar o produto (opcional).',
    de: 'Ich stimme zu, anonyme Nutzungsdaten zur Produktverbesserung zu teilen (optional).',
    fr: 'J’accepte de partager des statistiques d’usage anonymes pour améliorer le produit (facultatif).',
  },
  'setup.promoOptIn': {
    es: 'Quiero recibir novedades, promociones y ofertas (opcional).',
    en: 'I’d like to receive news, promotions and offers (optional).',
    pt: 'Quero receber novidades, promoções e ofertas (opcional).',
    de: 'Ich möchte Neuigkeiten, Aktionen und Angebote erhalten (optional).',
    fr: 'Je souhaite recevoir des nouveautés, promotions et offres (facultatif).',
  },
  'setup.dataNote': {
    es: 'Tu correo y fecha de nacimiento se guardan en este dispositivo y solo se usan para vincular tu cuenta a productos de Cosmos cuando tú lo pidas.',
    en: 'Your email and date of birth are stored on this device and only used to link your account to Cosmos products when you ask.',
    pt: 'O teu e-mail e data de nascimento ficam neste dispositivo e só são usados para vincular a tua conta aos produtos Cosmos quando o pedires.',
    de: 'Deine E-Mail und dein Geburtsdatum werden auf diesem Gerät gespeichert und nur verwendet, um dein Konto auf Wunsch mit Cosmos-Produkten zu verknüpfen.',
    fr: 'Ton e-mail et ta date de naissance restent sur cet appareil et ne servent qu’à lier ton compte aux produits Cosmos à ta demande.',
  },
  'setup.consent': {
    es: 'Acepto que Cosmos use mi correo y fecha de nacimiento para vincular mi cuenta a los productos de Cosmos cuando lo solicite. No se comparten con terceros sin mi consentimiento.',
    en: 'I agree that Cosmos may use my email and date of birth to link my account to Cosmos products when I request it. Not shared with third parties without my consent.',
    pt: 'Concordo que a Cosmos use o meu e-mail e data de nascimento para vincular a minha conta aos produtos Cosmos quando o solicitar. Não partilhado com terceiros sem o meu consentimento.',
    de: 'Ich stimme zu, dass Cosmos meine E-Mail und mein Geburtsdatum verwendet, um mein Konto auf Wunsch mit Cosmos-Produkten zu verknüpfen. Keine Weitergabe an Dritte ohne meine Zustimmung.',
    fr: 'J’accepte que Cosmos utilise mon e-mail et ma date de naissance pour lier mon compte aux produits Cosmos à ma demande. Non partagé avec des tiers sans mon consentement.',
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
  // live password criteria (PasswordSetup checklist)
  'pwd.critLen': { es: 'Mínimo 8 caracteres', en: 'At least 8 characters', pt: 'Mínimo de 8 caracteres', de: 'Mindestens 8 Zeichen', fr: 'Au moins 8 caractères' },
  'pwd.critUpper': { es: 'Al menos una mayúscula (A-Z)', en: 'At least one uppercase letter (A-Z)', pt: 'Pelo menos uma maiúscula (A-Z)', de: 'Mindestens ein Großbuchstabe (A-Z)', fr: 'Au moins une majuscule (A-Z)' },
  'pwd.critDigit': { es: 'Al menos un número (0-9)', en: 'At least one number (0-9)', pt: 'Pelo menos um número (0-9)', de: 'Mindestens eine Zahl (0-9)', fr: 'Au moins un chiffre (0-9)' },
  'pwd.critLower': { es: 'Al menos una letra minúscula (a-z)', en: 'At least one lowercase letter (a-z)', pt: 'Pelo menos uma letra minúscula (a-z)', de: 'Mindestens ein Kleinbuchstabe (a-z)', fr: 'Au moins une lettre minuscule (a-z)' },
  'pwd.critMatch': { es: 'Ambas contraseñas coinciden', en: 'Both passwords match', pt: 'As palavras-passe coincidem', de: 'Beide Passwörter stimmen überein', fr: 'Les deux mots de passe correspondent' },
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
  'unlock.switchTitle': { es: 'Cambiar de wallet', en: 'Switch wallet', pt: 'Mudar de wallet', de: 'Wallet wechseln', fr: 'Changer de portefeuille' },
  'unlock.use': { es: 'Usar', en: 'Use', pt: 'Usar', de: 'Verwenden', fr: 'Utiliser' },
  'unlock.current': { es: 'Actual', en: 'Current', pt: 'Atual', de: 'Aktuell', fr: 'Actuel' },
  'unlock.removeConfirm': { es: '¿Eliminar «{name}» de este dispositivo? Asegúrate de tener su frase de recuperación.', en: 'Remove “{name}” from this device? Make sure you have its recovery phrase.', pt: 'Remover «{name}» deste dispositivo? Certifica-te de que tens a frase de recuperação.', de: '„{name}“ von diesem Gerät entfernen? Stelle sicher, dass du die Wiederherstellungsphrase hast.', fr: 'Supprimer « {name} » de cet appareil ? Assure-toi d’avoir sa phrase de récupération.' },
  'unlock.happyDay': { es: '¡Feliz día!', en: 'Happy day!', pt: 'Feliz dia!', de: 'Schönen Tag!', fr: 'Joyeuse journée !' },
  'unlock.yearsOld': { es: '¡{age} años!', en: '{age} years old!', pt: '{age} anos!', de: '{age} Jahre!', fr: '{age} ans !' },

  // ---- greeting ----
  // Each time-of-day has variants; generic "welcome back" lines mix into every pool.
  // A random one is picked per app-open (see getGreeting).
  'greet.morning': { es: 'Buenos días', en: 'Good morning', pt: 'Bom dia', de: 'Guten Morgen', fr: 'Bonjour' },
  'greet.morning.2': { es: '¡Arriba, el día es tuyo!', en: 'Rise and shine!', pt: 'Levanta, o dia é teu!', de: 'Auf geht’s, der Tag gehört dir!', fr: 'Debout, la journée est à toi !' },
  'greet.morning.3': { es: 'Un café y a brillar', en: 'Coffee first, then shine', pt: 'Um café e a brilhar', de: 'Erst Kaffee, dann glänzen', fr: 'Un café et ça brille' },
  'greet.afternoon': { es: 'Buenas tardes', en: 'Good afternoon', pt: 'Boa tarde', de: 'Guten Tag', fr: 'Bon après-midi' },
  'greet.afternoon.2': { es: 'Qué buena tarde para avanzar', en: 'A fine afternoon to make moves', pt: 'Boa tarde para avançar', de: 'Ein guter Nachmittag, um voranzukommen', fr: 'Un bel après-midi pour avancer' },
  'greet.afternoon.3': { es: 'Seguimos en órbita', en: 'Still in orbit', pt: 'Continuamos em órbita', de: 'Weiter im Orbit', fr: 'Toujours en orbite' },
  'greet.evening': { es: 'Buenas noches', en: 'Good evening', pt: 'Boa noite', de: 'Guten Abend', fr: 'Bonsoir' },
  'greet.evening.2': { es: 'Linda noche para revisar tu universo', en: 'A nice night to check your universe', pt: 'Boa noite para rever o teu universo', de: 'Ein schöner Abend für deinen Kosmos', fr: 'Belle soirée pour ton univers' },
  'greet.evening.3': { es: 'Las estrellas ya salieron', en: 'The stars are out', pt: 'As estrelas já saíram', de: 'Die Sterne sind schon da', fr: 'Les étoiles sont de sortie' },
  // Gendered "welcome back" lines: .m / .f / .x picked by the user's gender.
  'greet.back.1.m': { es: '¡Bienvenido de nuevo!', en: 'Welcome back!', pt: 'Bem-vindo de volta!', de: 'Willkommen zurück!', fr: 'Content de te revoir !' },
  'greet.back.1.f': { es: '¡Bienvenida de nuevo!', en: 'Welcome back!', pt: 'Bem-vinda de volta!', de: 'Willkommen zurück!', fr: 'Contente de te revoir !' },
  'greet.back.1.x': { es: '¡Bienvenidx de nuevo!', en: 'Welcome back!', pt: 'Bem-vinde de volta!', de: 'Willkommen zurück!', fr: 'Content·e de te revoir !' },
  'greet.back.2': { es: 'Te extrañábamos', en: 'We missed you', pt: 'Tivemos saudades tuas', de: 'Wir haben dich vermisst', fr: 'Tu nous as manqué' },
  'greet.back.3': { es: 'Qué bueno verte por aquí', en: 'Good to see you here', pt: 'Que bom ver-te por aqui', de: 'Schön, dich zu sehen', fr: 'Ravi de te voir ici' },
  'greet.back.4.m': { es: '¿Listo para despegar?', en: 'Ready for liftoff?', pt: 'Pronto para descolar?', de: 'Bereit zum Abheben?', fr: 'Prêt au décollage ?' },
  'greet.back.4.f': { es: '¿Lista para despegar?', en: 'Ready for liftoff?', pt: 'Pronta para descolar?', de: 'Bereit zum Abheben?', fr: 'Prête au décollage ?' },
  'greet.back.4.x': { es: '¿Listx para despegar?', en: 'Ready for liftoff?', pt: 'Pronte para descolar?', de: 'Bereit zum Abheben?', fr: 'Prêt·e au décollage ?' },
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
  'home.showLess': { es: 'Ver menos', en: 'Show less', pt: 'Ver menos', de: 'Weniger anzeigen', fr: 'Voir moins' },
  // extension surface toggle (popup <-> side panel), preference persists
  'surface.toSidebar': { es: 'Fijar en la barra lateral', en: 'Pin to the sidebar', pt: 'Fixar na barra lateral', de: 'An Seitenleiste anheften', fr: 'Épingler à la barre latérale' },
  'surface.toPopup': { es: 'Usar como ventana emergente', en: 'Use as popup', pt: 'Usar como janela pop-up', de: 'Als Pop-up verwenden', fr: 'Utiliser en pop-up' },
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
  'profile.settings': { es: 'Ajustes', en: 'Settings', pt: 'Definições', de: 'Einstellungen', fr: 'Réglages' },
  'profile.changePhoto': { es: 'Cambiar foto', en: 'Change photo', pt: 'Mudar foto', de: 'Foto ändern', fr: 'Changer la photo' },
  'profile.editEmail': { es: 'Cambiar correo', en: 'Change email', pt: 'Mudar e-mail', de: 'E-Mail ändern', fr: 'Changer l’e-mail' },
  'profile.emailUpdated': { es: 'Correo actualizado.', en: 'Email updated.', pt: 'E-mail atualizado.', de: 'E-Mail aktualisiert.', fr: 'E-mail mis à jour.' },
  'profile.emailNote': {
    es: 'Este correo se usa para crear y vincular tu cuenta de Cosmos Pay.',
    en: 'This email is used to create and link your Cosmos Pay account.',
    pt: 'Este e-mail é usado para criar e vincular a tua conta Cosmos Pay.',
    de: 'Diese E-Mail wird zum Erstellen und Verknüpfen deines Cosmos-Pay-Kontos verwendet.',
    fr: 'Cet e-mail sert à créer et lier ton compte Cosmos Pay.',
  },
  'profile.copyAddress': { es: 'Copiar dirección', en: 'Copy address', pt: 'Copiar endereço', de: 'Adresse kopieren', fr: 'Copier l’adresse' },
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
  // developer mode (endpoint overrides)
  'settings.devMode': { es: 'Modo desarrollador', en: 'Developer mode', pt: 'Modo de programador', de: 'Entwicklermodus', fr: 'Mode développeur' },
  'settings.devModeDesc': {
    es: 'Redirige los endpoints de la app (precios, Developer Platform, gateway de pagos) a otros servidores. Los cambios aplican al instante; vacío = valor por defecto.',
    en: 'Repoints the app’s endpoints (prices, Developer Platform, payments gateway) to other servers. Changes apply instantly; empty = default value.',
    pt: 'Redireciona os endpoints da app (preços, Developer Platform, gateway de pagamentos) para outros servidores. As alterações aplicam-se de imediato; vazio = valor padrão.',
    de: 'Leitet die Endpunkte der App (Preise, Developer Platform, Zahlungs-Gateway) auf andere Server um. Änderungen gelten sofort; leer = Standardwert.',
    fr: 'Redirige les endpoints de l’app (prix, Developer Platform, passerelle de paiements) vers d’autres serveurs. Effet immédiat ; vide = valeur par défaut.',
  },
  'settings.devReset': { es: 'Restablecer endpoints', en: 'Reset endpoints', pt: 'Repor endpoints', de: 'Endpunkte zurücksetzen', fr: 'Réinitialiser les endpoints' },
  'settings.epCoingecko': { es: 'API de precios (CoinGecko)', en: 'Prices API (CoinGecko)', pt: 'API de preços (CoinGecko)', de: 'Preis-API (CoinGecko)', fr: 'API de prix (CoinGecko)' },
  'settings.epDevPlatform': { es: 'Developer Platform', en: 'Developer Platform', pt: 'Developer Platform', de: 'Developer Platform', fr: 'Developer Platform' },
  'settings.epGateway': { es: 'Gateway de pagos (APISIX)', en: 'Payments gateway (APISIX)', pt: 'Gateway de pagamentos (APISIX)', de: 'Zahlungs-Gateway (APISIX)', fr: 'Passerelle de paiements (APISIX)' },
  'settings.epGatewayEntry': { es: 'Prefijo del gateway', en: 'Gateway entry prefix', pt: 'Prefixo do gateway', de: 'Gateway-Präfix', fr: 'Préfixe de la passerelle' },

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
  'send.title': { es: 'Enviar', en: 'Send', pt: 'Enviar', de: 'Senden', fr: 'Envoyer' },
  'send.asset': { es: 'Activo', en: 'Asset', pt: 'Ativo', de: 'Asset', fr: 'Actif' },
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
  'swap.getQuote': { es: 'Obtener cotización', en: 'Get quote', pt: 'Get quote', de: 'Get quote', fr: 'Get quote' },
  'swap.quoting': { es: 'Calculando…', en: 'Quoting…', pt: 'Quoting…', de: 'Quoting…', fr: 'Quoting…' },
  'swap.minReceived': { es: 'Mínimo a recibir', en: 'Minimum received', pt: 'Minimum received', de: 'Minimum received', fr: 'Minimum received' },
  'swap.fee': { es: 'Comisión', en: 'Fee', pt: 'Fee', de: 'Fee', fr: 'Fee' },
  'swap.feeRate': { es: 'Tasa de comisión', en: 'Fee rate', pt: 'Fee rate', de: 'Fee rate', fr: 'Fee rate' },
  'swap.sameAsset': { es: 'Elegí dos tokens distintos para intercambiar.', en: 'Pick two different tokens to swap.', pt: 'Pick two different tokens to swap.', de: 'Pick two different tokens to swap.', fr: 'Pick two different tokens to swap.' },
  'swap.insufficient': { es: 'Saldo insuficiente. Disponible: {avail} {code}.', en: 'Insufficient balance. Available: {avail} {code}.', pt: 'Insufficient balance. Available: {avail} {code}.', de: 'Insufficient balance. Available: {avail} {code}.', fr: 'Insufficient balance. Available: {avail} {code}.' },

  // ---- operation history ----
  'history.title': { es: 'Historial', en: 'Activity', pt: 'Atividade', de: 'Verlauf', fr: 'Activité' },
  'history.empty': { es: 'Sin movimientos todavía.', en: 'No activity yet.', pt: 'No activity yet.', de: 'No activity yet.', fr: 'No activity yet.' },
  'history.sent': { es: 'Enviado', en: 'Sent', pt: 'Enviado', de: 'Gesendet', fr: 'Envoyé' },
  'history.received': { es: 'Recibido', en: 'Received', pt: 'Recebido', de: 'Erhalten', fr: 'Reçu' },
  'history.swap': { es: 'Intercambio', en: 'Swap', pt: 'Troca', de: 'Tausch', fr: 'Échange' },
  'history.created': { es: 'Cuenta creada', en: 'Account created', pt: 'Account created', de: 'Account created', fr: 'Account created' },
  'history.other': { es: 'Operación', en: 'Operation', pt: 'Operação', de: 'Vorgang', fr: 'Opération' },
  'history.failed': { es: 'Fallida', en: 'Failed', pt: 'Falhou', de: 'Fehlgeschlagen', fr: 'Échoué' },
  'history.genesis': { es: 'Inicio de uso de Cosmos Pay', en: 'Started using Cosmos Pay', pt: 'Início de uso do Cosmos Pay', de: 'Start mit Cosmos Pay', fr: 'Début d’utilisation de Cosmos Pay' },

  // ---- pay links (CosmosPay) ----
  'paylink.title': { es: 'Link de pago', en: 'Pay link', pt: 'Link de pagamento', de: 'Zahlungslink', fr: 'Lien de paiement' },
  'paylink.entryDesc': { es: 'Cobrá enviando un link a un amigo', en: 'Get paid by sending a friend a link', pt: 'Get paid by sending a friend a link', de: 'Get paid by sending a friend a link', fr: 'Get paid by sending a friend a link' },
  'paylink.desc': {
    es: 'Generá un link/QR de pago de CosmosPay para que un amigo te pague. Opcional: fijá un monto y un mensaje.',
    en: 'Generate a CosmosPay pay link/QR so a friend can pay you. Optionally set an amount and a message.',
    pt: 'Generate a CosmosPay pay link/QR so a friend can pay you. Optionally set an amount and a message.',
    de: 'Generate a CosmosPay pay link/QR so a friend can pay you. Optionally set an amount and a message.',
    fr: 'Generate a CosmosPay pay link/QR so a friend can pay you. Optionally set an amount and a message.',
  },
  'paylink.amount': { es: 'Monto (opcional)', en: 'Amount (optional)', pt: 'Amount (optional)', de: 'Amount (optional)', fr: 'Amount (optional)' },
  'paylink.msgPlaceholder': { es: 'Mensaje (opcional)', en: 'Message (optional)', pt: 'Message (optional)', de: 'Message (optional)', fr: 'Message (optional)' },
  'paylink.cta': { es: 'Generar link', en: 'Generate link', pt: 'Generate link', de: 'Generate link', fr: 'Generate link' },
  'paylink.anyAmount': { es: 'Cualquier monto', en: 'Any amount', pt: 'Any amount', de: 'Any amount', fr: 'Any amount' },
  'paylink.share': { es: 'Compartir link', en: 'Share link', pt: 'Share link', de: 'Share link', fr: 'Share link' },
  'paylink.another': { es: 'Otro', en: 'New', pt: 'New', de: 'New', fr: 'New' },
  'paylink.error': { es: 'No se pudo crear el link de pago.', en: 'Couldn’t create the pay link.', pt: 'Couldn’t create the pay link.', de: 'Couldn’t create the pay link.', fr: 'Couldn’t create the pay link.' },

  // ---- fiat (BlindPay on/off-ramp) ----
  'fiat.title': { es: 'Fiat', en: 'Fiat', pt: 'Fiat', de: 'Fiat', fr: 'Fiat' },
  'fiat.tab': { es: 'Cuenta fiat', en: 'Fiat account', pt: 'Conta fiat', de: 'Fiat-Konto', fr: 'Compte fiat' },
  'fiat.adultOnly': {
    es: 'El acceso a depósitos y retiros fiat requiere ser mayor de 18 años.',
    en: 'Access to fiat deposits and withdrawals requires being over 18.',
    pt: 'O acesso a depósitos e levantamentos fiat requer ter mais de 18 anos.',
    de: 'Der Zugang zu Fiat-Ein- und Auszahlungen erfordert ein Mindestalter von 18 Jahren.',
    fr: 'L’accès aux dépôts et retraits fiat nécessite d’avoir plus de 18 ans.',
  },
  'fiat.entryDesc': { es: 'Depositá y retirá en tu moneda local', en: 'Deposit & withdraw in your local currency', pt: 'Deposit & withdraw in your local currency', de: 'Deposit & withdraw in your local currency', fr: 'Deposit & withdraw in your local currency' },
  'fiat.createDesc': {
    es: 'Para operar con fiat (depositar/retirar) necesitás una cuenta de cobro (KYC) de BlindPay. Creala una vez y queda como predeterminada.',
    en: 'To use fiat (deposit/withdraw) you need a BlindPay receiver (KYC) account. Create it once and it becomes your default.',
    pt: 'To use fiat (deposit/withdraw) you need a BlindPay receiver (KYC) account. Create it once and it becomes your default.',
    de: 'To use fiat (deposit/withdraw) you need a BlindPay receiver (KYC) account. Create it once and it becomes your default.',
    fr: 'To use fiat (deposit/withdraw) you need a BlindPay receiver (KYC) account. Create it once and it becomes your default.',
  },
  'fiat.firstName': { es: 'Nombre', en: 'First name', pt: 'Nome', de: 'Vorname', fr: 'Prénom' },
  'fiat.lastName': { es: 'Apellido', en: 'Last name', pt: 'Sobrenome', de: 'Nachname', fr: 'Nom' },
  'fiat.email': { es: 'Correo', en: 'Email', pt: 'E-mail', de: 'E-Mail', fr: 'E-mail' },
  'fiat.country': { es: 'País', en: 'Country', pt: 'País', de: 'Land', fr: 'Pays' },
  'fiat.taxId': { es: 'Identificación fiscal', en: 'Tax ID', pt: 'CPF / Tax ID', de: 'Steuer-ID', fr: 'Identifiant fiscal' },
  'fiat.taxIdPlaceholder': { es: 'CPF, CUIT, NIT…', en: 'CPF, SSN, NIT…', pt: 'CPF, SSN, NIT…', de: 'CPF, SSN, NIT…', fr: 'CPF, SSN, NIT…' },
  'fiat.dob': { es: 'Fecha de nacimiento', en: 'Date of birth', pt: 'Data de nascimento', de: 'Geburtsdatum', fr: 'Date de naissance' },
  'fiat.address': { es: 'Dirección', en: 'Address', pt: 'Endereço', de: 'Adresse', fr: 'Adresse' },
  'fiat.city': { es: 'Ciudad', en: 'City', pt: 'Cidade', de: 'Stadt', fr: 'Ville' },
  'fiat.region': { es: 'Provincia', en: 'State', pt: 'Estado', de: 'Region', fr: 'Région' },
  'fiat.postal': { es: 'CP', en: 'ZIP', pt: 'CEP', de: 'PLZ', fr: 'CP' },
  'fiat.create': { es: 'Crear cuenta fiat', en: 'Create fiat account', pt: 'Create fiat account', de: 'Create fiat account', fr: 'Create fiat account' },
  'fiat.kycNote': {
    es: 'Tus datos se envían a BlindPay para verificación (KYC). La verificación puede tardar; verás el estado acá.',
    en: 'Your data is sent to BlindPay for verification (KYC). It may take a while; you’ll see the status here.',
    pt: 'Your data is sent to BlindPay for verification (KYC). It may take a while; you’ll see the status here.',
    de: 'Your data is sent to BlindPay for verification (KYC). It may take a while; you’ll see the status here.',
    fr: 'Your data is sent to BlindPay for verification (KYC). It may take a while; you’ll see the status here.',
  },
  'fiat.receiverCreated': { es: 'Cuenta fiat creada — verificación en curso.', en: 'Fiat account created — verification in progress.', pt: 'Fiat account created — verification in progress.', de: 'Fiat account created — verification in progress.', fr: 'Fiat account created — verification in progress.' },
  'fiat.receiverUnlinked': { es: 'Receiver desvinculado.', en: 'Receiver unlinked.', pt: 'Receiver unlinked.', de: 'Receiver unlinked.', fr: 'Receiver unlinked.' },
  'fiat.error': { es: 'No se pudo crear la cuenta fiat.', en: 'Couldn’t create the fiat account.', pt: 'Couldn’t create the fiat account.', de: 'Couldn’t create the fiat account.', fr: 'Couldn’t create the fiat account.' },
  'fiat.account': { es: 'Cuenta fiat (receiver)', en: 'Fiat account (receiver)', pt: 'Fiat account (receiver)', de: 'Fiat account (receiver)', fr: 'Fiat account (receiver)' },
  'fiat.statusPending': { es: 'Pendiente', en: 'Pending', pt: 'Pendente', de: 'Ausstehend', fr: 'En attente' },
  'fiat.statusApproved': { es: 'Aprobado', en: 'Approved', pt: 'Aprovado', de: 'Genehmigt', fr: 'Approuvé' },
  'fiat.statusRejected': { es: 'Rechazado', en: 'Rejected', pt: 'Rejeitado', de: 'Abgelehnt', fr: 'Rejeté' },
  'fiat.accounts': { es: 'Cuentas de depósito', en: 'Deposit accounts', pt: 'Contas de depósito', de: 'Einzahlungskonten', fr: 'Comptes de dépôt' },
  'fiat.addAccount': { es: 'Agregar cuenta', en: 'Add account', pt: 'Adicionar conta', de: 'Konto hinzufügen', fr: 'Ajouter un compte' },
  'fiat.noAccounts': { es: 'Sin cuentas de depósito todavía.', en: 'No deposit accounts yet.', pt: 'No deposit accounts yet.', de: 'No deposit accounts yet.', fr: 'No deposit accounts yet.' },
  'fiat.accountAdded': { es: 'Cuenta agregada.', en: 'Account added.', pt: 'Account added.', de: 'Account added.', fr: 'Account added.' },
  'fiat.accountDeleted': { es: 'Cuenta eliminada.', en: 'Account deleted.', pt: 'Account deleted.', de: 'Account deleted.', fr: 'Account deleted.' },
  'fiat.deleteAccount': { es: 'Eliminar cuenta', en: 'Delete account', pt: 'Delete account', de: 'Delete account', fr: 'Delete account' },
  'fiat.accountDesc': { es: 'Agregá una cuenta para recibir o depositar en tu moneda local (PIX, SPEI, CBU, etc.).', en: 'Add an account to receive or deposit in your local currency (PIX, SPEI, CBU, etc.).', pt: 'Add an account to receive or deposit in your local currency (PIX, SPEI, CBU, etc.).', de: 'Add an account to receive or deposit in your local currency (PIX, SPEI, CBU, etc.).', fr: 'Add an account to receive or deposit in your local currency (PIX, SPEI, CBU, etc.).' },
  'fiat.currency': { es: 'Moneda / método', en: 'Currency / method', pt: 'Moeda / método', de: 'Währung / Methode', fr: 'Devise / méthode' },
  'fiat.accountName': { es: 'Nombre de la cuenta', en: 'Account name', pt: 'Nome da conta', de: 'Kontoname', fr: 'Nom du compte' },
  'fiat.accountNamePlaceholder': { es: 'Ej. Mi cuenta BRL', en: 'e.g. My BRL account', pt: 'e.g. My BRL account', de: 'e.g. My BRL account', fr: 'e.g. My BRL account' },
  'fiat.onramp': { es: 'Depositar (fiat → cripto)', en: 'Deposit (fiat → crypto)', pt: 'Deposit (fiat → crypto)', de: 'Deposit (fiat → crypto)', fr: 'Deposit (fiat → crypto)' },
  'fiat.onrampDesc': { es: 'Cargá saldo desde tu banco / PIX / PSE', en: 'Top up from your bank / PIX / PSE', pt: 'Top up from your bank / PIX / PSE', de: 'Top up from your bank / PIX / PSE', fr: 'Top up from your bank / PIX / PSE' },
  'fiat.offramp': { es: 'Retirar (cripto → fiat)', en: 'Withdraw (crypto → fiat)', pt: 'Withdraw (crypto → fiat)', de: 'Withdraw (crypto → fiat)', fr: 'Withdraw (crypto → fiat)' },
  'fiat.offrampDesc': { es: 'Enviá a tu cuenta bancaria', en: 'Send to your bank account', pt: 'Send to your bank account', de: 'Send to your bank account', fr: 'Send to your bank account' },
  'fiat.soon': { es: 'Depósito/retiro: lo conectamos en el próximo paso.', en: 'Deposit/withdraw: wiring this up next.', pt: 'Deposit/withdraw: wiring this up next.', de: 'Deposit/withdraw: wiring this up next.', fr: 'Deposit/withdraw: wiring this up next.' },
  'fiat.needApproved': { es: 'Necesitás el KYC aprobado para depositar o retirar.', en: 'You need approved KYC to deposit or withdraw.', pt: 'You need approved KYC to deposit or withdraw.', de: 'You need approved KYC to deposit or withdraw.', fr: 'You need approved KYC to deposit or withdraw.' },
  'fiat.depositTitle': { es: 'Depositar', en: 'Deposit', pt: 'Depositar', de: 'Einzahlen', fr: 'Déposer' },
  'fiat.withdrawTitle': { es: 'Retirar', en: 'Withdraw', pt: 'Sacar', de: 'Abheben', fr: 'Retirer' },
  'fiat.depositDesc': { es: 'Cargá fiat (PIX, SPEI, etc.) y recibí stablecoin en tu wallet.', en: 'Pay fiat (PIX, SPEI, etc.) and receive stablecoin in your wallet.', pt: 'Pay fiat (PIX, SPEI, etc.) and receive stablecoin in your wallet.', de: 'Pay fiat (PIX, SPEI, etc.) and receive stablecoin in your wallet.', fr: 'Pay fiat (PIX, SPEI, etc.) and receive stablecoin in your wallet.' },
  'fiat.withdrawDesc': { es: 'Enviá stablecoin y recibí fiat en tu cuenta bancaria.', en: 'Send stablecoin and receive fiat in your bank account.', pt: 'Send stablecoin and receive fiat in your bank account.', de: 'Send stablecoin and receive fiat in your bank account.', fr: 'Send stablecoin and receive fiat in your bank account.' },
  'fiat.method': { es: 'Método de pago', en: 'Payment method', pt: 'Método de pagamento', de: 'Zahlungsmethode', fr: 'Méthode de paiement' },
  'fiat.token': { es: 'Token', en: 'Token', pt: 'Token', de: 'Token', fr: 'Token' },
  'fiat.payAmount': { es: 'Monto a pagar (moneda local)', en: 'Amount to pay (local currency)', pt: 'Amount to pay (local currency)', de: 'Amount to pay (local currency)', fr: 'Amount to pay (local currency)' },
  'fiat.sendAmount': { es: 'Monto a enviar', en: 'Amount to send', pt: 'Amount to send', de: 'Amount to send', fr: 'Amount to send' },
  'fiat.bankAccount': { es: 'Cuenta de destino', en: 'Destination account', pt: 'Destination account', de: 'Destination account', fr: 'Destination account' },
  'fiat.balance': { es: 'Saldo', en: 'Balance', pt: 'Saldo', de: 'Guthaben', fr: 'Solde' },
  'fiat.coverFees': { es: 'Cubrir las comisiones', en: 'Cover the fees', pt: 'Cover the fees', de: 'Cover the fees', fr: 'Cover the fees' },
  'fiat.getQuote': { es: 'Cotizar', en: 'Get quote', pt: 'Cotar', de: 'Angebot', fr: 'Devis' },
  'fiat.editQuote': { es: 'Editar', en: 'Edit', pt: 'Editar', de: 'Bearbeiten', fr: 'Modifier' },
  'fiat.youPay': { es: 'Pagás', en: 'You pay', pt: 'You pay', de: 'You pay', fr: 'You pay' },
  'fiat.youReceive': { es: 'Recibís', en: 'You receive', pt: 'You receive', de: 'You receive', fr: 'You receive' },
  'fiat.youSend': { es: 'Enviás', en: 'You send', pt: 'You send', de: 'You send', fr: 'You send' },
  'fiat.confirmDeposit': { es: 'Confirmar depósito', en: 'Confirm deposit', pt: 'Confirm deposit', de: 'Confirm deposit', fr: 'Confirm deposit' },
  'fiat.confirmWithdraw': { es: 'Confirmar retiro', en: 'Confirm withdrawal', pt: 'Confirm withdrawal', de: 'Confirm withdrawal', fr: 'Confirm withdrawal' },
  'fiat.quoteNote': { es: 'La cotización vence en ~5 min. Confirmá pronto.', en: 'The quote expires in ~5 min. Confirm soon.', pt: 'The quote expires in ~5 min. Confirm soon.', de: 'The quote expires in ~5 min. Confirm soon.', fr: 'The quote expires in ~5 min. Confirm soon.' },
  'fiat.withdrawSignNote': { es: 'Vas a firmar la transacción en tu dispositivo para enviar el stablecoin.', en: 'You’ll sign the transaction on your device to send the stablecoin.', pt: 'You’ll sign the transaction on your device to send the stablecoin.', de: 'You’ll sign the transaction on your device to send the stablecoin.', fr: 'You’ll sign the transaction on your device to send the stablecoin.' },
  'fiat.noTrustedToken': { es: 'Para depositar necesitás confiar primero en un stablecoin (USDC/USDT) en tu wallet.', en: 'To deposit you first need a stablecoin (USDC/USDT) trustline in your wallet.', pt: 'To deposit you first need a stablecoin (USDC/USDT) trustline in your wallet.', de: 'To deposit you first need a stablecoin (USDC/USDT) trustline in your wallet.', fr: 'To deposit you first need a stablecoin (USDC/USDT) trustline in your wallet.' },
  'fiat.addTrustline': { es: 'Agregar activo', en: 'Add asset', pt: 'Add asset', de: 'Add asset', fr: 'Add asset' },
  'fiat.needBankAccount': { es: 'Agregá una cuenta bancaria de destino antes de retirar.', en: 'Add a destination bank account before withdrawing.', pt: 'Add a destination bank account before withdrawing.', de: 'Add a destination bank account before withdrawing.', fr: 'Add a destination bank account before withdrawing.' },
  'fiat.noTokenBalance': { es: 'No tenés saldo de stablecoin (USDC/USDT) para retirar.', en: 'You have no stablecoin (USDC/USDT) balance to withdraw.', pt: 'You have no stablecoin (USDC/USDT) balance to withdraw.', de: 'You have no stablecoin (USDC/USDT) balance to withdraw.', fr: 'You have no stablecoin (USDC/USDT) balance to withdraw.' },
  'fiat.depositCreated': { es: 'Depósito creado. Seguí las instrucciones de pago.', en: 'Deposit created. Follow the payment instructions.', pt: 'Deposit created. Follow the payment instructions.', de: 'Deposit created. Follow the payment instructions.', fr: 'Deposit created. Follow the payment instructions.' },
  'fiat.depositInstructions': { es: 'Instrucciones de pago', en: 'Payment instructions', pt: 'Payment instructions', de: 'Payment instructions', fr: 'Payment instructions' },
  'fiat.depositInstructionsDesc': { es: 'Pagá con estos datos. Al acreditarse, recibís el stablecoin.', en: 'Pay with these details. Once received, you get the stablecoin.', pt: 'Pay with these details. Once received, you get the stablecoin.', de: 'Pay with these details. Once received, you get the stablecoin.', fr: 'Pay with these details. Once received, you get the stablecoin.' },
  'fiat.status': { es: 'Estado', en: 'Status', pt: 'Estado', de: 'Status', fr: 'Statut' },
  'fiat.insPending': { es: 'Instrucciones en preparación. Revisá el estado en un momento.', en: 'Instructions are being prepared. Check the status shortly.', pt: 'Instructions are being prepared. Check the status shortly.', de: 'Instructions are being prepared. Check the status shortly.', fr: 'Instructions are being prepared. Check the status shortly.' },
  'fiat.copy': { es: 'Copiar', en: 'Copy', pt: 'Copiar', de: 'Kopieren', fr: 'Copier' },
  'fiat.copied': { es: 'Copiado', en: 'Copied', pt: 'Copiado', de: 'Kopiert', fr: 'Copié' },
  'fiat.ins.pixCode': { es: 'Código PIX', en: 'PIX code', pt: 'PIX code', de: 'PIX code', fr: 'PIX code' },
  'fiat.ins.clabe': { es: 'CLABE', en: 'CLABE', pt: 'CLABE', de: 'CLABE', fr: 'CLABE' },
  'fiat.ins.cbu': { es: 'CBU', en: 'CBU', pt: 'CBU', de: 'CBU', fr: 'CBU' },
  'fiat.ins.memoCode': { es: 'Código de memo', en: 'Memo code', pt: 'Memo code', de: 'Memo code', fr: 'Memo code' },
  'fiat.ins.pseLink': { es: 'Link de pago PSE', en: 'PSE payment link', pt: 'PSE payment link', de: 'PSE payment link', fr: 'PSE payment link' },
  'fiat.ins.bankDetails': { es: 'Datos bancarios', en: 'Bank details', pt: 'Bank details', de: 'Bank details', fr: 'Bank details' },
  'fiat.withdrawSuccess': { es: 'Retiro enviado', en: 'Withdrawal sent', pt: 'Withdrawal sent', de: 'Withdrawal sent', fr: 'Withdrawal sent' },
  'fiat.withdrawSuccessMsg': { es: 'Tu pago está en proceso. Verás el fiat en tu cuenta cuando se acredite.', en: 'Your payout is processing. You’ll see the fiat in your account once settled.', pt: 'Your payout is processing. You’ll see the fiat in your account once settled.', de: 'Your payout is processing. You’ll see the fiat in your account once settled.', fr: 'Your payout is processing. You’ll see the fiat in your account once settled.' },
  'fiat.withdrawFailed': { es: 'No se pudo completar el retiro', en: 'Couldn’t complete the withdrawal', pt: 'Couldn’t complete the withdrawal', de: 'Couldn’t complete the withdrawal', fr: 'Couldn’t complete the withdrawal' },
  'fiat.noXdr': { es: 'El servidor no devolvió una transacción para firmar.', en: 'The server didn’t return a transaction to sign.', pt: 'The server didn’t return a transaction to sign.', de: 'The server didn’t return a transaction to sign.', fr: 'The server didn’t return a transaction to sign.' },
  'fiat.kycTitle': { es: 'Verificación', en: 'Verification', pt: 'Verificação', de: 'Verifizierung', fr: 'Vérification' },
  'fiat.docType': { es: 'Documento', en: 'Document', pt: 'Documento', de: 'Dokument', fr: 'Document' },
  'fiat.doc.PASSPORT': { es: 'Pasaporte', en: 'Passport', pt: 'Passaporte', de: 'Reisepass', fr: 'Passeport' },
  'fiat.doc.ID_CARD': { es: 'DNI / Cédula', en: 'ID card', pt: 'RG / Cédula', de: 'Ausweis', fr: 'Carte d’identité' },
  'fiat.doc.DRIVERS_LICENSE': { es: 'Licencia de conducir', en: 'Driver’s license', pt: 'CNH', de: 'Führerschein', fr: 'Permis' },
  'fiat.takePhoto': { es: 'Tomar / subir foto', en: 'Take / upload photo', pt: 'Take / upload photo', de: 'Take / upload photo', fr: 'Take / upload photo' },
  'fiat.docFront': { es: 'Frente del documento', en: 'Document front', pt: 'Frente do documento', de: 'Dokument Vorderseite', fr: 'Recto du document' },
  'fiat.docFrontHint': { es: 'Tomá una foto clara del frente de tu documento, sin reflejos.', en: 'Take a clear photo of the front of your ID, no glare.', pt: 'Take a clear photo of the front of your ID, no glare.', de: 'Take a clear photo of the front of your ID, no glare.', fr: 'Take a clear photo of the front of your ID, no glare.' },
  'fiat.docBack': { es: 'Dorso del documento', en: 'Document back', pt: 'Verso do documento', de: 'Dokument Rückseite', fr: 'Verso du document' },
  'fiat.docBackHint': { es: 'Ahora el dorso del mismo documento.', en: 'Now the back of the same document.', pt: 'Now the back of the same document.', de: 'Now the back of the same document.', fr: 'Now the back of the same document.' },
  'fiat.selfie': { es: 'Selfie', en: 'Selfie', pt: 'Selfie', de: 'Selfie', fr: 'Selfie' },
  'fiat.selfieHint': { es: 'Sacate una selfie con buena luz, mirando a la cámara.', en: 'Take a selfie in good light, looking at the camera.', pt: 'Take a selfie in good light, looking at the camera.', de: 'Take a selfie in good light, looking at the camera.', fr: 'Take a selfie in good light, looking at the camera.' },
  'fiat.uploadError': { es: 'No se pudo subir la foto.', en: 'Couldn’t upload the photo.', pt: 'Couldn’t upload the photo.', de: 'Couldn’t upload the photo.', fr: 'Couldn’t upload the photo.' },
  'swap.cta': { es: 'Intercambiar', en: 'Swap', pt: 'Swap', de: 'Swap', fr: 'Swap' },
  'swap.quoteError': { es: 'No se pudo obtener la cotización.', en: 'Couldn’t get a quote.', pt: 'Couldn’t get a quote.', de: 'Couldn’t get a quote.', fr: 'Couldn’t get a quote.' },
  'swap.success': { es: 'Intercambio completado', en: 'Swap completed', pt: 'Swap completed', de: 'Swap completed', fr: 'Swap completed' },
  'swap.successMsg': { es: 'Tu intercambio se procesó en la red Stellar.', en: 'Your swap was processed on the Stellar network.', pt: 'Your swap was processed on the Stellar network.', de: 'Your swap was processed on the Stellar network.', fr: 'Your swap was processed on the Stellar network.' },
  'swap.failed': { es: 'No se pudo intercambiar', en: 'Swap failed', pt: 'Swap failed', de: 'Swap failed', fr: 'Swap failed' },
  'swap.note2': {
    es: 'El intercambio se construye y se firma en tu dispositivo; CosmosPay lo envía a la red. La comisión la define el plan de tu organización.',
    en: 'The swap is built and signed on your device; CosmosPay submits it to the network. The fee is set by your organization’s plan.',
    pt: 'The swap is built and signed on your device; CosmosPay submits it to the network. The fee is set by your organization’s plan.',
    de: 'The swap is built and signed on your device; CosmosPay submits it to the network. The fee is set by your organization’s plan.',
    fr: 'The swap is built and signed on your device; CosmosPay submits it to the network. The fee is set by your organization’s plan.',
  },

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
  'toast.assetAdded': { es: 'Activo {code} añadido', en: 'Asset {code} added', pt: 'Ativo {code} adicionado', de: 'Asset {code} hinzugefügt', fr: 'Actif {code} ajouté' },

  // ---- success / error ----
  'success.failed': { es: 'No se pudo enviar', en: 'Couldn’t send', pt: 'Não foi possível enviar', de: 'Senden fehlgeschlagen', fr: 'Échec de l’envoi' },

  // ---- add asset (trustline) ----
  'addAsset.title': { es: 'Añadir activo', en: 'Add asset', pt: 'Adicionar ativo', de: 'Asset hinzufügen', fr: 'Ajouter un actif' },
  'addAsset.desc': {
    es: 'Crea una línea de confianza (trustline) para poder recibir un activo de Stellar. Indica su código e emisor.',
    en: 'Create a trustline so you can hold a Stellar asset. Enter its code and issuer.',
    pt: 'Cria uma trustline para poderes deter um ativo Stellar. Indica o código e o emissor.',
    de: 'Erstelle eine Trustline, um ein Stellar-Asset halten zu können. Gib Code und Aussteller an.',
    fr: 'Crée une trustline pour détenir un actif Stellar. Saisis son code et son émetteur.',
  },
  'addAsset.code': { es: 'Código del activo', en: 'Asset code', pt: 'Código do ativo', de: 'Asset-Code', fr: 'Code de l’actif' },
  'addAsset.issuer': { es: 'Emisor (G…)', en: 'Issuer (G…)', pt: 'Emissor (G…)', de: 'Aussteller (G…)', fr: 'Émetteur (G…)' },
  'addAsset.add': { es: 'Añadir línea de confianza', en: 'Add trustline', pt: 'Adicionar trustline', de: 'Trustline hinzufügen', fr: 'Ajouter la trustline' },
  'addAsset.suggested': { es: 'Sugeridos', en: 'Suggested', pt: 'Sugeridos', de: 'Vorschläge', fr: 'Suggérés' },
  'addAsset.common': { es: 'Activos más comunes', en: 'Most common assets', pt: 'Ativos mais comuns', de: 'Häufigste Assets', fr: 'Actifs les plus courants' },
  'addAsset.loading': { es: 'Buscando activos en la red…', en: 'Finding assets on the network…', pt: 'A procurar ativos na rede…', de: 'Assets im Netzwerk suchen…', fr: 'Recherche d’actifs sur le réseau…' },
  'addAsset.none': { es: 'No se encontraron activos comunes en esta red. Añade uno personalizado con su código y emisor.', en: 'No common assets found on this network. Add a custom one with its code and issuer.', pt: 'Nenhum ativo comum encontrado nesta rede. Adiciona um personalizado com código e emissor.', de: 'Keine gängigen Assets in diesem Netzwerk gefunden. Füge ein eigenes mit Code und Aussteller hinzu.', fr: 'Aucun actif courant trouvé sur ce réseau. Ajoute-en un personnalisé avec son code et son émetteur.' },
  'addAsset.custom': { es: 'Añadir activo personalizado', en: 'Add custom asset', pt: 'Adicionar ativo personalizado', de: 'Eigenes Asset hinzufügen', fr: 'Ajouter un actif personnalisé' },
  'addAsset.manual': { es: 'Activo personalizado', en: 'Custom asset', pt: 'Ativo personalizado', de: 'Eigenes Asset', fr: 'Actif personnalisé' },
  'addAsset.held': { es: 'Ya añadido', en: 'Already added', pt: 'Já adicionado', de: 'Bereits hinzugefügt', fr: 'Déjà ajouté' },
  'addAsset.testnetNote': { es: 'La lista de activos comunes está disponible en Mainnet. En testnet añade el activo por su código y emisor.', en: 'The common-asset list is available on Mainnet. On testnet, add assets by code and issuer.', pt: 'A lista de ativos comuns está disponível na Mainnet. Na testnet, adiciona pelo código e emissor.', de: 'Die Liste gängiger Assets ist im Mainnet verfügbar. Im Testnet per Code und Aussteller hinzufügen.', fr: 'La liste des actifs courants est disponible sur le Mainnet. Sur testnet, ajoute par code et émetteur.' },
  'addAsset.invalidIssuer': { es: 'El emisor no es una dirección Stellar válida (G…)', en: 'The issuer is not a valid Stellar address (G…)', pt: 'O emissor não é um endereço Stellar válido (G…)', de: 'Der Aussteller ist keine gültige Stellar-Adresse (G…)', fr: 'L’émetteur n’est pas une adresse Stellar valide (G…)' },

  // ---- networks ----
  'net.title': { es: 'Redes', en: 'Networks', pt: 'Redes', de: 'Netzwerke', fr: 'Réseaux' },
  'net.add': { es: 'Añadir red', en: 'Add network', pt: 'Adicionar rede', de: 'Netzwerk hinzufügen', fr: 'Ajouter un réseau' },
  'net.addTitle': { es: 'Añadir red personalizada', en: 'Add custom network', pt: 'Adicionar rede personalizada', de: 'Eigenes Netzwerk hinzufügen', fr: 'Ajouter un réseau personnalisé' },
  'net.name': { es: 'Nombre', en: 'Name', pt: 'Nome', de: 'Name', fr: 'Nom' },
  'net.horizon': { es: 'URL de Horizon', en: 'Horizon URL', pt: 'URL do Horizon', de: 'Horizon-URL', fr: 'URL Horizon' },
  'net.passphrase': { es: 'Network passphrase', en: 'Network passphrase', pt: 'Network passphrase', de: 'Network passphrase', fr: 'Network passphrase' },
  'net.save': { es: 'Guardar red', en: 'Save network', pt: 'Guardar rede', de: 'Netzwerk speichern', fr: 'Enregistrer le réseau' },
  'net.remove': { es: 'Eliminar red', en: 'Remove network', pt: 'Remover rede', de: 'Netzwerk entfernen', fr: 'Supprimer le réseau' },

  // ---- QR scanner ----
  'scan.scanQr': { es: 'Escanear QR', en: 'Scan QR', pt: 'Ler QR', de: 'QR scannen', fr: 'Scanner QR' },
  'scan.short': { es: 'Escanear', en: 'Scan', pt: 'Ler', de: 'Scannen', fr: 'Scanner' },
  'scan.title': { es: 'Escanea un código QR', en: 'Scan a QR code', pt: 'Lê um código QR', de: 'QR-Code scannen', fr: 'Scanne un code QR' },
  'scan.point': { es: 'Apunta la cámara al QR de una dirección Stellar.', en: 'Point the camera at a Stellar address QR.', pt: 'Aponta a câmara ao QR de um endereço Stellar.', de: 'Richte die Kamera auf einen Stellar-Adressen-QR.', fr: 'Pointe la caméra vers un QR d’adresse Stellar.' },
  'scan.denied': { es: 'No se pudo acceder a la cámara. Revisa los permisos.', en: 'Couldn’t access the camera. Check permissions.', pt: 'Não foi possível aceder à câmara. Verifica as permissões.', de: 'Kamerazugriff fehlgeschlagen. Berechtigungen prüfen.', fr: 'Accès à la caméra impossible. Vérifie les autorisations.' },
  'scan.retry': { es: 'Permitir cámara y reintentar', en: 'Allow camera & retry', pt: 'Permitir câmara e tentar de novo', de: 'Kamera erlauben & erneut versuchen', fr: 'Autoriser la caméra et réessayer' },
  'scan.upload': { es: 'Subir una imagen del QR', en: 'Upload a QR image', pt: 'Carregar uma imagem do QR', de: 'QR-Bild hochladen', fr: 'Importer une image du QR' },
  'scan.noQr': { es: 'No se encontró un código QR válido en la imagen.', en: 'No valid QR code found in the image.', pt: 'Nenhum código QR válido encontrado na imagem.', de: 'Kein gültiger QR-Code im Bild gefunden.', fr: 'Aucun code QR valide trouvé dans l’image.' },
  'scan.grant': { es: 'Conceder permiso de cámara', en: 'Grant camera permission', pt: 'Conceder permissão de câmara', de: 'Kameraberechtigung erteilen', fr: 'Accorder l’accès à la caméra' },
  'scan.paste': { es: 'Pegar imagen del portapapeles', en: 'Paste image from clipboard', pt: 'Colar imagem da área de transferência', de: 'Bild aus Zwischenablage einfügen', fr: 'Coller une image du presse-papiers' },
  'scan.noClipImg': { es: 'No hay ninguna imagen en el portapapeles.', en: 'There is no image in the clipboard.', pt: 'Não há nenhuma imagem na área de transferência.', de: 'Kein Bild in der Zwischenablage.', fr: 'Aucune image dans le presse-papiers.' },
  'scan.device': { es: 'Cámara', en: 'Camera', pt: 'Câmara', de: 'Kamera', fr: 'Caméra' },

  // ---- operations hub ----
  'ops.title': { es: 'Operaciones', en: 'Operations', pt: 'Operações', de: 'Operationen', fr: 'Opérations' },
  'ops.desc': { es: 'Herramientas avanzadas para tu cuenta Stellar.', en: 'Advanced tools for your Stellar account.', pt: 'Ferramentas avançadas para a tua conta Stellar.', de: 'Erweiterte Tools für dein Stellar-Konto.', fr: 'Outils avancés pour ton compte Stellar.' },
  'ops.signTx': { es: 'Firmar transacción', en: 'Sign transaction', pt: 'Assinar transação', de: 'Transaktion signieren', fr: 'Signer une transaction' },
  'ops.signTxSub': { es: 'Pega un XDR para firmarlo o enviarlo', en: 'Paste an XDR to sign or submit it', pt: 'Cola um XDR para assinar ou enviar', de: 'XDR zum Signieren oder Senden einfügen', fr: 'Colle un XDR pour le signer ou l’envoyer' },
  'ops.pastePay': { es: 'Pegar URL de pago', en: 'Paste payment URL', pt: 'Colar URL de pagamento', de: 'Zahlungs-URL einfügen', fr: 'Coller l’URL de paiement' },
  'ops.pastePaySub': { es: 'Enlace SEP-7 (web+stellar:pay…)', en: 'SEP-7 link (web+stellar:pay…)', pt: 'Ligação SEP-7 (web+stellar:pay…)', de: 'SEP-7-Link (web+stellar:pay…)', fr: 'Lien SEP-7 (web+stellar:pay…)' },
  'ops.pasteInvalid': { es: 'El portapapeles no contiene una dirección o enlace SEP-7 válido.', en: 'The clipboard has no valid Stellar address or SEP-7 link.', pt: 'A área de transferência não tem um endereço ou ligação SEP-7 válidos.', de: 'Die Zwischenablage enthält keine gültige Stellar-Adresse oder SEP-7-Link.', fr: 'Le presse-papiers ne contient pas d’adresse Stellar ou de lien SEP-7 valide.' },

  // ---- sign transaction ----
  'sign.title': { es: 'Firmar transacción', en: 'Sign transaction', pt: 'Assinar transação', de: 'Transaktion signieren', fr: 'Signer une transaction' },
  'sign.desc': { es: 'Pega el XDR de una transacción para revisarla, firmarla con esta wallet y opcionalmente enviarla a la red.', en: 'Paste a transaction XDR to review it, sign it with this wallet, and optionally submit it.', pt: 'Cola o XDR de uma transação para a rever, assinar com esta wallet e, opcionalmente, enviar.', de: 'Füge das XDR einer Transaktion ein, um sie zu prüfen, mit dieser Wallet zu signieren und optional zu senden.', fr: 'Colle le XDR d’une transaction pour la vérifier, la signer avec ce portefeuille et l’envoyer si besoin.' },
  'sign.paste': { es: 'Pegar XDR', en: 'Paste XDR', pt: 'Colar XDR', de: 'XDR einfügen', fr: 'Coller le XDR' },
  'sign.invalid': { es: 'XDR no válido para esta red.', en: 'Invalid XDR for this network.', pt: 'XDR inválido para esta rede.', de: 'Ungültiges XDR für dieses Netzwerk.', fr: 'XDR non valide pour ce réseau.' },
  'sign.source': { es: 'Origen', en: 'Source', pt: 'Origem', de: 'Quelle', fr: 'Source' },
  'sign.fee': { es: 'Comisión', en: 'Fee', pt: 'Taxa', de: 'Gebühr', fr: 'Frais' },
  'sign.ops': { es: 'Operaciones', en: 'Operations', pt: 'Operações', de: 'Operationen', fr: 'Opérations' },
  'sign.memo': { es: 'Memo', en: 'Memo', pt: 'Memo', de: 'Memo', fr: 'Mémo' },
  'sign.signatures': { es: 'Firmas', en: 'Signatures', pt: 'Assinaturas', de: 'Signaturen', fr: 'Signatures' },
  'sign.sign': { es: 'Firmar', en: 'Sign', pt: 'Assinar', de: 'Signieren', fr: 'Signer' },
  'sign.signedLabel': { es: 'XDR firmado', en: 'Signed XDR', pt: 'XDR assinado', de: 'Signiertes XDR', fr: 'XDR signé' },
  'sign.submit': { es: 'Enviar a la red', en: 'Submit to network', pt: 'Enviar para a rede', de: 'An Netzwerk senden', fr: 'Envoyer au réseau' },
  'sign.submitted': { es: 'Transacción enviada', en: 'Transaction submitted', pt: 'Transação enviada', de: 'Transaktion gesendet', fr: 'Transaction envoyée' },

  // ---- signing confirmation (password gate) ----
  'confirmSig.sign': { es: 'Firmar', en: 'Sign', pt: 'Assinar', de: 'Signieren', fr: 'Signer' },
  'confirmSig.wrongPwd': { es: 'Contraseña incorrecta.', en: 'Wrong password.', pt: 'Palavra-passe incorreta.', de: 'Falsches Passwort.', fr: 'Mot de passe incorrect.' },
  'confirmSig.sendTitle': { es: 'Confirmar envío', en: 'Confirm payment', pt: 'Confirmar envio', de: 'Zahlung bestätigen', fr: 'Confirmer le paiement' },
  'confirmSig.sendMsg': { es: 'Introduce tu contraseña para firmar el envío de {amount} {code}.', en: 'Enter your password to sign sending {amount} {code}.', pt: 'Introduz a tua palavra-passe para assinar o envio de {amount} {code}.', de: 'Gib dein Passwort ein, um das Senden von {amount} {code} zu signieren.', fr: 'Saisis ton mot de passe pour signer l’envoi de {amount} {code}.' },
  'confirmSig.trustTitle': { es: 'Confirmar trustline', en: 'Confirm trustline', pt: 'Confirmar trustline', de: 'Trustline bestätigen', fr: 'Confirmer la trustline' },
  'confirmSig.trustMsg': { es: 'Introduce tu contraseña para firmar la línea de confianza de {code}.', en: 'Enter your password to sign the {code} trustline.', pt: 'Introduz a tua palavra-passe para assinar a trustline de {code}.', de: 'Gib dein Passwort ein, um die {code}-Trustline zu signieren.', fr: 'Saisis ton mot de passe pour signer la trustline {code}.' },
  'confirmSig.signTitle': { es: 'Firmar transacción', en: 'Sign transaction', pt: 'Assinar transação', de: 'Transaktion signieren', fr: 'Signer la transaction' },
  'confirmSig.signMsg': { es: 'Introduce tu contraseña para firmar esta transacción.', en: 'Enter your password to sign this transaction.', pt: 'Introduz a tua palavra-passe para assinar esta transação.', de: 'Gib dein Passwort ein, um diese Transaktion zu signieren.', fr: 'Saisis ton mot de passe pour signer cette transaction.' },
  'confirmSig.submitTitle': { es: 'Enviar a la red', en: 'Submit to network', pt: 'Enviar para a rede', de: 'An Netzwerk senden', fr: 'Envoyer au réseau' },
  'confirmSig.submitMsg': { es: 'Introduce tu contraseña para enviar esta transacción a la red.', en: 'Enter your password to submit this transaction to the network.', pt: 'Introduz a tua palavra-passe para enviar esta transação para a rede.', de: 'Gib dein Passwort ein, um diese Transaktion an das Netzwerk zu senden.', fr: 'Saisis ton mot de passe pour envoyer cette transaction au réseau.' },

  'confirmSig.settingTitle': { es: 'Cambiar confirmaciones', en: 'Change confirmations', pt: 'Alterar confirmações', de: 'Bestätigungen ändern', fr: 'Modifier les confirmations' },
  'confirmSig.settingMsg': { es: 'Introduce tu contraseña para cambiar las confirmaciones manuales.', en: 'Enter your password to change manual confirmations.', pt: 'Introduz a tua palavra-passe para alterar as confirmações manuais.', de: 'Gib dein Passwort ein, um die manuellen Bestätigungen zu ändern.', fr: 'Saisis ton mot de passe pour modifier les confirmations manuelles.' },
  'confirmSig.swapTitle': { es: 'Confirmar intercambio', en: 'Confirm swap', pt: 'Confirm swap', de: 'Confirm swap', fr: 'Confirm swap' },
  'confirmSig.swapMsg': { es: 'Introduce tu contraseña para firmar el intercambio a {code}.', en: 'Enter your password to sign the swap to {code}.', pt: 'Enter your password to sign the swap to {code}.', de: 'Enter your password to sign the swap to {code}.', fr: 'Enter your password to sign the swap to {code}.' },
  'confirmSig.withdrawTitle': { es: 'Confirmar retiro', en: 'Confirm withdrawal', pt: 'Confirm withdrawal', de: 'Confirm withdrawal', fr: 'Confirm withdrawal' },
  'confirmSig.withdrawMsg': { es: 'Introduce tu contraseña para firmar el retiro a tu cuenta bancaria.', en: 'Enter your password to sign the withdrawal to your bank account.', pt: 'Enter your password to sign the withdrawal to your bank account.', de: 'Enter your password to sign the withdrawal to your bank account.', fr: 'Enter your password to sign the withdrawal to your bank account.' },

  // ---- CosmosPay (enable receiving payments) ----
  'cosmospay.cardTitle': { es: 'Conectá Cosmos Pay', en: 'Connect Cosmos Pay', pt: 'Conectar Cosmos Pay', de: 'Cosmos Pay verbinden', fr: 'Connecter Cosmos Pay' },
  'cosmospay.cardDesc': {
    es: 'Conecta tu wallet a Cosmos Pay para cobrar, intercambiar a tasa preferencial y usar onramp/offramp. Firmas con tu clave de Stellar y confirmas por correo — sin contraseñas en la app.',
    en: 'Connect your wallet to Cosmos Pay to receive payments, swap at a preferential rate and use on/off-ramp. You sign with your Stellar key and confirm by email — no secrets stored in the app.',
    pt: 'Connect your wallet to Cosmos Pay to receive payments, swap at a preferential rate and use on/off-ramp. You sign with your Stellar key and confirm by email — no secrets stored in the app.',
    de: 'Connect your wallet to Cosmos Pay to receive payments, swap at a preferential rate and use on/off-ramp. You sign with your Stellar key and confirm by email — no secrets stored in the app.',
    fr: 'Connect your wallet to Cosmos Pay to receive payments, swap at a preferential rate and use on/off-ramp. You sign with your Stellar key and confirm by email — no secrets stored in the app.',
  },
  'cosmospay.cta': { es: 'Conectar', en: 'Connect', pt: 'Conectar', de: 'Verbinden', fr: 'Connecter' },
  'cosmospay.manage': { es: 'Cosmos Pay', en: 'Cosmos Pay', pt: 'Cosmos Pay', de: 'Cosmos Pay', fr: 'Cosmos Pay' },
  'cosmospay.integrationDesc': {
    es: 'Integración de Cosmos Pay para procesar swaps y pagos (BlindPay). Vinculá o desvinculá tus claves de API y tu cuenta de cobro fiat.',
    en: 'Cosmos Pay integration to process swaps and payments (BlindPay). Link or unlink your API keys and your fiat receiver.',
    pt: 'Cosmos Pay integration to process swaps and payments (BlindPay). Link or unlink your API keys and your fiat receiver.',
    de: 'Cosmos Pay integration to process swaps and payments (BlindPay). Link or unlink your API keys and your fiat receiver.',
    fr: 'Cosmos Pay integration to process swaps and payments (BlindPay). Link or unlink your API keys and your fiat receiver.',
  },
  'cosmospay.apiKeys': { es: 'Claves de API', en: 'API keys', pt: 'Chaves de API', de: 'API-Schlüssel', fr: 'Clés API' },
  'cosmospay.status': { es: 'Estado', en: 'Status', pt: 'Estado', de: 'Status', fr: 'Statut' },
  'cosmospay.connected': { es: 'Conectado', en: 'Connected', pt: 'Conectado', de: 'Verbunden', fr: 'Connecté' },
  'cosmospay.org': { es: 'Organización', en: 'Organization', pt: 'Organização', de: 'Organisation', fr: 'Organisation' },
  'cosmospay.networks': { es: 'Redes', en: 'Networks', pt: 'Redes', de: 'Netzwerke', fr: 'Réseaux' },
  'cosmospay.unlink': { es: 'Desvincular Cosmos Pay', en: 'Unlink Cosmos Pay', pt: 'Unlink Cosmos Pay', de: 'Unlink Cosmos Pay', fr: 'Unlink Cosmos Pay' },
  'cosmospay.unlinked': { es: 'Cosmos Pay desvinculado.', en: 'Cosmos Pay unlinked.', pt: 'Cosmos Pay unlinked.', de: 'Cosmos Pay unlinked.', fr: 'Cosmos Pay unlinked.' },
  'cosmospay.receiverSection': { es: 'Cuenta de cobro (fiat)', en: 'Fiat receiver', pt: 'Fiat receiver', de: 'Fiat receiver', fr: 'Fiat receiver' },
  'cosmospay.manageReceiver': { es: 'Gestionar', en: 'Manage', pt: 'Gerir', de: 'Verwalten', fr: 'Gérer' },
  'cosmospay.unlinkReceiver': { es: 'Desvincular', en: 'Unlink', pt: 'Desvincular', de: 'Trennen', fr: 'Dissocier' },
  'cosmospay.noReceiver': { es: 'Todavía no vinculaste una cuenta de cobro para fiat (depósito/retiro).', en: 'No fiat receiver linked yet (for deposit/withdraw).', pt: 'No fiat receiver linked yet (for deposit/withdraw).', de: 'No fiat receiver linked yet (for deposit/withdraw).', fr: 'No fiat receiver linked yet (for deposit/withdraw).' },
  'cosmospay.linkReceiver': { es: 'Vincular cuenta fiat', en: 'Link fiat account', pt: 'Link fiat account', de: 'Link fiat account', fr: 'Link fiat account' },
  'cosmospay.unlinkedEnv': { es: 'Clave de {net} desvinculada.', en: '{net} key unlinked.', pt: '{net} key unlinked.', de: '{net} key unlinked.', fr: '{net} key unlinked.' },
  'cosmospay.keyLinked': { es: 'Vinculada', en: 'Linked', pt: 'Vinculada', de: 'Verbunden', fr: 'Liée' },
  'cosmospay.keyMissing': { es: 'No vinculada', en: 'Not linked', pt: 'Não vinculada', de: 'Nicht verbunden', fr: 'Non liée' },
  'cosmospay.reconnect': { es: 'Reconectar / actualizar claves', en: 'Reconnect / refresh keys', pt: 'Reconnect / refresh keys', de: 'Reconnect / refresh keys', fr: 'Reconnect / refresh keys' },
  'cosmospay.row': { es: 'Activar cobros (CosmosPay)', en: 'Enable receiving (CosmosPay)', pt: 'Enable receiving (CosmosPay)', de: 'Enable receiving (CosmosPay)', fr: 'Enable receiving (CosmosPay)' },
  'cosmospay.enabledRow': { es: 'Cobros activados (CosmosPay)', en: 'Receiving enabled (CosmosPay)', pt: 'Receiving enabled (CosmosPay)', de: 'Receiving enabled (CosmosPay)', fr: 'Receiving enabled (CosmosPay)' },
  'cosmospay.confirmRow': { es: 'Confirma tu correo (CosmosPay)', en: 'Confirm your email (CosmosPay)', pt: 'Confirm your email (CosmosPay)', de: 'Confirm your email (CosmosPay)', fr: 'Confirm your email (CosmosPay)' },
  'cosmospay.enableTitle': { es: 'Activar cobros', en: 'Enable receiving payments', pt: 'Enable receiving payments', de: 'Enable receiving payments', fr: 'Enable receiving payments' },
  'cosmospay.enableConfirm': {
    es: 'Introduce tu contraseña para firmar la solicitud con tu clave de Stellar. Te enviaremos un correo para confirmar.',
    en: 'Enter your password to sign the request with your Stellar key. We’ll email you a link to confirm.',
    pt: 'Enter your password to sign the request with your Stellar key. We’ll email you a link to confirm.',
    de: 'Enter your password to sign the request with your Stellar key. We’ll email you a link to confirm.',
    fr: 'Enter your password to sign the request with your Stellar key. We’ll email you a link to confirm.',
  },
  'cosmospay.pendingTitle': { es: 'Confirma tu correo', en: 'Confirm your email', pt: 'Confirma o teu e-mail', de: 'Bestätige deine E-Mail', fr: 'Confirme ton e-mail' },
  'cosmospay.resend': { es: 'Reenviar correo de confirmación', en: 'Resend confirmation email', pt: 'Reenviar e-mail de confirmação', de: 'Bestätigungs-E-Mail erneut senden', fr: 'Renvoyer l’e-mail de confirmation' },
  'cosmospay.emailMismatch': {
    es: 'La solicitud pendiente se envió a {old}, pero tu correo actual es {new}. Reenvía el correo para usar el actual.',
    en: 'The pending request was sent to {old}, but your current email is {new}. Resend to use the current one.',
    pt: 'O pedido pendente foi enviado para {old}, mas o teu e-mail atual é {new}. Reenvia para usar o atual.',
    de: 'Die ausstehende Anfrage ging an {old}, deine aktuelle E-Mail ist aber {new}. Sende sie erneut, um die aktuelle zu verwenden.',
    fr: 'La demande en attente a été envoyée à {old}, mais ton e-mail actuel est {new}. Renvoie l’e-mail pour utiliser l’actuel.',
  },
  'cosmospay.pendingDesc': {
    es: 'Te enviamos un enlace de confirmación. Ábrelo desde tu correo y luego toca «Ya lo confirmé».',
    en: 'We emailed you a confirmation link. Open it from your inbox, then tap “I’ve confirmed”.',
    pt: 'We emailed you a confirmation link. Open it from your inbox, then tap “I’ve confirmed”.',
    de: 'We emailed you a confirmation link. Open it from your inbox, then tap “I’ve confirmed”.',
    fr: 'We emailed you a confirmation link. Open it from your inbox, then tap “I’ve confirmed”.',
  },
  'cosmospay.confirmCta': { es: 'Ya confirmé mi correo', en: 'I’ve confirmed my email', pt: 'I’ve confirmed my email', de: 'I’ve confirmed my email', fr: 'I’ve confirmed my email' },
  'cosmospay.checkEmail': { es: 'Revisa tu correo y confirma para terminar.', en: 'Check your email and confirm to finish.', pt: 'Check your email and confirm to finish.', de: 'Check your email and confirm to finish.', fr: 'Check your email and confirm to finish.' },
  'cosmospay.notConfirmed': { es: 'Aún sin confirmar — abre el enlace de tu correo.', en: 'Not confirmed yet — click the link in your email.', pt: 'Not confirmed yet — click the link in your email.', de: 'Not confirmed yet — click the link in your email.', fr: 'Not confirmed yet — click the link in your email.' },
  'cosmospay.expired': { es: 'La solicitud caducó. Inténtalo de nuevo.', en: 'Expired — please try again.', pt: 'Expired — please try again.', de: 'Expired — please try again.', fr: 'Expired — please try again.' },
  'cosmospay.exists': {
    es: 'Ya existe una cuenta para este correo. Inicia sesión en el panel de CosmosPay.',
    en: 'An account already exists for this email. Sign in on the CosmosPay dashboard.',
    pt: 'An account already exists for this email. Sign in on the CosmosPay dashboard.',
    de: 'An account already exists for this email. Sign in on the CosmosPay dashboard.',
    fr: 'An account already exists for this email. Sign in on the CosmosPay dashboard.',
  },
  'cosmospay.created': { es: 'Cobros activados — ya puedes aceptar pagos.', en: 'Receiving enabled — you can now accept payments.', pt: 'Receiving enabled — you can now accept payments.', de: 'Receiving enabled — you can now accept payments.', fr: 'Receiving enabled — you can now accept payments.' },
  'cosmospay.already': { es: 'Esta cuenta ya estaba activada. Cobros activados.', en: 'This account was already claimed. Receiving enabled.', pt: 'This account was already claimed. Receiving enabled.', de: 'This account was already claimed. Receiving enabled.', fr: 'This account was already claimed. Receiving enabled.' },
  'cosmospay.needEmail': {
    es: 'Añade un correo a esta wallet para activar los cobros.',
    en: 'Add an email to this wallet to enable receiving payments.',
    pt: 'Add an email to this wallet to enable receiving payments.',
    de: 'Add an email to this wallet to enable receiving payments.',
    fr: 'Add an email to this wallet to enable receiving payments.',
  },
  'cosmospay.enableFirst': {
    es: 'Activa los cobros primero para poder intercambiar.',
    en: 'Enable receiving payments first to be able to swap.',
    pt: 'Enable receiving payments first to be able to swap.',
    de: 'Enable receiving payments first to be able to swap.',
    fr: 'Enable receiving payments first to be able to swap.',
  },
  'cosmospay.noKeyForNetwork': {
    es: 'No hay clave para esta red. Vinculá de nuevo para generar las claves de testnet y mainnet.',
    en: 'No key for this network. Re-link to generate the testnet and mainnet keys.',
    pt: 'No key for this network. Re-link to generate the testnet and mainnet keys.',
    de: 'No key for this network. Re-link to generate the testnet and mainnet keys.',
    fr: 'No key for this network. Re-link to generate the testnet and mainnet keys.',
  },
  'cosmospay.error': { es: 'No se pudo activar los cobros.', en: 'Couldn’t enable receiving payments.', pt: 'Couldn’t enable receiving payments.', de: 'Couldn’t enable receiving payments.', fr: 'Couldn’t enable receiving payments.' },

  // ---- CosmosPay (link an existing account via a one-time access code) ----
  'cosmospay.existsLinkTitle': { es: 'Vincula tu cuenta', en: 'Link your account', pt: 'Link your account', de: 'Link your account', fr: 'Link your account' },
  'cosmospay.existsLinkDesc': {
    es: 'Ya existe una cuenta con este correo. Genera un código de acceso de un solo uso para vincularla a esta wallet — sin crear una cuenta nueva.',
    en: 'An account already exists for this email. Generate a one-time access code to link it to this wallet — no new account needed.',
    pt: 'An account already exists for this email. Generate a one-time access code to link it to this wallet — no new account needed.',
    de: 'An account already exists for this email. Generate a one-time access code to link it to this wallet — no new account needed.',
    fr: 'An account already exists for this email. Generate a one-time access code to link it to this wallet — no new account needed.',
  },
  'cosmospay.linkCta': { es: 'Generar código de acceso', en: 'Generate access code', pt: 'Generate access code', de: 'Generate access code', fr: 'Generate access code' },
  'cosmospay.linkTitle': { es: 'Vincular cuenta', en: 'Link account', pt: 'Link account', de: 'Link account', fr: 'Link account' },
  'cosmospay.linkConfirm': {
    es: 'Introduce tu contraseña para firmar con tu clave de Stellar. Te enviaremos un código de acceso a tu correo.',
    en: 'Enter your password to sign with your Stellar key. We’ll email you a one-time access code.',
    pt: 'Enter your password to sign with your Stellar key. We’ll email you a one-time access code.',
    de: 'Enter your password to sign with your Stellar key. We’ll email you a one-time access code.',
    fr: 'Enter your password to sign with your Stellar key. We’ll email you a one-time access code.',
  },
  'cosmospay.codeTitle': { es: 'Ingresa tu código', en: 'Enter your code', pt: 'Enter your code', de: 'Enter your code', fr: 'Enter your code' },
  'cosmospay.codeDesc': {
    es: 'Te enviamos un código de 6 dígitos a tu correo. Ingrésalo para vincular tu cuenta a esta wallet.',
    en: 'We emailed you a 6-digit code. Enter it to link your account to this wallet.',
    pt: 'We emailed you a 6-digit code. Enter it to link your account to this wallet.',
    de: 'We emailed you a 6-digit code. Enter it to link your account to this wallet.',
    fr: 'We emailed you a 6-digit code. Enter it to link your account to this wallet.',
  },
  'cosmospay.codePlaceholder': { es: 'Código de 6 dígitos', en: '6-digit code', pt: '6-digit code', de: '6-digit code', fr: '6-digit code' },
  'cosmospay.linkVerifyCta': { es: 'Vincular cuenta', en: 'Link account', pt: 'Link account', de: 'Link account', fr: 'Link account' },
  'cosmospay.linkSent': { es: 'Te enviamos un código de acceso a tu correo.', en: 'We emailed you an access code.', pt: 'We emailed you an access code.', de: 'We emailed you an access code.', fr: 'We emailed you an access code.' },
  'cosmospay.linked': { es: 'Cuenta vinculada — cobros activados.', en: 'Account linked — receiving enabled.', pt: 'Account linked — receiving enabled.', de: 'Account linked — receiving enabled.', fr: 'Account linked — receiving enabled.' },
  'cosmospay.linkInvalid': { es: 'Código incorrecto. Te quedan {n} intentos.', en: 'Incorrect code. {n} attempts left.', pt: 'Incorrect code. {n} attempts left.', de: 'Incorrect code. {n} attempts left.', fr: 'Incorrect code. {n} attempts left.' },
  'cosmospay.linkExpired': { es: 'El código caducó. Genera uno nuevo.', en: 'The code expired. Generate a new one.', pt: 'The code expired. Generate a new one.', de: 'The code expired. Generate a new one.', fr: 'The code expired. Generate a new one.' },
  'cosmospay.linkLocked': { es: 'Demasiados intentos. Genera un código nuevo.', en: 'Too many attempts. Generate a new code.', pt: 'Too many attempts. Generate a new code.', de: 'Too many attempts. Generate a new code.', fr: 'Too many attempts. Generate a new code.' },
  'cosmospay.linkNotFound': { es: 'No hay cuenta para este correo. Crea una nueva.', en: 'No account for this email. Create a new one.', pt: 'No account for this email. Create a new one.', de: 'No account for this email. Create a new one.', fr: 'No account for this email. Create a new one.' },

  // ---- about ----
  'about.title': { es: 'Acerca de Cosmos', en: 'About Cosmos', pt: 'Acerca do Cosmos', de: 'Über Cosmos', fr: 'À propos de Cosmos' },
  'about.tagline': { es: 'Wallet no custodial en Stellar', en: 'Non-custodial Stellar wallet', pt: 'Wallet não custodial na Stellar', de: 'Nicht-verwahrte Stellar-Wallet', fr: 'Portefeuille Stellar non dépositaire' },
  'about.version': { es: 'Versión', en: 'Version', pt: 'Versão', de: 'Version', fr: 'Version' },
  'about.build': { es: 'Tipo de build', en: 'Build type', pt: 'Tipo de build', de: 'Build-Typ', fr: 'Type de build' },
  'about.platform': { es: 'Plataforma', en: 'Platform', pt: 'Plataforma', de: 'Plattform', fr: 'Plateforme' },
  'about.buildWeb': { es: 'Aplicación web', en: 'Web app', pt: 'Aplicação web', de: 'Web-App', fr: 'Application web' },
  'about.buildExt': { es: 'Extensión de navegador', en: 'Browser extension', pt: 'Extensão de navegador', de: 'Browser-Erweiterung', fr: 'Extension de navigateur' },
  'about.buildApp': { es: 'Aplicación móvil', en: 'Mobile app', pt: 'Aplicação móvel', de: 'Mobile App', fr: 'Application mobile' },
  'about.desc': { es: 'Tus claves se cifran y se guardan solo en este dispositivo (SEP-5 · AES-256-GCM). Cosmos nunca tiene acceso a ellas.', en: 'Your keys are encrypted and stored only on this device (SEP-5 · AES-256-GCM). Cosmos never has access to them.', pt: 'As tuas chaves são cifradas e guardadas apenas neste dispositivo (SEP-5 · AES-256-GCM). A Cosmos nunca tem acesso.', de: 'Deine Schlüssel werden verschlüsselt und nur auf diesem Gerät gespeichert (SEP-5 · AES-256-GCM). Cosmos hat nie Zugriff darauf.', fr: 'Tes clés sont chiffrées et stockées uniquement sur cet appareil (SEP-5 · AES-256-GCM). Cosmos n’y a jamais accès.' },

  'settings.confirmSigns': { es: 'Confirmaciones manuales', en: 'Manual confirmations', pt: 'Confirmações manuais', de: 'Manuelle Bestätigungen', fr: 'Confirmations manuelles' },
  'settings.confirmSignsDesc': { es: 'Pedir la contraseña antes de firmar cualquier operación (envíos, trustlines, transacciones).', en: 'Ask for your password before signing any operation (payments, trustlines, transactions).', pt: 'Pedir a palavra-passe antes de assinar qualquer operação (envios, trustlines, transações).', de: 'Vor jedem Signieren (Zahlungen, Trustlines, Transaktionen) nach dem Passwort fragen.', fr: 'Demander le mot de passe avant de signer toute opération (paiements, trustlines, transactions).' },
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
