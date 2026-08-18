import { Injectable } from "@nestjs/common";
import type { MacroEventCategory, MacroImportance } from "@prisma/client";
import { ExternalHttpClient } from "../../http/external-http-client";

export interface OfficialMacroEvent {
  externalId: string;
  name: string;
  category: MacroEventCategory;
  importance: MacroImportance;
  scheduledAt: Date;
  sourceUrl: string;
}

@Injectable()
export class OfficialMacroCalendarAdapter {
  private readonly blsCalendarUrl =
    "https://www.bls.gov/schedule/news_release/bls.ics";

  constructor(private readonly http: ExternalHttpClient) {}

  async fetchEvents(): Promise<OfficialMacroEvent[]> {
    const response = await this.http.fetch({
      url: this.blsCalendarUrl,
      timeoutMs: 15_000,
      maxResponseBytes: 2 * 1024 * 1024,
      headers: { "User-Agent": "crypto-platform-macro-calendar/1.0" },
    });
    return this.parseBlsCalendar(response.body);
  }

  parseBlsCalendar(raw: string): OfficialMacroEvent[] {
    const unfolded = raw.replace(/\r?\n[ \t]/g, "");
    return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)]
      .map((match) => this.parseEvent(match[1] ?? ""))
      .filter((event): event is OfficialMacroEvent => event !== undefined);
  }

  private parseEvent(block: string): OfficialMacroEvent | undefined {
    const summary = this.field(block, "SUMMARY");
    const uid = this.field(block, "UID");
    const dateLine = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("DTSTART"));
    if (!summary || !uid || !dateLine) return undefined;
    const rawDate = dateLine.split(":").slice(1).join(":").trim();
    const scheduledAt = this.parseEasternDate(rawDate);
    if (!scheduledAt) return undefined;
    const category = this.category(summary);
    return {
      externalId: uid,
      name: summary.replace(/\\,/g, ",").trim(),
      category,
      importance: this.importance(category),
      scheduledAt,
      sourceUrl: this.field(block, "URL") ?? this.blsCalendarUrl,
    };
  }

  private field(block: string, name: string): string | undefined {
    const line = block
      .split(/\r?\n/)
      .find((item) => item.startsWith(`${name}:`));
    return line?.slice(name.length + 1).trim();
  }

  private parseEasternDate(raw: string): Date | undefined {
    const match = raw.match(
      /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/,
    );
    if (!match) return undefined;
    const [, year, month, day, hour = "08", minute = "30", second = "00"] =
      match;
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const secondSundayInMarch =
      8 + ((7 - new Date(Date.UTC(yearNumber, 2, 1)).getUTCDay()) % 7);
    const firstSundayInNovember =
      1 + ((7 - new Date(Date.UTC(yearNumber, 10, 1)).getUTCDay()) % 7);
    const daylightSaving =
      (monthNumber > 3 && monthNumber < 11) ||
      (monthNumber === 3 && dayNumber >= secondSundayInMarch) ||
      (monthNumber === 11 && dayNumber < firstSundayInNovember);
    const offset = daylightSaving ? "-04:00" : "-05:00";
    const value = new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`,
    );
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  private category(summary: string): MacroEventCategory {
    if (/consumer price|\bCPI\b/i.test(summary)) return "CPI";
    if (/producer price|\bPPI\b/i.test(summary)) return "PPI";
    if (/employment situation|nonfarm|payroll/i.test(summary))
      return "NONFARM_PAYROLLS";
    if (/unemployment/i.test(summary)) return "UNEMPLOYMENT";
    if (/retail sales/i.test(summary)) return "RETAIL_SALES";
    return "OTHER";
  }

  private importance(category: MacroEventCategory): MacroImportance {
    return ["CPI", "PPI", "NONFARM_PAYROLLS", "UNEMPLOYMENT"].includes(category)
      ? "HIGH"
      : category === "RETAIL_SALES"
        ? "MEDIUM"
        : "LOW";
  }
}
