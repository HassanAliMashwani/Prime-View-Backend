import * as crypto from 'crypto';

/**
 * High-entropy Base32 alphabet (32 characters):
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 * Excludes easily confusable characters (I, O, 0, 1) to eliminate human transcription errors.
 */
export const SLIP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SLIP_SERIAL_LENGTH = 10;

/**
 * Generate a cryptographically secure random serial of length 10 using crypto.randomInt.
 * Math.random() is strictly prohibited.
 */
export function generateReceiptSerial(): string {
  let serial = '';
  for (let i = 0; i < SLIP_SERIAL_LENGTH; i++) {
    const idx = crypto.randomInt(0, SLIP_ALPHABET.length);
    serial += SLIP_ALPHABET[idx];
  }
  return serial;
}

/**
 * Generate an official slip number formatted as: PV-SLIP-{year}-{serial}
 * e.g. PV-SLIP-2026-K7M4Q9X2R8
 */
export function generateSlipNumber(year: number | string = new Date().getFullYear()): string {
  const serial = generateReceiptSerial();
  return `PV-SLIP-${year}-${serial}`;
}
