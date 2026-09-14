import type { ReactElement, SVGProps } from 'react';
import type { CameraPreset } from '@streaming/canvas-compositor';

type IconProps = SVGProps<SVGSVGElement>;

const svgAttrs = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Full-bleed camera — one rounded frame. */
export function FocusLayoutIcon(props: IconProps) {
  return (
    <svg {...svgAttrs} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

/** Featured full frame with two guest tiles stacked on the left. */
export function PipLeftLayoutIcon(props: IconProps) {
  return (
    <svg {...svgAttrs} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="5" y="7" width="5" height="4" rx="1" />
      <rect x="5" y="13" width="5" height="4" rx="1" />
    </svg>
  );
}

/** Featured full frame with two guest tiles stacked on the right. */
export function PipRightLayoutIcon(props: IconProps) {
  return (
    <svg {...svgAttrs} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="14" y="7" width="5" height="4" rx="1" />
      <rect x="14" y="13" width="5" height="4" rx="1" />
    </svg>
  );
}

/** Equal 2×2 cells with a small gap. */
export function GridLayoutIcon(props: IconProps) {
  return (
    <svg {...svgAttrs} {...props}>
      <rect x="3" y="5" width="8" height="6" rx="1" />
      <rect x="13" y="5" width="8" height="6" rx="1" />
      <rect x="3" y="13" width="8" height="6" rx="1" />
      <rect x="13" y="13" width="8" height="6" rx="1" />
    </svg>
  );
}

export const LAYOUT_OPTIONS: {
  id: CameraPreset;
  label: string;
  Icon: (props: IconProps) => ReactElement;
}[] = [
  { id: 'focus', label: 'focus', Icon: FocusLayoutIcon },
  { id: 'pip-left', label: 'pip L', Icon: PipLeftLayoutIcon },
  { id: 'pip-right', label: 'pip R', Icon: PipRightLayoutIcon },
  { id: 'grid', label: 'grid', Icon: GridLayoutIcon },
];
