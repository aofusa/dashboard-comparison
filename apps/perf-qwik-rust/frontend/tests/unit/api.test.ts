import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/auth", () => ({
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  clearTokens: vi.fn(),
  setTokens: vi.fn(),
  refreshRequest: vi.fn(() => Promise.resolve(null)),
}));

import {
  MIME_ARROW_LEGACY,
  MIME_ARROW_VND,
  apiItemsStats,
} from "../../src/lib/api";

describe("api", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "{}",
      } as Response),
    );
  });

  it("exports MIME arrow Accept tokens", () => {
    expect(MIME_ARROW_VND).toContain("arrow");
    expect(MIME_ARROW_VND).toContain("zstd");
    expect(MIME_ARROW_LEGACY).toContain("arrow");
  });

  it("apiItemsStats maps GraphQL payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              itemStats: {
                total: 3,
                byInitial: [
                  { letter: "a", count: 2 },
                  { letter: "b", count: 1 },
                ],
              },
            },
          }),
      } as Response),
    );

    const s = await apiItemsStats();
    expect(s.total).toBe(3);
    expect(s.by_initial).toEqual([
      { letter: "a", count: 2 },
      { letter: "b", count: 1 },
    ]);
  });

  it("apiItemsStats throws on GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            errors: [{ message: "unauthorized" }],
          }),
      } as Response),
    );

    await expect(apiItemsStats()).rejects.toThrow("unauthorized");
  });

  it("apiItemsStats throws on non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "not-json",
      } as Response),
    );

    await expect(apiItemsStats()).rejects.toThrow();
  });
});
