import type { MacroEventCategory, MacroImportance } from "@prisma/client";

export interface ParsedMacroRelease {
  category: MacroEventCategory;
  importance: MacroImportance;
  name: string;
  actual: string;
  forecast: string | null;
  previous: string | null;
}

export function parseMacroReleaseFromText(
  text: string,
): ParsedMacroRelease | null {
  if (!text || typeof text !== "string") return null;

  const isCpi = /\bCPI\b|inflation|consumer price/i.test(text);
  const isPpi = /\bPPI\b|producer price/i.test(text);
  const isNfp = /NONFARM|PAYROLL|EMPLOYMENT SITUATION/i.test(text);
  const isFed = (/\bFED\b|\bFOMC\b/i.test(text) && /\bRATES?\b/i.test(text)) ||
    /INTEREST RATE DECISION/i.test(text);

  if (!isCpi && !isPpi && !isNfp && !isFed) return null;

  let category: MacroEventCategory = "OTHER";
  let name = "Macroeconomic Release";
  const importance: MacroImportance = "HIGH";

  if (isCpi) {
    category = "CPI";
    name = "Consumer Price Index";
  } else if (isPpi) {
    category = "PPI";
    name = "Producer Price Index";
  } else if (isNfp) {
    category = "NONFARM_PAYROLLS";
    name = "Nonfarm Payrolls";
  } else if (isFed) {
    category = "OTHER";
    name = "Federal Funds Rate";
  }

  let actual: string | null = null;
  let forecast: string | null = null;
  let previous: string | null = null;

  // Pattern 1: Newswire format: ": 0.4% (EXP 0.4%; PREV 0.1%)" or ": 142K (EXP 160K; PREV 114K)"
  const newswireMatch = text.match(
    /:\s*([+-]?\d+(?:\.\d+)?%?k?)\s*\((?:EXP\s*([+-]?\d+(?:\.\d+)?%?k?))?(?:;\s*PREV\s*([+-]?\d+(?:\.\d+)?%?k?))?\)/i,
  );
  if (newswireMatch) {
    actual = newswireMatch[1] ?? null;
    forecast = newswireMatch[2] ?? null;
    previous = newswireMatch[3] ?? null;
  } else {
    // Pattern 2: Natural language: "comes in at 3.4%, in-line with expectations of 3.4%"
    const nlActualMatch = text.match(
      /(?:comes in at|holds at|rose|fell|reported at|actual:?)\s*([+-]?\d+(?:\.\d+)?%?k?)/i,
    );
    if (nlActualMatch) {
      actual = nlActualMatch[1] ?? null;
    }
    const nlForecastMatch = text.match(
      /(?:expectations?(?:\s+of)?|forecast|exp\.?|est\.?)\s*([+-]?\d+(?:\.\d+)?%?k?)/i,
    );
    if (nlForecastMatch) {
      forecast = nlForecastMatch[1] ?? null;
    }
    const nlPrevMatch = text.match(
      /(?:prev\.?|previous(?:\s+was)?)\s*([+-]?\d+(?:\.\d+)?%?k?)/i,
    );
    if (nlPrevMatch) {
      previous = nlPrevMatch[1] ?? null;
    }
  }

  // Handle Fed rate decision special phrasing if numbers were not in standard format
  if (isFed && !actual) {
    if (/LEAVES\s+RATES\s+UNCHANGED|HOLDS\s+RATES/i.test(text)) {
      const rateMatch = text.match(/(\d+\.\d+)%/);
      actual = rateMatch ? rateMatch[1]! : "5.25";
      forecast = actual;
    } else if (/CUTS\s+RATES\s+BY\s+(\d+)\s*BPS/i.test(text)) {
      const cutMatch = text.match(/CUTS\s+RATES\s+BY\s+(\d+)\s*BPS/i);
      const bps = cutMatch ? Number(cutMatch[1]) : 25;
      actual = `-${(bps / 100).toFixed(2)}`;
      forecast = "0.00";
    } else if (/HIKES\s+RATES\s+BY\s+(\d+)\s*BPS/i.test(text)) {
      const hikeMatch = text.match(/HIKES\s+RATES\s+BY\s+(\d+)\s*BPS/i);
      const bps = hikeMatch ? Number(hikeMatch[1]) : 25;
      actual = `+${(bps / 100).toFixed(2)}`;
      forecast = "0.00";
    }
  }

  if (!actual) return null;

  return {
    category,
    importance,
    name,
    actual,
    forecast,
    previous,
  };
}
