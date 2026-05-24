"use client";

import { useState } from "react";
import {
  AlertCircle,

  ChevronDown,
  Globe,
  Info,
  Settings,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { toast, Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { SliderItem } from "@/components/domain/slider-item";
import { PanelLayout, Panel } from "@/components/domain/panel-layout";
import { ConstraintWarnings } from "@/components/domain/constraint-warnings";
import { CategoryTable } from "@/components/domain/category-table";
import { ChartWrapper } from "@/components/domain/chart-wrapper";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight border-b border-border pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ThemePage() {
  const [sliderValue, setSliderValue] = useState(5000);

  return (
    <TooltipProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            color: "hsl(var(--foreground))",
          },
        }}
      />
      <div className="min-h-screen p-8 max-w-6xl mx-auto space-y-12">
        <div>
          <h1 className="text-3xl font-bold text-primary">
            Ocean Depth Design System
          </h1>
          <p className="text-muted-foreground mt-1">
            Prismo component showcase - shadcn/ui themed to Ocean Depth
          </p>
        </div>

        {/* Color Swatches */}
        <Section title="Color Palette">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { name: "Background", class: "bg-background", hex: "#020617" },
              { name: "Card", class: "bg-card", hex: "#0F172A" },
              { name: "Muted", class: "bg-muted", hex: "#1E293B" },
              { name: "Primary", class: "bg-primary", hex: "#06B6D4" },
              { name: "Destructive", class: "bg-destructive", hex: "#EF4444" },
              { name: "Teal", class: "bg-teal-500", hex: "#14B8A6" },
              { name: "Coral", class: "bg-coral-500", hex: "#F97316" },
              { name: "Aqua 400", class: "bg-aqua-400", hex: "#22D3EE" },
            ].map((c) => (
              <div key={c.name} className="space-y-1.5">
                <div
                  className={`h-16 rounded-md border border-border ${c.class}`}
                />
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {c.hex}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography">
          <div className="space-y-3 bg-card rounded-md border border-border p-6">
            <h1 className="text-2xl font-bold tracking-tight">
              Page Title (1.5rem / 700)
            </h1>
            <h2 className="text-xl font-semibold">
              Section Title (1.25rem / 600)
            </h2>
            <h3 className="text-base font-semibold">
              Card Title (1rem / 600)
            </h3>
            <p className="text-sm">Body text (0.875rem / 400)</p>
            <p className="text-xs text-muted-foreground">
              Small/Meta text (0.75rem / 400)
            </p>
            <p className="text-2xl font-semibold text-primary">
              Large Value (1.5rem / 600)
            </p>
            <p className="font-mono text-sm text-muted-foreground">
              Monospace: JetBrains Mono
            </p>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        {/* Inputs & Forms */}
        <Section title="Inputs & Forms">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Text Input</label>
              <Input placeholder="Enter a value..." />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select</label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Checkboxes</label>
              <div className="flex items-center gap-2">
                <Checkbox id="c1" defaultChecked />
                <label htmlFor="c1" className="text-sm">
                  Include cash
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="c2" />
                <label htmlFor="c2" className="text-sm">
                  Anonymous mode
                </label>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Radio Group</label>
            <RadioGroup defaultValue="overlay" className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="overlay" id="r1" />
                <label htmlFor="r1" className="text-sm">
                  Overlay
                </label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="portfolio" id="r2" />
                <label htmlFor="r2" className="text-sm">
                  Portfolio
                </label>
              </div>
            </RadioGroup>
          </div>
        </Section>

        {/* Badges */}
        <Section title="Badges">
          <div className="flex flex-wrap gap-3">
            <Badge>Primary</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Danger</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge className="bg-teal-500/15 text-teal-500 border-transparent">
              Success
            </Badge>
            <Badge className="bg-coral-500/15 text-coral-500 border-transparent">
              Warning
            </Badge>
          </div>
        </Section>

        {/* Alerts */}
        <Section title="Alerts">
          <div className="space-y-3">
            <Alert>
              <Info className="size-4" />
              <AlertTitle>Info</AlertTitle>
              <AlertDescription>
                Portfolio data refreshed successfully.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                Failed to fetch market prices. Check your connection.
              </AlertDescription>
            </Alert>
          </div>
        </Section>

        {/* Tabs */}
        <Section title="Tabs">
          <Tabs defaultValue="performance">
            <TabsList>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="rebalancer">Rebalancer</TabsTrigger>
              <TabsTrigger value="simulator">Simulator</TabsTrigger>
            </TabsList>
            <TabsContent value="performance" className="mt-4">
              <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                Performance tab content
              </div>
            </TabsContent>
            <TabsContent value="rebalancer" className="mt-4">
              <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                Rebalancer tab content
              </div>
            </TabsContent>
            <TabsContent value="simulator" className="mt-4">
              <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                Simulator tab content
              </div>
            </TabsContent>
          </Tabs>
        </Section>

        {/* Progress */}
        <Section title="Progress Bars">
          <div className="space-y-4 max-w-md">
            <Progress value={65}>
              <ProgressLabel>Normal (65%)</ProgressLabel>
              <ProgressValue />
            </Progress>
            <Progress value={100}>
              <ProgressLabel>Complete (100%)</ProgressLabel>
              <ProgressValue />
            </Progress>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-destructive">
                  Over limit (120%)
                </span>
                <span className="text-muted-foreground">120%</span>
              </div>
              <div className="relative h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-destructive to-red-400"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* Table */}
        <Section title="Table">
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="text-xs uppercase tracking-wider">
                    Company
                  </TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">
                    Allocation
                  </TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">
                    Value
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Apple Inc.</TableCell>
                  <TableCell className="text-right">15.2%</TableCell>
                  <TableCell className="text-right sensitive-value">
                    $12,500
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    Vanguard S&P 500
                  </TableCell>
                  <TableCell className="text-right">35.0%</TableCell>
                  <TableCell className="text-right sensitive-value">
                    $28,750
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">50.2%</TableCell>
                  <TableCell className="text-right sensitive-value">
                    $41,250
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Section>

        {/* Dialog */}
        <Section title="Dialog & Sheet">
          <div className="flex gap-3">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>
                Open Dialog
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Position</DialogTitle>
                  <DialogDescription>
                    Add a new stock, ETF, or crypto position to your portfolio.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <Input placeholder="Company name..." />
                  <Input placeholder="Identifier (optional)..." />
                </div>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger render={<Button variant="outline" />}>
                Open Sheet
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Settings</SheetTitle>
                  <SheetDescription>
                    Configure your portfolio preferences.
                  </SheetDescription>
                </SheetHeader>
                <div className="py-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Checkbox id="s1" defaultChecked />
                    <label htmlFor="s1" className="text-sm">
                      Include cash in allocations
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="s2" />
                    <label htmlFor="s2" className="text-sm">
                      Anonymous mode
                    </label>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </Section>

        {/* Dropdown */}
        <Section title="Dropdown Menu">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Settings className="size-4" />
              Options
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <TrendingUp className="size-4" />
                View Performance
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Globe className="size-4" />
                Rebalance
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                Delete Portfolio
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        {/* Tooltip */}
        <Section title="Tooltip">
          <div className="flex gap-4">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="icon" />}>
                <Info className="size-4" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Portfolio allocation percentage</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </Section>

        {/* Skeleton */}
        <Section title="Skeleton Loading">
          <div className="space-y-3 bg-card rounded-md border border-border p-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex gap-3 pt-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        </Section>

        {/* Toast */}
        <Section title="Toast (Sonner)">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() =>
                toast.success("Portfolio updated", {
                  description: "All positions have been recalculated.",
                })
              }
            >
              Success Toast
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error("Price fetch failed", {
                  description: "Could not reach market data provider.",
                })
              }
            >
              Error Toast
            </Button>
          </div>
        </Section>

        {/* Domain Components */}
        <div className="pt-4">
          <h1 className="text-2xl font-bold text-primary mb-8">
            Domain Components
          </h1>
        </div>

        {/* Panel Layout */}
        <Section title="Panel Layout">
          <PanelLayout>
            <Panel
              title="Allocation"
              subtitle="(editable)"
              icon={<Globe className="size-4 text-primary" />}
              variant="primary"
              footer={
                <>
                  <span className="text-sm text-muted-foreground">Total:</span>
                  <span className="text-sm font-semibold sensitive-value">
                    $82,000 / $100,000
                  </span>
                </>
              }
            >
              <div className="space-y-2">
                <SliderItem
                  name="United States"
                  value={sliderValue}
                  maxValue={10000}
                  currentValue={4500}
                  constraint={{ max: 100, label: "50% of 100% max" }}
                  onChange={setSliderValue}
                />
                <SliderItem
                  name="Europe"
                  value={3000}
                  maxValue={10000}
                  currentValue={2800}
                  constraint={{ max: 100, label: "30% of 100% max" }}
                />
                <SliderItem
                  name="Emerging Markets"
                  value={9500}
                  maxValue={10000}
                  currentValue={1200}
                  constraint={{ max: 50, label: "95% of 50% max" }}
                  isOverLimit
                />
              </div>
            </Panel>
            <Panel
              title="Summary"
              icon={<TrendingUp className="size-4 text-muted-foreground" />}
            >
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Value</span>
                  <span className="font-medium sensitive-value">$82,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Positions</span>
                  <span className="font-medium">24</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash</span>
                  <span className="font-medium sensitive-value">$18,000</span>
                </div>
              </div>
            </Panel>
          </PanelLayout>
        </Section>

        {/* Constraint Warnings */}
        <Section title="Constraint Warnings">
          <ConstraintWarnings
            violations={[
              {
                icon: <Globe className="size-4" />,
                category: "1 country limit exceeded",
                items: ["Emerging Markets (95%)"],
              },
              {
                icon: <TriangleAlert className="size-4" />,
                category: "2 position limits exceeded",
                items: ["Tesla (12.3%)", "Bitcoin (8.7%)"],
              },
            ]}
          />
        </Section>

        {/* Category Table */}
        <Section title="Category Table">
          <CategoryTable
            categories={[
              {
                name: "Technology",
                positions: [
                  { name: "Apple Inc.", allocation: "15.2%", value: "$12,500" },
                  {
                    name: "Microsoft Corp.",
                    allocation: "12.8%",
                    value: "$10,500",
                  },
                ],
              },
              {
                name: "ETFs",
                positions: [
                  {
                    name: "Vanguard S&P 500",
                    allocation: "35.0%",
                    value: "$28,750",
                  },
                  {
                    name: "iShares MSCI EM",
                    allocation: "10.0%",
                    value: "$8,200",
                  },
                ],
              },
            ]}
          />
        </Section>

        {/* Chart Wrapper */}
        <Section title="Chart Wrapper">
          <ChartWrapper title="Portfolio Performance">
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              ApexCharts will render here
            </div>
          </ChartWrapper>
        </Section>

        {/* Spacing reference */}
        <Section title="Spacing Grid (8px base)">
          <div className="flex items-end gap-4">
            {[
              { label: "xs (4px)", size: "h-1 w-8" },
              { label: "sm (8px)", size: "h-2 w-8" },
              { label: "md (16px)", size: "h-4 w-8" },
              { label: "lg (24px)", size: "h-6 w-8" },
              { label: "xl (32px)", size: "h-8 w-8" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-1">
                <div className={`${s.size} bg-primary rounded-sm`} />
                <span className="text-xs text-muted-foreground">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </TooltipProvider>
  );
}
