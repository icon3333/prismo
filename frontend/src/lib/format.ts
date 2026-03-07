export const rebalancerFmt = {
  currency: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  percent: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
};

export function formatAction(action: number) {
  if (Math.abs(action) < 0.01)
    return { text: "No action", className: "text-muted-foreground" };
  if (action > 0)
    return {
      text: `Buy ${rebalancerFmt.currency.format(action)}`,
      className: "text-emerald-400",
    };
  return {
    text: `Sell ${rebalancerFmt.currency.format(Math.abs(action))}`,
    className: "text-coral-500",
  };
}
