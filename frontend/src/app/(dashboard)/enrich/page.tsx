"use client";

import { useState, useMemo } from "react";
import { useEnrich } from "@/hooks/use-enrich";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryBar } from "./summary-bar";
import { EnrichTable } from "./enrich-table";
import { BulkActionBar } from "./bulk-action-bar";
import { AddPositionDialog } from "./add-position-dialog";
import { CsvUploadDialog } from "./csv-upload-dialog";
import { PortfolioFooter } from "./portfolio-footer";

export default function EnrichPage() {
  const enrich = useEnrich();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCsvDialog, setShowCsvDialog] = useState(false);

  // Extract unique country options from data
  const countryOptions = useMemo(() => {
    const countries = new Set<string>();
    // Add from data
    for (const item of enrich.items) {
      if (item.effective_country && item.effective_country !== "N/A" && item.effective_country.trim()) {
        countries.add(item.effective_country);
      }
    }
    // Add common fallbacks
    for (const c of ["US", "DE", "GB", "FR", "CH", "NL", "JP", "CN", "CA", "AU", "IE", "KR", "SE", "IT", "ES"]) {
      countries.add(c);
    }
    return Array.from(countries).sort();
  }, [enrich.items]);

  const allSelected = enrich.sortedItems.length > 0 && enrich.sortedItems.every((i) => enrich.selectedIds.has(i.id));
  const someSelected = enrich.selectedIds.size > 0 && enrich.sortedItems.some((i) => enrich.selectedIds.has(i.id));

  const selectedManualNames = useMemo(() => {
    return enrich.items
      .filter((i) => enrich.selectedIds.has(i.id) && i.source === "manual")
      .map((i) => i.company);
  }, [enrich.items, enrich.selectedIds]);

  if (enrich.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (enrich.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Enrich</h1>
        <Alert variant="destructive">
          <AlertDescription>{enrich.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Enrich</h1>

      <PortfolioFooter
        portfolioOptions={enrich.portfolioOptions}
        onManagePortfolio={enrich.managePortfolio}
      />

      <SummaryBar
        metrics={enrich.metrics}
        cashBalance={enrich.cashBalance}
        portfolioTotal={enrich.portfolioTotal}
        builderAvailable={enrich.builderAvailable}
        portfolioOptions={enrich.portfolioOptions}
        selectedPortfolio={enrich.selectedPortfolio}
        onSelectPortfolio={enrich.setSelectedPortfolio}
        searchQuery={enrich.searchQuery}
        onSearchChange={enrich.setSearchQuery}
        selectedCount={enrich.selectedIds.size}
        isPriceUpdating={enrich.isPriceUpdating}
        onUpdateAll={enrich.updateAllPrices}
        onUpdateSelected={() => enrich.updateSelectedPrices(Array.from(enrich.selectedIds))}
        onAddPosition={() => setShowAddDialog(true)}
        onCsvUpload={() => setShowCsvDialog(true)}
        onDownloadCSV={enrich.downloadCSV}
        onSaveCash={enrich.saveCash}
        onUseBuilderAsCash={enrich.useBuilderAsCash}
      />

      {enrich.selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={enrich.selectedIds.size}
          selectedManualCount={enrich.selectedManualCount}
          selectedManualNames={selectedManualNames}
          portfolioOptions={enrich.portfolioOptions}
          countryOptions={countryOptions}
          onApply={(values) => enrich.applyBulkEdit(Array.from(enrich.selectedIds), values)}
          onDelete={() => enrich.deleteCompanies(Array.from(enrich.selectedIds))}
          onClear={enrich.clearSelection}
        />
      )}

      <EnrichTable
        items={enrich.sortedItems}
        sort={enrich.sort}
        columnHealth={enrich.columnHealth}
        selectedIds={enrich.selectedIds}
        portfolioOptions={enrich.portfolioOptions}
        countryOptions={countryOptions}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggleSort={enrich.toggleSort}
        onToggleSelectAll={enrich.toggleSelectAll}
        onToggleSelect={enrich.toggleSelect}
        onSavePortfolio={enrich.savePortfolioChange}
        onSaveIdentifier={enrich.saveIdentifierChange}
        onSaveSector={enrich.saveSectorChange}
        onSaveThesis={enrich.saveThesisChange}
        onSaveCompany={enrich.saveCompanyChange}
        onSaveInvestmentType={enrich.saveInvestmentTypeChange}
        onSaveCountry={enrich.saveCountryChange}
        onSaveShares={enrich.saveSharesChange}
        onSaveTotalValue={enrich.saveTotalValueChange}
        onResetIdentifier={enrich.resetIdentifier}
        onResetCountry={enrich.resetCountry}
        onResetShares={enrich.resetShares}
        onResetCustomValue={enrich.resetCustomValue}
      />

      {enrich.sortedItems.length === 0 && !enrich.isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          No positions found. Import a CSV or add a position manually.
        </div>
      )}

      <AddPositionDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        portfolios={enrich.portfolioDropdown}
        countryOptions={countryOptions}
        onValidateIdentifier={enrich.validateIdentifier}
        onSubmit={enrich.addPosition}
      />

      <CsvUploadDialog
        open={showCsvDialog}
        onOpenChange={setShowCsvDialog}
        onComplete={enrich.refreshData}
      />
    </div>
  );
}
