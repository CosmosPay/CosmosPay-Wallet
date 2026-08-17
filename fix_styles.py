import re
import os

def rep(file, old, new):
    with open(file, 'r') as f:
        c = f.read()
    c = c.replace(old, new)
    with open(file, 'w') as f:
        f.write(c)

def app(file, text):
    with open(file, 'a') as f:
        f.write("\n" + text + "\n")

# 1. src/features/fiat/components/CreateReceiver.tsx
rep('src/features/fiat/components/CreateReceiver.tsx', "style={{ flex: 1 }}", "className=\"fiat-flex\"")
app('src/styles/features/fiat/shared.css', ".fiat-flex { flex: 1; }")

# 2. src/app/Toast.tsx
c_toast = """          style={{
            background: bg,
            color: fg,
            animation: leaving ? 'toastDown .23s ease forwards' : 'toastUp .3s cubic-bezier(.2,.9,.3,1)',
          }}"""
rep('src/app/Toast.tsx', c_toast, """          style={{ background: bg, color: fg } as React.CSSProperties}
          className={`toast-ext-card ${leaving ? 'is-leaving' : 'is-entering'}`}""")
c_toast2 = """        style={{
          background: bg,
          color: fg,
          animation: leaving ? 'popOut .23s ease forwards' : 'pop .28s ease',
        }}"""
rep('src/app/Toast.tsx', c_toast2, """        style={{ background: bg, color: fg } as React.CSSProperties}
        className={`toast-card ${leaving ? 'is-leaving' : 'is-entering'}`}""")
app('src/styles/app/toast.css', """.toast-ext-card.is-leaving { animation: toastDown .23s ease forwards; }
.toast-ext-card.is-entering { animation: toastUp .3s cubic-bezier(.2,.9,.3,1); }
.toast-card.is-leaving { animation: popOut .23s ease forwards; }
.toast-card.is-entering { animation: pop .28s ease; }""")

# 3. src/ui/ConfirmSign.tsx
rep('src/ui/ConfirmSign.tsx', "style={{ marginBottom: err ? '8px' : '16px' }}", "className={`confirm-sign-msg ${err ? 'is-err' : ''}`}")
app('src/styles/ui/confirm-sign.css', ".confirm-sign-msg { margin-bottom: 16px; }\n.confirm-sign-msg.is-err { margin-bottom: 8px; }")

# 4. src/features/money/Send.tsx
rep('src/features/money/Send.tsx', "style={{ width: `${Math.max(1, s.amount.length || 1)}ch` }}", "style={{ '--chars': Math.max(1, s.amount.length || 1) } as React.CSSProperties}")
app('src/styles/features/money/send.css', ".send-amount-input { width: calc(var(--chars, 1) * 1ch); }")
rep('src/features/money/Send.tsx', 'className="send-amount-input"', 'className="send-amount-input"')

# 5. src/app/BottomNav.tsx
c_bn1 = """        style={{
          opacity: show ? 1 : 0,
          transform: `translateY(${show ? 0 : 20}px)`,
          pointerEvents: show ? 'auto' : 'none',
        }}"""
rep('src/app/BottomNav.tsx', c_bn1, 'className={`bottom-nav-wrap ${show ? "is-visible" : "is-hidden"}`}')
c_bn2 = """            style={{
              opacity: on ? 1 : 0.45,
              transform: on ? 'scale(1.05)' : 'none',
              color: on ? 'var(--text)' : 'inherit',
            }}"""
rep('src/app/BottomNav.tsx', c_bn2, 'className={`col g4 bottom-nav-btn ${on ? "is-on" : ""}`}')
rep('src/app/BottomNav.tsx', 'className="col g4 bottom-nav-btn"', '')
app('src/styles/app/bottom-nav.css', """.bottom-nav-wrap.is-visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
.bottom-nav-wrap.is-hidden { opacity: 0; transform: translateY(20px); pointer-events: none; }
.bottom-nav-btn { opacity: 0.45; }
.bottom-nav-btn.is-on { opacity: 1; transform: scale(1.05); color: var(--text); }""")

# 6. src/app/NavMenu.tsx
c_nm1 = """          style={{
            transform: `translateX(${open ? 0 : 100}%)`,
            pointerEvents: open ? 'auto' : 'none',
          }}"""
rep('src/app/NavMenu.tsx', c_nm1, 'className={`glass nav-menu-drawer ${open ? "is-open" : "is-closed"}`}')
c_nm2 = """                  style={on ? { background: 'var(--surface)', border: '1px solid var(--glass-soft-border)' } : undefined}"""
rep('src/app/NavMenu.tsx', c_nm2, 'className={`row g12 nav-menu-row tap ${on ? "is-on" : ""}`}')
rep('src/app/NavMenu.tsx', 'className="row g12 nav-menu-row tap"', '')
app('src/styles/app/nav-menu.css', """.nav-menu-drawer.is-open { transform: translateX(0); pointer-events: auto; }
.nav-menu-drawer.is-closed { transform: translateX(100%); pointer-events: none; }
.nav-menu-row.is-on { background: var(--surface); border: 1px solid var(--glass-soft-border); }""")

