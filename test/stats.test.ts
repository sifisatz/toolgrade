import { describe, expect, it } from "vitest";
import { bonferroniZ, difference, pass1, pass3, pass5, passAtK, perToolSuccessRate, probit, rate, significance, taskLevelRate, toolEngagementRate, wilson } from "../src/stats.js";

describe("probit / bonferroniZ", () => {
  it("matches standard normal quantiles", () => {
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.005)).toBeCloseTo(-2.575829, 5);
    expect(bonferroniZ(1)).toBeCloseTo(1.959964, 5);
    expect(bonferroniZ(10)).toBeCloseTo(2.807034, 5);
  });
});

describe("taskLevelRate", () => {
  it("uses tasks, not trials, as the sample size", () => {
    const r = taskLevelRate([1, 1, 0.5]);
    expect(r.n).toBe(3);
    expect(r.rate).toBeCloseTo(2.5 / 3, 9);
    // Much wider than pooling 3 tasks x 10 trials = 25/30 as independent.
    expect(r.high - r.low).toBeGreaterThan(wilson(25, 30).high - wilson(25, 30).low);
  });
});

describe("wilson", () => {
  it("matches reference values", () => {
    const zero = wilson(0, 10);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(0.2775, 3);
    const half = wilson(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
  });

  it("is the whole unit interval with no data", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("passAtK (Chen et al. 2021 unbiased estimator)", () => {
  it("k=1 is identical to naive c/n", () => {
    expect(passAtK(10, 7, 1)).toBeCloseTo(0.7, 9);
    expect(pass1(10, 7)).toBeCloseTo(0.7, 9);
  });

  it("all pass => 1 regardless of k", () => {
    expect(passAtK(10, 10, 5)).toBe(1);
  });

  it("none pass => 0 regardless of k", () => {
    expect(passAtK(10, 0, 3)).toBe(0);
  });

  it("pass@k >= pass@1 when c > 0 and k > 1", () => {
    // More samples -> higher chance at least one passes
    expect(passAtK(10, 3, 3)).toBeGreaterThan(passAtK(10, 3, 1));
    expect(passAtK(10, 5, 5)).toBeGreaterThan(passAtK(10, 5, 1));
  });

  it("pass@3 matches the closed-form for n=5, c=2, k=3", () => {
    // C(3,3)/C(5,3) = 1/10 = 0.1 -> pass@3 = 1 - 0.1 = 0.9
    expect(passAtK(5, 2, 3)).toBeCloseTo(0.9, 9);
  });

  it("throws when k > n", () => {
    expect(() => passAtK(5, 3, 6)).toThrow(RangeError);
  });

  it("pass3 and pass5 helpers delegate correctly", () => {
    expect(pass3(5, 2)).toBeCloseTo(passAtK(5, 2, 3), 12);
    expect(pass5(10, 7)).toBeCloseTo(passAtK(10, 7, 5), 12);
  });
});

describe("toolEngagementRate", () => {
  it("returns 0 when no trials", () => {
    expect(toolEngagementRate([])).toBe(0);
  });

  it("counts only trials that made at least one tool call", () => {
    const trials = [
      { passed: true, trajectory: { toolCalls: [{ name: "read_file" }] } },
      { passed: false, trajectory: { toolCalls: [] } },
      { passed: true, trajectory: { toolCalls: [{ name: "list_dir" }, { name: "read_file" }] } },
      { error: "boom", passed: false },
    ];
    // 3 non-errored; 2 engaged (first + third)
    expect(toolEngagementRate(trials)).toBeCloseTo(2 / 3, 9);
  });

  it("excludes errored trials from denominator", () => {
    const trials = [
      { error: "oops", passed: false },
      { passed: true, trajectory: { toolCalls: [{ name: "x" }] } },
    ];
    expect(toolEngagementRate(trials)).toBe(1);
  });
});

describe("perToolSuccessRate", () => {
  it("returns empty object when no graded trials", () => {
    expect(perToolSuccessRate([])).toEqual({});
  });

  it("omits tools called in only one trial", () => {
    const trials = [
      { passed: true, trajectory: { toolCalls: [{ name: "rare_tool" }] } },
      { passed: false, trajectory: { toolCalls: [] } },
    ];
    expect(perToolSuccessRate(trials)).toEqual({});
  });

  it("computes per-tool pass rates correctly", () => {
    const trials = [
      { passed: true, trajectory: { toolCalls: [{ name: "read_file" }, { name: "list_dir" }] } },
      { passed: false, trajectory: { toolCalls: [{ name: "read_file" }] } },
      { passed: true, trajectory: { toolCalls: [{ name: "read_file" }, { name: "list_dir" }] } },
    ];
    const result = perToolSuccessRate(trials);
    // read_file called in 3 trials, 2 passed -> 2/3
    expect(result["read_file"]).toBeCloseTo(2 / 3, 9);
    // list_dir called in 2 trials, 2 passed -> 1
    expect(result["list_dir"]).toBeCloseTo(1, 9);
  });

  it("counts each tool once per trial even if called multiple times", () => {
    const trials = [
      { passed: true, trajectory: { toolCalls: [{ name: "t" }, { name: "t" }] } },
      { passed: false, trajectory: { toolCalls: [{ name: "t" }] } },
    ];
    const result = perToolSuccessRate(trials);
    // t used in 2 trials, 1 passed -> 0.5
    expect(result["t"]).toBeCloseTo(0.5, 9);
  });
});

describe("difference (Newcombe hybrid score)", () => {
  // Newcombe (1998), Statistics in Medicine 17:873, example (a): 56/70 vs 48/80.
  it("matches the published worked example", () => {
    const d = difference(rate(56, 70), rate(48, 80));
    expect(d.delta).toBeCloseTo(0.2, 6);
    expect(d.low).toBeCloseTo(0.0524, 3);
    expect(d.high).toBeCloseTo(0.3339, 3);
    expect(significance(d)).toBe("better");
  });

  it("calls small samples inconclusive rather than guessing", () => {
    const d = difference(rate(3, 3), rate(1, 3));
    expect(d.delta).toBeCloseTo(0.667, 3);
    expect(significance(d)).toBe("not_significant");
  });

  it("detects a clear drop", () => {
    expect(significance(difference(rate(2, 20), rate(18, 20)))).toBe("worse");
  });
});
