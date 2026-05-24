import {
  computePortfolioAmount,
  computeSummaryGroups,
  formatCurrencyRaw,
} from "@/lib/builder-calc";
import { longDate } from "@/lib/format";
import type {
  BudgetData,
  BuilderPortfolio,
} from "@/types/builder";

type BuilderPDFExportInput = {
  budget: BudgetData;
  portfolios: BuilderPortfolio[];
  currentPositionsMap: Record<string, number>;
  effectivePositions: Record<string, number>;
  totalAllocation: number;
  totalAllocatedAmount: number;
};

export async function exportBuilderPDF({
  budget,
  portfolios,
  currentPositionsMap,
  effectivePositions,
  totalAllocation,
  totalAllocatedAmount,
}: BuilderPDFExportInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();

  doc.setProperties({ title: "Portfolio Allocation Summary", creator: "Prismo" });

  const colors = {
    primary: [33, 37, 41] as [number, number, number],
    secondary: [108, 117, 125] as [number, number, number],
    light: [248, 249, 250] as [number, number, number],
    accent: [6, 182, 212] as [number, number, number],
  };

  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, 210, 35, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "normal");
  doc.text("Portfolio Allocation Summary", 20, 22);
  doc.setFontSize(10);
  doc.text(`Generated ${longDate(new Date())}`, 20, 30);

  doc.setTextColor(...colors.primary);

  let yPosition = 45;
  doc.setFontSize(16);
  doc.text("Investment Overview", 20, yPosition);
  yPosition += 10;

  const cardWidth = 42;
  const cardHeight = 25;
  const cardSpacing = 5;

  const budgetItems = [
    { label: "Net Worth", value: formatCurrencyRaw(budget.totalNetWorth) },
    { label: "Invested", value: formatCurrencyRaw(budget.alreadyInvested) },
    { label: "Emergency", value: formatCurrencyRaw(budget.emergencyFund) },
    { label: "Available", value: formatCurrencyRaw(budget.availableToInvest) },
  ];

  budgetItems.forEach((item, index) => {
    const x = 20 + index * (cardWidth + cardSpacing);
    doc.setFillColor(...colors.light);
    doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, "F");
    doc.setDrawColor(...colors.secondary);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, "S");
    doc.setTextColor(...colors.secondary);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(item.label, x + 3, yPosition + 8);
    doc.setTextColor(...colors.primary);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    const tw = doc.getTextWidth(item.value);
    doc.text(item.value, x + cardWidth - tw - 3, yPosition + 18);
  });

  yPosition += cardHeight + 15;

  doc.setTextColor(...colors.primary);
  doc.setFontSize(16);
  doc.setFont("helvetica", "normal");
  doc.text("Portfolio Allocations", 20, yPosition);
  yPosition += 10;

  const tableWidth = 170;
  const rowHeight = 8;
  const headerHeight = 12;
  const columns = [
    { header: "Portfolio", width: 40, align: "left" as const },
    { header: "Position", width: 50, align: "left" as const },
    { header: "Global %", width: 20, align: "right" as const },
    { header: "Portfolio %", width: 22, align: "right" as const },
    { header: "Amount", width: 38, align: "right" as const },
  ];

  doc.setFillColor(...colors.primary);
  doc.rect(20, yPosition, tableWidth, headerHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  let xPos = 20;
  columns.forEach((col) => {
    const textX = col.align === "right" ? xPos + col.width - 3 : xPos + 3;
    doc.text(col.header, textX, yPosition + 8, { align: col.align });
    xPos += col.width;
  });
  yPosition += headerHeight;

  let rowIndex = 0;

  for (const portfolio of portfolios) {
    if (yPosition > 260) {
      doc.addPage();
      yPosition = 30;
      rowIndex = 0;
    }

    const portfolioAmount = computePortfolioAmount(
      portfolio.allocation,
      budget.totalInvestableCapital
    );

    const bgColor = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    doc.rect(20, yPosition, tableWidth, rowHeight + 2, "F");
    doc.setTextColor(...colors.primary);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");

    const portfolioRow = [
      portfolio.name,
      "",
      `${portfolio.allocation.toFixed(1)}%`,
      "100%",
      formatCurrencyRaw(portfolioAmount),
    ];

    xPos = 20;
    portfolioRow.forEach((data, colIndex) => {
      const textX =
        columns[colIndex].align === "right"
          ? xPos + columns[colIndex].width - 3
          : xPos + 3;
      doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
      xPos += columns[colIndex].width;
    });
    yPosition += rowHeight + 2;
    rowIndex++;

    const groups = computeSummaryGroups(
      portfolio,
      currentPositionsMap[portfolio.id] ?? 0,
      effectivePositions[portfolio.id] ?? 0,
      budget.totalInvestableCapital
    );

    for (const group of groups) {
      if (yPosition > 260) {
        doc.addPage();
        yPosition = 30;
        rowIndex = 0;
      }

      const rowBg = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
      doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
      doc.rect(20, yPosition, tableWidth, rowHeight, "F");
      doc.setTextColor(...colors.secondary);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");

      const suffix = group.eachSuffix ? " each" : "";
      const displayName =
        group.companyName.length > 30
          ? group.companyName.substring(0, 27) + "..."
          : group.companyName;

      const posRow = [
        "",
        displayName,
        `${group.globalPct.toFixed(1)}%${suffix}`,
        `${group.portfolioPct.toFixed(1)}%${suffix}`,
        `${formatCurrencyRaw(group.amount)}${suffix}`,
      ];

      xPos = 20;
      posRow.forEach((data, colIndex) => {
        const textX =
          columns[colIndex].align === "right"
            ? xPos + columns[colIndex].width - 3
            : xPos + 3;
        doc.text(data, textX, yPosition + 5, { align: columns[colIndex].align });
        xPos += columns[colIndex].width;
      });
      yPosition += rowHeight;
      rowIndex++;
    }

    yPosition += 2;
  }

  if (yPosition > 260) {
    doc.addPage();
    yPosition = 30;
  }
  yPosition += 5;
  doc.setFillColor(...colors.accent);
  doc.rect(20, yPosition, tableWidth, rowHeight + 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");

  const totalRow = [
    "TOTAL ALLOCATION",
    "",
    `${totalAllocation.toFixed(1)}%`,
    "--",
    formatCurrencyRaw(totalAllocatedAmount),
  ];

  xPos = 20;
  totalRow.forEach((data, colIndex) => {
    const textX =
      columns[colIndex].align === "right"
        ? xPos + columns[colIndex].width - 3
        : xPos + 3;
    doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
    xPos += columns[colIndex].width;
  });

  const pageHeight = doc.internal.pageSize.height;
  doc.setTextColor(...colors.secondary);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Generated by Prismo", 20, pageHeight - 10);

  doc.save(`allocation_summary_${new Date().toISOString().slice(0, 10)}.pdf`);
}
