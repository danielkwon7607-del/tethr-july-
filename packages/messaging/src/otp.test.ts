import { describe, expect, it } from "vitest";
import {
  createVerificationChallenge,
  extractOtpCode,
  generateOtpCode,
  OTP_CODE_LENGTH,
  OTP_TTL_MS,
  otpCodeHash,
} from "./otp";

// Pure-unit OTP tests (no DB): code shape, the peppered/bound hash, and reply
// extraction. The DB-backed verify/verified-at behavior lives in the
// messaging integration suite (requires Postgres for the definer + RLS).

describe("OTP codes", () => {
  it("generates a standalone N-digit code", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`));
    }
  });

  it("is not a constant (CSPRNG, not a fixed string)", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("otpCodeHash", () => {
  const secret = "test-pepper";
  const identity = "11111111-1111-1111-1111-111111111111";

  it("is deterministic and 64 hex chars", () => {
    const h = otpCodeHash(secret, identity, "123456");
    expect(h).toBe(otpCodeHash(secret, identity, "123456"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds to identity, secret, and code — any change changes the hash", () => {
    const base = otpCodeHash(secret, identity, "123456");
    expect(otpCodeHash(secret, "22222222-2222-2222-2222-222222222222", "123456")).not.toBe(base);
    expect(otpCodeHash("other-pepper", identity, "123456")).not.toBe(base);
    expect(otpCodeHash(secret, identity, "654321")).not.toBe(base);
  });
});

describe("extractOtpCode", () => {
  it("pulls a standalone 6-digit code from free text", () => {
    expect(extractOtpCode("123456")).toBe("123456");
    expect(extractOtpCode("my code is 123456")).toBe("123456");
    expect(extractOtpCode("code 123456 thanks")).toBe("123456");
  });

  it("rejects non-standalone or wrong-length digit runs", () => {
    expect(extractOtpCode("1234567")).toBeNull(); // 7 digits, not a 6-run
    expect(extractOtpCode("12345")).toBeNull(); // too short
    expect(extractOtpCode("no code here")).toBeNull();
    expect(extractOtpCode("")).toBeNull();
  });
});

describe("createVerificationChallenge", () => {
  it("hashes the code (never returns it inside the challenge) with a future expiry", () => {
    const secret = "test-pepper";
    const identity = "33333333-3333-3333-3333-333333333333";
    const now = new Date("2026-07-10T00:00:00Z");
    const { code, challenge } = createVerificationChallenge({ secret }, identity, now);
    expect(code).toMatch(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`));
    expect(challenge.channelIdentityId).toBe(identity);
    expect(challenge.codeHash).toBe(otpCodeHash(secret, identity, code));
    expect(challenge.expiresAt.getTime()).toBe(now.getTime() + OTP_TTL_MS);
    // The plaintext is not recoverable from the challenge record.
    expect(JSON.stringify(challenge)).not.toContain(code);
  });
});