# 7. src/ui/NetworkDropdown.tsx
rep('src/ui/NetworkDropdown.tsx', "style={align === 'right' ? { right: 0 } : { left: 0 }}", "className={`glass network-dd-menu align-${align}`}")
rep('src/ui/NetworkDropdown.tsx', "style={on ? { background: 'var(--surface)' } : undefined}", "className={`row g10 network-dd-row ${on ? 'is-on' : ''}`}")
rep('src/ui/NetworkDropdown.tsx', 'className="row g10 network-dd-row"', '')
app('src/styles/ui/network-dropdown.css', ".network-dd-menu.align-right { right: 0; }\n.network-dd-menu.align-left { left: 0; }\n.network-dd-row.is-on { background: var(--surface); }")

# 8. src/ui/Buttons.tsx
rep('src/ui/Buttons.tsx', ' className={className ? `btn-primary ${className}` : \'btn-primary\'} style={style}', ' className={className ? `btn-primary ${className}` : \'btn-primary\'}')
rep('src/ui/Buttons.tsx', ' className={className ? `btn-ghost ${className}` : \'btn-ghost\'} style={style}', ' className={className ? `btn-ghost ${className}` : \'btn-ghost\'}')

# 9. src/ui/Spinner.tsx
rep('src/ui/Spinner.tsx', 'style={{ width: `${size}px`, height: `${size}px`, color }}', 'style={{ "--size": `${size}px`, color } as React.CSSProperties}')
app('src/styles/app.css', ".spinner { width: var(--size, 20px); height: var(--size, 20px); }")

# 10. src/ui/TokenAvatar.tsx
c_ta1 = """      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.4)}px`,
      }}"""
rep('src/ui/TokenAvatar.tsx', c_ta1, 'style={{ "--sz": `${size}px`, "--fsz": `${Math.round(size * 0.4)}px` } as React.CSSProperties}')
app('src/styles/ui/token-avatar.css', ".token-avatar-ring, .token-avatar-circle { width: var(--sz); height: var(--sz); font-size: var(--fsz); }")

# 11. Stagger ladder (main, money, genesis, etc)
for file, class_ in [('src/features/main/components/AssetListRow.tsx', 'home-asset-row'), ('src/features/main/components/MarketRow.tsx', 'market-row'), ('src/features/money/components/HistoryRow.tsx', 'money-history-row'), ('src/features/money/components/GenesisRow.tsx', 'money-genesis-row')]:
    rep(file, "style={{ animationDelay: `${delay}s` }}", "style={{ \"--stagger\": `${delay}s` } as React.CSSProperties}")
    if class_ == 'money-history-row':
        rep(file, "style={{ animationDelay: `${delay}s` }}", "style={{ \"--stagger\": `${delay}s` } as React.CSSProperties}")
        
app('src/styles/app.css', ".home-asset-row, .market-row, .money-history-row, .money-genesis-row { animation-delay: var(--stagger) !important; }")

# 12. src/features/fiat/components/Select.tsx
rep('src/features/fiat/components/Select.tsx', 'style={style}', '')

# 13. src/ui/flags.tsx
rep('src/ui/flags.tsx', 'style={{ width: `${size}px` }}', 'style={{ "--fsize": `${size}px` } as React.CSSProperties}')
rep('src/ui/flags.tsx', "style={{ transform: open ? 'rotate(180deg)' : 'none' }}", "className={`flag-select-caret ${open ? 'is-open' : ''}`}")
rep('src/ui/flags.tsx', "style={{ background: on ? C.cardSolid : 'transparent', fontWeight: on ? 800 : 600 }}", "")
rep('src/ui/flags.tsx', 'className="row g10 flag-select-opt"', 'className={`row g10 flag-select-opt ${on ? "is-on" : ""}`}')
app('src/styles/ui/flags.css', ".flag-img { width: var(--fsize, 22px); }\n.flag-select-caret.is-open { transform: rotate(180deg); }\n.flag-select-opt.is-on { background: var(--glass-soft-bg); font-weight: 800; }")

# 14. src/app/WalletApp.tsx
c_wa1 = """        style={{
          transform: `translateX(${routeSlide}%)`,
          opacity: Math.max(0, 1 - Math.abs(routeSlide) / 50),
        }}"""
rep('src/app/WalletApp.tsx', c_wa1, 'style={{ "--rs-x": `${routeSlide}%`, "--rs-o": Math.max(0, 1 - Math.abs(routeSlide) / 50) } as React.CSSProperties}')
c_wa2 = """      style={{
        opacity: splashState === 'hidden' ? 0 : 1,
        pointerEvents: splashState === 'hidden' ? 'none' : 'auto',
      }}"""
rep('src/app/WalletApp.tsx', c_wa2, 'className={`splash-overlay ${splashState}`}')
app('src/styles/app/wallet-app.css', ".wallet-view-wrap { transform: translateX(var(--rs-x)); opacity: var(--rs-o); }\n.splash-overlay.hidden { opacity: 0; pointer-events: none; }\n.splash-overlay.visible { opacity: 1; pointer-events: auto; }")

