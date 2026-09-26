import { describe, expect, it } from "vitest";
import { dzienZKalendarza, poDniachRoboczych, terminyOdlozenia, zaTydzien } from "./terminOdlozenia";

/* Terminy liczą się w czasie lokalnym, więc test stawia daty lokalne
   (`new Date(r, m, d, h)`), a nie napisy ISO ze strefą. */
const dzien = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

describe("terminy odłożenia", () => {
  it("następny dzień roboczy z czwartku to piątek 8:00, z piątku — poniedziałek", () => {
    expect(dzien(poDniachRoboczych(new Date(2026, 8, 24, 15, 40), 1))).toEqual([2026, 9, 25, 8, 0]);
    expect(dzien(poDniachRoboczych(new Date(2026, 8, 25, 15, 40), 1))).toEqual([2026, 9, 28, 8, 0]);
    expect(dzien(poDniachRoboczych(new Date(2026, 8, 26, 11, 0), 1)), "z soboty też poniedziałek")
      .toEqual([2026, 9, 28, 8, 0]);
  });

  it("dwa dni robocze z piątku to wtorek", () => {
    expect(dzien(poDniachRoboczych(new Date(2026, 8, 25, 9, 0), 2))).toEqual([2026, 9, 29, 8, 0]);
  });

  it("za tydzień z soboty zjeżdża na poniedziałek, nie wraca w weekend", () => {
    expect(dzien(zaTydzien(new Date(2026, 8, 23, 12, 0)))).toEqual([2026, 9, 30, 8, 0]);
    expect(dzien(zaTydzien(new Date(2026, 8, 26, 12, 0)))).toEqual([2026, 10, 5, 8, 0]);
  });

  it("dzień z kalendarza to 8:00 tego dnia; śmieci to null", () => {
    expect(dzien(dzienZKalendarza("2026-10-02")!)).toEqual([2026, 10, 2, 8, 0]);
    expect(dzienZKalendarza("jutro")).toBeNull();
  });

  it("gotowe terminy są w przyszłości i rosną", () => {
    const teraz = new Date(2026, 8, 24, 15, 40);
    const t = terminyOdlozenia(teraz).map((x) => x.kiedy.getTime());
    expect(t.every((x) => x > teraz.getTime())).toBe(true);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
});
