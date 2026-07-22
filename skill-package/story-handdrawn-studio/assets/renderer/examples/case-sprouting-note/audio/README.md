# 案例音频来源

本目录中的背景音乐和音效均由仓库内的 `scripts/build-case-sprouting-note-audio.mjs` 通过 FFmpeg 程序化生成，没有使用第三方音乐、录音或音效素材。

运行以下命令可重新生成 `sources/` 中的全部音频：

```bash
npm run audio:case
```

`audio-options.json` 定义音乐、雨声、种子提示音、浇水声、鸟鸣和三次翻页声的时间线与混音参数。翻页声按 30 FPS 的实际转场帧边界对齐。
