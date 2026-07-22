# Visual Quality and Acceptance

Read this file before reporting preview or final completion.

## Preview acceptance

Validate the storyboard with assets, render the preview, then inspect representative frames from the beginning, middle, scene transitions, and end.

Check:

- exact aspect ratio and expected orientation;
- no stretched, cover-cropped, clipped, or missing artwork;
- caption line count, legibility, safe margins, and correct wording;
- scene order and reasonable reading time;
- direct-cut scenes show `bw_full` from frame zero, then reveal `text`, then reveal `color`;
- page-flip mode retains the complete uploaded page;
- characters retain face, hair, age, clothing colors, and proportions;
- no unintended text, watermark, extra people, or premature narrative elements;
- white background and restrained palette remain visually consistent;
- transitions and scene openings have no black frames, blank white frames, or abrupt layout jumps.

If one frame fails, fix the underlying storyboard, asset, timing, or renderer rule and produce a new preview. Do not approve by description alone.

## Final acceptance

After preview approval or an explicit final-only request:

1. Run strict asset validation.
2. Render at the selected preset's full dimensions.
3. Confirm the MP4 exists and has nonzero size.
4. Probe width, height, duration, codec, pixel format, and audio streams.
5. Confirm H.264 video and a broadly compatible 4:2:0 pixel format (`yuv420p` or full-range `yuvj420p`); audio should be absent unless an audio feature was deliberately added.
6. Inspect at least the opening and ending frames plus one middle frame.

Report measured properties rather than intended settings. A successful render command alone is not sufficient evidence.

## Quality tradeoffs

- Preview optimizes turnaround and review, not archive quality.
- Final uses full preset resolution and a lower CRF.
- Keep render concurrency at 1 by default for predictable memory use.
- Long stories should be divided by semantic beats, not mechanically compressed until captions become unreadable.
