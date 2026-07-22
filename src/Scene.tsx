import {
  AbsoluteFill,
  Img,
  staticFile,
  useVideoConfig,
} from 'remotion';
import {LayerWipe} from './LayerWipe';
import {sceneRevealTiming} from './scene-timing.mjs';
import {TextWipe} from './TextWipe';
import type {SceneData, Storyboard} from './types';

export const Scene: React.FC<{
  scene: SceneData;
  project: Storyboard['project'];
}> = ({scene, project}) => {
  const {fps} = useVideoConfig();
  const total = Math.round(scene.duration_sec * fps);
  const has = (layer: string) => scene.layers.includes(layer as never);
  const speedMode = !has('detail');
  const timing = sceneRevealTiming(total, speedMode);
  const staticColor = has('color') && !has('bw_full') && !has('detail');
  const fullUploadedPage =
    scene.shot === 'full_uploaded_page' && scene.assets.color;

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
      {has('bw_full') && scene.assets.bw ? (
        <LayerWipe
          src={scene.assets.bw}
          startFrame={timing.bwVisibleFromFrame}
          durationFrames={1}
          zIndex={10}
          treatment="bw"
          layout={project.layout}
          visibleFromStart
        />
      ) : null}

      {has('detail') && scene.assets.detail ? (
        <LayerWipe
          src={scene.assets.detail}
          startFrame={timing.detailStartFrame}
          durationFrames={timing.detailDurationFrames}
          zIndex={20}
          treatment="detail"
          layout={project.layout}
        />
      ) : null}

      {has('color') && scene.assets.color ? (
        <LayerWipe
          src={scene.assets.color}
          startFrame={staticColor ? 0 : timing.colorStartFrame}
          durationFrames={staticColor ? 1 : timing.colorDurationFrames}
          zIndex={30}
          treatment="color"
          layout={project.layout}
          visibleFromStart={staticColor}
        />
      ) : null}

      <TextWipe
        text={scene.text}
        textAsset={scene.assets.text_image}
        startFrame={timing.textStartFrame}
        durationFrames={timing.textDurationFrames}
        project={project}
      />

    </AbsoluteFill>
  );
};
