# Visual Quality and Acceptance

Read this file before reporting preview or final completion.

## Preview acceptance

Validate the storyboard with assets, render the preview, require the generated machine QA report to pass, then inspect its representative frames from the beginning, middle, scene transitions, and end.

Check:

- exact aspect ratio and expected orientation;
- no stretched, cover-cropped, clipped, or missing artwork;
- caption line count, legibility, safe margins, and correct wording;
- scene order and reasonable reading time;
- direct-cut scenes show `bw_full` from frame zero, then reveal `text`; start revealing `color` on the exact frame the text reveal completes, with no completed-text hold;
- page-flip story mode exposes the next monochrome scene under the curl, ends on that drawing, then reveals text and immediately starts color when the text reveal completes, without a hold or blank transition plate;
- page-flip uploaded-page mode retains the complete page;
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
4. Require `qa/final/report.json` to have `passed: true`, inspect its transition samples, then probe width, height, duration, codec, pixel format, and audio streams.
5. Confirm H.264 video and a broadly compatible 4:2:0 pixel format (`yuv420p` or full-range `yuvj420p`); audio should be absent unless deliberately added, and must be present when an audio feature was requested.
6. Confirm the machine checks for first-frame content, first-frame monochrome artwork (generated stories), next-frame colour advancement at every caption/colour handoff, later color, expected geometry/FPS/duration, and no sampled black/white blank frames. Treat duplicate-frame hints as review warnings, not automatic failures.
7. Inspect every semantic vision job or explicitly leave it `needs_review`; never turn absent observations into a pass.
8. Inspect at least the opening and ending frames plus one middle frame, and use the local review workspace when approval is requested.

Report measured properties rather than intended settings. A successful render command alone is not sufficient evidence.

## Quality tradeoffs

- Preview optimizes turnaround and review, not archive quality.
- Final uses full preset resolution and a lower CRF.
- Keep render concurrency at 1 by default for predictable memory use.
- Long stories should be divided by semantic beats, not mechanically compressed until captions become unreadable.
