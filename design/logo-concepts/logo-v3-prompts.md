# RingCode Logo v3 prompts

## Small-size logo simplification

```text
Use case: logo-brand
Asset type: small-size production app icon, optimized for 32–128px
Input images: Image 1 is the current logoized draft and edit target.
Primary request: Make one targeted simplification pass so the symbol reads unmistakably as a solid forged Jingang Zhuo ring at 32px, not a portal.

Change only these points:
1. Make the silver-white forged ring body about 15% visually thicker and more dominant. The ring must own roughly 85% of the mark's visual weight.
2. Remove the continuous glowing blue circular line / halo around the inner circumference. The inner recess may remain dark navy, but it must not look illuminated all the way around.
3. Keep exactly three incoming azure streams from the right. Shorten and simplify them into three broad, clean tapered ribbons that visibly end just after entering the central opening; no blue continuation around or behind the ring.
4. Reduce right-side particles to exactly five large, clearly separated square/diamond fragments.
5. Remove nearly all decorative motifs. Keep only ONE bold, simplified ruyi-cloud / thunder-key cut-line motif on the lower-left/front face, large enough to read at 64px. No other small ornaments.
6. Flatten the shading further: use a maximum of four broad tonal regions on the ring, no scratches, microtexture, thin panel lines, or tiny highlights.
7. Preserve the three-quarter tilted closed-ring silhouette, generous central hole, cold silver/charcoal/blue palette, and transparent background.

Critical small-size test:
When reduced to 32px, the viewer must first see a thick silver magical ring, then three blue incoming strokes. It must not resemble a portal, vortex, turbine, target, pinwheel, wind-fire wheel, bearing, letter O, or spaceship component.

Output:
single centered symbol, square canvas, generous even padding, genuine transparent alpha including the central opening, crisp anti-aliased edges, no wordmark, no text, no mockup, no background square, no checkerboard, no watermark.
```

## Alpha extraction

```text
Use case: background-extraction
Asset type: transparent production logo
Input images: Image 1 is the exact approved logo artwork and edit target.
Primary request: Remove only the pale gray-and-white checkerboard background and convert it to genuine transparent alpha.

Invariants:
- Preserve the silver ring, dark inner recess, one lower-left cloud/thunder motif, exactly three blue tapered streams, exactly five blue particles, their colors, geometry, spacing, proportions, placement, and canvas padding exactly.
- Do not redesign, repaint, crop, move, simplify, sharpen, or add anything.
- All pixels outside the logo artwork must have alpha=0.
- The open center of the ring must also be alpha=0 except where the three blue streams cross.
- Preserve clean anti-aliased edges.

Constraints:
actual RGBA PNG transparency only; no checkerboard pattern; no white/gray/black/color canvas; no background square; no floor; no shadow; no text; no watermark.
```
