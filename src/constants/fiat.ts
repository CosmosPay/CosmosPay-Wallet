/** Fiat (BlindPay on/off-ramp) tables: countries, KYC docs, bank rails and onramp
 *  payment methods. LatAm-first. Centralised so tweaking a rail or adding a country
 *  never means digging through the Fiat screens. */
import type { PayinMethod } from '@/lib/cosmospay';

export const COUNTRIES = [
  { code: 'BR', name: 'Brasil' },
  { code: 'CO', name: 'Colombia' },
  { code: 'AR', name: 'Argentina' },
  { code: 'MX', name: 'México' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Perú' },
  { code: 'UY', name: 'Uruguay' },
];

export const DOC_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'];

/* Deposit/payout rails per currency. Each `field` maps to the BlindPay
   bank-account body; `options` renders a select. */
export type RailField = { k: string; label: string; options?: string[] };
export const RAILS: { type: string; label: string; fields: RailField[] }[] = [
  { type: 'pix', label: 'PIX · Brasil (BRL)', fields: [{ k: 'pix_key', label: 'Clave PIX' }, { k: 'tax_id', label: 'CPF' }] },
  { type: 'spei_bitso', label: 'SPEI · México (MXN)', fields: [{ k: 'beneficiary_name', label: 'Beneficiario' }, { k: 'spei_clabe', label: 'CLABE (18 dígitos)' }] },
  { type: 'transfers_bitso', label: 'Transferencia · Argentina (ARS)', fields: [{ k: 'transfers_account', label: 'CBU / CVU / Alias' }, { k: 'transfers_type', label: 'Tipo', options: ['CBU', 'CVU', 'ALIAS'] }, { k: 'tax_id', label: 'CUIT / CUIL' }] },
  { type: 'ach_cop_bitso', label: 'ACH · Colombia (COP)', fields: [{ k: 'ach_cop_beneficiary_first_name', label: 'Nombre' }, { k: 'ach_cop_beneficiary_last_name', label: 'Apellido' }, { k: 'ach_cop_document_type', label: 'Tipo doc', options: ['CC', 'NIT', 'CE'] }, { k: 'ach_cop_document_id', label: 'Documento' }, { k: 'ach_cop_bank_code', label: 'Código de banco' }, { k: 'account_number', label: 'Nº de cuenta' }, { k: 'ach_cop_email', label: 'Email' }] },
  { type: 'ted', label: 'TED · Brasil (BRL)', fields: [{ k: 'ted_bank_code', label: 'Código de banco' }, { k: 'ted_branch_code', label: 'Agencia' }, { k: 'account_number', label: 'Nº de cuenta' }, { k: 'ted_cpf_cnpj', label: 'CPF / CNPJ' }] },
  { type: 'ach', label: 'ACH · EE. UU. (USD)', fields: [{ k: 'beneficiary_name', label: 'Beneficiario' }, { k: 'account_number', label: 'Account number' }, { k: 'routing_number', label: 'Routing number' }] },
];

/** Friendly label for a saved bank account's rail type (null-safe; falls back to the
 *  upper-cased raw type, or '' when the type is missing). */
export const railLabel = (type?: string | null) =>
  type ? (RAILS.find((r) => r.type === type)?.label ?? type.replace(/_/g, ' ').toUpperCase()) : '';

/** ISO currency for a BlindPay rail / payin method (used as the fiat amount suffix). */
export const RAIL_CCY: Record<string, string> = {
  pix: 'BRL', pix_safe: 'BRL', ted: 'BRL',
  spei: 'MXN', spei_bitso: 'MXN',
  transfers: 'ARS', transfers_bitso: 'ARS',
  pse: 'COP', ach_cop_bitso: 'COP',
  ach: 'USD', wire: 'USD', rtp: 'USD', international_swift: 'USD',
  sepa: 'EUR',
};
export const railCurrency = (rail?: string | null) => (rail ? RAIL_CCY[rail] ?? '' : '');

/** Trusted stablecoins the wallet accepts for on/off-ramp flows. */
export const STABLES = ['USDC', 'USDT', 'USDB'];

/** Onramp payment methods (LatAm-first) with the per-method payer fields BlindPay requires. */
export type PayerField = { k: string; label: string; options?: string[] };
export const PAY_METHODS: { method: PayinMethod; label: string; payer?: PayerField[] }[] = [
  { method: 'pix', label: 'PIX · Brasil (BRL)' },
  { method: 'spei', label: 'SPEI · México (MXN)' },
  {
    method: 'transfers',
    label: 'Transferencia · Argentina (ARS)',
    payer: [{ k: 'transfers_allowed_tax_id', label: 'CUIT/CUIL del pagador' }],
  },
  {
    method: 'pse',
    label: 'PSE · Colombia (COP)',
    payer: [
      { k: 'pse_full_name', label: 'Nombre completo' },
      { k: 'pse_document_type', label: 'Tipo doc', options: ['CC', 'NIT'] },
      { k: 'pse_document_number', label: 'Nº de documento' },
      { k: 'pse_email', label: 'Email' },
      { k: 'pse_phone', label: 'Teléfono' },
      { k: 'pse_bank_code', label: 'Código de banco' },
    ],
  },
  { method: 'ted', label: 'TED · Brasil (BRL)' },
  { method: 'ach', label: 'ACH · EE. UU. (USD)' },
  { method: 'wire', label: 'Wire · EE. UU. (USD)' },
  { method: 'rtp', label: 'RTP · EE. UU. (USD)' },
];
