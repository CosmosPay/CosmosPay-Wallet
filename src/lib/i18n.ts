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

/**
 * `t` for the two places with no store in reach: a shared `ui/` primitive whose only
 * string is an `aria-label`, and the error boundary that sits ABOVE the store — the
 * store being what may have thrown.
 *
 * Reads the persisted language on every call. A module-level cache lived here to save
 * a `localStorage.getItem` per render of a password eye; it bought microseconds and
 * cost a real staleness path, since any write to the key that did not go through
 * `persistLang` left it serving the previous language until a reload.
 *
 * NOT reactive: everything that holds the store keeps using `store.t`, which
 * re-renders on a language change by itself. Do not reach for this for visible copy.
 */
export function tNow(key: string, params?: Record<string, string | number>): string {
  return makeT(savedLang())(key, params);
}

/** Locale tag for Intl (dates, numbers) derived from the language. */
export function localeOf(lang: Lang): string {
  return { es: 'es-ES', en: 'en-US', pt: 'pt-BR', de: 'de-DE', fr: 'fr-FR' }[lang];
}

// Each entry: key -> { es, en, pt, de, fr }
/** Exported so tests can assert every key is complete in all five languages. */
export const T: Record<string, Record<Lang, string>> = {
  // ---- common ----
  'common.continue': { es: 'Continuar', en: 'Continue', pt: 'Continuar', de: 'Weiter', fr: 'Continuer' },
  'common.done': { es: 'Listo', en: 'Done', pt: 'Concluído', de: 'Fertig', fr: 'Terminé' },
  'common.cancel': { es: 'Cancelar', en: 'Cancel', pt: 'Cancelar', de: 'Abbrechen', fr: 'Annuler' },
  'common.save': { es: 'Guardar', en: 'Save', pt: 'Salvar', de: 'Speichern', fr: 'Enregistrer' },
  'common.copy': { es: 'Copiar', en: 'Copy', pt: 'Copiar', de: 'Kopieren', fr: 'Copier' },
  'common.copied': { es: 'Copiado ✓', en: 'Copied ✓', pt: 'Copiado ✓', de: 'Kopiert ✓', fr: 'Copié ✓' },
  'common.share': { es: 'Compartir', en: 'Share', pt: 'Partilhar', de: 'Teilen', fr: 'Partager' },
  'common.delete': { es: 'Borrar', en: 'Delete', pt: 'Apagar', de: 'Löschen', fr: 'Supprimer' },
  'common.send': { es: 'Enviar', en: 'Send', pt: 'Enviar', de: 'Senden', fr: 'Envoyer' },
  'common.receive': { es: 'Recibir', en: 'Receive', pt: 'Receber', de: 'Empfangen', fr: 'Recevoir' },

  // ---- accessible labels ----
  // Screen-reader names for icon-only controls. They used to be Spanish literals
  // inside shared primitives (ui/Field, app/NavMenu), which the i18n test cannot
  // see: it checks that every key exists in five languages, and a string that was
  // never a key has no key to check.
  'a11y.show': { es: 'Mostrar', en: 'Show', pt: 'Mostrar', de: 'Anzeigen', fr: 'Afficher' },
  'a11y.hide': { es: 'Ocultar', en: 'Hide', pt: 'Ocultar', de: 'Verbergen', fr: 'Masquer' },
  'a11y.menu': { es: 'Menú', en: 'Menu', pt: 'Menu', de: 'Menü', fr: 'Menu' },
  'a11y.close': { es: 'Cerrar', en: 'Close', pt: 'Fechar', de: 'Schließen', fr: 'Fermer' },

  // ---- error boundary ----
  'error.screenTitle': {
    es: 'No se pudo cargar esta pantalla',
    en: "This screen couldn't load",
    pt: 'Não foi possível carregar este ecrã',
    de: 'Dieser Bildschirm konnte nicht geladen werden',
    fr: "Cet écran n'a pas pu se charger",
  },
  'error.screenMsg': {
    es: 'Tus fondos y tus claves no se han visto afectados. Recarga la app para volver a intentarlo.',
    en: 'Your funds and keys are untouched. Reload the app to try again.',
    pt: 'Os teus fundos e chaves não foram afetados. Recarrega a app para tentar de novo.',
    de: 'Deine Guthaben und Schlüssel sind unberührt. Lade die App neu, um es erneut zu versuchen.',
    fr: 'Tes fonds et tes clés sont intacts. Recharge l’app pour réessayer.',
  },
  'error.appTitle': {
    es: 'La wallet no pudo arrancar',
    en: "The wallet couldn't start",
    pt: 'A wallet não conseguiu arrancar',
    de: 'Die Wallet konnte nicht starten',
    fr: "Le portefeuille n'a pas pu démarrer",
  },
  'error.reload': { es: 'Recargar', en: 'Reload', pt: 'Recarregar', de: 'Neu laden', fr: 'Recharger' },
  'error.goHome': { es: 'Volver al inicio', en: 'Back to home', pt: 'Voltar ao início', de: 'Zurück zum Start', fr: "Retour à l'accueil" },

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
  // "…only on your device" was unqualified here, and it stops being true the moment the user
  // links a Cosmos Pay account: registerCosmosAccount sends the name and the email. The
  // promise is now scoped to what the app actually guarantees.
  'setup.subtitle': {
    es: 'Así te saludamos cada vez que abres la wallet. Se guardan en este dispositivo; solo salen de él si vinculas una cuenta Cosmos Pay.',
    en: 'This is how we greet you each time you open the wallet. It is stored on this device, and only leaves it if you link a Cosmos Pay account.',
    pt: 'É assim que te saudamos sempre que abres a wallet. Ficam guardados neste dispositivo e só saem dele se vinculares uma conta Cosmos Pay.',
    de: 'So begrüßen wir dich jedes Mal, wenn du die Wallet öffnest. Sie bleiben auf diesem Gerät und verlassen es nur, wenn du ein Cosmos-Pay-Konto verknüpfst.',
    fr: 'C’est ainsi que nous t’accueillons à chaque ouverture du portefeuille. Ces données sont stockées sur cet appareil et n’en sortent que si tu lies un compte Cosmos Pay.',
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
  // Wrong-password backoff (lib/attempts.ts). Says how long, because "try again later" with
  // no number is indistinguishable from the app being broken.
  'pwd.tooManyAttempts': { es: 'Demasiados intentos. Espera {secs} s antes de volver a probar.', en: 'Too many attempts. Wait {secs}s before trying again.', pt: 'Demasiadas tentativas. Espera {secs} s antes de tentar de novo.', de: 'Zu viele Versuche. Warte {secs} s, bevor du es erneut versuchst.', fr: 'Trop de tentatives. Attends {secs} s avant de réessayer.' },
  'pwd.min': { es: 'Mínimo {n} caracteres', en: 'At least {n} characters', pt: 'Mínimo de {n} caracteres', de: 'Mindestens {n} Zeichen', fr: 'Au moins {n} caractères' },
  'pwd.repeat': { es: 'Repite la contraseña', en: 'Repeat the password', pt: 'Repete a palavra-passe', de: 'Passwort wiederholen', fr: 'Répète le mot de passe' },
  'pwd.show': { es: 'Mostrar contraseña', en: 'Show password', pt: 'Mostrar palavra-passe', de: 'Passwort anzeigen', fr: 'Afficher le mot de passe' },
  'pwd.lenOk': { es: '✓ Longitud suficiente', en: '✓ Long enough', pt: '✓ Comprimento suficiente', de: '✓ Lang genug', fr: '✓ Assez long' },
  'pwd.lenErr': { es: 'La contraseña debe tener al menos {n} caracteres', en: 'The password must be at least {n} characters', pt: 'A palavra-passe deve ter pelo menos {n} caracteres', de: 'Das Passwort muss mindestens {n} Zeichen haben', fr: 'Le mot de passe doit comporter au moins {n} caractères' },
  'pwd.mismatch': { es: 'Las contraseñas no coinciden', en: 'The passwords don’t match', pt: 'As palavras-passe não coincidem', de: 'Die Passwörter stimmen nicht überein', fr: 'Les mots de passe ne correspondent pas' },
  // live password criteria (PasswordSetup checklist)
  // Shown when the store refuses a password the form should already have blocked — the
  // enforcement point is `changeAppPassword`, not the disabled button.
  'pwd.weak': { es: 'La contraseña necesita {n} caracteres, una mayúscula, una minúscula y un número.', en: 'The password needs {n} characters, an uppercase letter, a lowercase letter and a digit.', pt: 'A palavra-passe precisa de {n} caracteres, uma maiúscula, uma minúscula e um número.', de: 'Das Passwort braucht {n} Zeichen, einen Groß-, einen Kleinbuchstaben und eine Ziffer.', fr: 'Le mot de passe doit contenir {n} caractères, une majuscule, une minuscule et un chiffre.' },
  'pwd.critLen': { es: 'Mínimo {n} caracteres', en: 'At least {n} characters', pt: 'Mínimo de {n} caracteres', de: 'Mindestens {n} Zeichen', fr: 'Au moins {n} caractères' },
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
  'unlock.autoLocked': { es: 'Wallet bloqueada por inactividad.', en: 'Wallet locked due to inactivity.', pt: 'Wallet bloqueada por inatividade.', de: 'Wallet wegen Inaktivität gesperrt.', fr: 'Portefeuille verrouillé pour inactivité.' },
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
  'home.loadError': { es: 'No se pudieron cargar los datos.', en: 'The data could not be loaded.', pt: 'Não foi possível carregar os dados.', de: 'Die Daten konnten nicht geladen werden.', fr: 'Les données n’ont pas pu être chargées.' },
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
  'profile.editProfile': { es: 'Editar perfil', en: 'Edit profile', pt: 'Editar perfil', de: 'Profil bearbeiten', fr: 'Modifier le profil' },
  'profile.saved': { es: 'Perfil actualizado.', en: 'Profile updated.', pt: 'Perfil atualizado.', de: 'Profil aktualisiert.', fr: 'Profil mis à jour.' },
  'editProfile.title': { es: 'Editar perfil', en: 'Edit profile', pt: 'Editar perfil', de: 'Profil bearbeiten', fr: 'Modifier le profil' },
  'editProfile.dobLocked': { es: 'La fecha de nacimiento no puede modificarse.', en: 'Your date of birth can’t be changed.', pt: 'A data de nascimento não pode ser alterada.', de: 'Das Geburtsdatum kann nicht geändert werden.', fr: 'La date de naissance ne peut pas être modifiée.' },
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
  // Shown on the forced confirmation before a password change, and again after it: the
  // change ends the session on purpose, so the user has to be told that before it happens.
  'settings.changePwdConfirm': { es: 'Se volverán a cifrar todas tus wallets y se cerrará la sesión. Tendrás que entrar con la contraseña nueva.', en: 'Every wallet will be re-encrypted and this session will end. You will sign in again with the new password.', pt: 'Todas as tuas wallets serão novamente cifradas e a sessão terminará. Vais entrar de novo com a nova palavra-passe.', de: 'Alle Wallets werden neu verschlüsselt und diese Sitzung endet. Du meldest dich mit dem neuen Passwort erneut an.', fr: 'Tous tes portefeuilles seront rechiffrés et cette session prendra fin. Tu te reconnecteras avec le nouveau mot de passe.' },
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
  'confirm.issuer': { es: 'Emisor', en: 'Issuer', pt: 'Emissor', de: 'Emittent', fr: 'Émetteur' },
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
  'history.fee': { es: 'Comisión', en: 'Fee', pt: 'Taxa', de: 'Gebühr', fr: 'Frais' },
  'history.feeSwap': { es: 'Comisión de swap', en: 'Swap fee', pt: 'Taxa de swap', de: 'Swap-Gebühr', fr: 'Frais de swap' },
  'history.feeLiquidity': { es: 'Comisión de liquidez', en: 'Liquidity fee', pt: 'Taxa de liquidez', de: 'Liquiditätsgebühr', fr: 'Frais de liquidité' },
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
  'fiat.trustlineConfirmTitle': { es: 'Habilitar el activo del depósito', en: 'Enable the deposit asset', pt: 'Ativar o ativo do depósito', de: 'Asset für die Einzahlung aktivieren', fr: 'Activer l’actif du dépôt' },
  'fiat.trustlineConfirmMsg': { es: 'Vas a habilitar {asset} emitido por {issuer}. Es el emisor con el que la pasarela paga tus depósitos.', en: 'You are about to enable {asset} issued by {issuer}. That is the issuer the gateway pays your deposits in.', pt: 'Vai ativar {asset} emitido por {issuer}. É o emissor com que a gateway paga os seus depósitos.', de: 'Sie aktivieren {asset}, ausgegeben von {issuer}. Das ist der Aussteller, in dem das Gateway Ihre Einzahlungen auszahlt.', fr: 'Vous allez activer {asset} émis par {issuer}. C’est l’émetteur avec lequel la passerelle verse vos dépôts.' },
  'fiat.trustlineOpened': { es: '{asset} habilitado. Ya podés recibir depósitos.', en: '{asset} enabled. You can receive deposits now.', pt: '{asset} ativado. Já pode receber depósitos.', de: '{asset} aktiviert. Sie können jetzt Einzahlungen empfangen.', fr: '{asset} activé. Vous pouvez recevoir des dépôts.' },
  'fiat.trustlineNoAsset': { es: 'La pasarela no indicó qué activo habilitar.', en: 'The gateway did not say which asset to enable.', pt: 'A gateway não indicou que ativo ativar.', de: 'Das Gateway hat nicht angegeben, welches Asset aktiviert werden soll.', fr: 'La passerelle n’a pas indiqué quel actif activer.' },
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
    es: 'Stellar incorpora pools de liquidez nativos y una DEX integrada. Aporta un par de activos, gana comisiones de trading y retira cuando quieras.',
    en: 'Stellar has native liquidity pools and a built-in DEX. Provide a pair of assets, earn trading fees, and withdraw anytime.',
    pt: 'A Stellar tem pools de liquidez nativos e uma DEX integrada. Aporta um par de ativos, ganha taxas de trading e retira quando quiseres.',
    de: 'Stellar bietet native Liquiditätspools und eine integrierte DEX. Stelle ein Asset-Paar bereit, verdiene Handelsgebühren und ziehe jederzeit ab.',
    fr: 'Stellar dispose de pools de liquidité natifs et d’une DEX intégrée. Fournis une paire d’actifs, gagne des frais de trading et retire à tout moment.',
  },
  'earn.soon': { es: 'Próximamente', en: 'Coming soon', pt: 'Em breve', de: 'Bald verfügbar', fr: 'Bientôt' },
  'earn.note': {
    es: 'Las funciones de rendimiento son informativas. Tu wallet sigue siendo 100% no custodial: las claves nunca salen del dispositivo.',
    en: 'Yield features are informational. Your wallet stays 100% non-custodial: keys never leave the device.',
    pt: 'As funções de rendimento são informativas. A tua wallet continua 100% não custodial: as chaves nunca saem do dispositivo.',
    de: 'Die Rendite-Funktionen sind informativ. Deine Wallet bleibt zu 100 % nicht-verwahrt: Schlüssel verlassen das Gerät nie.',
    fr: 'Les fonctions de rendement sont informatives. Ton portefeuille reste 100 % non dépositaire : les clés ne quittent jamais l’appareil.',
  },

  // ---- liquidity pools ----
  'lp.title': { es: 'Pools de liquidez', en: 'Liquidity pools', pt: 'Pools de liquidez', de: 'Liquiditätspools', fr: 'Pools de liquidité' },
  'lp.open': { es: 'Abrir', en: 'Open', pt: 'Abrir', de: 'Öffnen', fr: 'Ouvrir' },
  'lp.enableFirst': {
    es: 'Activá tu cuenta CosmosPay para operar con pools de liquidez.',
    en: 'Enable your CosmosPay account to use liquidity pools.',
    pt: 'Ativa a tua conta CosmosPay para usar pools de liquidez.',
    de: 'Aktiviere dein CosmosPay-Konto, um Liquiditätspools zu nutzen.',
    fr: 'Active ton compte CosmosPay pour utiliser les pools de liquidité.',
  },
  'lp.myPositions': { es: 'Mis posiciones', en: 'My positions', pt: 'Minhas posições', de: 'Meine Positionen', fr: 'Mes positions' },
  'lp.explore': { es: 'Explorar', en: 'Explore', pt: 'Explorar', de: 'Entdecken', fr: 'Explorer' },
  'lp.newDeposit': { es: 'Nuevo depósito', en: 'New deposit', pt: 'Novo depósito', de: 'Neue Einzahlung', fr: 'Nouveau dépôt' },
  'lp.loading': { es: 'Cargando…', en: 'Loading…', pt: 'A carregar…', de: 'Wird geladen…', fr: 'Chargement…' },
  'lp.loadError': { es: 'No se pudieron cargar los datos de liquidez.', en: 'Couldn’t load liquidity data.', pt: 'Couldn’t load liquidity data.', de: 'Couldn’t load liquidity data.', fr: 'Couldn’t load liquidity data.' },
  'lp.noPositions': {
    es: 'Todavía no tenés posiciones en pools. Depositá un par de activos para empezar a ganar comisiones.',
    en: 'You don’t have any pool positions yet. Deposit a pair of assets to start earning fees.',
    pt: 'Ainda não tens posições em pools. Deposita um par de ativos para começar a ganhar taxas.',
    de: 'Du hast noch keine Pool-Positionen. Zahle ein Asset-Paar ein, um Gebühren zu verdienen.',
    fr: 'Tu n’as pas encore de positions dans les pools. Dépose une paire d’actifs pour gagner des frais.',
  },
  'lp.noPools': { es: 'No se encontraron pools.', en: 'No pools found.', pt: 'Nenhum pool encontrado.', de: 'Keine Pools gefunden.', fr: 'Aucun pool trouvé.' },
  'lp.poolShare': { es: 'Tu parte del pool', en: 'Your pool share', pt: 'A tua parte do pool', de: 'Dein Pool-Anteil', fr: 'Ta part du pool' },
  'lp.shares': { es: 'Participaciones', en: 'Shares', pt: 'Participações', de: 'Anteile', fr: 'Parts' },
  'lp.redeemable': { es: 'Rescatable', en: 'Redeemable', pt: 'Resgatável', de: 'Einlösbar', fr: 'Récupérable' },
  'lp.withdraw': { es: 'Retirar', en: 'Withdraw', pt: 'Retirar', de: 'Abheben', fr: 'Retirer' },
  'lp.deposit': { es: 'Depositar', en: 'Deposit', pt: 'Depositar', de: 'Einzahlen', fr: 'Déposer' },
  'lp.fee': { es: 'Comisión', en: 'Fee', pt: 'Taxa', de: 'Gebühr', fr: 'Frais' },
  'lp.tvl': { es: 'Shares:', en: 'Shares:', pt: 'Shares:', de: 'Shares:', fr: 'Shares:' },
  'lp.assetA': { es: 'Primer activo', en: 'First asset', pt: 'Primeiro ativo', de: 'Erstes Asset', fr: 'Premier actif' },
  'lp.assetB': { es: 'Segundo activo', en: 'Second asset', pt: 'Segundo ativo', de: 'Zweites Asset', fr: 'Deuxième actif' },
  'lp.autoAmount': { es: 'auto', en: 'auto', pt: 'auto', de: 'auto', fr: 'auto' },
  'lp.sameAsset': { es: 'Elegí dos activos distintos para el pool.', en: 'Pick two different assets for the pool.', pt: 'Escolhe dois ativos diferentes para o pool.', de: 'Wähle zwei verschiedene Assets für den Pool.', fr: 'Choisis deux actifs différents pour le pool.' },
  'lp.depositNote': {
    es: 'Depositás ambos activos en la proporción del pool. Si dejás el segundo monto vacío, se calcula con el precio actual del pool. Recibís participaciones que representan tu parte.',
    en: 'You deposit both assets at the pool ratio. Leave the second amount blank to derive it from the current pool price. You receive shares representing your stake.',
    pt: 'Depositas ambos os ativos na proporção do pool. Deixa o segundo valor em branco para o calcular pelo preço atual do pool. Recebes participações que representam a tua parte.',
    de: 'Du zahlst beide Assets im Pool-Verhältnis ein. Lass den zweiten Betrag leer, um ihn aus dem aktuellen Pool-Preis abzuleiten. Du erhältst Anteile, die deinen Einsatz repräsentieren.',
    fr: 'Tu déposes les deux actifs au ratio du pool. Laisse le second montant vide pour le déduire du prix actuel du pool. Tu reçois des parts représentant ton apport.',
  },
  'lp.depositTitle': { es: 'Depositar liquidez', en: 'Deposit liquidity', pt: 'Depositar liquidez', de: 'Liquidität einzahlen', fr: 'Déposer de la liquidité' },
  'lp.withdrawTitle': { es: 'Retirar liquidez', en: 'Withdraw liquidity', pt: 'Retirar liquidez', de: 'Liquidität abheben', fr: 'Retirer la liquidité' },
  'lp.noPositionSelected': { es: 'No hay ninguna posición seleccionada.', en: 'No position selected.', pt: 'Nenhuma posição selecionada.', de: 'Keine Position ausgewählt.', fr: 'Aucune position sélectionnée.' },
  'lp.sharesToBurn': { es: 'Participaciones a quemar', en: 'Shares to burn', pt: 'Participações a queimar', de: 'Zu verbrennende Anteile', fr: 'Parts à brûler' },
  'lp.sharesHeld': { es: 'Tenés', en: 'You hold', pt: 'Tens', de: 'Du hältst', fr: 'Tu détiens' },
  'lp.max': { es: 'Máx', en: 'Max', pt: 'Máx', de: 'Max', fr: 'Max' },
  'lp.overShares': { es: 'Solo tenés {held} participaciones.', en: 'You only hold {held} shares.', pt: 'Só tens {held} participações.', de: 'Du hältst nur {held} Anteile.', fr: 'Tu ne détiens que {held} parts.' },
  'lp.youReceiveApprox': { es: 'Recibirás (aprox.)', en: 'You’ll receive (approx.)', pt: 'Vais receber (aprox.)', de: 'Du erhältst (ca.)', fr: 'Tu recevras (env.)' },
  'lp.withdrawNote': {
    es: 'Quemás participaciones y recibís tu parte proporcional de ambos activos. Los mínimos on-chain se protegen con tu tolerancia de slippage.',
    en: 'You burn shares and receive your proportional part of both assets. On-chain minimums are protected by your slippage tolerance.',
    pt: 'Queimas participações e recebes a tua parte proporcional de ambos os ativos. Os mínimos on-chain são protegidos pela tua tolerância de slippage.',
    de: 'Du verbrennst Anteile und erhältst deinen proportionalen Teil beider Assets. On-Chain-Minima werden durch deine Slippage-Toleranz geschützt.',
    fr: 'Tu brûles des parts et reçois ta part proportionnelle des deux actifs. Les minimums on-chain sont protégés par ta tolérance de slippage.',
  },
  'lp.depositSuccess': { es: 'Depósito completado', en: 'Deposit completed', pt: 'Depósito concluído', de: 'Einzahlung abgeschlossen', fr: 'Dépôt effectué' },
  'lp.depositSuccessMsg': { es: 'Tu liquidez se agregó al pool en la red Stellar.', en: 'Your liquidity was added to the pool on the Stellar network.', pt: 'A tua liquidez foi adicionada ao pool na rede Stellar.', de: 'Deine Liquidität wurde dem Pool im Stellar-Netzwerk hinzugefügt.', fr: 'Ta liquidité a été ajoutée au pool sur le réseau Stellar.' },
  'lp.depositFailed': { es: 'No se pudo depositar', en: 'Deposit failed', pt: 'Falha no depósito', de: 'Einzahlung fehlgeschlagen', fr: 'Échec du dépôt' },
  'lp.withdrawSuccess': { es: 'Retiro completado', en: 'Withdrawal completed', pt: 'Retirada concluída', de: 'Abhebung abgeschlossen', fr: 'Retrait effectué' },
  'lp.withdrawSuccessMsg': { es: 'Tu retiro se procesó en la red Stellar.', en: 'Your withdrawal was processed on the Stellar network.', pt: 'A tua retirada foi processada na rede Stellar.', de: 'Deine Abhebung wurde im Stellar-Netzwerk verarbeitet.', fr: 'Ton retrait a été traité sur le réseau Stellar.' },
  'lp.withdrawFailed': { es: 'No se pudo retirar', en: 'Withdrawal failed', pt: 'Falha na retirada', de: 'Abhebung fehlgeschlagen', fr: 'Échec du retrait' },

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
  // One message per CameraFailure in src/lib/camera.ts — 'scan.denied' is the permission one,
  // and the four below are the failures it used to be shown for.
  'scan.denied': { es: 'No se pudo acceder a la cámara. Revisa los permisos.', en: 'Couldn’t access the camera. Check permissions.', pt: 'Não foi possível aceder à câmara. Verifica as permissões.', de: 'Kamerazugriff fehlgeschlagen. Berechtigungen prüfen.', fr: 'Accès à la caméra impossible. Vérifie les autorisations.' },
  'scan.noCam': { es: 'Este navegador no da acceso a la cámara. Hace falta una conexión segura (https).', en: 'This browser gives no camera access. It needs a secure (https) connection.', pt: 'Este navegador não dá acesso à câmara. É precisa uma ligação segura (https).', de: 'Dieser Browser gibt keinen Kamerazugriff. Er braucht eine sichere (https) Verbindung.', fr: 'Ce navigateur ne donne pas accès à la caméra. Il faut une connexion sécurisée (https).' },
  'scan.noDevice': { es: 'No se encontró ninguna cámara en este dispositivo.', en: 'No camera found on this device.', pt: 'Nenhuma câmara encontrada neste dispositivo.', de: 'Keine Kamera auf diesem Gerät gefunden.', fr: 'Aucune caméra trouvée sur cet appareil.' },
  'scan.busy': { es: 'Otra aplicación está usando la cámara. Ciérrala y reintenta.', en: 'Another app is using the camera. Close it and retry.', pt: 'Outra aplicação está a usar a câmara. Fecha-a e tenta de novo.', de: 'Eine andere App benutzt die Kamera. Schließe sie und versuche es erneut.', fr: 'Une autre application utilise la caméra. Ferme-la et réessaie.' },
  'scan.failed': { es: 'No se pudo abrir la cámara.', en: 'Couldn’t open the camera.', pt: 'Não foi possível abrir a câmara.', de: 'Die Kamera konnte nicht geöffnet werden.', fr: 'Impossible d’ouvrir la caméra.' },
  'scan.settingsHint': { es: 'Si rechazaste el permiso, actívalo en Ajustes → Aplicaciones → Cosmos Wallet → Permisos.', en: 'If you denied the permission, turn it on in Settings → Apps → Cosmos Wallet → Permissions.', pt: 'Se recusaste a permissão, ativa-a em Definições → Aplicações → Cosmos Wallet → Permissões.', de: 'Wenn du die Berechtigung abgelehnt hast, aktiviere sie in Einstellungen → Apps → Cosmos Wallet → Berechtigungen.', fr: 'Si tu as refusé l’autorisation, active-la dans Réglages → Applications → Cosmos Wallet → Autorisations.' },
  'scan.retry': { es: 'Permitir cámara y reintentar', en: 'Allow camera & retry', pt: 'Permitir câmara e tentar de novo', de: 'Kamera erlauben & erneut versuchen', fr: 'Autoriser la caméra et réessayer' },
  // The same button when no permission is in question — offering to "allow the camera" for a
  // camera another app is holding is advice that cannot work.
  'scan.retryPlain': { es: 'Reintentar', en: 'Retry', pt: 'Tentar de novo', de: 'Erneut versuchen', fr: 'Réessayer' },
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
  'ops.gatewayTitle': { es: 'Operaciones de Cosmos Pay', en: 'Cosmos Pay operations', pt: 'Operações da Cosmos Pay', de: 'Cosmos-Pay-Vorgänge', fr: 'Opérations Cosmos Pay' },
  'ops.gatewaySub': { es: 'Estado de tus swaps, depósitos y retiros', en: 'The state of your swaps, deposits and withdrawals', pt: 'O estado dos seus swaps, depósitos e levantamentos', de: 'Der Status Ihrer Swaps, Ein- und Auszahlungen', fr: 'L’état de vos swaps, dépôts et retraits' },
  'ops.gatewayEmpty': { es: 'Todavía no hay operaciones acá.', en: 'No operations here yet.', pt: 'Ainda não há operações aqui.', de: 'Hier gibt es noch keine Vorgänge.', fr: 'Aucune opération ici pour l’instant.' },
  'ops.tabSwaps': { es: 'Swaps', en: 'Swaps', pt: 'Swaps', de: 'Swaps', fr: 'Swaps' },
  'ops.tabDeposits': { es: 'Depósitos', en: 'Deposits', pt: 'Depósitos', de: 'Einzahlungen', fr: 'Dépôts' },
  'ops.tabWithdrawals': { es: 'Retiros', en: 'Withdrawals', pt: 'Levantamentos', de: 'Auszahlungen', fr: 'Retraits' },
  'ops.tabLiquidity': { es: 'Liquidez', en: 'Liquidity', pt: 'Liquidez', de: 'Liquidität', fr: 'Liquidité' },
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
  'confirmSig.lpDepositTitle': { es: 'Confirmar depósito', en: 'Confirm deposit', pt: 'Confirm deposit', de: 'Confirm deposit', fr: 'Confirm deposit' },
  'confirmSig.lpDepositMsg': { es: 'Introduce tu contraseña para firmar el depósito de {a} y {b} al pool.', en: 'Enter your password to sign the {a}/{b} pool deposit.', pt: 'Enter your password to sign the {a}/{b} pool deposit.', de: 'Enter your password to sign the {a}/{b} pool deposit.', fr: 'Enter your password to sign the {a}/{b} pool deposit.' },
  'confirmSig.lpWithdrawTitle': { es: 'Confirmar retiro', en: 'Confirm withdrawal', pt: 'Confirm withdrawal', de: 'Confirm withdrawal', fr: 'Confirm withdrawal' },
  'confirmSig.lpWithdrawMsg': { es: 'Introduce tu contraseña para firmar el retiro de {shares} participaciones.', en: 'Enter your password to sign the withdrawal of {shares} shares.', pt: 'Enter your password to sign the withdrawal of {shares} shares.', de: 'Enter your password to sign the withdrawal of {shares} shares.', fr: 'Enter your password to sign the withdrawal of {shares} shares.' },
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
  'about.buildDesktop': { es: 'Aplicación de escritorio', en: 'Desktop app', pt: 'Aplicação de ambiente de trabalho', de: 'Desktop-App', fr: 'Application de bureau' },
  'about.desc': { es: 'Tus claves se cifran y se guardan solo en este dispositivo (SEP-5 · AES-256-GCM). Cosmos nunca tiene acceso a ellas.', en: 'Your keys are encrypted and stored only on this device (SEP-5 · AES-256-GCM). Cosmos never has access to them.', pt: 'As tuas chaves são cifradas e guardadas apenas neste dispositivo (SEP-5 · AES-256-GCM). A Cosmos nunca tem acesso.', de: 'Deine Schlüssel werden verschlüsselt und nur auf diesem Gerät gespeichert (SEP-5 · AES-256-GCM). Cosmos hat nie Zugriff darauf.', fr: 'Tes clés sont chiffrées et stockées uniquement sur cet appareil (SEP-5 · AES-256-GCM). Cosmos n’y a jamais accès.' },

  'fiat.noAmount': {
    es: 'La cotización no indica cuánto se enviaría. No se ha firmado nada.',
    en: "The quote doesn't say how much would be sent. Nothing was signed.",
    pt: 'A cotação não indica quanto seria enviado. Não se assinou nada.',
    de: 'Das Angebot nennt keinen Sendebetrag. Es wurde nichts signiert.',
    fr: "Le devis n'indique pas le montant à envoyer. Rien n'a été signé.",
  },
  'fiat.ambiguousAsset': {
    es: 'Tienes más de un activo llamado {code}, o ninguno. Elimina la línea de confianza que no uses antes de retirar.',
    en: 'You hold more than one asset called {code}, or none. Remove the trustline you do not use before withdrawing.',
    pt: 'Tens mais de um ativo chamado {code}, ou nenhum. Remove a trustline que não usas antes de levantar.',
    de: 'Du hältst mehr als einen Vermögenswert namens {code} – oder keinen. Entferne die nicht genutzte Trustline vor der Auszahlung.',
    fr: 'Tu détiens plus d’un actif nommé {code}, ou aucun. Supprime la trustline inutilisée avant de retirer.',
  },

  // ---- connected sites (extension only) ----
  'settings.sites': { es: 'Webs conectadas', en: 'Connected sites', pt: 'Sites ligados', de: 'Verbundene Websites', fr: 'Sites connectés' },
  'settings.sitesDesc': {
    es: 'Estas webs pueden leer tu dirección pública sin volver a preguntar. Nunca pueden firmar sin tu contraseña.',
    en: 'These sites can read your public address without asking again. They can never sign without your password.',
    pt: 'Estes sites podem ler o teu endereço público sem voltar a perguntar. Nunca podem assinar sem a tua palavra-passe.',
    de: 'Diese Websites können deine öffentliche Adresse ohne erneute Nachfrage lesen. Signieren können sie nie ohne dein Passwort.',
    fr: 'Ces sites peuvent lire ton adresse publique sans redemander. Ils ne peuvent jamais signer sans ton mot de passe.',
  },
  'settings.sitesNone': { es: 'Ninguna web conectada.', en: 'No connected sites.', pt: 'Nenhum site ligado.', de: 'Keine verbundenen Websites.', fr: 'Aucun site connecté.' },
  'settings.revoke': { es: 'Revocar', en: 'Revoke', pt: 'Revogar', de: 'Entziehen', fr: 'Révoquer' },
  'settings.revokeAll': { es: 'Revocar todas', en: 'Revoke all', pt: 'Revogar todas', de: 'Alle entziehen', fr: 'Tout révoquer' },
  'settings.sitesRevoked': { es: 'Acceso revocado.', en: 'Access revoked.', pt: 'Acesso revogado.', de: 'Zugriff entzogen.', fr: 'Accès révoqué.' },

  'settings.confirmSigns': { es: 'Confirmaciones manuales', en: 'Manual confirmations', pt: 'Confirmações manuais', de: 'Manuelle Bestätigungen', fr: 'Confirmations manuelles' },
  // ---- device unlock (phone build only: fingerprint / face / device passcode) ----
  'devAuth.kindFace': { es: 'tu rostro', en: 'your face', pt: 'o teu rosto', de: 'dein Gesicht', fr: 'ton visage' },
  'devAuth.kindFingerprint': { es: 'tu huella', en: 'your fingerprint', pt: 'a tua impressão digital', de: 'deinen Fingerabdruck', fr: 'ton empreinte' },
  'devAuth.kindIris': { es: 'tu iris', en: 'your iris', pt: 'a tua íris', de: 'deine Iris', fr: 'ton iris' },
  'devAuth.kindMultiple': { es: 'tu biometría', en: 'your biometrics', pt: 'a tua biometria', de: 'deine Biometrie', fr: 'ta biométrie' },
  'devAuth.kindPasscode': { es: 'el bloqueo del teléfono', en: 'your phone lock', pt: 'o bloqueio do telemóvel', de: 'deine Gerätesperre', fr: 'le verrouillage du téléphone' },
  'devAuth.kindGeneric': { es: 'el bloqueo del dispositivo', en: 'your device lock', pt: 'o bloqueio do dispositivo', de: 'deine Gerätesperre', fr: 'le verrouillage de l’appareil' },

  'devAuth.unlockWith': { es: 'Entrar con {method}', en: 'Unlock with {method}', pt: 'Entrar com {method}', de: 'Mit {method} entsperren', fr: 'Déverrouiller avec {method}' },
  'devAuth.signWith': { es: 'Firmar con {method}', en: 'Sign with {method}', pt: 'Assinar com {method}', de: 'Mit {method} signieren', fr: 'Signer avec {method}' },

  'devAuth.unlockTitle': { es: 'Abrir tu wallet', en: 'Open your wallet', pt: 'Abrir a tua wallet', de: 'Wallet öffnen', fr: 'Ouvrir ton portefeuille' },
  'devAuth.unlockReason': { es: 'Confirma que eres tú para abrir tu wallet.', en: 'Confirm it’s you to open your wallet.', pt: 'Confirma que és tu para abrir a tua wallet.', de: 'Bestätige, dass du es bist, um deine Wallet zu öffnen.', fr: 'Confirme que c’est bien toi pour ouvrir ton portefeuille.' },
  'devAuth.signTitle': { es: 'Confirmar la firma', en: 'Confirm signing', pt: 'Confirmar a assinatura', de: 'Signatur bestätigen', fr: 'Confirmer la signature' },
  'devAuth.signReason': { es: 'Confirma que eres tú para firmar esta operación.', en: 'Confirm it’s you to sign this operation.', pt: 'Confirma que és tu para assinar esta operação.', de: 'Bestätige, dass du es bist, um diesen Vorgang zu signieren.', fr: 'Confirme que c’est bien toi pour signer cette opération.' },
  'devAuth.enrollTitle': { es: 'Activar el desbloqueo rápido', en: 'Turn on quick unlock', pt: 'Ativar o desbloqueio rápido', de: 'Schnellentsperrung aktivieren', fr: 'Activer le déverrouillage rapide' },
  'devAuth.enrollReason': { es: 'Confirma que eres tú para guardar tu contraseña en este teléfono.', en: 'Confirm it’s you to store your password on this phone.', pt: 'Confirma que és tu para guardar a tua palavra-passe neste telemóvel.', de: 'Bestätige, dass du es bist, um dein Passwort auf diesem Gerät zu speichern.', fr: 'Confirme que c’est bien toi pour enregistrer ton mot de passe sur ce téléphone.' },
  'devAuth.rewrapTitle': { es: 'Actualizar el desbloqueo rápido', en: 'Update quick unlock', pt: 'Atualizar o desbloqueio rápido', de: 'Schnellentsperrung aktualisieren', fr: 'Mettre à jour le déverrouillage rapide' },

  'devAuth.offerTitle': { es: 'Entra más rápido con {method}', en: 'Get in faster with {method}', pt: 'Entra mais depressa com {method}', de: 'Schneller rein mit {method}', fr: 'Entre plus vite avec {method}' },
  'devAuth.offerBody': { es: 'Puedes abrir la wallet y confirmar firmas con {method}, sin escribir la contraseña cada vez.', en: 'You can open the wallet and confirm signatures with {method}, without typing your password every time.', pt: 'Podes abrir a wallet e confirmar assinaturas com {method}, sem escrever a palavra-passe de cada vez.', de: 'Du kannst die Wallet öffnen und Signaturen mit {method} bestätigen, ohne jedes Mal dein Passwort zu tippen.', fr: 'Tu peux ouvrir le portefeuille et confirmer les signatures avec {method}, sans saisir ton mot de passe à chaque fois.' },
  'devAuth.offerNote': { es: 'Tu contraseña sigue siendo la llave: la necesitarás igual y puedes cambiar esto cuando quieras en Ajustes.', en: 'Your password is still the key: you will still need it, and you can change this any time in Settings.', pt: 'A tua palavra-passe continua a ser a chave: vais precisar dela na mesma e podes mudar isto quando quiseres nas Definições.', de: 'Dein Passwort bleibt der Schlüssel: du brauchst es weiterhin und kannst dies jederzeit in den Einstellungen ändern.', fr: 'Ton mot de passe reste la clé : tu en auras toujours besoin et tu peux changer ceci à tout moment dans les réglages.' },
  'devAuth.offerActivate': { es: 'Activar {method}', en: 'Turn on {method}', pt: 'Ativar {method}', de: '{method} aktivieren', fr: 'Activer {method}' },
  'devAuth.offerLater': { es: 'Ahora no', en: 'Not now', pt: 'Agora não', de: 'Jetzt nicht', fr: 'Pas maintenant' },

  'devAuth.settingLabel': { es: 'Desbloqueo con el teléfono', en: 'Unlock with your phone', pt: 'Desbloqueio com o telemóvel', de: 'Mit dem Gerät entsperren', fr: 'Déverrouillage par le téléphone' },
  'devAuth.settingDesc': { es: 'Usa {method} para abrir la wallet y confirmar firmas, sin escribir la contraseña. Tu contraseña sigue funcionando siempre.', en: 'Use {method} to open the wallet and confirm signatures without typing your password. Your password keeps working either way.', pt: 'Usa {method} para abrir a wallet e confirmar assinaturas sem escrever a palavra-passe. A tua palavra-passe continua a funcionar.', de: 'Nutze {method}, um die Wallet zu öffnen und Signaturen zu bestätigen, ohne dein Passwort zu tippen. Dein Passwort funktioniert weiterhin.', fr: 'Utilise {method} pour ouvrir le portefeuille et confirmer les signatures sans saisir ton mot de passe. Ton mot de passe reste toujours valable.' },
  'devAuth.enabled': { es: 'Listo: ya puedes entrar con {method}.', en: 'Done — you can now unlock with {method}.', pt: 'Pronto: já podes entrar com {method}.', de: 'Fertig — du kannst jetzt mit {method} entsperren.', fr: 'C’est prêt : tu peux déverrouiller avec {method}.' },
  'devAuth.disabled': { es: 'Desbloqueo con el teléfono desactivado.', en: 'Phone unlock turned off.', pt: 'Desbloqueio com o telemóvel desativado.', de: 'Entsperren per Gerät deaktiviert.', fr: 'Déverrouillage par le téléphone désactivé.' },
  'devAuth.droppedOnPwdChange': { es: 'Se desactivó el desbloqueo con el teléfono en: {names}. Vuelve a activarlo en Ajustes.', en: 'Phone unlock was turned off for: {names}. Turn it back on in Settings.', pt: 'O desbloqueio com o telemóvel foi desativado em: {names}. Volta a ativá-lo em Definições.', de: 'Entsperren per Gerät wurde deaktiviert für: {names}. Aktiviere es in den Einstellungen erneut.', fr: 'Le déverrouillage par le téléphone a été désactivé pour : {names}. Réactive-le dans les réglages.' },

  'devAuth.errUnsupported': { es: 'Este dispositivo no puede usar el bloqueo del teléfono.', en: 'This device can’t use the phone lock.', pt: 'Este dispositivo não pode usar o bloqueio do telemóvel.', de: 'Dieses Gerät kann die Gerätesperre nicht nutzen.', fr: 'Cet appareil ne peut pas utiliser le verrouillage du téléphone.' },
  'devAuth.errNoHardware': { es: 'Este teléfono no tiene lector biométrico disponible.', en: 'No biometric sensor is available on this phone.', pt: 'Este telemóvel não tem sensor biométrico disponível.', de: 'Auf diesem Gerät ist kein biometrischer Sensor verfügbar.', fr: 'Aucun capteur biométrique n’est disponible sur ce téléphone.' },
  'devAuth.errNotEnrolled': { es: 'No hay ninguna huella ni rostro registrado en el teléfono.', en: 'No fingerprint or face is enrolled on this phone.', pt: 'Não há nenhuma impressão digital ou rosto registado no telemóvel.', de: 'Auf diesem Gerät ist kein Fingerabdruck und kein Gesicht hinterlegt.', fr: 'Aucune empreinte ni visage n’est enregistré sur ce téléphone.' },
  'devAuth.errNoPasscode': { es: 'Configura un bloqueo de pantalla en tu teléfono para poder usar esto.', en: 'Set a screen lock on your phone to use this.', pt: 'Configura um bloqueio de ecrã no telemóvel para usar isto.', de: 'Richte eine Bildschirmsperre ein, um dies zu nutzen.', fr: 'Configure un verrouillage d’écran sur ton téléphone pour utiliser ceci.' },
  // A lock screen but nothing that can BIND the key: a PIN-only phone, or one whose only
  // sensor is a weak Class 2 face unlock. Says what the phone cannot do and that nothing
  // is lost, because unlike errNotEnrolled there is no setting the user can go fix.
  'devAuth.errNoStrongBiometry': { es: 'Este teléfono no puede proteger tu contraseña con biometría. Sigue entrando con tu contraseña.', en: 'This phone can’t protect your password with biometrics. Keep signing in with your password.', pt: 'Este telemóvel não consegue proteger a tua palavra-passe com biometria. Continua a entrar com a tua palavra-passe.', de: 'Dieses Gerät kann dein Passwort nicht biometrisch schützen. Melde dich weiterhin mit deinem Passwort an.', fr: 'Ce téléphone ne peut pas protéger ton mot de passe par biométrie. Continue à te connecter avec ton mot de passe.' },
  'devAuth.errLockedOut': { es: 'Demasiados intentos. Desbloquea el teléfono con su PIN y vuelve a intentarlo.', en: 'Too many attempts. Unlock your phone with its PIN and try again.', pt: 'Demasiadas tentativas. Desbloqueia o telemóvel com o PIN e tenta de novo.', de: 'Zu viele Versuche. Entsperre das Gerät mit der PIN und versuche es erneut.', fr: 'Trop de tentatives. Déverrouille ton téléphone avec son code et réessaie.' },
  'devAuth.errLockedOutTemp': { es: 'No se reconoció. Vuelve a intentarlo.', en: 'Not recognised. Try again.', pt: 'Não foi reconhecido. Tenta de novo.', de: 'Nicht erkannt. Versuche es erneut.', fr: 'Non reconnu. Réessaie.' },
  'devAuth.errCancelled': { es: 'Verificación cancelada.', en: 'Verification cancelled.', pt: 'Verificação cancelada.', de: 'Überprüfung abgebrochen.', fr: 'Vérification annulée.' },
  'devAuth.errStale': { es: 'El bloqueo del teléfono cambió. Entra con tu contraseña y vuelve a activarlo.', en: 'The phone lock changed. Sign in with your password and turn it back on.', pt: 'O bloqueio do telemóvel mudou. Entra com a palavra-passe e volta a ativá-lo.', de: 'Die Gerätesperre hat sich geändert. Melde dich mit dem Passwort an und aktiviere es erneut.', fr: 'Le verrouillage du téléphone a changé. Connecte-toi avec ton mot de passe et réactive-le.' },
  // Neutral on purpose: this same key is shown when ENROLLING fails and when READING the
  // stored key fails. It used to say "couldn't set up quick unlock", which read as nonsense
  // to a user who had set it up days ago and was merely trying to sign in.
  'devAuth.errFailed': { es: 'El teléfono no pudo completar la verificación. Usa tu contraseña.', en: 'Your phone couldn’t complete the check. Use your password.', pt: 'O telemóvel não conseguiu concluir a verificação. Usa a tua palavra-passe.', de: 'Dein Gerät konnte die Prüfung nicht abschließen. Nutze dein Passwort.', fr: 'Ton téléphone n’a pas pu terminer la vérification. Utilise ton mot de passe.' },
  // The unclassified bucket carries the platform's own sentence, because the code
  // alone cannot separate a refusing Keystore from a bad read — and "couldn't verify
  // your identity" blamed the finger for a fault that never reached the sensor.
  // Composes here rather than in TS: the store used to build this line with a template
  // literal, which puts user-visible punctuation in a .ts file and leaves this key unused.
  'devAuth.errDetail': { es: '{base} ({msg})', en: '{base} ({msg})', pt: '{base} ({msg})', de: '{base} ({msg})', fr: '{base} ({msg})' },

  'settings.confirmSignsDesc': { es: 'Pedir la contraseña antes de firmar cualquier operación (envíos, trustlines, transacciones).', en: 'Ask for your password before signing any operation (payments, trustlines, transactions).', pt: 'Pedir a palavra-passe antes de assinar qualquer operação (envios, trustlines, transações).', de: 'Vor jedem Signieren (Zahlungen, Trustlines, Transaktionen) nach dem Passwort fragen.', fr: 'Demander le mot de passe avant de signer toute opération (paiements, trustlines, transactions).' },
  // ---- transaction guard (src/lib/txGuard.ts) ----
  // Refusals and the review rows the approval window renders. These were Spanish
  // literals inside the guard itself, which meant a French user read a Spanish
  // refusal — and, worse, that a security module owned copy at all. `TxGuardError`
  // carries the key alongside the resolved message, so a test can assert WHICH check
  // fired instead of what it said.
  'guard.undecodable': { es: 'No se pudo decodificar la transacción (XDR inválido).', en: 'This transaction could not be decoded (invalid XDR).', pt: 'Não foi possível descodificar a transação (XDR inválido).', de: 'Diese Transaktion konnte nicht dekodiert werden (ungültiges XDR).', fr: 'Cette transaction n’a pas pu être décodée (XDR invalide).' },
  'guard.feeBump': { es: 'La transacción viene envuelta en un fee-bump. La wallet no firma envoltorios de terceros.', en: 'This transaction is wrapped in a fee-bump. The wallet does not sign third-party wrappers.', pt: 'A transação vem dentro de um fee-bump. A wallet não assina invólucros de terceiros.', de: 'Diese Transaktion steckt in einem Fee-Bump. Die Wallet signiert keine fremden Hüllen.', fr: 'Cette transaction est enveloppée dans un fee-bump. Le portefeuille ne signe pas d’enveloppes tierces.' },
  'guard.foreignSource': { es: 'La transacción no sale de tu cuenta (origen: {source}). Firma rechazada.', en: 'This transaction does not come from your account (source: {source}). Signature refused.', pt: 'A transação não sai da tua conta (origem: {source}). Assinatura recusada.', de: 'Diese Transaktion stammt nicht aus deinem Konto (Quelle: {source}). Signatur abgelehnt.', fr: 'Cette transaction ne provient pas de ton compte (source : {source}). Signature refusée.' },
  'guard.noOps': { es: 'La transacción no contiene ninguna operación.', en: 'This transaction contains no operations.', pt: 'A transação não contém nenhuma operação.', de: 'Diese Transaktion enthält keine Operationen.', fr: 'Cette transaction ne contient aucune opération.' },
  'guard.tooManyOps': { es: 'La transacción contiene {count} operaciones, más de las que esta acción necesita. Firma rechazada.', en: 'This transaction contains {count} operations, more than this action needs. Signature refused.', pt: 'A transação contém {count} operações, mais do que esta ação precisa. Assinatura recusada.', de: 'Diese Transaktion enthält {count} Operationen — mehr, als diese Aktion braucht. Signatur abgelehnt.', fr: 'Cette transaction contient {count} opérations, plus que cette action n’en demande. Signature refusée.' },
  'guard.feeTooHigh': { es: 'La comisión de la transacción es anómala ({fee} XLM). Firma rechazada.', en: 'The transaction fee is abnormal ({fee} XLM). Signature refused.', pt: 'A comissão da transação é anómala ({fee} XLM). Assinatura recusada.', de: 'Die Transaktionsgebühr ist auffällig ({fee} XLM). Signatur abgelehnt.', fr: 'Les frais de transaction sont anormaux ({fee} XLM). Signature refusée.' },
  'guard.noExpiry': { es: 'La transacción no caduca nunca (sin límite temporal). Una firma sin caducidad puede reenviarse cuando le convenga a la contraparte. Firma rechazada.', en: 'This transaction never expires (no time bound). A signature with no expiry can be replayed whenever the counterparty chooses. Signature refused.', pt: 'A transação nunca caduca (sem limite temporal). Uma assinatura sem validade pode ser reenviada quando a contraparte quiser. Assinatura recusada.', de: 'Diese Transaktion läuft nie ab (keine Zeitgrenze). Eine Signatur ohne Ablauf kann die Gegenseite jederzeit erneut einreichen. Signatur abgelehnt.', fr: 'Cette transaction n’expire jamais (aucune limite de temps). Une signature sans expiration peut être rejouée quand la contrepartie le décide. Signature refusée.' },
  'guard.badMaxTime': { es: 'El límite temporal de la transacción no es legible. Firma rechazada.', en: 'The transaction’s time bound is unreadable. Signature refused.', pt: 'O limite temporal da transação não é legível. Assinatura recusada.', de: 'Die Zeitgrenze der Transaktion ist nicht lesbar. Signatur abgelehnt.', fr: 'La limite de temps de la transaction est illisible. Signature refusée.' },
  'guard.expired': { es: 'La transacción ya ha caducado. Vuelve a pedir la cotización.', en: 'This transaction has already expired. Request the quote again.', pt: 'A transação já caducou. Pede novamente a cotação.', de: 'Diese Transaktion ist bereits abgelaufen. Fordere das Angebot erneut an.', fr: 'Cette transaction a déjà expiré. Redemande le devis.' },
  'guard.notYetValid': { es: 'La transacción no es válida hasta más tarde. Firma rechazada.', en: 'This transaction is not valid until later. Signature refused.', pt: 'A transação só é válida mais tarde. Assinatura recusada.', de: 'Diese Transaktion ist erst später gültig. Signatur abgelehnt.', fr: 'Cette transaction n’est valable que plus tard. Signature refusée.' },
  'guard.validTooLong': { es: 'La transacción sigue siendo válida durante demasiado tiempo. Firma rechazada.', en: 'This transaction stays valid for too long. Signature refused.', pt: 'A transação permanece válida durante demasiado tempo. Assinatura recusada.', de: 'Diese Transaktion bleibt zu lange gültig. Signatur abgelehnt.', fr: 'Cette transaction reste valable trop longtemps. Signature refusée.' },
  'guard.criticalOp': { es: 'La transacción contiene una operación crítica ({op}) que podría dar control de tu cuenta a un tercero. Firma rechazada.', en: 'This transaction contains a critical operation ({op}) that could hand control of your account to someone else. Signature refused.', pt: 'A transação contém uma operação crítica ({op}) que poderia dar controlo da tua conta a terceiros. Assinatura recusada.', de: 'Diese Transaktion enthält eine kritische Operation ({op}), die einem Dritten die Kontrolle über dein Konto geben könnte. Signatur abgelehnt.', fr: 'Cette transaction contient une opération critique ({op}) qui pourrait donner le contrôle de ton compte à un tiers. Signature refusée.' },
  'guard.unexpectedOp': { es: 'La transacción contiene una operación inesperada para esta acción ({op}). Firma rechazada.', en: 'This transaction contains an operation this action does not use ({op}). Signature refused.', pt: 'A transação contém uma operação inesperada para esta ação ({op}). Assinatura recusada.', de: 'Diese Transaktion enthält eine Operation, die diese Aktion nicht verwendet ({op}). Signatur abgelehnt.', fr: 'Cette transaction contient une opération que cette action n’utilise pas ({op}). Signature refusée.' },
  'guard.foreignOpSource': { es: 'Una operación actúa sobre otra cuenta ({source}). Firma rechazada.', en: 'One operation acts on another account ({source}). Signature refused.', pt: 'Uma operação atua sobre outra conta ({source}). Assinatura recusada.', de: 'Eine Operation wirkt auf ein anderes Konto ({source}). Signatur abgelehnt.', fr: 'Une opération agit sur un autre compte ({source}). Signature refusée.' },
  'guard.notSelfDestination': { es: 'La operación envía el dinero a otra cuenta ({destination}), no a la tuya. Firma rechazada.', en: 'The operation sends the money to another account ({destination}), not to yours. Signature refused.', pt: 'A operação envia o dinheiro para outra conta ({destination}), não para a tua. Assinatura recusada.', de: 'Die Operation sendet das Geld an ein anderes Konto ({destination}), nicht an deines. Signatur abgelehnt.', fr: 'L’opération envoie l’argent vers un autre compte ({destination}), pas le tien. Signature refusée.' },
  'guard.multipleDestinations': { es: 'La transacción reparte el dinero entre varios destinatarios. Firma rechazada.', en: 'This transaction splits the money between several recipients. Signature refused.', pt: 'A transação divide o dinheiro por vários destinatários. Assinatura recusada.', de: 'Diese Transaktion verteilt das Geld auf mehrere Empfänger. Signatur abgelehnt.', fr: 'Cette transaction répartit l’argent entre plusieurs destinataires. Signature refusée.' },
  'guard.unconfirmedDestination': { es: 'La operación envía el dinero a un destino que no confirmaste ({destination}). Firma rechazada.', en: 'The operation sends the money to a destination you did not confirm ({destination}). Signature refused.', pt: 'A operação envia o dinheiro para um destino que não confirmaste ({destination}). Assinatura recusada.', de: 'Die Operation sendet das Geld an ein Ziel, das du nicht bestätigt hast ({destination}). Signatur abgelehnt.', fr: 'L’opération envoie l’argent vers une destination que tu n’as pas confirmée ({destination}). Signature refusée.' },
  'guard.unquantifiable': { es: 'La wallet no puede determinar cuánto mueve una de las operaciones ({op}). Firma rechazada.', en: 'The wallet cannot determine how much one of the operations moves ({op}). Signature refused.', pt: 'A wallet não consegue determinar quanto move uma das operações ({op}). Assinatura recusada.', de: 'Die Wallet kann nicht bestimmen, wie viel eine der Operationen bewegt ({op}). Signatur abgelehnt.', fr: 'Le portefeuille ne peut pas déterminer combien déplace l’une des opérations ({op}). Signature refusée.' },
  'guard.poolShareOutsideLiquidity': { es: 'La transacción abre una línea de participaciones de pool fuera de un flujo de liquidez. Firma rechazada.', en: 'This transaction opens a pool-share trustline outside a liquidity flow. Signature refused.', pt: 'A transação abre uma linha de participações de pool fora de um fluxo de liquidez. Assinatura recusada.', de: 'Diese Transaktion öffnet eine Pool-Anteils-Trustline außerhalb eines Liquiditätsvorgangs. Signatur abgelehnt.', fr: 'Cette transaction ouvre une trustline de parts de pool en dehors d’un flux de liquidité. Signature refusée.' },
  'guard.removesTrustline': { es: 'La transacción elimina una línea de confianza. Firma rechazada.', en: 'This transaction removes a trustline. Signature refused.', pt: 'A transação remove uma linha de confiança. Assinatura recusada.', de: 'Diese Transaktion entfernt eine Trustline. Signatur abgelehnt.', fr: 'Cette transaction supprime une trustline. Signature refusée.' },
  'guard.noConfirmedTrustline': { es: 'El flujo no declaró qué activo puede confiar. Firma rechazada.', en: 'The flow did not declare which asset it may trust. Signature refused.', pt: 'O fluxo não declarou que ativo pode confiar. Assinatura recusada.', de: 'Der Ablauf hat nicht angegeben, welchem Asset er vertrauen darf. Signatur abgelehnt.', fr: 'Le flux n’a pas déclaré quel actif il peut approuver. Signature refusée.' },
  'guard.unconfirmedTrustline': { es: 'La transacción abre una línea de confianza para un activo que no confirmaste ({asset}). Firma rechazada.', en: 'This transaction opens a trustline for an asset you did not confirm ({asset}). Signature refused.', pt: 'A transação abre uma linha de confiança para um ativo que não confirmaste ({asset}). Assinatura recusada.', de: 'Diese Transaktion öffnet eine Trustline für ein Asset, das du nicht bestätigt hast ({asset}). Signatur abgelehnt.', fr: 'Cette transaction ouvre une trustline pour un actif que tu n’as pas confirmé ({asset}). Signature refusée.' },
  'guard.wrongPool': { es: 'La operación actúa sobre un pool distinto del que elegiste ({pool}). Firma rechazada.', en: 'The operation acts on a different pool from the one you chose ({pool}). Signature refused.', pt: 'A operação atua sobre um pool diferente do que escolheste ({pool}). Assinatura recusada.', de: 'Die Operation wirkt auf einen anderen Pool als den gewählten ({pool}). Signatur abgelehnt.', fr: 'L’opération agit sur un pool différent de celui que tu as choisi ({pool}). Signature refusée.' },
  'guard.withdrawNoMinimum': { es: 'El retiro de liquidez no declara un mínimo a recibir. Firma rechazada.', en: 'The liquidity withdrawal does not declare a minimum to receive. Signature refused.', pt: 'O levantamento de liquidez não declara um mínimo a receber. Assinatura recusada.', de: 'Die Liquiditätsentnahme nennt keinen Mindestbetrag, den du erhältst. Signatur abgelehnt.', fr: 'Le retrait de liquidité ne déclare aucun minimum à recevoir. Signature refusée.' },
  'guard.withdrawZero': { es: 'El retiro de liquidez garantiza recibir cero. Firma rechazada.', en: 'The liquidity withdrawal guarantees receiving zero. Signature refused.', pt: 'O levantamento de liquidez garante receber zero. Assinatura recusada.', de: 'Die Liquiditätsentnahme garantiert null Ertrag. Signatur abgelehnt.', fr: 'Le retrait de liquidité garantit de ne rien recevoir. Signature refusée.' },
  'guard.maxSendUnreadable': { es: 'El importe confirmado no es legible, así que la wallet no puede acotar la transacción. Firma rechazada.', en: 'The confirmed amount is unreadable, so the wallet cannot bound this transaction. Signature refused.', pt: 'O valor confirmado não é legível, por isso a wallet não consegue limitar a transação. Assinatura recusada.', de: 'Der bestätigte Betrag ist nicht lesbar, daher kann die Wallet diese Transaktion nicht begrenzen. Signatur abgelehnt.', fr: 'Le montant confirmé est illisible, le portefeuille ne peut donc pas borner cette transaction. Signature refusée.' },
  'guard.wrongAsset': { es: 'La transacción mueve {moved}, que no es el activo que confirmaste ({expected}). Firma rechazada.', en: 'This transaction moves {moved}, which is not the asset you confirmed ({expected}). Signature refused.', pt: 'A transação move {moved}, que não é o ativo que confirmaste ({expected}). Assinatura recusada.', de: 'Diese Transaktion bewegt {moved} — nicht das von dir bestätigte Asset ({expected}). Signatur abgelehnt.', fr: 'Cette transaction déplace {moved}, qui n’est pas l’actif que tu as confirmé ({expected}). Signature refusée.' },
  'guard.amountUnreadable': { es: 'Una de las cantidades de la transacción no es legible. Firma rechazada.', en: 'One of the transaction’s amounts is unreadable. Signature refused.', pt: 'Uma das quantias da transação não é legível. Assinatura recusada.', de: 'Einer der Beträge der Transaktion ist nicht lesbar. Signatur abgelehnt.', fr: 'L’un des montants de la transaction est illisible. Signature refusée.' },
  'guard.overMaxSend': { es: 'La transacción mueve más de lo confirmado ({amount} {code}). Firma rechazada.', en: 'This transaction moves more than you confirmed ({amount} {code}). Signature refused.', pt: 'A transação move mais do que confirmaste ({amount} {code}). Assinatura recusada.', de: 'Diese Transaktion bewegt mehr als bestätigt ({amount} {code}). Signatur abgelehnt.', fr: 'Cette transaction déplace plus que ce que tu as confirmé ({amount} {code}). Signature refusée.' },
  'guard.minReceiveUnreadable': { es: 'El importe a recibir no es legible, así que la wallet no puede acotar la transacción. Firma rechazada.', en: 'The amount to receive is unreadable, so the wallet cannot bound this transaction. Signature refused.', pt: 'O valor a receber não é legível, por isso a wallet não consegue limitar a transação. Assinatura recusada.', de: 'Der zu erhaltende Betrag ist nicht lesbar, daher kann die Wallet diese Transaktion nicht begrenzen. Signatur abgelehnt.', fr: 'Le montant à recevoir est illisible, le portefeuille ne peut donc pas borner cette transaction. Signature refusée.' },
  'guard.receiveUnreadable': { es: 'Una de las cantidades a recibir no es legible. Firma rechazada.', en: 'One of the amounts to receive is unreadable. Signature refused.', pt: 'Uma das quantias a receber não é legível. Assinatura recusada.', de: 'Einer der zu erhaltenden Beträge ist nicht lesbar. Signatur abgelehnt.', fr: 'L’un des montants à recevoir est illisible. Signature refusée.' },
  'guard.noGuaranteedAsset': { es: 'La transacción no garantiza que recibas {code}. Firma rechazada.', en: 'This transaction does not guarantee that you receive {code}. Signature refused.', pt: 'A transação não garante que recebas {code}. Assinatura recusada.', de: 'Diese Transaktion garantiert nicht, dass du {code} erhältst. Signatur abgelehnt.', fr: 'Cette transaction ne garantit pas que tu reçoives {code}. Signature refusée.' },
  'guard.underMinReceive': { es: 'La transacción sólo garantiza recibir menos de lo cotizado ({amount} {code}). Firma rechazada.', en: 'This transaction only guarantees receiving less than quoted ({amount} {code}). Signature refused.', pt: 'A transação só garante receber menos do que o cotado ({amount} {code}). Assinatura recusada.', de: 'Diese Transaktion garantiert nur weniger als angeboten ({amount} {code}). Signatur abgelehnt.', fr: 'Cette transaction ne garantit que moins que le devis ({amount} {code}). Signature refusée.' },
  'guard.poolAmountsUnreadable': { es: 'Los importes de liquidez confirmados no son legibles. Firma rechazada.', en: 'The confirmed liquidity amounts are unreadable. Signature refused.', pt: 'Os valores de liquidez confirmados não são legíveis. Assinatura recusada.', de: 'Die bestätigten Liquiditätsbeträge sind nicht lesbar. Signatur abgelehnt.', fr: 'Les montants de liquidité confirmés sont illisibles. Signature refusée.' },
  'guard.overPoolCeiling': { es: 'La operación de liquidez mueve {amount}, más de lo que confirmaste. Firma rechazada.', en: 'The liquidity operation moves {amount}, more than you confirmed. Signature refused.', pt: 'A operação de liquidez move {amount}, mais do que confirmaste. Assinatura recusada.', de: 'Die Liquiditätsoperation bewegt {amount} — mehr als bestätigt. Signatur abgelehnt.', fr: 'L’opération de liquidité déplace {amount}, plus que ce que tu as confirmé. Signature refusée.' },
  'guard.overPoolSide': { es: 'Un lado del depósito mueve {amount}, más que el máximo de {max} que confirmaste. Firma rechazada.', en: 'One side of the deposit moves {amount}, more than the {max} maximum you confirmed. Signature refused.', pt: 'Um lado do depósito move {amount}, mais do que o máximo de {max} que confirmaste. Assinatura recusada.', de: 'Eine Seite der Einzahlung bewegt {amount} — mehr als das bestätigte Maximum von {max}. Signatur abgelehnt.', fr: 'Un côté du dépôt déplace {amount}, plus que le maximum de {max} que tu as confirmé. Signature refusée.' },
  'guard.poolSideCount': { es: 'El depósito de liquidez no declara sus dos lados. Firma rechazada.', en: 'The liquidity deposit does not declare both of its sides. Signature refused.', pt: 'O depósito de liquidez não declara os seus dois lados. Assinatura recusada.', de: 'Die Liquiditätseinzahlung nennt nicht beide Seiten. Signatur abgelehnt.', fr: 'Le dépôt de liquidité ne déclare pas ses deux côtés. Signature refusée.' },
  'guard.poolUncomputable': { es: 'Los dos activos confirmados no forman un pool válido. Firma rechazada.', en: 'The two confirmed assets do not form a valid pool. Signature refused.', pt: 'Os dois ativos confirmados não formam um pool válido. Assinatura recusada.', de: 'Die beiden bestätigten Assets bilden keinen gültigen Pool. Signatur abgelehnt.', fr: 'Les deux actifs confirmés ne forment pas un pool valide. Signature refusée.' },

  // Review rows — the operation summary the approval window renders.
  'guard.row.destination': { es: 'Destino', en: 'Destination', pt: 'Destino', de: 'Ziel', fr: 'Destination' },
  'guard.row.amount': { es: 'Importe', en: 'Amount', pt: 'Valor', de: 'Betrag', fr: 'Montant' },
  'guard.row.newAccount': { es: 'Cuenta nueva', en: 'New account', pt: 'Conta nova', de: 'Neues Konto', fr: 'Nouveau compte' },
  'guard.row.startingBalance': { es: 'Saldo inicial', en: 'Starting balance', pt: 'Saldo inicial', de: 'Startguthaben', fr: 'Solde initial' },
  'guard.row.youSend': { es: 'Envías', en: 'You send', pt: 'Envias', de: 'Du sendest', fr: 'Tu envoies' },
  'guard.row.receivesMin': { es: 'Recibe (mínimo)', en: 'Receives (minimum)', pt: 'Recebe (mínimo)', de: 'Erhält (Minimum)', fr: 'Reçoit (minimum)' },
  'guard.row.youSendMax': { es: 'Envías (máximo)', en: 'You send (maximum)', pt: 'Envias (máximo)', de: 'Du sendest (Maximum)', fr: 'Tu envoies (maximum)' },
  'guard.row.receives': { es: 'Recibe', en: 'Receives', pt: 'Recebe', de: 'Erhält', fr: 'Reçoit' },
  'guard.row.asset': { es: 'Activo', en: 'Asset', pt: 'Ativo', de: 'Asset', fr: 'Actif' },
  'guard.row.limit': { es: 'Límite', en: 'Limit', pt: 'Limite', de: 'Limit', fr: 'Limite' },
  'guard.row.pool': { es: 'Pool', en: 'Pool', pt: 'Pool', de: 'Pool', fr: 'Pool' },
  'guard.row.maxA': { es: 'Máximo A', en: 'Maximum A', pt: 'Máximo A', de: 'Maximum A', fr: 'Maximum A' },
  'guard.row.maxB': { es: 'Máximo B', en: 'Maximum B', pt: 'Máximo B', de: 'Maximum B', fr: 'Maximum B' },
  'guard.row.minPrice': { es: 'Precio mínimo', en: 'Minimum price', pt: 'Preço mínimo', de: 'Mindestpreis', fr: 'Prix minimum' },
  'guard.row.maxPrice': { es: 'Precio máximo', en: 'Maximum price', pt: 'Preço máximo', de: 'Höchstpreis', fr: 'Prix maximum' },
  'guard.row.shares': { es: 'Participaciones', en: 'Shares', pt: 'Participações', de: 'Anteile', fr: 'Parts' },
  'guard.row.minA': { es: 'Mínimo A', en: 'Minimum A', pt: 'Mínimo A', de: 'Minimum A', fr: 'Minimum A' },
  'guard.row.minB': { es: 'Mínimo B', en: 'Minimum B', pt: 'Mínimo B', de: 'Minimum B', fr: 'Minimum B' },
  'guard.row.lockedAmount': { es: 'Importe bloqueado', en: 'Locked amount', pt: 'Valor bloqueado', de: 'Gesperrter Betrag', fr: 'Montant bloqué' },
  'guard.row.claimants': { es: 'Reclamantes', en: 'Claimants', pt: 'Reclamantes', de: 'Anspruchsberechtigte', fr: 'Bénéficiaires' },
  'guard.row.claimedBalance': { es: 'Saldo reclamado', en: 'Claimed balance', pt: 'Saldo reclamado', de: 'Beanspruchtes Guthaben', fr: 'Solde réclamé' },
  'guard.row.newSequence': { es: 'Nueva secuencia', en: 'New sequence', pt: 'Nova sequência', de: 'Neue Sequenz', fr: 'Nouvelle séquence' },
  'guard.row.mergeInto': { es: 'Fusiona la cuenta en', en: 'Merges the account into', pt: 'Funde a conta em', de: 'Führt das Konto zusammen in', fr: 'Fusionne le compte dans' },
  'guard.row.addsSigner': { es: 'Añade firmante', en: 'Adds signer', pt: 'Adiciona signatário', de: 'Fügt Unterzeichner hinzu', fr: 'Ajoute un signataire' },
  'guard.row.masterWeight': { es: 'Peso de tu clave', en: 'Weight of your key', pt: 'Peso da tua chave', de: 'Gewicht deines Schlüssels', fr: 'Poids de ta clé' },
  'guard.row.lowThreshold': { es: 'Umbral bajo', en: 'Low threshold', pt: 'Limiar baixo', de: 'Niedrige Schwelle', fr: 'Seuil bas' },
  'guard.row.medThreshold': { es: 'Umbral medio', en: 'Medium threshold', pt: 'Limiar médio', de: 'Mittlere Schwelle', fr: 'Seuil moyen' },
  'guard.row.highThreshold': { es: 'Umbral alto', en: 'High threshold', pt: 'Limiar alto', de: 'Hohe Schwelle', fr: 'Seuil haut' },
  'guard.row.homeDomain': { es: 'Dominio', en: 'Home domain', pt: 'Domínio', de: 'Domain', fr: 'Domaine' },
  'guard.row.selling': { es: 'Vende', en: 'Selling', pt: 'Vende', de: 'Verkauft', fr: 'Vend' },
  'guard.row.buying': { es: 'Compra', en: 'Buying', pt: 'Compra', de: 'Kauft', fr: 'Achète' },
  'guard.row.quantity': { es: 'Cantidad', en: 'Quantity', pt: 'Quantidade', de: 'Menge', fr: 'Quantité' },
  'guard.row.price': { es: 'Precio', en: 'Price', pt: 'Preço', de: 'Preis', fr: 'Prix' },
  'guard.row.dataName': { es: 'Clave', en: 'Key', pt: 'Chave', de: 'Schlüssel', fr: 'Clé' },
  'guard.row.dataValue': { es: 'Valor', en: 'Value', pt: 'Valor', de: 'Wert', fr: 'Valeur' },
  'guard.row.contract': { es: 'Contrato', en: 'Contract', pt: 'Contrato', de: 'Vertrag', fr: 'Contrat' },
  'guard.row.function': { es: 'Función', en: 'Function', pt: 'Função', de: 'Funktion', fr: 'Fonction' },
  'guard.row.operation': { es: 'Operación', en: 'Operation', pt: 'Operação', de: 'Operation', fr: 'Opération' },

  // Row values that are copy rather than decoded data.
  'guard.val.removeTrustline': { es: 'ELIMINAR trustline', en: 'REMOVE trustline', pt: 'REMOVER trustline', de: 'Trustline ENTFERNEN', fr: 'SUPPRIMER la trustline' },
  'guard.val.deleteEntry': { es: 'BORRAR', en: 'DELETE', pt: 'APAGAR', de: 'LÖSCHEN', fr: 'SUPPRIMER' },
  'guard.val.binary': { es: '(binario)', en: '(binary)', pt: '(binário)', de: '(binär)', fr: '(binaire)' },
  'guard.val.sorobanOpaque': { es: 'Invocación de contrato Soroban (no legible)', en: 'Soroban contract call (not readable)', pt: 'Invocação de contrato Soroban (não legível)', de: 'Soroban-Vertragsaufruf (nicht lesbar)', fr: 'Appel de contrat Soroban (illisible)' },
  'guard.val.unreadableOp': { es: 'La wallet no sabe leer esta operación', en: 'The wallet cannot read this operation', pt: 'A wallet não sabe ler esta operação', de: 'Die Wallet kann diese Operation nicht lesen', fr: 'Le portefeuille ne sait pas lire cette opération' },
  'guard.val.signerWeight': { es: '{key} (peso {weight})', en: '{key} (weight {weight})', pt: '{key} (peso {weight})', de: '{key} (Gewicht {weight})', fr: '{key} (poids {weight})' },
  // ---- dapp approval window (src/app/ApprovePopup.tsx) ----
  // This window is a separate document that loads neither theme.css nor app.css, but it
  // is still the surface where a website asks for a signature — so its copy is
  // translated like everything else. Strings it hands back to the DAPP are not in here:
  // those are API surface and stay English.
  'approve.title.getAddress': { es: 'Conectar tu wallet', en: 'Connect your wallet', pt: 'Ligar a tua wallet', de: 'Wallet verbinden', fr: 'Connecter ton portefeuille' },
  'approve.title.signTransaction': { es: 'Firmar transacción', en: 'Sign transaction', pt: 'Assinar transação', de: 'Transaktion signieren', fr: 'Signer la transaction' },
  'approve.title.signMessage': { es: 'Firmar mensaje', en: 'Sign message', pt: 'Assinar mensagem', de: 'Nachricht signieren', fr: 'Signer le message' },
  'approve.title.requestPayment': { es: 'Enviar pago', en: 'Send payment', pt: 'Enviar pagamento', de: 'Zahlung senden', fr: 'Envoyer le paiement' },

  'approve.loading': { es: 'Cargando…', en: 'Loading…', pt: 'A carregar…', de: 'Wird geladen…', fr: 'Chargement…' },
  'approve.notFound': { es: 'Solicitud no encontrada', en: 'Request not found', pt: 'Pedido não encontrado', de: 'Anfrage nicht gefunden', fr: 'Demande introuvable' },
  'approve.notFoundBody': { es: 'La solicitud caducó o ya se resolvió. Puedes cerrar esta ventana.', en: 'The request expired or was already answered. You can close this window.', pt: 'O pedido caducou ou já foi respondido. Podes fechar esta janela.', de: 'Die Anfrage ist abgelaufen oder wurde bereits beantwortet. Du kannst dieses Fenster schließen.', fr: 'La demande a expiré ou a déjà été traitée. Tu peux fermer cette fenêtre.' },
  'approve.noWallet': { es: 'No hay wallet', en: 'No wallet', pt: 'Sem wallet', de: 'Keine Wallet', fr: 'Aucun portefeuille' },
  'approve.close': { es: 'Cerrar', en: 'Close', pt: 'Fechar', de: 'Schließen', fr: 'Fermer' },
  'approve.addressBar': { es: 'Barra de direcciones', en: 'Address bar', pt: 'Barra de endereços', de: 'Adressleiste', fr: 'Barre d’adresse' },
  'approve.defaultWalletName': { es: 'astronauta', en: 'astronaut', pt: 'astronauta', de: 'Astronaut', fr: 'astronaute' },
  'approve.yourAccount': { es: 'Tu cuenta', en: 'Your account', pt: 'A tua conta', de: 'Dein Konto', fr: 'Ton compte' },

  'approve.paymentSent': { es: 'Pago enviado ✓', en: 'Payment sent ✓', pt: 'Pagamento enviado ✓', de: 'Zahlung gesendet ✓', fr: 'Paiement envoyé ✓' },
  'approve.paymentSentBody': { es: 'La transacción se firmó en tu dispositivo y se envió a la red.', en: 'The transaction was signed on your device and submitted to the network.', pt: 'A transação foi assinada no teu dispositivo e enviada para a rede.', de: 'Die Transaktion wurde auf deinem Gerät signiert und an das Netzwerk gesendet.', fr: 'La transaction a été signée sur ton appareil et envoyée au réseau.' },
  'approve.requestFrom': { es: 'Solicitud de', en: 'Request from', pt: 'Pedido de', de: 'Anfrage von', fr: 'Demande de' },
  'approve.messageToSign': { es: 'Mensaje a firmar', en: 'Message to sign', pt: 'Mensagem a assinar', de: 'Zu signierende Nachricht', fr: 'Message à signer' },
  'approve.rowNetwork': { es: 'Red', en: 'Network', pt: 'Rede', de: 'Netzwerk', fr: 'Réseau' },
  'approve.rowHash': { es: 'Hash', en: 'Hash', pt: 'Hash', de: 'Hash', fr: 'Hash' },
  'approve.rowWallet': { es: 'Wallet', en: 'Wallet', pt: 'Wallet', de: 'Wallet', fr: 'Portefeuille' },
  'approve.rowYourAddress': { es: 'Tu dirección', en: 'Your address', pt: 'O teu endereço', de: 'Deine Adresse', fr: 'Ton adresse' },
  'approve.rowSendTo': { es: 'Enviar a', en: 'Send to', pt: 'Enviar para', de: 'Senden an', fr: 'Envoyer à' },
  'approve.rowAmount': { es: 'Importe', en: 'Amount', pt: 'Valor', de: 'Betrag', fr: 'Montant' },
  'approve.rowMemo': { es: 'Memo', en: 'Memo', pt: 'Memo', de: 'Memo', fr: 'Mémo' },
  'approve.rowSource': { es: 'Origen', en: 'Source', pt: 'Origem', de: 'Quelle', fr: 'Source' },
  'approve.rowFee': { es: 'Comisión', en: 'Fee', pt: 'Comissão', de: 'Gebühr', fr: 'Frais' },
  'approve.rowSequence': { es: 'Secuencia', en: 'Sequence', pt: 'Sequência', de: 'Sequenz', fr: 'Séquence' },
  'approve.rowExpires': { es: 'Caduca', en: 'Expires', pt: 'Caduca', de: 'Läuft ab', fr: 'Expire' },
  'approve.rowSignatures': { es: 'Firmas ya presentes', en: 'Signatures already present', pt: 'Assinaturas já presentes', de: 'Bereits vorhandene Signaturen', fr: 'Signatures déjà présentes' },
  'approve.rowFeeBumpFrom': { es: 'Fee-bump de', en: 'Fee-bump from', pt: 'Fee-bump de', de: 'Fee-Bump von', fr: 'Fee-bump de' },

  'approve.expiryNever': { es: 'Nunca (sin caducidad)', en: 'Never (no expiry)', pt: 'Nunca (sem validade)', de: 'Nie (kein Ablauf)', fr: 'Jamais (sans expiration)' },
  'approve.expiryPast': { es: 'Ya ha caducado', en: 'Already expired', pt: 'Já caducou', de: 'Bereits abgelaufen', fr: 'Déjà expirée' },
  'approve.expirySecs': { es: 'en {n} s', en: 'in {n} s', pt: 'em {n} s', de: 'in {n} s', fr: 'dans {n} s' },
  'approve.expiryMins': { es: 'en {n} min', en: 'in {n} min', pt: 'em {n} min', de: 'in {n} Min.', fr: 'dans {n} min' },
  'approve.expiryHours': { es: 'en {n} h', en: 'in {n} h', pt: 'em {n} h', de: 'in {n} Std.', fr: 'dans {n} h' },

  'approve.badSep7': { es: 'El enlace SEP-7 no contiene un pago válido.', en: 'This SEP-7 link does not contain a valid payment.', pt: 'A ligação SEP-7 não contém um pagamento válido.', de: 'Dieser SEP-7-Link enthält keine gültige Zahlung.', fr: 'Ce lien SEP-7 ne contient pas de paiement valide.' },
  'approve.badPayLink': { es: 'Enlace de pago inválido.', en: 'Invalid payment link.', pt: 'Ligação de pagamento inválida.', de: 'Ungültiger Zahlungslink.', fr: 'Lien de paiement invalide.' },
  'approve.readFailed': { es: 'No se pudo leer la transacción: {msg}', en: 'This transaction could not be read: {msg}', pt: 'Não foi possível ler a transação: {msg}', de: 'Diese Transaktion konnte nicht gelesen werden: {msg}', fr: 'Cette transaction n’a pas pu être lue : {msg}' },
  'approve.netMismatch': { es: 'La web pide firmar en una red distinta a la tuya ({network}). Cambia de red en la wallet si realmente quieres operar ahí.', en: 'This site is asking you to sign on a different network from yours ({network}). Switch networks in the wallet if you really mean to operate there.', pt: 'O site pede para assinar numa rede diferente da tua ({network}). Muda de rede na wallet se queres mesmo operar aí.', de: 'Diese Seite möchte in einem anderen Netzwerk als deinem signieren lassen ({network}). Wechsle in der Wallet das Netzwerk, wenn du dort wirklich arbeiten willst.', fr: 'Ce site demande de signer sur un réseau différent du tien ({network}). Change de réseau dans le portefeuille si tu veux vraiment y opérer.' },

  'approve.warnCritical': { es: 'Esta transacción incluye una operación que puede dar control de tu cuenta a un tercero, o invoca un contrato que esta ventana no puede leer. No la apruebes salvo que sepas exactamente qué estás haciendo.', en: 'This transaction includes an operation that can hand control of your account to someone else, or calls a contract this window cannot read. Do not approve it unless you know exactly what you are doing.', pt: 'Esta transação inclui uma operação que pode dar controlo da tua conta a terceiros, ou invoca um contrato que esta janela não consegue ler. Não aproves a menos que saibas exatamente o que estás a fazer.', de: 'Diese Transaktion enthält eine Operation, die einem Dritten die Kontrolle über dein Konto geben kann, oder ruft einen Vertrag auf, den dieses Fenster nicht lesen kann. Bestätige sie nur, wenn du genau weißt, was du tust.', fr: 'Cette transaction contient une opération pouvant donner le contrôle de ton compte à un tiers, ou appelle un contrat que cette fenêtre ne peut pas lire. Ne l’approuve que si tu sais exactement ce que tu fais.' },
  'approve.warnForeignSource': { es: 'Esta transacción no sale de tu cuenta. Tu firma se añadiría a la de otra persona.', en: 'This transaction does not come from your account. Your signature would be added to someone else’s.', pt: 'Esta transação não sai da tua conta. A tua assinatura seria adicionada à de outra pessoa.', de: 'Diese Transaktion stammt nicht aus deinem Konto. Deine Signatur käme zu der einer anderen Person hinzu.', fr: 'Cette transaction ne provient pas de ton compte. Ta signature s’ajouterait à celle de quelqu’un d’autre.' },
  'approve.warnFeeBump': { es: 'Es un envoltorio fee-bump: un tercero paga la comisión y decide cuándo reenviarla.', en: 'This is a fee-bump wrapper: a third party pays the fee and decides when to resubmit it.', pt: 'É um invólucro fee-bump: um terceiro paga a comissão e decide quando reenviar.', de: 'Das ist eine Fee-Bump-Hülle: Ein Dritter zahlt die Gebühr und entscheidet, wann er sie erneut einreicht.', fr: 'C’est une enveloppe fee-bump : un tiers paie les frais et décide quand la resoumettre.' },
  'approve.warnNoExpiry': { es: 'Esta transacción no caduca nunca. Una vez firmada, quien la tenga puede enviarla en cualquier momento.', en: 'This transaction never expires. Once signed, whoever holds it can submit it at any time.', pt: 'Esta transação nunca caduca. Depois de assinada, quem a tiver pode enviá-la a qualquer momento.', de: 'Diese Transaktion läuft nie ab. Einmal signiert, kann sie jeder Inhaber jederzeit einreichen.', fr: 'Cette transaction n’expire jamais. Une fois signée, quiconque la détient peut l’envoyer à tout moment.' },
  'approve.ack': { es: 'Entiendo que esta transacción puede dar control de mi cuenta o mi firma a un tercero, y quiero aprobarla igualmente.', en: 'I understand this transaction can hand control of my account, or my signature, to someone else — and I want to approve it anyway.', pt: 'Compreendo que esta transação pode dar controlo da minha conta, ou a minha assinatura, a terceiros — e quero aprová-la mesmo assim.', de: 'Mir ist klar, dass diese Transaktion die Kontrolle über mein Konto oder meine Signatur an Dritte geben kann — und ich will sie trotzdem bestätigen.', fr: 'Je comprends que cette transaction peut donner le contrôle de mon compte, ou ma signature, à un tiers — et je veux quand même l’approuver.' },

  'approve.noteConnect': { es: 'Se compartirá tu dirección pública con esta web. No se expone ninguna clave.', en: 'Your public address will be shared with this site. No key is exposed.', pt: 'O teu endereço público será partilhado com este site. Nenhuma chave é exposta.', de: 'Deine öffentliche Adresse wird mit dieser Seite geteilt. Kein Schlüssel wird preisgegeben.', fr: 'Ton adresse publique sera partagée avec ce site. Aucune clé n’est exposée.' },
  'approve.notePay': { es: 'Se construirá, firmará y enviará este pago desde tu wallet. Revisa el destino y el importe.', en: 'This payment will be built, signed and submitted from your wallet. Check the destination and the amount.', pt: 'Este pagamento será construído, assinado e enviado a partir da tua wallet. Verifica o destino e o valor.', de: 'Diese Zahlung wird aus deiner Wallet erstellt, signiert und gesendet. Prüfe Ziel und Betrag.', fr: 'Ce paiement sera construit, signé et envoyé depuis ton portefeuille. Vérifie la destination et le montant.' },
  'approve.noteSign': { es: 'La firma se hace en tu dispositivo con tu clave; nunca sale de aquí.', en: 'Signing happens on your device with your key; it never leaves here.', pt: 'A assinatura acontece no teu dispositivo com a tua chave; nunca sai daqui.', de: 'Signiert wird auf deinem Gerät mit deinem Schlüssel; er verlässt es nie.', fr: 'La signature se fait sur ton appareil avec ta clé ; elle n’en sort jamais.' },
  'approve.pwdPlaceholder': { es: 'Contraseña de la wallet', en: 'Wallet password', pt: 'Palavra-passe da wallet', de: 'Wallet-Passwort', fr: 'Mot de passe du portefeuille' },
  'approve.reject': { es: 'Rechazar', en: 'Reject', pt: 'Rejeitar', de: 'Ablehnen', fr: 'Refuser' },
  'approve.approve': { es: 'Aprobar', en: 'Approve', pt: 'Aprovar', de: 'Bestätigen', fr: 'Approuver' },
  'approve.connect': { es: 'Conectar', en: 'Connect', pt: 'Ligar', de: 'Verbinden', fr: 'Connecter' },
  'approve.send': { es: 'Enviar', en: 'Send', pt: 'Enviar', de: 'Senden', fr: 'Envoyer' },
  'approve.sending': { es: 'Enviando…', en: 'Sending…', pt: 'A enviar…', de: 'Wird gesendet…', fr: 'Envoi…' },
  'approve.signing': { es: 'Firmando…', en: 'Signing…', pt: 'A assinar…', de: 'Wird signiert…', fr: 'Signature…' },

  // ---- Stellar operation names (src/constants/app.ts OP_LABEL_KEYS) ----
  'op.payment': { es: 'Pago', en: 'Payment', pt: 'Pagamento', de: 'Zahlung', fr: 'Paiement' },
  'op.createAccount': { es: 'Crear cuenta', en: 'Create account', pt: 'Criar conta', de: 'Konto erstellen', fr: 'Créer un compte' },
  'op.pathPaymentStrictSend': { es: 'Intercambio (envío fijo)', en: 'Swap (fixed send)', pt: 'Troca (envio fixo)', de: 'Tausch (fester Versand)', fr: 'Échange (envoi fixe)' },
  'op.pathPaymentStrictReceive': { es: 'Intercambio (recepción fija)', en: 'Swap (fixed receive)', pt: 'Troca (receção fixa)', de: 'Tausch (fester Empfang)', fr: 'Échange (réception fixe)' },
  'op.changeTrust': { es: 'Añadir/quitar activo (trustline)', en: 'Add/remove asset (trustline)', pt: 'Adicionar/remover ativo (trustline)', de: 'Asset hinzufügen/entfernen (Trustline)', fr: 'Ajouter/retirer un actif (trustline)' },
  'op.manageSellOffer': { es: 'Orden de venta', en: 'Sell offer', pt: 'Ordem de venda', de: 'Verkaufsangebot', fr: 'Ordre de vente' },
  'op.manageBuyOffer': { es: 'Orden de compra', en: 'Buy offer', pt: 'Ordem de compra', de: 'Kaufangebot', fr: 'Ordre d’achat' },
  'op.createPassiveSellOffer': { es: 'Orden de venta pasiva', en: 'Passive sell offer', pt: 'Ordem de venda passiva', de: 'Passives Verkaufsangebot', fr: 'Ordre de vente passif' },
  'op.liquidityPoolDeposit': { es: 'Depósito en pool de liquidez', en: 'Liquidity pool deposit', pt: 'Depósito em pool de liquidez', de: 'Einzahlung in Liquiditätspool', fr: 'Dépôt en pool de liquidité' },
  'op.liquidityPoolWithdraw': { es: 'Retiro de pool de liquidez', en: 'Liquidity pool withdrawal', pt: 'Levantamento de pool de liquidez', de: 'Entnahme aus Liquiditätspool', fr: 'Retrait de pool de liquidité' },
  'op.manageData': { es: 'Escribir dato en la cuenta', en: 'Write data on the account', pt: 'Escrever dados na conta', de: 'Daten im Konto schreiben', fr: 'Écrire une donnée sur le compte' },
  'op.bumpSequence': { es: 'Avanzar número de secuencia', en: 'Bump sequence number', pt: 'Avançar número de sequência', de: 'Sequenznummer erhöhen', fr: 'Avancer le numéro de séquence' },
  'op.createClaimableBalance': { es: 'Crear saldo reclamable', en: 'Create claimable balance', pt: 'Criar saldo reclamável', de: 'Beanspruchbares Guthaben erstellen', fr: 'Créer un solde réclamable' },
  'op.claimClaimableBalance': { es: 'Reclamar saldo', en: 'Claim balance', pt: 'Reclamar saldo', de: 'Guthaben beanspruchen', fr: 'Réclamer le solde' },
  'op.invokeHostFunction': { es: '⚠️ INVOCAR CONTRATO (SOROBAN) — CONTENIDO NO LEGIBLE', en: '⚠️ CALL CONTRACT (SOROBAN) — CONTENTS NOT READABLE', pt: '⚠️ INVOCAR CONTRATO (SOROBAN) — CONTEÚDO NÃO LEGÍVEL', de: '⚠️ VERTRAG AUFRUFEN (SOROBAN) — INHALT NICHT LESBAR', fr: '⚠️ APPELER UN CONTRAT (SOROBAN) — CONTENU ILLISIBLE' },
  'op.setOptions': { es: '⚠️ CAMBIAR FIRMANTES / UMBRALES DE TU CUENTA', en: '⚠️ CHANGE YOUR ACCOUNT’S SIGNERS / THRESHOLDS', pt: '⚠️ ALTERAR SIGNATÁRIOS / LIMIARES DA TUA CONTA', de: '⚠️ UNTERZEICHNER / SCHWELLEN DEINES KONTOS ÄNDERN', fr: '⚠️ MODIFIER LES SIGNATAIRES / SEUILS DE TON COMPTE' },
  'op.accountMerge': { es: '⚠️ FUSIONAR (VACIAR) TU CUENTA', en: '⚠️ MERGE (EMPTY) YOUR ACCOUNT', pt: '⚠️ FUNDIR (ESVAZIAR) A TUA CONTA', de: '⚠️ DEIN KONTO ZUSAMMENFÜHREN (LEEREN)', fr: '⚠️ FUSIONNER (VIDER) TON COMPTE' },
  'op.allowTrust': { es: '⚠️ Cambiar autorización de trustline', en: '⚠️ Change trustline authorisation', pt: '⚠️ Alterar autorização de trustline', de: '⚠️ Trustline-Autorisierung ändern', fr: '⚠️ Modifier l’autorisation de trustline' },
  'op.setTrustLineFlags': { es: '⚠️ Cambiar flags de trustline', en: '⚠️ Change trustline flags', pt: '⚠️ Alterar flags de trustline', de: '⚠️ Trustline-Flags ändern', fr: '⚠️ Modifier les flags de trustline' },
  'op.clawback': { es: '⚠️ Clawback de activos', en: '⚠️ Asset clawback', pt: '⚠️ Clawback de ativos', de: '⚠️ Asset-Clawback', fr: '⚠️ Clawback d’actifs' },
  'op.clawbackClaimableBalance': { es: '⚠️ Clawback de saldo reclamable', en: '⚠️ Claimable-balance clawback', pt: '⚠️ Clawback de saldo reclamável', de: '⚠️ Clawback eines beanspruchbaren Guthabens', fr: '⚠️ Clawback de solde réclamable' },
  'op.beginSponsoringFutureReserves': { es: '⚠️ Iniciar patrocinio de reservas', en: '⚠️ Begin sponsoring reserves', pt: '⚠️ Iniciar patrocínio de reservas', de: '⚠️ Reserven-Sponsoring beginnen', fr: '⚠️ Commencer le parrainage des réserves' },
  'op.endSponsoringFutureReserves': { es: '⚠️ Finalizar patrocinio de reservas', en: '⚠️ End sponsoring reserves', pt: '⚠️ Terminar patrocínio de reservas', de: '⚠️ Reserven-Sponsoring beenden', fr: '⚠️ Terminer le parrainage des réserves' },
  'op.revokeSponsorship': { es: '⚠️ Revocar patrocinio', en: '⚠️ Revoke sponsorship', pt: '⚠️ Revogar patrocínio', de: '⚠️ Sponsoring widerrufen', fr: '⚠️ Révoquer le parrainage' },
  // ---- errors thrown from lib/ (network, vault, wallet, memo, endpoints) ----
  // Thrown as `Error(t(...))` so a caller that only knows how to show `e.message`
  // keeps working. Where a caller needs to BRANCH, it branches on the error type —
  // never on the text (see WrongPasswordError, TxGuardError).
  'tx.badAmount': { es: 'Importe no válido.', en: 'Invalid amount.', pt: 'Valor inválido.', de: 'Ungültiger Betrag.', fr: 'Montant invalide.' },
  'tx.err.underfunded': { es: 'Saldo insuficiente para cubrir el importe y la comisión.', en: 'Not enough balance to cover the amount and the fee.', pt: 'Saldo insuficiente para cobrir o valor e a comissão.', de: 'Guthaben reicht nicht für Betrag und Gebühr.', fr: 'Solde insuffisant pour couvrir le montant et les frais.' },
  'tx.err.noDestination': { es: 'La cuenta de destino no existe.', en: 'The destination account does not exist.', pt: 'A conta de destino não existe.', de: 'Das Zielkonto existiert nicht.', fr: 'Le compte de destination n’existe pas.' },
  'tx.err.lowReserve': { es: 'El importe es menor que la reserva mínima (1 XLM) para crear la cuenta.', en: 'The amount is below the minimum reserve (1 XLM) needed to create the account.', pt: 'O valor é inferior à reserva mínima (1 XLM) para criar a conta.', de: 'Der Betrag liegt unter der Mindestreserve (1 XLM), die zum Anlegen des Kontos nötig ist.', fr: 'Le montant est inférieur à la réserve minimale (1 XLM) requise pour créer le compte.' },
  'tx.err.insufficientBalance': { es: 'Saldo insuficiente.', en: 'Not enough balance.', pt: 'Saldo insuficiente.', de: 'Nicht genügend Guthaben.', fr: 'Solde insuffisant.' },
  'tx.err.badSequence': { es: 'Error de secuencia, inténtalo de nuevo.', en: 'Sequence error, please try again.', pt: 'Erro de sequência, tenta novamente.', de: 'Sequenzfehler, bitte erneut versuchen.', fr: 'Erreur de séquence, réessaie.' },
  'tx.err.rejected': { es: 'La red rechazó la transacción ({code}).', en: 'The network rejected the transaction ({code}).', pt: 'A rede rejeitou a transação ({code}).', de: 'Das Netzwerk hat die Transaktion abgelehnt ({code}).', fr: 'Le réseau a rejeté la transaction ({code}).' },
  'tx.err.submitFailed': { es: 'No se pudo enviar la transacción.', en: 'The transaction could not be submitted.', pt: 'Não foi possível enviar a transação.', de: 'Die Transaktion konnte nicht gesendet werden.', fr: 'La transaction n’a pas pu être envoyée.' },
  'tx.err.friendbotTestnetOnly': { es: 'Friendbot solo está disponible en Testnet.', en: 'Friendbot is only available on Testnet.', pt: 'O Friendbot só está disponível na Testnet.', de: 'Friendbot ist nur im Testnet verfügbar.', fr: 'Friendbot n’est disponible que sur Testnet.' },

  'wallet.badMnemonic': { es: 'La frase de recuperación no es válida.', en: 'That recovery phrase is not valid.', pt: 'A frase de recuperação não é válida.', de: 'Diese Wiederherstellungsphrase ist ungültig.', fr: 'Cette phrase de récupération n’est pas valide.' },
  'wallet.badSecret': { es: 'La clave secreta no es válida (debe empezar por «S»).', en: 'That secret key is not valid (it must start with “S”).', pt: 'A chave secreta não é válida (deve começar por «S»).', de: 'Dieser geheime Schlüssel ist ungültig (er muss mit „S“ beginnen).', fr: 'Cette clé secrète n’est pas valide (elle doit commencer par « S »).' },
  'wallet.emptyImport': { es: 'Introduce tu frase de recuperación o clave secreta.', en: 'Enter your recovery phrase or secret key.', pt: 'Introduz a tua frase de recuperação ou chave secreta.', de: 'Gib deine Wiederherstellungsphrase oder deinen geheimen Schlüssel ein.', fr: 'Saisis ta phrase de récupération ou ta clé secrète.' },

  'memo.idMustBeInteger': { es: 'El memo ID debe ser un número entero.', en: 'A memo ID must be a whole number.', pt: 'O memo ID deve ser um número inteiro.', de: 'Eine Memo-ID muss eine ganze Zahl sein.', fr: 'Un mémo ID doit être un nombre entier.' },
  'memo.overByteLimit': { es: 'El memo supera el límite de {max} bytes (te sobran {over}).', en: 'The memo is over the {max}-byte limit (by {over}).', pt: 'O memo excede o limite de {max} bytes (por {over}).', de: 'Das Memo überschreitet das Limit von {max} Bytes (um {over}).', fr: 'Le mémo dépasse la limite de {max} octets (de {over}).' },

  'validate.needsHttps': { es: 'Usa https:// — con http tu saldo y tus transacciones viajan sin cifrar.', en: 'Use https:// — over http your balance and transactions travel unencrypted.', pt: 'Usa https:// — em http o teu saldo e as tuas transações viajam sem cifrar.', de: 'Nutze https:// — über http reisen dein Guthaben und deine Transaktionen unverschlüsselt.', fr: 'Utilise https:// — en http ton solde et tes transactions circulent en clair.' },
  'validate.mustStartHttps': { es: 'La dirección debe empezar por https://', en: 'The address must start with https://', pt: 'O endereço deve começar por https://', de: 'Die Adresse muss mit https:// beginnen', fr: 'L’adresse doit commencer par https://' },
  'validate.notAUrl': { es: 'La dirección no es una URL válida.', en: 'That address is not a valid URL.', pt: 'O endereço não é um URL válido.', de: 'Diese Adresse ist keine gültige URL.', fr: 'Cette adresse n’est pas une URL valide.' },

  'vault.notFound': { es: 'No se encontró la wallet en este dispositivo.', en: 'That wallet was not found on this device.', pt: 'A wallet não foi encontrada neste dispositivo.', de: 'Diese Wallet wurde auf diesem Gerät nicht gefunden.', fr: 'Ce portefeuille est introuvable sur cet appareil.' },
  'vault.noLocalKey': { es: 'Esta wallet no guarda su clave en este dispositivo: la custodia Pollar.', en: 'This wallet does not keep its key on this device — Pollar custodies it.', pt: 'Esta wallet não guarda a sua chave neste dispositivo: a Pollar é que a custodia.', de: 'Diese Wallet bewahrt ihren Schlüssel nicht auf diesem Gerät auf — Pollar verwahrt ihn.', fr: 'Ce portefeuille ne conserve pas sa clé sur cet appareil : Pollar en assure la garde.' },

  /* Pollar — social login that hands back a Pollar-custodied Stellar account. */
  'pollar.title': { es: 'Entrar con una cuenta social', en: 'Sign in with a social account', pt: 'Entrar com uma conta social', de: 'Mit einem sozialen Konto anmelden', fr: 'Se connecter avec un compte social' },
  'pollar.desc': { es: 'Pollar crea y custodia una cuenta Stellar por vos. No vas a ver una frase de recuperación, y tampoco vas a poder exportar la clave.', en: 'Pollar creates and custodies a Stellar account for you. You will not see a recovery phrase, and you will not be able to export the key either.', pt: 'A Pollar cria e guarda uma conta Stellar por si. Não verá uma frase de recuperação, nem poderá exportar a chave.', de: 'Pollar erstellt und verwahrt ein Stellar-Konto für Sie. Sie sehen keine Wiederherstellungsphrase und können den Schlüssel auch nicht exportieren.', fr: 'Pollar crée et conserve un compte Stellar pour vous. Vous ne verrez pas de phrase de récupération et vous ne pourrez pas non plus exporter la clé.' },
  'pollar.custodialWarning': { es: 'Cuenta custodiada: Pollar tiene la clave y puede negarse a firmar. Para una wallet que controles solo vos, creá una con frase de recuperación.', en: 'Custodial account: Pollar holds the key and can refuse to sign. For a wallet only you control, create one with a recovery phrase.', pt: 'Conta sob custódia: a Pollar detém a chave e pode recusar-se a assinar. Para uma wallet que só você controla, crie uma com frase de recuperação.', de: 'Verwahrtes Konto: Pollar hält den Schlüssel und kann die Signatur verweigern. Für eine Wallet, die nur Sie kontrollieren, erstellen Sie eine mit Wiederherstellungsphrase.', fr: 'Compte sous garde : Pollar détient la clé et peut refuser de signer. Pour un portefeuille que vous seul contrôlez, créez-en un avec une phrase de récupération.' },
  'pollar.custodialBadge': { es: 'Custodiada', en: 'Custodial', pt: 'Sob custódia', de: 'Verwahrt', fr: 'Sous garde' },
  'pollar.continueWith': { es: 'Continuar con {provider}', en: 'Continue with {provider}', pt: 'Continuar com {provider}', de: 'Weiter mit {provider}', fr: 'Continuer avec {provider}' },
  'pollar.opening': { es: 'Abriendo el inicio de sesión…', en: 'Opening the sign-in…', pt: 'A abrir o início de sessão…', de: 'Anmeldung wird geöffnet…', fr: 'Ouverture de la connexion…' },
  'pollar.waiting': { es: 'Esperando a que termines en el navegador…', en: 'Waiting for you to finish in the browser…', pt: 'A aguardar que termine no navegador…', de: 'Warten, bis Sie im Browser fertig sind…', fr: 'En attente de la fin dans le navigateur…' },
  'pollar.redeeming': { es: 'Preparando tu cuenta Stellar…', en: 'Preparing your Stellar account…', pt: 'A preparar a sua conta Stellar…', de: 'Ihr Stellar-Konto wird vorbereitet…', fr: 'Préparation de votre compte Stellar…' },
  'pollar.reopen': { es: 'Volver a abrir el inicio de sesión', en: 'Reopen the sign-in', pt: 'Reabrir o início de sessão', de: 'Anmeldung erneut öffnen', fr: 'Rouvrir la connexion' },
  'pollar.cancelled': { es: 'Inicio de sesión cancelado.', en: 'Sign-in cancelled.', pt: 'Início de sessão cancelado.', de: 'Anmeldung abgebrochen.', fr: 'Connexion annulée.' },
  'pollar.timedOut': { es: 'El inicio de sesión tardó demasiado. Probá de nuevo.', en: 'The sign-in took too long. Try again.', pt: 'O início de sessão demorou demasiado. Tente novamente.', de: 'Die Anmeldung hat zu lange gedauert. Versuchen Sie es erneut.', fr: 'La connexion a pris trop de temps. Réessayez.' },
  'pollar.badUrl': { es: 'El servidor devolvió una dirección de inicio de sesión que no es segura.', en: 'The server returned a sign-in address that is not secure.', pt: 'O servidor devolveu um endereço de início de sessão que não é seguro.', de: 'Der Server hat eine nicht sichere Anmeldeadresse zurückgegeben.', fr: 'Le serveur a renvoyé une adresse de connexion non sécurisée.' },
  'pollar.openFailed': { es: 'No se pudo abrir el navegador. Copiá el enlace y abrilo a mano.', en: 'Could not open the browser. Copy the link and open it yourself.', pt: 'Não foi possível abrir o navegador. Copie a ligação e abra-a manualmente.', de: 'Der Browser konnte nicht geöffnet werden. Kopieren Sie den Link und öffnen Sie ihn selbst.', fr: 'Impossible d’ouvrir le navigateur. Copiez le lien et ouvrez-le vous-même.' },
  'pollar.copyLink': { es: 'Copiar enlace', en: 'Copy link', pt: 'Copiar ligação', de: 'Link kopieren', fr: 'Copier le lien' },
  'pollar.status.authorized': { es: 'El inicio de sesión terminó pero no llegó el código. Probá de nuevo.', en: 'The sign-in finished but no code arrived. Try again.', pt: 'O início de sessão terminou mas não chegou o código. Tente novamente.', de: 'Die Anmeldung ist abgeschlossen, aber es kam kein Code an. Versuchen Sie es erneut.', fr: 'La connexion est terminée mais aucun code n’est arrivé. Réessayez.' },
  'pollar.status.exchanging': { es: 'Ya hay un canje en curso para este inicio de sesión.', en: 'A redemption is already in flight for this sign-in.', pt: 'Já existe um resgate em curso para este início de sessão.', de: 'Für diese Anmeldung läuft bereits eine Einlösung.', fr: 'Un échange est déjà en cours pour cette connexion.' },
  'pollar.status.consumed': { es: 'Este inicio de sesión ya se usó. Empezá uno nuevo.', en: 'This sign-in was already used. Start a new one.', pt: 'Este início de sessão já foi utilizado. Comece um novo.', de: 'Diese Anmeldung wurde bereits verwendet. Starten Sie eine neue.', fr: 'Cette connexion a déjà été utilisée. Recommencez.' },
  'pollar.status.failed': { es: 'El inicio de sesión falló. Empezá uno nuevo.', en: 'The sign-in failed. Start a new one.', pt: 'O início de sessão falhou. Comece um novo.', de: 'Die Anmeldung ist fehlgeschlagen. Starten Sie eine neue.', fr: 'La connexion a échoué. Recommencez.' },
  'pollar.status.expired': { es: 'El inicio de sesión venció. Empezá uno nuevo.', en: 'The sign-in expired. Start a new one.', pt: 'O início de sessão expirou. Comece um novo.', de: 'Die Anmeldung ist abgelaufen. Starten Sie eine neue.', fr: 'La connexion a expiré. Recommencez.' },
  'pollar.providerError': { es: 'Pollar rechazó la operación ({code}).', en: 'Pollar refused the operation ({code}).', pt: 'A Pollar recusou a operação ({code}).', de: 'Pollar hat den Vorgang abgelehnt ({code}).', fr: 'Pollar a refusé l’opération ({code}).' },
  'pollar.emptyResponse': { es: 'Pollar respondió sin contenido.', en: 'Pollar answered with no content.', pt: 'A Pollar respondeu sem conteúdo.', de: 'Pollar hat ohne Inhalt geantwortet.', fr: 'Pollar a répondu sans contenu.' },
  'pollar.noWallet': { es: 'Pollar todavía no creó tu cuenta Stellar.', en: 'Pollar has not created your Stellar account yet.', pt: 'A Pollar ainda não criou a sua conta Stellar.', de: 'Pollar hat Ihr Stellar-Konto noch nicht erstellt.', fr: 'Pollar n’a pas encore créé votre compte Stellar.' },
  'pollar.sigNotATransaction': { es: 'La respuesta de Pollar no es una transacción válida. No se envió nada.', en: 'The response from Pollar is not a valid transaction. Nothing was submitted.', pt: 'A resposta da Pollar não é uma transação válida. Nada foi enviado.', de: 'Die Antwort von Pollar ist keine gültige Transaktion. Es wurde nichts eingereicht.', fr: 'La réponse de Pollar n’est pas une transaction valide. Rien n’a été envoyé.' },
  'pollar.sigDifferentTx': { es: 'Pollar firmó una transacción distinta de la que confirmaste. No se envió nada.', en: 'Pollar signed a different transaction from the one you confirmed. Nothing was submitted.', pt: 'A Pollar assinou uma transação diferente da que confirmou. Nada foi enviado.', de: 'Pollar hat eine andere Transaktion signiert als die von Ihnen bestätigte. Es wurde nichts eingereicht.', fr: 'Pollar a signé une transaction différente de celle que vous avez confirmée. Rien n’a été envoyé.' },
  'pollar.sigUnsigned': { es: 'Pollar devolvió la transacción sin firmar. No se envió nada.', en: 'Pollar returned the transaction unsigned. Nothing was submitted.', pt: 'A Pollar devolveu a transação sem assinatura. Nada foi enviado.', de: 'Pollar hat die Transaktion unsigniert zurückgegeben. Es wurde nichts eingereicht.', fr: 'Pollar a renvoyé la transaction non signée. Rien n’a été envoyé.' },
  'pollar.sigWrongSigner': { es: 'La firma de Pollar no corresponde a tu cuenta. No se envió nada.', en: 'The signature from Pollar does not belong to your account. Nothing was submitted.', pt: 'A assinatura da Pollar não corresponde à sua conta. Nada foi enviado.', de: 'Die Signatur von Pollar gehört nicht zu Ihrem Konto. Es wurde nichts eingereicht.', fr: 'La signature de Pollar ne correspond pas à votre compte. Rien n’a été envoyé.' },
  'pollar.sigFeeTooHigh': { es: 'Pollar envolvió la transacción con una comisión demasiado alta. No se envió nada.', en: 'Pollar wrapped the transaction with too high a fee. Nothing was submitted.', pt: 'A Pollar envolveu a transação com uma taxa demasiado alta. Nada foi enviado.', de: 'Pollar hat die Transaktion mit einer zu hohen Gebühr umhüllt. Es wurde nichts eingereicht.', fr: 'Pollar a encapsulé la transaction avec des frais trop élevés. Rien n’a été envoyé.' },
  'pollar.sessionExpired': { es: 'Tu sesión de Pollar venció. Volvé a entrar.', en: 'Your Pollar session expired. Sign in again.', pt: 'A sua sessão Pollar expirou. Inicie sessão novamente.', de: 'Ihre Pollar-Sitzung ist abgelaufen. Melden Sie sich erneut an.', fr: 'Votre session Pollar a expiré. Reconnectez-vous.' },
  'pollar.accountCreated': { es: 'Tu cuenta de Cosmos Pay quedó lista.', en: 'Your Cosmos Pay account is ready.', pt: 'A sua conta Cosmos Pay está pronta.', de: 'Ihr Cosmos-Pay-Konto ist bereit.', fr: 'Votre compte Cosmos Pay est prêt.' },
  'pollar.accountLinked': { es: 'Vinculamos esta wallet a tu cuenta de Cosmos Pay.', en: 'This wallet is linked to your existing Cosmos Pay account.', pt: 'Esta carteira ficou ligada à sua conta Cosmos Pay.', de: 'Diese Wallet ist mit Ihrem bestehenden Cosmos-Pay-Konto verknüpft.', fr: 'Ce portefeuille est lié à votre compte Cosmos Pay existant.' },
  'pollar.noAccount': { es: 'Entraste, pero el proveedor no devolvió un email: los swaps y las operaciones con dinero fiat quedan desactivados.', en: 'Signed in, but the provider returned no email: swaps and fiat operations stay off.', pt: 'Entrou, mas o fornecedor não devolveu um email: os swaps e as operações em moeda fiduciária ficam desativados.', de: 'Angemeldet, aber der Anbieter hat keine E-Mail zurückgegeben: Swaps und Fiat-Vorgänge bleiben deaktiviert.', fr: 'Connecté, mais le fournisseur n’a renvoyé aucun e-mail : les swaps et les opérations en monnaie fiduciaire restent désactivés.' },
  'pollar.passwordDesc': { es: 'Elegí una contraseña para proteger esta sesión en este dispositivo. No es la de Google ni la de GitHub, y no se envía a ningún lado.', en: 'Choose a password to protect this session on this device. It is not your Google or GitHub password, and it never leaves the device.', pt: 'Escolha uma palavra-passe para proteger esta sessão neste dispositivo. Não é a do Google nem a do GitHub e nunca sai do dispositivo.', de: 'Wählen Sie ein Passwort, um diese Sitzung auf diesem Gerät zu schützen. Es ist nicht Ihr Google- oder GitHub-Passwort und verlässt das Gerät nie.', fr: 'Choisissez un mot de passe pour protéger cette session sur cet appareil. Ce n’est pas celui de Google ou de GitHub, et il ne quitte jamais l’appareil.' },
  'pollar.activated': { es: 'Cuenta activada en la red ({amount} XLM).', en: 'Account activated on-chain ({amount} XLM).', pt: 'Conta ativada na rede ({amount} XLM).', de: 'Konto on-chain aktiviert ({amount} XLM).', fr: 'Compte activé sur le réseau ({amount} XLM).' },
  'pollar.signOut': { es: 'Cerrar sesión de Pollar', en: 'Sign out of Pollar', pt: 'Terminar sessão da Pollar', de: 'Von Pollar abmelden', fr: 'Se déconnecter de Pollar' },
  'pollar.signOutMsg': { es: 'Se va a quitar esta cuenta de este dispositivo. No perdés nada: volviendo a entrar con la misma cuenta social recuperás la misma wallet y sus fondos.', en: 'This account will be removed from this device. Nothing is lost: signing in with the same social account gives you back the same wallet and its funds.', pt: 'Esta conta será removida deste dispositivo. Não perde nada: ao entrar com a mesma conta social recupera a mesma wallet e os seus fundos.', de: 'Dieses Konto wird von diesem Gerät entfernt. Nichts geht verloren: Eine erneute Anmeldung mit demselben sozialen Konto stellt dieselbe Wallet samt Guthaben wieder her.', fr: 'Ce compte sera retiré de cet appareil. Rien n’est perdu : en vous reconnectant avec le même compte social, vous retrouvez le même portefeuille et ses fonds.' },
  'vault.keyMismatch': { es: 'Esta wallet debe abrirse otra vez con tu contraseña.', en: 'This wallet has to be opened again with your password.', pt: 'Esta wallet tem de ser aberta outra vez com a tua palavra-passe.', de: 'Diese Wallet muss erneut mit deinem Passwort geöffnet werden.', fr: 'Ce portefeuille doit être rouvert avec ton mot de passe.' },
  'vault.passwordChangeFailed': { es: 'No se pudo completar el cambio de contraseña.', en: 'The password change could not be completed.', pt: 'Não foi possível concluir a alteração da palavra-passe.', de: 'Die Passwortänderung konnte nicht abgeschlossen werden.', fr: 'Le changement de mot de passe n’a pas pu être terminé.' },

  'api.requestFailed': { es: 'La solicitud falló ({status}).', en: 'The request failed ({status}).', pt: 'O pedido falhou ({status}).', de: 'Die Anfrage ist fehlgeschlagen ({status}).', fr: 'La requête a échoué ({status}).' },
  'api.uploadFailed': { es: 'La subida falló ({status}).', en: 'The upload failed ({status}).', pt: 'O carregamento falhou ({status}).', de: 'Der Upload ist fehlgeschlagen ({status}).', fr: 'L’envoi a échoué ({status}).' },
  'api.rateLimited': { es: 'Demasiados intentos. Esperá un momento y volvé a probar.', en: 'Too many attempts. Wait a moment and try again.', pt: 'Demasiadas tentativas. Aguarde um momento e tente novamente.', de: 'Zu viele Versuche. Warten Sie einen Moment und versuchen Sie es erneut.', fr: 'Trop de tentatives. Patientez un instant et réessayez.' },
  'api.rateLimitedRetry': { es: 'Demasiados intentos. Volvé a probar en {seconds} s.', en: 'Too many attempts. Try again in {seconds}s.', pt: 'Demasiadas tentativas. Tente novamente em {seconds} s.', de: 'Zu viele Versuche. Versuchen Sie es in {seconds} s erneut.', fr: 'Trop de tentatives. Réessayez dans {seconds} s.' },

  'send.max': { es: 'Máx', en: 'Max', pt: 'Máx', de: 'Max', fr: 'Max' },
  'sign.foreignSource': { es: 'Esa transacción no sale de tu cuenta. No se ha firmado.', en: 'That transaction does not come from your account. It was not signed.', pt: 'Essa transação não sai da tua conta. Não foi assinada.', de: 'Diese Transaktion stammt nicht aus deinem Konto. Sie wurde nicht signiert.', fr: 'Cette transaction ne provient pas de ton compte. Elle n’a pas été signée.' },
  // ---- fiat rails, countries and bank fields (src/constants/fiat.ts) ----
  // The tables hold keys, not copy: `constants/` cannot reach the translator, so a
  // literal there is one that could never be translated. Rail names keep their proper
  // nouns (PIX, SPEI, CLABE, CBU) in every language — those are the words printed on
  // the user's own bank screen.
  'fiat.country.BR': { es: 'Brasil', en: 'Brazil', pt: 'Brasil', de: 'Brasilien', fr: 'Brésil' },
  'fiat.country.CO': { es: 'Colombia', en: 'Colombia', pt: 'Colômbia', de: 'Kolumbien', fr: 'Colombie' },
  'fiat.country.AR': { es: 'Argentina', en: 'Argentina', pt: 'Argentina', de: 'Argentinien', fr: 'Argentine' },
  'fiat.country.MX': { es: 'México', en: 'Mexico', pt: 'México', de: 'Mexiko', fr: 'Mexique' },
  'fiat.country.CL': { es: 'Chile', en: 'Chile', pt: 'Chile', de: 'Chile', fr: 'Chili' },
  'fiat.country.PE': { es: 'Perú', en: 'Peru', pt: 'Peru', de: 'Peru', fr: 'Pérou' },
  'fiat.country.UY': { es: 'Uruguay', en: 'Uruguay', pt: 'Uruguai', de: 'Uruguay', fr: 'Uruguay' },

  'fiat.rail.pix': { es: 'PIX · Brasil (BRL)', en: 'PIX · Brazil (BRL)', pt: 'PIX · Brasil (BRL)', de: 'PIX · Brasilien (BRL)', fr: 'PIX · Brésil (BRL)' },
  'fiat.rail.spei': { es: 'SPEI · México (MXN)', en: 'SPEI · Mexico (MXN)', pt: 'SPEI · México (MXN)', de: 'SPEI · Mexiko (MXN)', fr: 'SPEI · Mexique (MXN)' },
  'fiat.rail.transfers': { es: 'Transferencia · Argentina (ARS)', en: 'Bank transfer · Argentina (ARS)', pt: 'Transferência · Argentina (ARS)', de: 'Überweisung · Argentinien (ARS)', fr: 'Virement · Argentine (ARS)' },
  'fiat.rail.achCop': { es: 'ACH · Colombia (COP)', en: 'ACH · Colombia (COP)', pt: 'ACH · Colômbia (COP)', de: 'ACH · Kolumbien (COP)', fr: 'ACH · Colombie (COP)' },
  'fiat.rail.ted': { es: 'TED · Brasil (BRL)', en: 'TED · Brazil (BRL)', pt: 'TED · Brasil (BRL)', de: 'TED · Brasilien (BRL)', fr: 'TED · Brésil (BRL)' },
  'fiat.rail.ach': { es: 'ACH · EE. UU. (USD)', en: 'ACH · United States (USD)', pt: 'ACH · EUA (USD)', de: 'ACH · USA (USD)', fr: 'ACH · États-Unis (USD)' },
  'fiat.rail.pse': { es: 'PSE · Colombia (COP)', en: 'PSE · Colombia (COP)', pt: 'PSE · Colômbia (COP)', de: 'PSE · Kolumbien (COP)', fr: 'PSE · Colombie (COP)' },
  'fiat.rail.wire': { es: 'Wire · EE. UU. (USD)', en: 'Wire · United States (USD)', pt: 'Wire · EUA (USD)', de: 'Wire · USA (USD)', fr: 'Wire · États-Unis (USD)' },
  'fiat.rail.rtp': { es: 'RTP · EE. UU. (USD)', en: 'RTP · United States (USD)', pt: 'RTP · EUA (USD)', de: 'RTP · USA (USD)', fr: 'RTP · États-Unis (USD)' },

  'fiat.field.pixKey': { es: 'Clave PIX', en: 'PIX key', pt: 'Chave PIX', de: 'PIX-Schlüssel', fr: 'Clé PIX' },
  'fiat.field.cpf': { es: 'CPF', en: 'CPF', pt: 'CPF', de: 'CPF', fr: 'CPF' },
  'fiat.field.cpfCnpj': { es: 'CPF / CNPJ', en: 'CPF / CNPJ', pt: 'CPF / CNPJ', de: 'CPF / CNPJ', fr: 'CPF / CNPJ' },
  'fiat.field.beneficiary': { es: 'Beneficiario', en: 'Beneficiary', pt: 'Beneficiário', de: 'Begünstigter', fr: 'Bénéficiaire' },
  'fiat.field.clabe': { es: 'CLABE (18 dígitos)', en: 'CLABE (18 digits)', pt: 'CLABE (18 dígitos)', de: 'CLABE (18 Ziffern)', fr: 'CLABE (18 chiffres)' },
  'fiat.field.cbuCvuAlias': { es: 'CBU / CVU / Alias', en: 'CBU / CVU / Alias', pt: 'CBU / CVU / Alias', de: 'CBU / CVU / Alias', fr: 'CBU / CVU / Alias' },
  'fiat.field.type': { es: 'Tipo', en: 'Type', pt: 'Tipo', de: 'Typ', fr: 'Type' },
  'fiat.field.cuitCuil': { es: 'CUIT / CUIL', en: 'CUIT / CUIL', pt: 'CUIT / CUIL', de: 'CUIT / CUIL', fr: 'CUIT / CUIL' },
  'fiat.field.payerCuit': { es: 'CUIT/CUIL del pagador', en: 'Payer’s CUIT/CUIL', pt: 'CUIT/CUIL do pagador', de: 'CUIT/CUIL des Zahlers', fr: 'CUIT/CUIL du payeur' },
  'fiat.field.firstName': { es: 'Nombre', en: 'First name', pt: 'Nome', de: 'Vorname', fr: 'Prénom' },
  'fiat.field.lastName': { es: 'Apellido', en: 'Last name', pt: 'Apelido', de: 'Nachname', fr: 'Nom' },
  'fiat.field.fullName': { es: 'Nombre completo', en: 'Full name', pt: 'Nome completo', de: 'Vollständiger Name', fr: 'Nom complet' },
  'fiat.field.docType': { es: 'Tipo doc', en: 'Document type', pt: 'Tipo de doc.', de: 'Dokumentart', fr: 'Type de document' },
  'fiat.field.document': { es: 'Documento', en: 'Document', pt: 'Documento', de: 'Dokument', fr: 'Document' },
  'fiat.field.documentNumber': { es: 'Nº de documento', en: 'Document number', pt: 'Nº do documento', de: 'Dokumentnummer', fr: 'N° de document' },
  'fiat.field.bankCode': { es: 'Código de banco', en: 'Bank code', pt: 'Código do banco', de: 'Bankleitzahl', fr: 'Code banque' },
  'fiat.field.branch': { es: 'Agencia', en: 'Branch', pt: 'Agência', de: 'Filiale', fr: 'Agence' },
  'fiat.field.accountNumber': { es: 'Nº de cuenta', en: 'Account number', pt: 'Nº da conta', de: 'Kontonummer', fr: 'N° de compte' },
  'fiat.field.accountNumberUs': { es: 'Account number', en: 'Account number', pt: 'Account number', de: 'Account number', fr: 'Account number' },
  'fiat.field.routingNumber': { es: 'Routing number', en: 'Routing number', pt: 'Routing number', de: 'Routing number', fr: 'Routing number' },
  'fiat.field.email': { es: 'Email', en: 'Email', pt: 'Email', de: 'E-Mail', fr: 'E-mail' },
  'fiat.field.phone': { es: 'Teléfono', en: 'Phone', pt: 'Telefone', de: 'Telefon', fr: 'Téléphone' },
};

export function makeT(lang: Lang) {
  return (key: string, params?: Record<string, string | number>): string => {
    const entry = T[key];
    let s = entry ? entry[lang] ?? entry.en : key;
    // replaceAll, not replace: a string that uses the same placeholder twice used to
    // render it once and leave the literal `{name}` visible in the second slot.
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export type TFn = ReturnType<typeof makeT>;
