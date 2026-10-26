/**
 * Los skins que vienen con la app.
 *
 * Los dos primeros son los originales, copiados tal cual: cambiarlos seria
 * cambiarle la wallet a quien no pidio nada. Los demas se generan con el mismo
 * derivador que usa el color propio del usuario, asi que si la derivacion
 * mejora, mejoran todos juntos, y si empeora se nota en los que vienen de
 * fabrica antes de que lo sufra nadie.
 */
import { deriveSkin, type SkinSeed } from './derive.ts';
import { DARK, LIGHT, type Skin, type SkinMode } from './tokens.ts';

export type PresetId =
  | 'dark'
  | 'light'
  | 'medianoche'
  | 'cosmico'
  | 'esmeralda'
  | 'atardecer'
  | 'ciruela'
  | 'papel';

export type Preset = {
  id: PresetId;
  /** Como se llama en la pantalla de ajustes. */
  name: string;
  mode: SkinMode;
  skin: Skin;
  /** Con que dos colores se genero. Sirve para mostrar la muestra. */
  seed?: SkinSeed;
};

function generado(id: PresetId, name: string, seed: SkinSeed): Preset {
  return { id, name, mode: seed.mode ?? 'dark', skin: deriveSkin(seed), seed };
}

export const PRESETS: Preset[] = [
  { id: 'dark', name: 'Oscuro', mode: 'dark', skin: DARK },
  { id: 'light', name: 'Claro', mode: 'light', skin: LIGHT },
  // Los dos azules del manual de marca.
  generado('medianoche', 'Medianoche', { bg: '#05064F', accent: '#8aa0ff', mode: 'dark' }),
  generado('cosmico', 'Cosmico', { bg: '#000877', accent: '#7f9cff', mode: 'dark' }),
  generado('esmeralda', 'Esmeralda', { bg: '#071a14', accent: '#35d39a', mode: 'dark' }),
  generado('atardecer', 'Atardecer', { bg: '#1a0f08', accent: '#ff9d4d', mode: 'dark' }),
  generado('ciruela', 'Ciruela', { bg: '#17091a', accent: '#d98cff', mode: 'dark' }),
  generado('papel', 'Papel', { bg: '#f4f1ea', accent: '#2f5d50', mode: 'light' }),
];

export const PRESET_IDS = PRESETS.map((p) => p.id);

export function presetById(id: string): Preset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

export const DEFAULT_PRESET: PresetId = 'dark';
