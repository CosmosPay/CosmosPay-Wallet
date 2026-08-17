/** Shared UI barrel. Implementations live under atomic-design layers
 *  (src/components/atoms|molecules|organisms/), one file per component; everything
 *  is re-exported here so every existing `import { ... } from '@/ui/parts'`
 *  keeps working unchanged. New code may import from the layer directly. */

// Design tokens live in src/constants/ui.ts (single source of truth).
export { ASSET_META } from '@/constants/assets';

// atoms
export { Logo } from '@/ui/Logo';
export { StellarMark } from '@/ui/StellarMark';
export { Spinner } from '@/ui/Spinner';
export { TokenAvatar } from '@/ui/TokenAvatar';
export { assetMeta, AssetLogo } from '@/ui/AssetLogo';
export { PrimaryButton, GhostButton } from '@/ui/Buttons';
export { NumberPad } from '@/ui/NumberPad';

// molecules
export { BackBar } from '@/ui/BackBar';
export { SurfaceToggle } from '@/ui/SurfaceToggle';
export { NetworkDropdown } from '@/ui/NetworkDropdown';

// organisms
export { Shell } from '@/app/Shell';
export { ConfirmSign } from '@/ui/ConfirmSign';
export { BottomNav } from '@/app/BottomNav';
export { NavMenu } from '@/app/NavMenu';
export { Toast } from '@/app/Toast';
export { EnableReceivingCard } from '@/ui/EnableReceivingCard';
