/** Fiat (BlindPay on/off-ramp) tables: countries, KYC docs, bank rails and onramp
 *  payment methods. LatAm-first. Centralised so tweaking a rail or adding a country
 *  never means digging through the Fiat screens.
 *
 *  Every user-facing string here is an i18n KEY, never copy. `constants/` may not
 *  import from `lib/` at runtime, so it cannot call the translator — which means a
 *  literal in this file is a literal that can never be translated. The screens resolve
 *  `labelKey` / `nameKey`. See "Constants live in `constants/`" in CLAUDE.md. */
import type { PayinMethod } from '@/lib/cosmospay';

export const COUNTRIES = [
  { code: 'BR', nameKey: 'fiat.country.BR' },
  { code: 'CO', nameKey: 'fiat.country.CO' },
  { code: 'AR', nameKey: 'fiat.country.AR' },
  { code: 'MX', nameKey: 'fiat.country.MX' },
  { code: 'CL', nameKey: 'fiat.country.CL' },
  { code: 'PE', nameKey: 'fiat.country.PE' },
  { code: 'UY', nameKey: 'fiat.country.UY' },
];

export const DOC_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'];

/* Deposit/payout rails per currency. Each `field` maps to the BlindPay
   bank-account body; `options` renders a select. */
export type RailField = { k: string; labelKey: string; options?: string[] };
export const RAILS: { type: string; labelKey: string; fields: RailField[] }[] = [
  { type: 'pix', labelKey: 'fiat.rail.pix', fields: [{ k: 'pix_key', labelKey: 'fiat.field.pixKey' }, { k: 'tax_id', labelKey: 'fiat.field.cpf' }] },
  { type: 'spei_bitso', labelKey: 'fiat.rail.spei', fields: [{ k: 'beneficiary_name', labelKey: 'fiat.field.beneficiary' }, { k: 'spei_clabe', labelKey: 'fiat.field.clabe' }] },
  { type: 'transfers_bitso', labelKey: 'fiat.rail.transfers', fields: [{ k: 'transfers_account', labelKey: 'fiat.field.cbuCvuAlias' }, { k: 'transfers_type', labelKey: 'fiat.field.type', options: ['CBU', 'CVU', 'ALIAS'] }, { k: 'tax_id', labelKey: 'fiat.field.cuitCuil' }] },
  { type: 'ach_cop_bitso', labelKey: 'fiat.rail.achCop', fields: [{ k: 'ach_cop_beneficiary_first_name', labelKey: 'fiat.field.firstName' }, { k: 'ach_cop_beneficiary_last_name', labelKey: 'fiat.field.lastName' }, { k: 'ach_cop_document_type', labelKey: 'fiat.field.docType', options: ['CC', 'NIT', 'CE'] }, { k: 'ach_cop_document_id', labelKey: 'fiat.field.document' }, { k: 'ach_cop_bank_code', labelKey: 'fiat.field.bankCode' }, { k: 'account_number', labelKey: 'fiat.field.accountNumber' }, { k: 'ach_cop_email', labelKey: 'fiat.field.email' }] },
  { type: 'ted', labelKey: 'fiat.rail.ted', fields: [{ k: 'ted_bank_code', labelKey: 'fiat.field.bankCode' }, { k: 'ted_branch_code', labelKey: 'fiat.field.branch' }, { k: 'account_number', labelKey: 'fiat.field.accountNumber' }, { k: 'ted_cpf_cnpj', labelKey: 'fiat.field.cpfCnpj' }] },
  { type: 'ach', labelKey: 'fiat.rail.ach', fields: [{ k: 'beneficiary_name', labelKey: 'fiat.field.beneficiary' }, { k: 'account_number', labelKey: 'fiat.field.accountNumberUs' }, { k: 'routing_number', labelKey: 'fiat.field.routingNumber' }] },
];

/** ISO currency for a BlindPay rail / payin method (used as the fiat amount suffix). */
export const RAIL_CCY: Record<string, string> = {
  pix: 'BRL', pix_safe: 'BRL', ted: 'BRL',
  spei: 'MXN', spei_bitso: 'MXN',
  transfers: 'ARS', transfers_bitso: 'ARS',
  pse: 'COP', ach_cop_bitso: 'COP',
  ach: 'USD', wire: 'USD', rtp: 'USD', international_swift: 'USD',
  sepa: 'EUR',
};

/** Trusted stablecoins the wallet accepts for on/off-ramp flows. */
export const STABLES = ['USDC', 'USDT', 'USDB'];

/** Onramp payment methods (LatAm-first) with the per-method payer fields BlindPay requires. */
export type PayerField = { k: string; labelKey: string; options?: string[] };
export const PAY_METHODS: { method: PayinMethod; labelKey: string; payer?: PayerField[] }[] = [
  { method: 'pix', labelKey: 'fiat.rail.pix' },
  { method: 'spei', labelKey: 'fiat.rail.spei' },
  {
    method: 'transfers',
    labelKey: 'fiat.rail.transfers',
    payer: [{ k: 'transfers_allowed_tax_id', labelKey: 'fiat.field.payerCuit' }],
  },
  {
    method: 'pse',
    labelKey: 'fiat.rail.pse',
    payer: [
      { k: 'pse_full_name', labelKey: 'fiat.field.fullName' },
      { k: 'pse_document_type', labelKey: 'fiat.field.docType', options: ['CC', 'NIT'] },
      { k: 'pse_document_number', labelKey: 'fiat.field.documentNumber' },
      { k: 'pse_email', labelKey: 'fiat.field.email' },
      { k: 'pse_phone', labelKey: 'fiat.field.phone' },
      { k: 'pse_bank_code', labelKey: 'fiat.field.bankCode' },
    ],
  },
  { method: 'ted', labelKey: 'fiat.rail.ted' },
  { method: 'ach', labelKey: 'fiat.rail.ach' },
  { method: 'wire', labelKey: 'fiat.rail.wire' },
  { method: 'rtp', labelKey: 'fiat.rail.rtp' },
];
