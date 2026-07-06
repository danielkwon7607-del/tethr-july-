import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("parses a valid local environment", () => {
    const config = loadConfig({ TETHR_ENV: "local" });
    expect(config.appEnv).toBe("local");
  });

  it("parses staging and production", () => {
    expect(loadConfig({ TETHR_ENV: "staging" }).appEnv).toBe("staging");
    expect(loadConfig({ TETHR_ENV: "production" }).appEnv).toBe("production");
  });

  it("fails fast when TETHR_ENV is missing", () => {
    expect(() => loadConfig({})).toThrow(/TETHR_ENV/);
  });

  it("fails fast on an unknown environment, so a mis-scoped process cannot start", () => {
    expect(() => loadConfig({ TETHR_ENV: "prod" })).toThrow(/TETHR_ENV/);
  });
});
