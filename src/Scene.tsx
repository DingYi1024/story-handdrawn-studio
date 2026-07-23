import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {HanddrawnEffects} from './HanddrawnEffects';
import {LayerWipe} from './LayerWipe';
import {sceneRevealTiming} from './scene-timing.mjs';
import {shotStateAtFrame} from './shot-motion.mjs';
import {TextWipe} from './TextWipe';
import type {SceneData, Storyboard} from './types';

export const Scene: React.FC<{
  scene: SceneData;
  project: Storyboard['project'];
  startDelayFrames?: number;
  endReserveFrames?: number;
}> = ({scene, project, startDelayFrames = 0, endReserveFrames = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = Math.max(
    1,
    Math.round(scene.duration_sec * fps) - startDelayFrames - endReserveFrames,
  );
  const has = (layer: string) => scene.layers.includes(layer as never);
  const speedMode = !has('detail');
  const timing = sceneRevealTiming(total, speedMode);
  const motion = shotStateAtFrame(scene, frame - startDelayFrames, total);
  const shotAssets = {...scene.assets, ...(motion.shot.assets || {})};
  const artworkTransform = [
    `translate(${motion.transform.xPercent}% , ${motion.transform.yPercent}%)`,
    `scale(${motion.transform.scale})`,
    `rotate(${motion.transform.rotateDeg}deg)`,
  ].join(' ');
  const staticColor = has('color') && !has('bw_full') && !has('detail');
  const fullUploadedPage =
    scene.shot === 'full_uploaded_page' && shotAssets.color;

  if (fullUploadedPage) {
    return (
      <AbsoluteFill style={{backgroundColor: '#FFFFFF', overflow: 'hidden'}}>
        <Img
          src={staticFile(fullUploadedPage)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center center',
          }}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: '#FFFFFF', overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: artworkTransform, transformOrigin: '50% 58%', willChange: 'transform'}}>
        {has('bw_full') && shotAssets.bw ? (
          <LayerWipe
            src={shotAssets.bw}
            startFrame={timing.bwVisibleFromFrame}
            durationFrames={1}
            zIndex={10}
            treatment="bw"
            layout={project.layout}
            visibleFromStart
            frameOffset={startDelayFrames}
          />
        ) : null}

        {has('detail') && shotAssets.detail ? (
          <LayerWipe
            src={shotAssets.detail}
            startFrame={timing.detailStartFrame}
            durationFrames={timing.detailDurationFrames}
            zIndex={20}
            treatment="detail"
            layout={project.layout}
            frameOffset={startDelayFrames}
          />
        ) : null}

        {has('color') && shotAssets.color ? (
          <LayerWipe
            src={shotAssets.color}
            startFrame={staticColor ? 0 : timing.colorStartFrame}
            durationFrames={staticColor ? 1 : timing.colorDurationFrames}
            zIndex={30}
            treatment="color"
            layout={project.layout}
            visibleFromStart={staticColor}
            frameOffset={startDelayFrames}
          />
        ) : null}
      </AbsoluteFill>

      <HanddrawnEffects effects={motion.shot.element_motion} frameOffset={startDelayFrames} opacity={0.9} />

      <TextWipe
        text={scene.text}
        textAsset={scene.assets.text_image}
        startFrame={timing.textStartFrame}
        durationFrames={timing.textDurationFrames}
        project={project}
        frameOffset={startDelayFrames}
      />

    </AbsoluteFill>
  );
};
