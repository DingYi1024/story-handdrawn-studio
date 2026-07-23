import {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

const hash = (value: number) => {
  const x = Math.sin(value * 91.17) * 43758.5453;
  return x - Math.floor(x);
};

export const HanddrawnEffects: React.FC<{
  effects?: string[];
  frameOffset?: number;
  opacity?: number;
}> = ({effects = [], frameOffset = 0, opacity = 1}) => {
  const frame = Math.max(0, useCurrentFrame() - frameOffset);
  const {width, height, fps} = useVideoConfig();
  const particles = useMemo(() => Array.from({length: 18}, (_, index) => ({
    x: hash(index + 3) * width,
    y: hash(index + 17) * height,
    speed: 0.45 + hash(index + 31) * 0.8,
    size: 4 + hash(index + 47) * 10,
  })), [height, width]);
  const has = (name: string) => effects.includes(name);
  if (!effects.length || effects.includes('handheld-drift')) return null;
  const t = frame / fps;
  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity, overflow: 'hidden'}}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {has('rain') ? particles.map((p, index) => {
          const y = (p.y + t * 260 * p.speed) % (height + 60) - 30;
          return <line key={`r${index}`} x1={p.x} y1={y} x2={p.x - 8} y2={y + 28} stroke="#6b7885" strokeWidth={2} opacity={0.2 + hash(index) * 0.24} strokeLinecap="round" />;
        }) : null}
        {has('petals') ? particles.slice(0, 11).map((p, index) => {
          const y = (p.y + t * 32 * p.speed) % (height + 80) - 40;
          const x = p.x + Math.sin(t * 1.4 + index) * 24;
          return <ellipse key={`p${index}`} cx={x} cy={y} rx={p.size * 0.55} ry={p.size * 0.25} fill={index % 2 ? '#d6a36c' : '#8ba17e'} opacity="0.34" transform={`rotate(${20 + Math.sin(t + index) * 35} ${x} ${y})`} />;
        }) : null}
        {has('sparkle') ? particles.slice(0, 9).map((p, index) => {
          const pulse = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.7 + index));
          return <path key={`s${index}`} d={`M ${p.x - p.size} ${p.y} H ${p.x + p.size} M ${p.x} ${p.y - p.size} V ${p.y + p.size}`} stroke="#d9a936" strokeWidth={2.5} strokeLinecap="round" opacity={0.15 + pulse * 0.45} />;
        }) : null}
        {has('paper-float') ? particles.slice(0, 6).map((p, index) => {
          const y = (p.y + Math.sin(t * 0.8 + index) * 18 + height) % height;
          const x = p.x + Math.sin(t * 0.55 + index * 0.7) * 16;
          return <rect key={`f${index}`} x={x} y={y} width={p.size * 1.4} height={p.size * 0.8} rx="2" fill="#ece5d8" stroke="#7c7266" strokeWidth="1.3" opacity="0.3" transform={`rotate(${Math.sin(t + index) * 9} ${x} ${y})`} />;
        }) : null}
        {has('ink-breathe') ? <ellipse cx={width * 0.5} cy={height * 0.58} rx={width * (0.12 + Math.sin(t * 1.2) * 0.004)} ry={height * 0.05} fill="none" stroke="#1f1f1f" strokeWidth="2" strokeDasharray="4 14" opacity="0.08" /> : null}
      </svg>
    </AbsoluteFill>
  );
};
