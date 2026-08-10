/**
 * Contact channels, kept free of any server-only dependency.
 *
 * `call.ts` reaches `@monark/core` for phone parsing, which reaches
 * `node:crypto` — importing a runtime value from it into a client component
 * drags that whole graph into the browser bundle and fails the build. These
 * constants are needed on both sides, so they live on their own.
 */
/**
 * How to reach them. `tel:` is the default because a follow-up is a call.
 *
 * The scheme is not cosmetic: a QR carrying a bare number is interpreted
 * differently by every scanner — some offer to text, some to save a contact —
 * so each channel encodes the URI that unambiguously opens the app intended.
 */
export const CONTACT_CHANNELS = ["call", "whatsapp", "sms"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  sms: "Messages",
};

export const CONTACT_CHANNEL_HINTS: Record<ContactChannel, string> = {
  call: "Opens the dialler with the number already filled in.",
  whatsapp: "Opens a WhatsApp chat with this contact.",
  sms: "Opens the messaging app with the number already filled in.",
};

export interface ChannelTarget {
  /** What the QR encodes and what the button opens. */
  uri: string;
  /** SVG path for the dark modules, drawn inside a `0 0 size size` viewBox. */
  qrPath: string;
  qrSize: number;
}

export interface CallTarget {
  /** E.164, country code always present: "+919381167516". */
  e164: string;
  /** What the QR encodes and what the link dials. */
  tel: string;
  /** Grouped so it can be read aloud or copied down: "+91 93811 67516". */
  display: string;
  /** Country calling code on its own, for labelling the number. */
  countryCode: string;
  /** One QR per channel, all rendered server-side so the generator never
   *  reaches the browser bundle. */
  channels: Record<ContactChannel, ChannelTarget>;
}

