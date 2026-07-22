import {Composition} from 'remotion';
import {ProjectVideo, StoryVideo} from './StoryVideo';
import {storyboard, totalFrames, totalFramesFor} from './storyboard';
import {UploadedStoryVideo} from './UploadedStoryVideo';
import {
  uploadedStoryboard,
  uploadedTotalFrames,
} from './uploadedStoryboard';

export const RemotionRoot: React.FC = () => {
  const {project} = storyboard;

  return (
    <>
      <Composition
        id="PictureSilent"
        component={StoryVideo}
        durationInFrames={totalFrames}
        fps={project.fps}
        width={project.width}
        height={project.height}
        defaultProps={{}}
      />
      <Composition
        id="ProjectVideo"
        component={ProjectVideo}
        durationInFrames={totalFrames}
        fps={project.fps}
        width={project.width}
        height={project.height}
        defaultProps={{storyboard}}
        calculateMetadata={({props}) => ({
          durationInFrames: totalFramesFor(props.storyboard),
          fps: props.storyboard.project.fps,
          width: props.storyboard.project.width,
          height: props.storyboard.project.height,
        })}
      />
      <Composition
        id="UploadedPictureSilent"
        component={UploadedStoryVideo}
        durationInFrames={uploadedTotalFrames}
        fps={uploadedStoryboard.project.fps}
        width={uploadedStoryboard.project.width}
        height={uploadedStoryboard.project.height}
        defaultProps={{}}
      />
    </>
  );
};
