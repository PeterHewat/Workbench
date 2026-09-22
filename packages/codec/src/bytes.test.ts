import { describe, expect, test } from "bun:test";
import {
  CodecError,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  hexToBytes,
  utf8Decode,
  utf8Encode,
} from "./bytes.js";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("base64", () => {
  // RFC 4648 §10 test vectors.
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  test.each(vectors)("%p encodes to %p and back", (text, b64) => {
    expect(bytesToBase64(utf8Encode(text))).toBe(b64);
    expect(utf8Decode(base64ToBytes(b64))).toBe(text);
  });

  test("agrees with btoa over every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(btoa(String.fromCharCode(...all)));
  });

  test("decoding tolerates missing padding and whitespace", () => {
    expect(utf8Decode(base64ToBytes("Zm9v\nYg"))).toBe("foob");
  });

  test("decoding rejects characters outside the alphabet, with their offset", () => {
    expect(() => base64ToBytes("Zm9v!")).toThrow(CodecError);
    try {
      base64ToBytes("Zm9v!");
    } catch (e) {
      expect((e as CodecError).offset).toBe(4);
    }
  });

  test("decoding rejects an impossible length", () => {
    expect(() => base64ToBytes("Zm9vY")).toThrow(/too long/);
  });
});

describe("base64url", () => {
  test("uses - and _ and no padding", () => {
    expect(bytesToBase64Url(bytes(0xfb, 0xff))).toBe("-_8");
    expect(base64UrlToBytes("-_8")).toEqual(bytes(0xfb, 0xff));
  });

  test("rejects standard base64's + and /", () => {
    expect(() => base64UrlToBytes("+/8")).toThrow(CodecError);
  });

  test("decodes a JWT header", () => {
    expect(utf8Decode(base64UrlToBytes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"))).toBe(
      '{"alg":"HS256","typ":"JWT"}'
    );
  });
});

describe("hex", () => {
  test("round-trips", () => {
    expect(bytesToHex(bytes(0, 15, 16, 255))).toBe("000f10ff");
    expect(hexToBytes("000F10ff")).toEqual(bytes(0, 15, 16, 255));
  });

  test("ignores spaces and colons between bytes", () => {
    expect(hexToBytes("de:ad be\nef")).toEqual(bytes(0xde, 0xad, 0xbe, 0xef));
  });

  test("rejects an odd number of digits and non-hex characters", () => {
    expect(() => hexToBytes("abc")).toThrow(/even/);
    expect(() => hexToBytes("zz")).toThrow(/hex digit/);
  });
});

describe("utf8", () => {
  test("round-trips text outside the BMP", () => {
    expect(utf8Decode(utf8Encode("héllo 🙂"))).toBe("héllo 🙂");
  });

  test("refuses bytes that are not UTF-8", () => {
    expect(() => utf8Decode(bytes(0xff, 0xfe))).toThrow(/UTF-8/);
  });
});
