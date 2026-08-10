import qrcode from "qrcode-generator";
import { normalizePhone } from "@monark/core";

export interface CallTarget {
  /** E.164, country code always present: "+919381167516". */
  e164: string;
  /** What the QR encodes and what the link dials. */
  tel: string;
  /** Grouped so it can be read aloud or copied down: "+91 93811 67516". */
  display: string;
  /** Country calling code on its own, for labelling the number. */
  countryCode: string;
  /** SVG path for the dark modules, drawn inside a `0 0 size size` viewBox. */
  qrPath: string;
  qrSize: number;
}

/**
 * Everything the Call control needs, resolved once on the server.
 *
 * A desktop browser cannot place the call, so the number has to get to the
 * phone in the person's pocket. A QR code is the shortest path: point the
 * camera, tap the notification, the dialler opens pre-filled. That only works
 * if the encoded number is fully qualified — a scanner has no idea which
 * country a bare "9381167516" belongs to — so the country code is not
 * cosmetic, it is what makes the scan dial the right person.
 *
 * Landlines are allowed through here even though lead capture rejects them:
 * refusing to *call* a number that is already in the database helps nobody.
 */
export function buildCallTarget(phone: string | null | undefined): CallTarget | null {
  const raw = phone?.trim();
  if (!raw) return null;

  const parsed = normalizePhone(raw, { allowNonMobile: true });
  // A number already stored can still fail to parse — imported data, a foreign
  // format libphonenumber does not know. Dialling the stored digits is better
  // than hiding the button, so fall back rather than bail.
  const e164 = parsed?.e164 ?? (raw.startsWith("+") ? raw.replace(/[^\d+]/g, "") : `+${raw.replace(/\D/g, "")}`);
  if (e164.replace(/\D/g, "").length < 6) return null;

  const tel = `tel:${e164}`;
  const qr = qrcode(0, "M");
  qr.addData(tel);
  qr.make();
  const qrSize = qr.getModuleCount();
  let qrPath = "";
  for (let row = 0; row < qrSize; row += 1) {
    for (let col = 0; col < qrSize; col += 1) {
      if (qr.isDark(row, col)) qrPath += `M${col} ${row}h1v1h-1z`;
    }
  }

  return {
    e164,
    tel,
    display: formatCallDisplay(parsed?.countryCode, parsed?.nationalNumber, e164),
    countryCode: parsed ? `+${parsed.countryCode}` : e164.slice(0, 3),
    qrPath,
    qrSize,
  };
}

/** "+91 93811 67516" — the country code split off, the rest grouped in fives. */
function formatCallDisplay(
  countryCode: string | undefined,
  nationalNumber: string | undefined,
  e164: string,
): string {
  if (!countryCode || !nationalNumber) return e164;
  const grouped =
    nationalNumber.length === 10
      ? `${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`
      : nationalNumber.replace(/(\d{4})(?=\d)/g, "$1 ");
  return `+${countryCode} ${grouped}`;
}
