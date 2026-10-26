/**
 * Elegir skin, o armarse uno con dos colores.
 *
 * La muestra de cada skin se pinta con los tokens de ESE skin, no con los del
 * que esta puesto: asi se ve de verdad lo que vas a elegir antes de elegirlo.
 */
import { useMemo, useState } from 'react';
import type { WalletStore } from '../store';
import { C } from '../parts';
import {
  PRESETS,
  checkSeed,
  deriveSkin,
  type Appearance,
  type Preset,
  type SkinSeed,
} from '@/lib/appearance';

/** Una pastilla redonda que muestra el fondo, el acento y una linea de texto. */
function Muestra({ bg, accent, text }: { bg: string; accent: string; text: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '46px',
        borderRadius: '12px',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 10px',
        overflow: 'hidden',
      }}
    >
      <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: accent, flexShrink: 0 }} />
      <span style={{ flex: 1, height: '6px', borderRadius: '999px', background: text, opacity: 0.85 }} />
      <span style={{ width: '22px', height: '6px', borderRadius: '999px', background: text, opacity: 0.4 }} />
    </div>
  );
}

function TarjetaPreset({
  preset,
  activo,
  onPick,
}: {
  preset: Preset;
  activo: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className="card-btn"
      style={{
        border: activo ? `2px solid ${C.accent}` : '1px solid var(--glass-border)',
        background: 'var(--glass-soft-bg)',
        borderRadius: '16px',
        padding: '8px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        textAlign: 'left',
      }}
    >
      <Muestra bg={preset.skin.bg} accent={preset.skin.accent} text={preset.skin.text} />
      <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text)', paddingLeft: '2px' }}>
        {preset.name}
      </span>
    </button>
  );
}

export function SkinPicker({ store }: { store: WalletStore }) {
  const t = store.t;
  const actual: Appearance = store.appearance;
  const [abierto, setAbierto] = useState(actual.preset === 'custom');
  const [seed, setSeed] = useState<SkinSeed>(
    actual.custom ?? { bg: '#101418', accent: '#6ea8ff' },
  );

  const vistaPrevia = useMemo(() => deriveSkin(seed), [seed]);
  const reporte = useMemo(() => checkSeed(seed), [seed]);

  const aplicarPropio = () => store.setAppearance({ preset: 'custom', custom: seed });

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {PRESETS.map((p) => (
          <TarjetaPreset
            key={p.id}
            preset={p}
            activo={actual.preset === p.id}
            onPick={() => store.setAppearance({ preset: p.id })}
          />
        ))}
      </div>

      <button
        onClick={() => setAbierto((o) => !o)}
        style={{
          marginTop: '10px',
          width: '100%',
          background: actual.preset === 'custom' ? C.accent : 'var(--glass-soft-bg)',
          color: actual.preset === 'custom' ? 'var(--on-accent)' : 'var(--text)',
          border: '1px solid var(--glass-soft-border)',
          padding: '12px',
          fontSize: '13px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        {t('settings.customColors')}
      </button>

      {abierto && (
        <div
          style={{
            marginTop: '10px',
            padding: '12px',
            borderRadius: '16px',
            background: 'var(--surface)',
            border: '1px solid var(--hairline)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '12px' }}>
            {(
              [
                ['bg', t('settings.colorBg')],
                ['accent', t('settings.colorAccent')],
              ] as const
            ).map(([campo, label]) => (
              <label key={campo} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: C.muted }}>{label}</span>
                <input
                  type="color"
                  value={seed[campo]}
                  onChange={(e) => setSeed((s) => ({ ...s, [campo]: e.target.value }))}
                  style={{
                    width: '100%',
                    height: '42px',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '12px',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                />
              </label>
            ))}
          </div>

          <Muestra bg={vistaPrevia.bg} accent={vistaPrevia.accent} text={vistaPrevia.text} />

          {/*
            Si hubo que apartarse del color pedido, se dice. Cambiarlo en
            silencio hace que el usuario crea que la app ignora lo que elige.
          */}
          {reporte.ajustado && (
            <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.4, color: C.muted }}>
              {t('settings.contrastFixed')}
            </p>
          )}

          <button
            onClick={aplicarPropio}
            style={{
              background: C.accent,
              color: 'var(--on-accent)',
              border: 'none',
              padding: '12px',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {t('settings.applyColors')}
          </button>
        </div>
      )}
    </>
  );
}
