import { useId } from "react";
import type { WalletStore } from "@/state/store";
import { NETWORK_IDS, type NetworkId } from "@/constants/networks";
import { networkOfRow } from "@/lib/assetList";
import { rowKey, type AssetRow } from "@/lib/portfolio";
import { fmt, pct } from "@/lib/format";
import { AssetLogo, assetMeta } from "@/ui/AssetLogo";
import "@/styles/features/wallet/home-insights.css";

/** A priced snapshot of the portfolio; no invented historical performance. */
export function HomeInsights({
  store,
  rows,
  total,
  networkName,
}: {
  store: WalletStore;
  rows: AssetRow[];
  total: number;
  networkName: (network: NetworkId) => string;
}) {
  const t = store.t;
  const titleId = useId();
  const held = rows
    .filter((row) => (row.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const networks = NETWORK_IDS.map((network) => ({
    network,
    value: held
      .filter((row) => networkOfRow(row) === network)
      .reduce((sum, row) => sum + (row.value ?? 0), 0),
  }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  const hasAllocation = networks.length > 0 && total > 0;
  const share = (value: number) =>
    total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <section className="insights" aria-labelledby={titleId}>
      <header className="insights-heading">
        <h2 id={titleId}>{t("home.insights.title")}</h2>
        {hasAllocation && <p>{t("home.insights.caption")}</p>}
      </header>
      {!hasAllocation ? (
        <p className="insights-empty">{t("home.insights.empty")}</p>
      ) : (
        <>
          <section
            className="insights-section"
            aria-label={t("home.byNetwork")}
          >
            <header className="insights-section-head">
              <h3>{t("home.byNetwork")} <span className="insights-count">({networks.length})</span></h3>
              <span>USD · %</span>
            </header>
            <ol className="insights-list">
              {networks.map(({ network, value }) => (
                <li key={network} className="insights-network">
                  <span className="insights-name">{networkName(network)}</span>
                  <span className="insights-value">${fmt(value, 2)}</span>
                  <span className="insights-detail">{fmt(share(value), 1)}%</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="insights-section" aria-label={t("home.byAsset")}>
            <header className="insights-section-head">
              <h3>{t("home.insights.positions")} <span className="insights-count">({held.length})</span></h3>
              <span>{t("home.in24h")}</span>
            </header>
            <ul className="insights-list">
              {held.map((row) => {
                const change = store.prices[row.code]?.change24h;
                return (
                  <li key={rowKey(row)} className="insights-position">
                    <AssetLogo code={row.code} size={24} />
                    <div className="insights-position-name">
                      <span className="insights-name">
                        {assetMeta(row.code).name}
                      </span>
                      <span className="insights-detail">
                        {networkName(networkOfRow(row))} ·{" "}
                        {fmt(share(row.value ?? 0), 1)}%
                      </span>
                    </div>
                    <div className="insights-numbers">
                      <span>${fmt(row.value ?? 0, 2)}</span>
                      <span className="insights-detail">
                        {change !== undefined ? pct(change) : "—"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
