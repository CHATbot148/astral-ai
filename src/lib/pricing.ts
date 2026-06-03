// Location-aware pricing. Base prices are stored in NGN (kobo for Paystack).
// We display in the user's local currency using approximate FX rates,
// but Paystack still charges in NGN (multi-currency support varies by account).

export type CurrencyCode = 'NGN' | 'USD' | 'EUR' | 'GBP' | 'GHS' | 'KES' | 'ZAR' | 'CAD' | 'AUD' | 'INR';

// Approximate FX rate from 1 NGN to target currency. Refreshed manually; close enough for display.
const FX_FROM_NGN: Record<CurrencyCode, number> = {
  NGN: 1,
  USD: 0.00065,
  EUR: 0.00060,
  GBP: 0.00052,
  GHS: 0.0096,
  KES: 0.084,
  ZAR: 0.012,
  CAD: 0.00089,
  AUD: 0.00099,
  INR: 0.055,
};

const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR',
  US: 'USD', CA: 'CAD', AU: 'AUD', IN: 'INR',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', PT: 'EUR', AT: 'EUR',
};

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: 'GH₵', KES: 'KSh', ZAR: 'R', CAD: 'CA$', AUD: 'A$', INR: '₹',
};

export interface LocaleInfo {
  country: string;
  currency: CurrencyCode;
}

const STORAGE_KEY = 'astraz_locale_v1';

export const getCachedLocale = (): LocaleInfo => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { country: 'NG', currency: 'NGN' };
};

export const detectLocale = async (): Promise<LocaleInfo> => {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.country) return parsed;
    }
  } catch {}
  try {
    const res = await fetch('https://ipapi.co/json/', { cache: 'force-cache' });
    if (res.ok) {
      const data = await res.json();
      const country = String(data.country_code || data.country || 'NG').toUpperCase();
      const currency = COUNTRY_TO_CURRENCY[country] || 'USD';
      const info: LocaleInfo = { country, currency };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(info)); } catch {}
      return info;
    }
  } catch {}
  return { country: 'NG', currency: 'NGN' };
};

const roundForCurrency = (amt: number, currency: CurrencyCode) => {
  if (currency === 'NGN' || currency === 'KES' || currency === 'INR' || currency === 'ZAR') {
    // Round to nearest 50 for "clean" pricing in low-unit currencies (NGN base)
    return Math.round(amt / 50) * 50;
  }
  // Nearest 0.99
  return Math.round(amt) - 0.01 < 0 ? Math.round(amt * 100) / 100 : Math.max(0.99, Math.round(amt) - 0.01);
};

export const convertFromNGN = (amountNGN: number, currency: CurrencyCode): number => {
  if (amountNGN === 0) return 0;
  const rate = FX_FROM_NGN[currency] ?? 1;
  return roundForCurrency(amountNGN * rate, currency);
};

export const formatLocalPrice = (amountNGN: number, currency: CurrencyCode): string => {
  const value = convertFromNGN(amountNGN, currency);
  const sym = CURRENCY_SYMBOL[currency] || '';
  if (currency === 'NGN' || currency === 'KES' || currency === 'INR' || currency === 'ZAR') {
    return `${sym}${Math.round(value).toLocaleString()}`;
  }
  return `${sym}${value.toFixed(2)}`;
};

// Cancellation fee in NGN (₦5,000), displayed localized.
export const CANCEL_FEE_NGN = 5000;
