import { useEffect, useMemo, useState } from "react";
import type { WalletStore } from "@/state/store";
import { BackBar } from "@/ui/BackBar";
import { PrimaryButton } from "@/ui/Buttons";
import { Spinner } from "@/ui/Spinner";
import { networkEnv } from "@/lib/stellar";
import {
  buildDefindexDeposit,
  buildDefindexWithdraw,
  defindexBalance,
  defindexXdr,
  discoverDefindex,
  submitDefindex,
  type DefindexVault,
} from "@/lib/defindex";
import { assertSafeDefindexTransaction } from "@/lib/defindexGuard";
import { sanitizeDecimalInput, toMinorUnitsBig } from "@/lib/amount";
import "@/styles/features/wallet/defindex.css";

const short = (value: string) => `${value.slice(0, 7)}…${value.slice(-6)}`;
const minorUnits = (value: string): string | null => {
  try {
    const units = toMinorUnitsBig(value, 7);
    return units !== null && units > 0n ? units.toString() : null;
  } catch {
    return null;
  }
};

export function Defindex({ store }: { store: WalletStore }) {
  const t = store.t;
  const apiKey = store.cosmosPay?.keys[networkEnv(store.network)] ?? null;
  const [vaults, setVaults] = useState<DefindexVault[]>([]);
  const [selected, setSelected] = useState("");
  const [amounts, setAmounts] = useState<string[]>([]);
  const [shares, setShares] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [balance, setBalance] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const vault = useMemo(
    () => vaults.find((item) => item.address === selected) ?? null,
    [vaults, selected],
  );

  useEffect(() => {
    if (!apiKey) return;
    let live = true;
    setLoading(true);
    discoverDefindex(apiKey)
      .then((result) => {
        if (!live) return;
        setVaults(result.vaults);
        setSelected(result.vaults[0]?.address ?? "");
      })
      .catch(
        (reason: unknown) =>
          live &&
          setError(
            reason instanceof Error ? reason.message : t("defindex.loadError"),
          ),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [apiKey, t]);

  useEffect(() => {
    const count = vault?.totalManagedFunds.length ?? 0;
    setAmounts(Array.from({ length: count }, () => ""));
    if (!apiKey || !selected || !store.publicKey) return;
    void defindexBalance(apiKey, selected, store.publicKey)
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [apiKey, selected, store.publicKey, vault?.totalManagedFunds.length]);

  const approvedAmounts = amounts.map(minorUnits);
  const approvedShares = minorUnits(shares);
  const validAmounts =
    approvedAmounts.length > 0 &&
    approvedAmounts.every((value) => value !== null);
  const validShares = approvedShares !== null;

  const execute = async () => {
    if (!apiKey || !store.publicKey || !vault) return;
    setLoading(true);
    setError("");
    try {
      const built =
        mode === "deposit"
          ? await buildDefindexDeposit(
              apiKey,
              vault.address,
              store.publicKey,
              approvedAmounts as string[],
            )
          : await buildDefindexWithdraw(
              apiKey,
              vault.address,
              store.publicKey,
              approvedShares as string,
            );
      const unsigned = defindexXdr(built);
      assertSafeDefindexTransaction(
        store.network,
        unsigned,
        store.publicKey,
        vault.address,
        mode === "deposit"
          ? {
              kind: "deposit",
              amounts: approvedAmounts as string[],
              invest: true,
            }
          : { kind: "withdraw", shares: approvedShares as string },
      );
      const signed = await store.signRawXdr(unsigned);
      if (!signed) return;
      await submitDefindex(apiKey, signed);
      store.flash(t("defindex.success"), "ok");
      const next = await defindexBalance(
        apiKey,
        vault.address,
        store.publicKey,
      );
      setBalance(next);
      setAmounts(amounts.map(() => ""));
      setShares("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("defindex.submitError"),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title="DeFindex" onBack={store.goBack} />
        <div className="glass card defindex-empty">
          <div className="title-20">{t("defindex.enableTitle")}</div>
          <div className="t-dim-12">{t("defindex.enableDesc")}</div>
          <PrimaryButton onClick={() => store.go("cosmospay")}>
            {t("defindex.enable")}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      <BackBar title="DeFindex" onBack={store.goBack} />
      <div className="defindex-intro">{t("defindex.intro")}</div>
      {loading && !vaults.length ? (
        <Spinner />
      ) : (
        <>
          <label className="defindex-label" htmlFor="defindex-vault">
            {t("defindex.vault")}
          </label>
          <select
            id="defindex-vault"
            className="glass defindex-select"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {vaults.map((item, index) => (
              <option value={item.address} key={item.address}>
                #{index + 1} · {item.apy.toFixed(2)}% APY ·{" "}
                {short(item.address)}
              </option>
            ))}
          </select>
          {vault && (
            <div className="glass card defindex-summary">
              <span>
                <strong>{vault.apy.toFixed(2)}%</strong> APY
              </span>
              <span>
                {vault.totalManagedFunds.length} {t("defindex.assets")}
              </span>
              <span title={vault.address}>{short(vault.address)}</span>
            </div>
          )}
          <div className="defindex-tabs">
            <button
              type="button"
              className={mode === "deposit" ? "is-active" : ""}
              onClick={() => setMode("deposit")}
            >
              {t("defindex.deposit")}
            </button>
            <button
              type="button"
              className={mode === "withdraw" ? "is-active" : ""}
              onClick={() => setMode("withdraw")}
            >
              {t("defindex.withdraw")}
            </button>
          </div>
          {mode === "deposit" ? (
            vault?.totalManagedFunds.map((fund, index) => (
              <label className="glass defindex-field" key={fund.asset}>
                <span>
                  {t("defindex.amount")} {index + 1} ·{" "}
                  <small>{short(fund.asset)}</small>
                </span>
                <input
                  inputMode="decimal"
                  value={amounts[index] ?? ""}
                  onChange={(event) =>
                    setAmounts((current) =>
                      current.map((value, position) =>
                        position === index
                          ? (sanitizeDecimalInput(event.target.value, 7) ??
                            value)
                          : value,
                      ),
                    )
                  }
                  placeholder="0.00"
                />
              </label>
            ))
          ) : (
            <label className="glass defindex-field">
              <span>{t("defindex.shares")}</span>
              <input
                inputMode="decimal"
                value={shares}
                onChange={(event) =>
                  setShares(
                    sanitizeDecimalInput(event.target.value, 7) ?? shares,
                  )
                }
                placeholder="0.00"
              />
            </label>
          )}
          <div className="t-dim-12 defindex-note">
            {t("defindex.minorUnits")}
          </div>
          {balance !== null && (
            <div className="glass defindex-balance">
              <span>{t("defindex.position")}</span>
              <code>{JSON.stringify(balance)}</code>
            </div>
          )}
          {error && (
            <div className="exchange-guard exchange-guard--danger">{error}</div>
          )}
          <div className="spacer" />
          <div className="kb-dock">
            <PrimaryButton
              disabled={
                loading ||
                !vault ||
                (mode === "deposit" ? !validAmounts : !validShares)
              }
              onClick={() => void execute()}
            >
              {loading ? (
                <Spinner />
              ) : mode === "deposit" ? (
                t("defindex.confirmDeposit")
              ) : (
                t("defindex.confirmWithdraw")
              )}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
