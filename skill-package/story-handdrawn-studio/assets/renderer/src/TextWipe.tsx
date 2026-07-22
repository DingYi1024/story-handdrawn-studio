import type {CSSProperties} from 'react';
import {Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {revealProgress} from './easing';
import type {Storyboard} from './types';

type TextWipeProps = {
  text: string;
  textAsset?: string | null;
  startFrame: number;
  durationFrames: number;
  project: Storyboard['project'];
};

const textStyle = (fontSize: number, maxWidth: number): CSSProperties => ({
  fontFamily: 'OriginalDiaryHand, STKaiti, serif',
  fontSize,
  fontWeight: 400,
  lineHeight: 1.34,
  letterSpacing: '0.025em',
  color: '#171714',
  WebkitTextStroke: '0.7px #171714',
  margin: 0,
  maxWidth,
  textAlign: 'left',
  whiteSpace: 'pre-line',
  transform: 'rotate(-0.35deg)',
});

const fallbackFontSize = (text: string, availableWidth: number, availableHeight: number) => {
  const lines = text.split('\n').filter(Boolean);
  const lineCount = Math.max(1, lines.length);
  const longestLine = Math.max(...lines.map((line) => line.length), 1);
  const widthLimited = Math.floor(availableWidth / (longestLine * 1.08));
  const heightLimited = Math.floor(availableHeight / (lineCount * 1.28));
  const scale = Math.min(availableWidth / 850, availableHeight / 306);
  return Math.max(26, Math.min(82 * Math.max(0.7, scale), widthLimited, heightLimited));
};

export const TextWipe: React.FC<TextWipeProps> = ({
  text,
  textAsset,
  startFrame,
  durationFrames,
  project,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const progress = revealProgress(frame, startFrame, durationFrames);
  const layout = project.layout;
  const side = width * (layout?.side_margin_ratio ?? 0.0685);
  const top = height * (layout?.caption_top_ratio ?? 0.06);
  const captionHeight = height * (layout?.caption_height_ratio ?? 0.2);
  const availableWidth = width - side * 2;
  const fontSize = fallbackFontSize(text, availableWidth, captionHeight);

  if (textAsset) {
    return (
      <div
        style={{
          position: 'absolute',
          zIndex: 40,
          top,
          left: side,
          width: availableWidth,
          height: captionHeight,
          clipPath: `inset(0 ${100 - progress * 100}% 0 0)`,
          overflow: 'hidden',
        }}
      >
        <Img
          src={staticFile(textAsset)}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'left top',
            filter: 'brightness(1.025) contrast(1.035)',
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 40,
        top,
        left: side,
        right: side,
        display: 'flex',
        justifyContent: 'flex-start',
        clipPath: `inset(0 ${100 - progress * 100}% 0 0)`,
      }}
    >
      <p style={textStyle(fontSize, availableWidth)}>{text}</p>
    </div>
  );
};
