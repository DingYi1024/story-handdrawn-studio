# 案例：会发芽的纸条

这是 Story Handdrawn Studio 的完整 9:16 有声案例，演示同一角色在四幕八镜中的身份一致性、`黑白图 → 文字写完立即彩色显影` 的无停顿幕内顺序、推拉/平移/视差和局部手绘微动画，以及幕间卷页转场和同步音效。

下面是完整 27.5 秒成片的低分辨率动态预览。GIF 格式本身没有声音；点击图片可打开带 AAC 立体声的 1080×1920 正式 MP4。

[![完整动态预览](animated-preview.gif)](final.mp4)

[直接打开正式 MP4](final.mp4)

## 转场特写

下面依次截取三次卷页。旧幕彩色图卷起时，下一幕黑白图直接从纸页下露出；卷页结束后才开始写字，最后一个字写完即开始彩色显影，中间没有停顿或白屏过渡。

[![三次卷页转场特写](transition-preview.gif)](final.mp4)

## 故事

一位在陌生城市独居的女孩，于雨夜捡到三颗向日葵种子。九十天的照料，让她第一次感到这座城市也在等她回家。

## 交付内容

- `story.txt`：故事原文
- `storyboard.json`：可验证的四幕故事板
- `render-props.json`：Remotion 案例渲染参数
- `audio-options.json`：音乐、环境音、音效与帧级时间线配置
- `audio/sources/`：程序化生成的原创 AAC 音源
- `../../scripts/build-case-sprouting-note-audio.mjs`：音源复现脚本
- `../../public/examples/case-sprouting-note/00_character_reference.png`：固定角色设定
- `../../public/examples/case-sprouting-note/*_color.png`：ImageGen 彩色场景母图
- `../../public/examples/case-sprouting-note/*_bw.png`：FFmpeg 本地派生黑白层
- `preview.mp4`：720×1280 H.264 + AAC 有声审片版
- `final.mp4`：1080×1920 H.264 + AAC 有声正式片
- `cover.png`：从正式片末幕提取的案例封面
- `animated-preview.gif`：README 内可直接观看的完整动态预览
- `transition-preview.gif`：三次卷页转场的短预览
- `qa-report.json`：机器验收报告（包含音频流、四次文字/彩色逐帧交接、三次卷页和四个内部镜头切点检查）
- `qa-frames/`：验收抽帧，包含每次文字/彩色交接、卷页和多镜头切点的前后画面
- `semantic-observations.json`：逐场人工视觉观察
- `semantic-report.json`：32/32 语义检查通过的机器报告
- `review.html`：可直接打开、逐场批准或返修的本地审片台

## 本地复现

```bash
npm ci
npm run audio:case
npm run props:case
node scripts/validate-storyboard.mjs examples/case-sprouting-note/storyboard.json
npx remotion render src/index.ts ProjectVideo examples/case-sprouting-note/_preview-silent.mp4 \
  --props=examples/case-sprouting-note/render-props.json \
  --public-dir=public --codec=h264 --pixel-format=yuv420p --crf=23 --scale=0.6666666667 --muted --concurrency=1
node scripts/audio-project.mjs \
  --storyboard examples/case-sprouting-note/storyboard.json \
  --config examples/case-sprouting-note/audio-options.json --enable \
  --video examples/case-sprouting-note/_preview-silent.mp4 \
  --output examples/case-sprouting-note/preview.mp4
npx remotion render src/index.ts ProjectVideo examples/case-sprouting-note/_final-silent.mp4 \
  --props=examples/case-sprouting-note/render-props.json \
  --public-dir=public --codec=h264 --pixel-format=yuv420p --crf=18 --muted --concurrency=1
node scripts/audio-project.mjs \
  --storyboard examples/case-sprouting-note/storyboard.json \
  --config examples/case-sprouting-note/audio-options.json --enable \
  --video examples/case-sprouting-note/_final-silent.mp4 \
  --output examples/case-sprouting-note/final.mp4
npm run evidence:case
```

案例没有使用外部录音或第三方音乐；全部音乐和音效由仓库脚本通过 FFmpeg 程序化生成。当前版本未加旁白，重点展示无语音 API 也能交付的有声氛围片。
