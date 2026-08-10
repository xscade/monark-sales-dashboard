import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface NormalizedPhone {
  /** E.164 with the leading '+', e.g. "+919876543210". Canonical storage form. */
  e164: string;
  /** Digits only, no '+', e.g. "919876543210". Meta's expected hash input. */
  digits: string;
  countryCode: string;
  nationalNumber: string;
  isMobile: boolean;
  /** True when the number is not Indian — a useful NRI signal in this market. */
  isInternational: boolean;
}

export class PhoneNormalizationError extends Error {
  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = "PhoneNormalizationError";
  }
}

/**
 * Normalize a phone number to E.164.
 *
 * Phone is the de facto primary key for a person in the Indian real-estate
 * market — email is frequently absent, mistyped, or a throwaway. Everything
 * downstream (deduplication, identity resolution, ad-platform matching) rests
 * on this function producing one canonical form, so the messy inputs it has to
 * survive are worth enumerating:
 *
 *   "9876543210"          → +919876543210   (bare 10-digit, the common case)
 *   "09876543210"         → +919876543210   (STD leading zero)
 *   "+91 98765 43210"     → +919876543210
 *   "91-9876543210"       → +919876543210
 *   "0091 9876543210"     → +919876543210   (ISD prefix)
 *   "+971 50 123 4567"    → +971501234567   (NRI, Dubai)
 *
 * Ambiguity is resolved in favour of `defaultCountry`, because a bare 10-digit
 * string is only interpretable with an assumed region.
 */
export interface NormalizePhoneOptions {
  defaultCountry?: CountryCode;
  /**
   * Accept Indian numbers outside the mobile ranges.
   *
   * Off by default. India's numbering plan reserves leading digits 6–9 for
   * mobile, and this business runs on mobile: you cannot WhatsApp a landline,
   * and neither Meta nor Google can match a landline against a user account, so
   * a landline lead is close to worthless for both selling and attribution.
   *
   * More importantly, libphonenumber's `isValid()` for IN is permissive enough
   * to wave through obvious junk like "1234567890", which is exactly the shape
   * bot-filled forms produce. Requiring mobile is the cheapest reliable filter.
   *
   * Manual entry can pass `true` when a genuine landline enquiry arrives.
   */
  allowNonMobile?: boolean;
}

export function normalizePhone(
  input: string | null | undefined,
  optionsOrCountry: NormalizePhoneOptions | CountryCode = {},
): NormalizedPhone | null {
  const options: NormalizePhoneOptions =
    typeof optionsOrCountry === "string" ? { defaultCountry: optionsOrCountry } : optionsOrCountry;
  const defaultCountry = options.defaultCountry ?? "IN";
  const allowNonMobile = options.allowNonMobile ?? false;

  if (!input) return null;

  let cleaned = input.trim();
  if (!cleaned) return null;

  // Strip everything except digits and a single leading '+'.
  const hasPlus = cleaned.startsWith("+");
  cleaned = cleaned.replace(/[^\d]/g, "");
  if (!cleaned) return null;

  const done = (candidate: string) => finish(candidate, defaultCountry, allowNonMobile);

  if (hasPlus) return done(`+${cleaned}`);

  // "00" — ISD access code. libphonenumber does not reliably strip this when
  // the '+' is absent, so handle it before parsing.
  if (cleaned.startsWith("00")) return done(`+${cleaned.slice(2)}`);

  // Bare digits. For India, disambiguate the common shapes before falling back
  // to the generic parser.
  if (defaultCountry === "IN") {
    // "0919876543210" — STD zero followed by the country code. People type
    // this constantly; without an explicit case it parses as something else
    // entirely and silently produces a different hash than the same number
    // entered as "9876543210", splitting one person into two.
    if (cleaned.length === 13 && cleaned.startsWith("091")) {
      return done(`+${cleaned.slice(1)}`);
    }
    // 12 digits beginning with the country code: 91XXXXXXXXXX
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
      return done(`+${cleaned}`);
    }
    // 11 digits with an STD leading zero: 0XXXXXXXXXX
    if (cleaned.length === 11 && cleaned.startsWith("0")) {
      return done(`+91${cleaned.slice(1)}`);
    }
    if (cleaned.length === 10) return done(`+91${cleaned}`);
  }

  return done(cleaned);
}

function finish(
  candidate: string,
  defaultCountry: CountryCode,
  allowNonMobile: boolean,
): NormalizedPhone | null {
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;

  const type = parsed.getType();
  const nationalNumber = parsed.nationalNumber;

  // India: enforce the mobile numbering plan directly rather than trusting
  // libphonenumber's looser validity check. See NormalizePhoneOptions above.
  const isIndianMobile =
    nationalNumber.length === 10 && /^[6-9]/.test(nationalNumber);

  if (parsed.country === "IN" && !isIndianMobile && !allowNonMobile) {
    return null;
  }

  return {
    e164: parsed.number,
    digits: parsed.number.replace(/^\+/, ""),
    countryCode: String(parsed.countryCallingCode),
    nationalNumber,
    isMobile:
      parsed.country === "IN"
        ? isIndianMobile
        : type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE",
    isInternational: parsed.country !== "IN",
  };
}

/** Throwing variant, for code paths where an invalid number is a hard error. */
export function normalizePhoneOrThrow(
  input: string,
  defaultCountry: CountryCode = "IN",
): NormalizedPhone {
  const result = normalizePhone(input, defaultCountry);
  if (!result) {
    throw new PhoneNormalizationError(`Could not parse phone number: ${input}`, input);
  }
  return result;
}

/** Masked form for UI and logs: "+9198765•••10". Never log a full number. */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return "•".repeat(e164.length);
  return `${e164.slice(0, 8)}•••${e164.slice(-2)}`;
}
