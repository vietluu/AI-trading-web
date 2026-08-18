import { describe, expect, it } from "vitest";
import { OfficialMacroCalendarAdapter } from "../../src/modules/external-data/infrastructure/providers/macro/official-macro-calendar.adapter";

describe("OfficialMacroCalendarAdapter", () => {
  it("normalizes high-impact BLS calendar events", () => {
    const adapter = new OfficialMacroCalendarAdapter({} as never);
    const events = adapter.parseBlsCalendar(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:cpi-2026",
        "DTSTART;TZID=America/New_York:20260812T083000",
        "SUMMARY:Consumer Price Index",
        "URL:https://www.bls.gov/news.release/cpi.htm",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:jobs-2026",
        "DTSTART;TZID=America/New_York:20260807T083000",
        "SUMMARY:Employment Situation",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );

    expect(events).toHaveLength(2);
    expect(events.map((event) => [event.category, event.importance])).toEqual([
      ["CPI", "HIGH"],
      ["NONFARM_PAYROLLS", "HIGH"],
    ]);
    expect(events[0]?.scheduledAt.toISOString()).toBe(
      "2026-08-12T12:30:00.000Z",
    );
  });
});
