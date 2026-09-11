import { describe, expect, it } from "vitest";
import { parseMacroReleaseFromText } from "../../src/modules/external-data/infrastructure/providers/macro/macro-news-parser";

describe("parseMacroReleaseFromText", () => {
  it("parses Bloomberg newswire style CPI release with actual, forecast, previous", () => {
    const text = "US CPI (MOM) AUG: 0.4% (EXP 0.4%; PREV 0.1%)";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("CPI");
    expect(result?.name).toBe("Consumer Price Index");
    expect(result?.actual).toBe("0.4%");
    expect(result?.forecast).toBe("0.4%");
    expect(result?.previous).toBe("0.1%");
    expect(result?.importance).toBe("HIGH");
  });

  it("parses annual CPI headline with YoY rate", () => {
    const text = "US CPI (YOY) AUG: 3.4% (EXP 3.4%; PREV 3.4%)";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("CPI");
    expect(result?.actual).toBe("3.4%");
    expect(result?.forecast).toBe("3.4%");
    expect(result?.previous).toBe("3.4%");
  });

  it("parses natural language headline from Twitter/news feeds", () => {
    const text = "August CPI inflation comes in at 3.4%, in-line with expectations of 3.4%";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("CPI");
    expect(result?.actual).toBe("3.4%");
    expect(result?.forecast).toBe("3.4%");
  });

  it("parses headline with actual but without explicit forecast", () => {
    const text = "U.S. August CPI Holds at 3.4%, Core Inflation Falls to Lowest Since March 2021";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("CPI");
    expect(result?.actual).toBe("3.4%");
  });

  it("parses Producer Price Index (PPI) headline", () => {
    const text = "US PPI (MOM) AUG: 0.4% (EXP 0.4%; PREV 0.0%)";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("PPI");
    expect(result?.name).toBe("Producer Price Index");
    expect(result?.actual).toBe("0.4%");
    expect(result?.forecast).toBe("0.4%");
  });

  it("parses Nonfarm Payrolls (NFP) headline with K suffix", () => {
    const text = "US NONFARM PAYROLLS AUG: 142K (EXP 160K; PREV 114K)";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("NONFARM_PAYROLLS");
    expect(result?.name).toBe("Nonfarm Payrolls");
    expect(result?.actual).toBe("142K");
    expect(result?.forecast).toBe("160K");
    expect(result?.previous).toBe("114K");
  });

  it("parses Fed rate cut headline", () => {
    const text = "FED CUTS RATES BY 50 BPS";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("OTHER");
    expect(result?.name).toBe("Federal Funds Rate");
    expect(result?.actual).toBe("-0.50");
  });

  it("parses Fed leaves rates unchanged headline", () => {
    const text = "FED LEAVES RATES UNCHANGED AT 5.25%-5.50%";
    const result = parseMacroReleaseFromText(text);

    expect(result).not.toBeNull();
    expect(result?.category).toBe("OTHER");
    expect(result?.actual).toBe("5.25");
  });

  it("returns null for unrelated crypto or market news", () => {
    const text = "Bitcoin surpasses $60,000 as ETF inflows resume across major desks";
    expect(parseMacroReleaseFromText(text)).toBeNull();
  });
});
