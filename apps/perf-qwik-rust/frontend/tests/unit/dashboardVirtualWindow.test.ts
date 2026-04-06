import { describe, expect, it } from "vitest";
import {
  computeQuerySpan,
  hysteresisQueryWindowCanSkip,
  OVER_SCAN,
  queryWindowKey,
  scrollStartRow,
  VIRT_ROW,
  VISIBLE_DATA_ROW_COUNT,
  visibleWindowNeedEnd,
} from "../../src/lib/dashboardVirtualWindow";

describe("dashboardVirtualWindow", () => {
  it("scrollStartRow は行高で割った床", () => {
    expect(scrollStartRow(0)).toBe(0);
    expect(scrollStartRow(VIRT_ROW - 1)).toBe(0);
    expect(scrollStartRow(VIRT_ROW)).toBe(1);
  });

  it("computeQuerySpan は前後 OVER_SCAN を含み limit が上限内", () => {
    const { offset, limit } = computeQuerySpan(20);
    expect(offset).toBe(20 - OVER_SCAN);
    expect(limit).toBe(VISIBLE_DATA_ROW_COUNT + 2 * OVER_SCAN);
  });

  it("computeQuerySpan は先頭で offset 0", () => {
    const { offset } = computeQuerySpan(3);
    expect(offset).toBe(0);
  });

  it("queryWindowKey はフィルタ・ソートを区切る", () => {
    expect(queryWindowKey("a", "title", true)).not.toBe(
      queryWindowKey("b", "title", true),
    );
  });

  it("visibleWindowNeedEnd は末尾で total にクランプ", () => {
    expect(visibleWindowNeedEnd(18, 14, 20)).toBe(20);
    expect(visibleWindowNeedEnd(0, 14, 5)).toBe(5);
    expect(visibleWindowNeedEnd(0, 14, 0)).toBe(0);
  });

  it("hysteresisQueryWindowCanSkip は start+count>total でもバッファが末尾を覆えば真", () => {
    expect(
      hysteresisQueryWindowCanSkip({
        sameQueryKey: true,
        start: 18,
        visibleCount: 14,
        total: 20,
        bufferRangeStart: 8,
        bufferRangeEnd: 20,
      }),
    ).toBe(true);
  });

  it("hysteresisQueryWindowCanSkip は旧条件だと偽だった末尾ケースで無駄再取得を防ぐ", () => {
    // 旧: start + count <= bufferRangeEnd → 18+14<=20 は偽
    expect(18 + 14 <= 20).toBe(false);
    expect(
      hysteresisQueryWindowCanSkip({
        sameQueryKey: true,
        start: 18,
        visibleCount: 14,
        total: 20,
        bufferRangeStart: 0,
        bufferRangeEnd: 20,
      }),
    ).toBe(true);
  });

  it("hysteresisQueryWindowCanSkip は total<=0 で偽", () => {
    expect(
      hysteresisQueryWindowCanSkip({
        sameQueryKey: true,
        start: 0,
        visibleCount: 14,
        total: 0,
        bufferRangeStart: 0,
        bufferRangeEnd: 0,
      }),
    ).toBe(false);
  });
});
