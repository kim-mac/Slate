# Slate Brand Assets — V1

Visual source of truth: approved solid Angular Fold S inside a black rounded square.

## Included

- `slate-icon-master-1024.png` — cleaned high-resolution raster master derived from the approved generated artwork.
- Chromium and Windows assets are derived from this corrected master while preserving the approved geometry.
- The Windows ICO uses genuine 16, 20, 24, 32, 48, 64, and 256 px raster frames. Its first entry remains the approved 32 px Chromium artwork for Tauri's default icon, while the main window and tray explicitly use dedicated runtime PNGs.
- The 16, 32, and 48 px frames are the approved Chromium rasters. The Windows-only 24 px frame and the 64 and 256 px frames are purpose-sized directly from the master rather than upscaled from another small icon.
- `apps/desktop/src-tauri/icons/runtime-window.png` is byte-for-byte the approved Chromium 32 px icon; `runtime-tray.png` is byte-for-byte the approved Chromium 16 px icon. The multi-frame ICO remains the executable and shell icon.

## Brand rules

- Solid white Angular Fold S.
- Black rounded-square background.
- The S and rounded-square interiors use fully opaque `#FFFFFF` and `#000000`, respectively; only antialiased edges may contain intermediate values.
- No gradient, shadow, texture, blue accent, bookmark, or redesign.
- Preserve proportions and geometry.
- Internal application and extension identities must not change when replacing visual assets.

## Production note

This package is raster-derived from the approved visual. It is not a canonical SVG, and no SVG replacement should be fabricated from this raster. A future vector source may become canonical only after the exact approved geometry is recreated and visually reviewed.
