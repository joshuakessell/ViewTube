import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsDownUp } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { ArrowsInSimple } from '@phosphor-icons/react/dist/csr/ArrowsInSimple';
import { ArrowsLeftRight } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight';
import { ArrowsOutSimple } from '@phosphor-icons/react/dist/csr/ArrowsOutSimple';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { ClipboardText } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { Export } from '@phosphor-icons/react/dist/csr/Export';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { Microphone } from '@phosphor-icons/react/dist/csr/Microphone';
import { MicrophoneSlash } from '@phosphor-icons/react/dist/csr/MicrophoneSlash';
import { Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { PencilSimple } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { Shuffle } from '@phosphor-icons/react/dist/csr/Shuffle';
import { UserPlus } from '@phosphor-icons/react/dist/csr/UserPlus';
import { VideoCamera } from '@phosphor-icons/react/dist/csr/VideoCamera';
import { VideoCameraSlash } from '@phosphor-icons/react/dist/csr/VideoCameraSlash';
import { X } from '@phosphor-icons/react/dist/csr/X';

const ICONS = {
  mic: Microphone,
  micOff: MicrophoneSlash,
  cam: VideoCamera,
  camOff: VideoCameraSlash,
  swapV: ArrowsDownUp,
  swapH: ArrowsLeftRight,
  expand: ArrowsOutSimple,
  shrink: ArrowsInSimple,
  share: Export,
  invite: UserPlus,
  leave: X,
  close: X,
  play: Play,
  pause: Pause,
  paste: ClipboardText,
  plus: Plus,
  check: Check,
  search: MagnifyingGlass,
  back: ArrowCounterClockwise,
  forward: ArrowClockwise,
  shuffle: Shuffle,
  edit: PencilSimple,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, weight = 'regular' }: { name: IconName; size?: number; weight?: IconWeight }) {
  const Glyph = ICONS[name];
  return <Glyph size={size} weight={weight} aria-hidden="true" />;
}
