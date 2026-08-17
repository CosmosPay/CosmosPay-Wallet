import re
import os

def rep(file, old, new):
    with open(file, 'r') as f:
        c = f.read()
    c = c.replace(old, new)
    with open(file, 'w') as f:
        f.write(c)

# Remove --stagger and add stagger class
rep('src/features/main/components/AssetListRow.tsx', ' style={{ "--stagger": `${delay}s` } as React.CSSProperties}', '')
rep('src/features/main/components/AssetListRow.tsx', 'className="tap home-asset-row"', 'className={`tap home-asset-row stagger-${Math.min(delay, 20)}`}')

rep('src/features/main/components/MarketRow.tsx', ' style={{ "--stagger": `${delay}s` } as React.CSSProperties}', '')
rep('src/features/main/components/MarketRow.tsx', 'className="tap row between market-row"', 'className={`tap row between market-row stagger-${Math.min(delay, 20)}`}')

rep('src/features/money/components/HistoryRow.tsx', ' style={{ "--stagger": `${delay}s` } as React.CSSProperties}', '')
rep('src/features/money/components/HistoryRow.tsx', 'className={`tap money-history-row ${isSep7 ? "sep7" : ""}`}', 'className={`tap money-history-row stagger-${Math.min(delay, 20)} ${isSep7 ? "sep7" : ""}`}')
rep('src/features/money/components/HistoryRow.tsx', 'className="tap money-history-row"', 'className={`tap money-history-row stagger-${Math.min(delay, 20)}`}')

rep('src/features/money/components/GenesisRow.tsx', ' style={{ "--stagger": `${delay}s` } as React.CSSProperties}', '')
rep('src/features/money/components/GenesisRow.tsx', 'className="money-genesis-row"', 'className={`money-genesis-row stagger-${Math.min(delay, 20)}`}')

# Fix callers to pass index, not index * 0.05
rep('src/features/main/Home.tsx', 'delay={i * 0.05}', 'delay={i}')
rep('src/features/main/Home.tsx', 'delay={store.history.length * 0.05}', 'delay={store.history.length}')

rep('src/features/main/Markets.tsx', 'delay={i * 0.05}', 'delay={i}')
rep('src/features/main/Asset.tsx', 'delay={i * 0.05}', 'delay={i}')
rep('src/features/main/Asset.tsx', 'delay={assetHistory.length * 0.05}', 'delay={assetHistory.length}')
rep('src/features/money/History.tsx', 'delay={i * 0.05}', 'delay={i}')
rep('src/features/money/History.tsx', 'delay={store.history.length * 0.05}', 'delay={store.history.length}')

# Append stagger ladder to CSS
stagger_css = "\n/* Stagger ladder */\n"
for i in range(21):
    stagger_css += f".stagger-{i} {{ animation-delay: {i * 0.05}s !important; }}\n"
with open('src/styles/app.css', 'a') as f:
    f.write(stagger_css)

# Remove ui.ts and its export from parts.tsx
if os.path.exists('src/constants/ui.ts'):
    os.remove('src/constants/ui.ts')
rep('src/ui/parts.tsx', "export { C, CONTROL, CONTROL_H, inputStyle } from '@/constants/ui';\n", "")

