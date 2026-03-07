"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";
import type { SearchResult } from "@/types/simulator";

interface Props {
  sim: UseSimulatorReturn;
}

export function ItemInputForms({ sim }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TickerInput sim={sim} />
      <DimensionInput
        label="Sector"
        options={
          sim.portfolioData?.sectors?.map((s) => s.name).filter(Boolean) || []
        }
        onAdd={(v) => sim.handleAddDimension("sector", v)}
      />
      <DimensionInput
        label="Thesis"
        options={
          sim.portfolioData?.theses?.map((t) => t.name).filter(Boolean) || []
        }
        onAdd={(v) => sim.handleAddDimension("thesis", v)}
      />
      <DimensionInput
        label="Country"
        options={
          sim.portfolioData?.countries?.map((c) => c.name).filter(Boolean) || []
        }
        onAdd={(v) => sim.handleAddDimension("country", v)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticker Input with autocomplete
// ---------------------------------------------------------------------------

function TickerInput({ sim }: { sim: UseSimulatorReturn }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await apiFetch<SearchResult[]>(
        `/simulator/search-investments?q=${encodeURIComponent(query)}&limit=10`
      );
      setSuggestions(res || []);
      setShowDropdown((res || []).length > 0);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleInputChange = useCallback(
    (val: string) => {
      setValue(val);
      clearTimeout(debounceRef.current);
      if (val.trim().length >= 2) {
        debounceRef.current = setTimeout(() => search(val.trim()), 300);
      } else {
        setSuggestions([]);
        setShowDropdown(false);
      }
    },
    [search]
  );

  const submit = useCallback(
    async (ticker: string) => {
      if (!ticker.trim() || loading) return;
      setLoading(true);
      setShowDropdown(false);
      const ok = await sim.handleAddTicker(ticker);
      if (ok) setValue("");
      setLoading(false);
    },
    [sim, loading]
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <label className="text-xs font-medium text-muted-foreground">
        Add Identifier
      </label>
      <div className="relative">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Ticker or name..."
              value={value}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit(value);
                }
                if (e.key === "Escape") setShowDropdown(false);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setShowDropdown(true);
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={!value.trim() || loading}
            onClick={() => submit(value)}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-md overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={`${s.ticker}-${i}`}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(s.ticker);
                  setShowDropdown(false);
                  submit(s.ticker);
                }}
              >
                <span className="font-mono text-xs text-cyan-400 shrink-0">
                  {s.ticker}
                </span>
                <span className="truncate text-muted-foreground">
                  {s.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dimension combobox (sector / thesis / country)
// ---------------------------------------------------------------------------

function DimensionInput({
  label,
  options,
  onAdd,
}: {
  label: string;
  options: string[];
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const uniqueOptions = [...new Set(options.map((o) => o.toLowerCase()))].sort();

  const filtered = value.trim()
    ? uniqueOptions.filter((o) => o.includes(value.trim().toLowerCase()))
    : uniqueOptions;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    setShowDropdown(false);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <label className="text-xs font-medium text-muted-foreground">
        Add {label}
      </label>
      <div className="relative">
        <div className="flex gap-1.5">
          <Input
            placeholder={`${label}...`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShowDropdown(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setShowDropdown(false);
            }}
            onFocus={() => {
              if (uniqueOptions.length > 0) setShowDropdown(true);
            }}
          />
          <Button size="sm" disabled={!value.trim()} onClick={submit}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Dropdown */}
        {showDropdown && filtered.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
            {filtered.slice(0, 10).map((opt) => (
              <button
                key={opt}
                className="flex w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAdd(opt);
                  setValue("");
                  setShowDropdown(false);
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
