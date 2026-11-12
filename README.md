# GAANIX — 3D photography site

A single-page photography portfolio where scrolling flies a real WebGL camera
through a corridor of floating framed prints, while the chapter text moves
through the room with it.

## Run it

ES modules and textures need to be served over HTTP (opening `index.html`
directly with `file://` will not work). From this folder:

```bash
npx serve .          # or: python -m http.server 8080
```

Then open the printed URL (`http://localhost:3000` or `http://localhost:8080`).

## What's inside

- `index.html` — page structure: 3D journey, archive grid, studio, contact
- `style.css` — layout, typography, CSS 3D (print rack, tilt cards)
- `app.js` — Three.js scene, camera flight path, scroll choreography
- `images/` — 18 photographs
- `fonts/` — self-hosted Cormorant Garamond + Inter
- `vendor/` — Three.js r160, GSAP 3.12 + ScrollTrigger (all local, no CDN)

## The 3D

- A Catmull-Rom camera path (position + look-at target) is sampled by scroll
  progress through a 680vh sticky stage, so the camera banks, rises and falls
  between chapters.
- Each print is a frame + matte + textured plane; the scene is lit only for the
  procedural film camera prop, with exponential fog and drifting dust.
- Pointer position adds a small parallax offset and camera roll.
- The studio section has a draggable CSS-3D print rack; the archive cards tilt
  in 3D toward the cursor.
- Honours `prefers-reduced-motion`, pauses rendering when the canvas is off
  screen or the tab is hidden.

Photographs are from [picsum.photos](https://picsum.photos) (Unsplash) and are
placeholders — swap the files in `images/` to use your own.
