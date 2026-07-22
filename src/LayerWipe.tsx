import {Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {revealProgress} from './easing';
import type {Storyboard} from './types';

type LayerWipeProps = {
  src: string;
  startFrame: number;
  durationFrames: number;
  opacity?: number;
  zIndex: number;
  treatment?: 'bw' | 'detail' | 'color';
  layout?: Storyboard['project']['layout'];
  visibleFromStart?: boolean;
};

const treatmentFilter = {
  bw: 'grayscale(1) contrast(1.72) brightness(1.12)',
  detail: 'grayscale(1) contrast(1.28) brightness(1.055)',
  color: 'brightness(1.035) contrast(1.04)',
} as const;

export const LayerWipe: React.FC<LayerWipeProps> = ({
  src,
  startFrame,
  durationFrames,
  opacity = 1,
  zIndex,
  treatment = 'color',
  layout,
  visibleFromStart = false,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const progress = visibleFromStart
    ? 1
    : revealProgress(frame, startFrame, durationFrames);
  // The BW base plate is already present on the first frame. Later detail and
  // color plates keep one left-to-right mask direction so the drawing never
  // jumps or passes through a blank page.
  const clipPath = `inset(0 ${100 - progress * 100}% 0 0)`;

  return (
    <div
      style={{
        position: 'absolute',
        zIndex,
        left: width * (layout?.side_margin_ratio ?? 0.0685),
        right: width * (layout?.side_margin_ratio ?? 0.0685),
        top: height * (layout?.illustration_top_ratio ?? 0.265),
        bottom: height * (layout?.bottom_margin_ratio ?? 0.03),
        clipPath,
        opacity,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center center',
          filter: treatmentFilter[treatment],
        }}
      />
    </div>
  );
};
