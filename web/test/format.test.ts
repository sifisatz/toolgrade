import { describe, expect, it } from "vitest";
import { signedRelPct } from "@/lib/format";

describe("signedRelPct", () => {
  it("prefixes a positive change with +", () => {
    expect(signedRelPct(0.18)).toBe("+18%");
  });

  it("does not double up the sign on a negative change", () => {
    expect(signedRelPct(-0.05)).toBe("-5%");
  });

  it("prefixes zero with + (no change is still a reported delta, not absence of one)", () => {
    expect(signedRelPct(0)).toBe("+0%");
  });

  it("rounds to the nearest whole percent", () => {
    expect(signedRelPct(0.1249)).toBe("+12%");
    expect(signedRelPct(0.1251)).toBe("+13%");
  });

  it("handles a swing greater than 100%", () => {
    expect(signedRelPct(1.5)).toBe("+150%");
    expect(signedRelPct(-0.99)).toBe("-99%");
  });
});
