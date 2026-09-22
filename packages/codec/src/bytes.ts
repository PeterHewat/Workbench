/** Bytes ⇄ text: UTF-8, hex, base64 and base64url. Decoders throw `CodecError` on bad input. */

export class CodecError extends Error {
  /** Offset of the first offending character in the input, when there is one. */
  readonly offset: number | undefined;

  constructor(message: string, offset?: number) {
    super(message);
    this.name = "CodecError";
    this.offset = offset;
  }
}

const encoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Strict: invalid UTF-8 throws rather than turning into U+FFFD, so binary is never mistaken for text. */
export function utf8Decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CodecError("Not valid UTF-8 text");
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Accepts upper or lower case, with any whitespace or `:` between bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:]/g, "");
  const bad = clean.search(/[^0-9a-fA-F]/);
  if (bad >= 0) throw new CodecError(`Not a hex digit: "${clean[bad]}"`, bad);
  if (clean.length % 2) throw new CodecError("Hex needs an even number of digits");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encode64(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[n >> 18] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += alphabet[n >> 18] + alphabet[(n >> 12) & 63] + (pad ? "==" : "");
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      alphabet[n >> 18] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + (pad ? "=" : "");
  }
  return out;
}

function decode64(text: string, alphabet: string, name: string): Uint8Array {
  const clean = text.replace(/\s/g, "");
  const body = clean.replace(/=+$/, "");
  const lookup = new Map([...alphabet].map((c, i) => [c, i]));
  for (let i = 0; i < body.length; i++) {
    if (!lookup.has(body[i])) throw new CodecError(`Not a ${name} character: "${body[i]}"`, i);
  }
  if (body.length % 4 === 1) throw new CodecError(`${name} input is one character too long`);
  if (clean.length > body.length && clean.length % 4) {
    throw new CodecError(`${name} padding does not line up`);
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < body.length; i += 4) {
    const n =
      (lookup.get(body[i])! << 18) |
      (lookup.get(body[i + 1])! << 12) |
      ((lookup.get(body[i + 2]) ?? 0) << 6) |
      (lookup.get(body[i + 3]) ?? 0);
    out[o++] = n >> 16;
    if (i + 2 < body.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < body.length) out[o++] = n & 255;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return encode64(bytes, B64, true);
}

/** Padding is optional and whitespace is ignored, as in most pasted base64. */
export function base64ToBytes(text: string): Uint8Array {
  return decode64(text, B64, "base64");
}

/** RFC 4648 §5, unpadded — the form JWTs use. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return encode64(bytes, B64URL, false);
}

export function base64UrlToBytes(text: string): Uint8Array {
  return decode64(text, B64URL, "base64url");
}
