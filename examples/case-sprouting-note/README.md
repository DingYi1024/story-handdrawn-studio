# 案例：会发芽的纸条

这是 Story Handdrawn Studio 的完整 9:16 案例，演示同一角色在四幕故事中的身份一致性，以及字体字幕、黑白线稿和彩色插画的分层揭示。

下面是完整 27.7 秒成片的低分辨率动态预览；点击图片可打开 1080×1920 正式 MP4。

[![完整动态预览](animated-preview.gif)](final.mp4)

[直接打开正式 MP4](final.mp4)

## 故事

一位在陌生城市独居的女孩，于雨夜捡到三颗向日葵种子。九十天的照料，让她第一次感到这座城市也在等她回家。

## 交付内容

- `story.txt`：故事原文
- `storyboard.json`：可验证的四幕故事板
- `render-props.json`：Remotion 案例渲染参数
- `../../public/examples/case-sprouting-note/00_character_reference.png`：固定角色设定
- `../../public/examples/case-sprouting-note/*_color.png`：ImageGen 彩色场景母图
- `../../public/examples/case-sprouting-note/*_bw.png`：FFmpeg 本地派生黑白层
- `preview.mp4`：720×1280 审片版
- `final.mp4`：1080×1920 H.264 正式片
- `cover.png`：从正式片末幕提取的案例封面
- `animated-preview.gif`：README 内可直接观看的完整动态预览
- `qa-report.json`：机器验收报告（8 项通过、1 项审片提示、0 项失败）
- `qa-frames/`：首帧、彩色揭示点与全片时间线抽帧

## 本地复现

```bash
npm ci
node scripts/validate-storyboard.mjs examples/case-sprouting-note/storyboard.json
node scripts/qa-video.mjs examples/case-sprouting-note/final.mp4 \
  --width 1080 --height 1920 --fps 30 --duration 27.7 \
  --color-after 5.76 --samples 11
npx remotion render src/index.ts ProjectVideo examples/case-sprouting-note/preview.mp4 \
  --props=examples/case-sprouting-note/render-props.json \
  --public-dir=public --codec=h264 --pixel-format=yuv420p --crf=23 --scale=0.6666666667 --muted --concurrency=1
npx remotion render src/index.ts ProjectVideo examples/case-sprouting-note/final.mp4 \
  --props=examples/case-sprouting-note/render-props.json \
  --public-dir=public --codec=h264 --pixel-format=yuv420p --crf=18 --muted --concurrency=1
```

正式片默认是静音画面轨；v0.5 可通过 `studio.mjs audio` 加入 OpenAI 旁白或自备旁白、音乐和音效。
