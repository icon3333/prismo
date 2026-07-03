import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calculateItemValue,
  calculatePortfolioTotal,
  getValueSource,
  computeColumnHealth,
  sortItems,
  filterItems,
  parseGermanNumber,
  escapeCSVField,
  formatDateAgo,
} from "@/lib/enrich-calc";
import type { EnrichItem } from "@/types/enrich";

let nextId = 1;
function makeItem(overrides: Partial<EnrichItem> = {}): EnrichItem {
  return {
    id: nextId++,
    company: "Test Co",
    identifier: "TST",
    source: "parqet",
    portfolio: "Main",
    portfolio_id: 1,
    sector: "Tech",
    thesis: "solid",
    investment_type: "Stock",
    country: "USA",
    effective_country: "USA",
    shares: 10,
    effective_shares: 10,
    price_eur: 5,
    custom_price_eur: null,
    custom_total_value: null,
    is_custom_value: false,
    total_value: 50,
    total_invested: 40,
    last_updated: "2026-01-01T00:00:00Z",
    first_bought_date: null,
    is_manually_edited: false,
    csv_modified_after_edit: false,
    identifier_manually_edited: false,
    identifier_manual_edit_date: null,
    country_manually_edited: false,
    country_manual_edit_date: null,
    override_identifier: null,
    override_country: null,
    override_share: null,
    ...overrides,
  } as EnrichItem;
}

describe("calculateItemValue / getValueSource", () => {
  it("computes from price and shares, ignoring backend current_value", () => {
    expect(calculateItemValue(makeItem({ price_eur: 5, effective_shares: 4 }))).toBe(20);
  });

  it("custom value wins", () => {
    const item = makeItem({ is_custom_value: true, custom_total_value: 777 });
    expect(calculateItemValue(item)).toBe(777);
    expect(getValueSource(item)).toBe("custom");
  });

  it("no price and no custom value is 'none'", () => {
    const item = makeItem({ price_eur: null });
    expect(getValueSource(item)).toBe("none");
    expect(calculateItemValue(item)).toBe(0);
  });

  it("portfolio total sums item values", () => {
    const items = [
      makeItem({ price_eur: 5, effective_shares: 2 }),
      makeItem({ is_custom_value: true, custom_total_value: 100 }),
    ];
    expect(calculatePortfolioTotal(items)).toBe(110);
  });
});

describe("computeColumnHealth", () => {
  it("scores each enrichment column as a rounded percentage", () => {
    const items = [
      makeItem(),
      makeItem({
        portfolio: "-",
        sector: "",
        thesis: null,
        investment_type: null,
        price_eur: null,
        effective_country: "N/A",
      }),
    ];
    const health = computeColumnHealth(items);
    expect(health).toEqual({
      portfolio: 50,
      sector: 50,
      thesis: 50,
      investmentType: 50,
      price: 50,
      country: 50,
      value: 50,
    });
  });

  it("custom price satisfies the price column", () => {
    const health = computeColumnHealth([
      makeItem({ price_eur: null, is_custom_value: true, custom_price_eur: 5, custom_total_value: 10 }),
    ]);
    expect(health.price).toBe(100);
    expect(health.value).toBe(100);
  });

  it("empty list scores zero", () => {
    expect(computeColumnHealth([]).sector).toBe(0);
  });
});

describe("sortItems", () => {
  it("sorts by computed total value", () => {
    const small = makeItem({ company: "Small", price_eur: 1, effective_shares: 1 });
    const big = makeItem({ company: "Big", price_eur: 100, effective_shares: 1 });
    const sorted = sortItems([small, big], { column: "total_value", direction: "desc" });
    expect(sorted.map((i) => i.company)).toEqual(["Big", "Small"]);
  });

  it("sorts country with crypto first and unknown last (asc)", () => {
    const de = makeItem({ company: "DE", effective_country: "Germany" });
    const unknown = makeItem({ company: "??", effective_country: "N/A" });
    const crypto = makeItem({ company: "BTC", effective_country: "(crypto)" });
    const sorted = sortItems([de, unknown, crypto], { column: "country", direction: "asc" });
    expect(sorted.map((i) => i.company)).toEqual(["BTC", "DE", "??"]);
  });

  it("returns items unchanged without a sort column", () => {
    const items = [makeItem(), makeItem()];
    expect(sortItems(items, { column: null, direction: "asc" })).toBe(items);
  });
});

describe("filterItems", () => {
  const items = [
    makeItem({ company: "Apple", identifier: "AAPL", portfolio: "Growth" }),
    makeItem({ company: "Siemens", identifier: "SIE", portfolio: "Core" }),
  ];

  it("filters by portfolio", () => {
    expect(filterItems(items, "Core", "")).toHaveLength(1);
  });

  it("searches name and identifier case-insensitively", () => {
    expect(filterItems(items, null, "apple")).toHaveLength(1);
    expect(filterItems(items, null, "sie")).toHaveLength(1);
    expect(filterItems(items, null, "zzz")).toHaveLength(0);
  });
});

describe("parseGermanNumber", () => {
  it("parses German-format currency strings", () => {
    expect(parseGermanNumber("1.234,56 €")).toBe(1234.56);
    expect(parseGermanNumber("12,5")).toBe(12.5);
  });

  it("returns NaN for empty/invalid input", () => {
    expect(parseGermanNumber("")).toBeNaN();
    expect(parseGermanNumber("abc")).toBeNaN();
  });
});

describe("escapeCSVField", () => {
  it("quotes fields containing separators and escapes quotes", () => {
    expect(escapeCSVField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(escapeCSVField("plain")).toBe("plain");
    expect(escapeCSVField(null)).toBe("");
  });
});

describe("formatDateAgo", () => {
  afterEach(() => vi.useRealTimers());

  it("buckets by age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00Z"));
    expect(formatDateAgo(null)).toBe("Never");
    expect(formatDateAgo("2026-07-03T11:59:30Z")).toBe("Just now");
    expect(formatDateAgo("2026-07-03T11:30:00Z")).toBe("30m ago");
    expect(formatDateAgo("2026-07-03T02:00:00Z")).toBe("10h ago");
    expect(formatDateAgo("2026-07-01T12:00:00Z")).toBe("2d ago");
  });
});
