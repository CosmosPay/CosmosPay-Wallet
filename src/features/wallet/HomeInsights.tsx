import { useId } from "react";
import type { WalletStore } from "@/state/store";
import { NETWORK_IDS, type NetworkId } from "@/constants/networks";
import { networkOfRow } from "@/lib/assetList";
import { rowKey, type AssetRow } from "@/lib/portfolio";
import { fmt, pct } from "@/lib/format";
import { cx } from "@/lib/cx";
import { AssetLogo, NetworkLogo, assetMeta } from "@/ui/AssetLogo";
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
  const largest = networks[0];
  const share = (value: number) =>
    total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <section className="insights" aria-labelledby={titleId}>
      <header className="insights-heading">
        <h2 id={titleId}>{t("home.insights.title")}</h2>
        <p>{t("home.insights.caption")}</p>
      </header>
      {!largest || total <= 0 ? (
        <p className="insights-empty">{t("home.insights.empty")}</p>
      ) : (
        <>
          <div className="insights-overview">
            <div className="insights-lead">
              <p className="insights-eyebrow">{t("home.insights.largest")}</p>
              <p className="insights-figure">
                {fmt(share(largest.value), 1)}
                <span>%</span>
              </p>
              <p className="insights-lead-name">
                {networkName(largest.network)}
              </p>
            </div>
            <dl className="insights-facts">
              <div>
                <dt>{t("home.insights.networks")}</dt>
                <dd>{networks.length}</dd>
              </div>
              <div>
                <dt>{t("home.insights.positions")}</dt>
                <dd>{held.length}</dd>
              </div>
            </dl>
          </div>
          <section
            className="insights-section"
            aria-label={t("home.byNetwork")}
          >
            <header className="insights-section-head">
              <h3>{t("home.byNetwork")}</h3>
              <span>USD · %</span>
            </header>
            <ol className="insights-list">
              {networks.map(({ network, value }, index) => (
                <li key={network} className="insights-network">
                  <span className="insights-rank" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <NetworkLogo network={network} size={28} />
                  <span className="insights-name">{networkName(network)}</span>
                  <div className="insights-numbers">
                    <span>${fmt(value, 2)}</span>
                    <span className="insights-share">
                      {fmt(share(value), 1)}%
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="insights-section" aria-label={t("home.byAsset")}>
            <header className="insights-section-head">
              <h3>{t("home.insights.positions")}</h3>
              <span>{t("home.in24h")}</span>
            </header>
            <ul className="insights-list">
              {held.map((row) => {
                const change = store.prices[row.code]?.change24h;
                return (
                  <li key={rowKey(row)} className="insights-position">
                    <AssetLogo code={row.code} size={28} />
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
                      <span
                        className={cx(
                          "insights-change",
                          change !== undefined &&
                            (change >= 0 ? "is-up" : "is-down"),
                        )}
                      >
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
