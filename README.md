# Comic Panels

A home-screen web app for iPad + Apple Pencil for laying out comic pages.
There's no build step: it's plain HTML, CSS and JavaScript modules.

## What it does

- **Pages**: a comic page (1988 × 3056), a webtoon scroll (800 wide; make it longer in page settings), or Instagram portrait 4:5, square or story 9:16.
- **Panels tool**
  - Drag on an empty part of the page to draw a panel. Edges snap to the margins, to one gutter away from other panels (diagonal edges too), and into line with neighbouring panels.
  - Tap a panel to select it.
  - Drag a white corner handle to slant that edge.
  - Drag an edge (or its blue dot) to move the whole side.
  - Drag inside the panel to move it.
  - Use **Layouts** for a starting grid, including slanted ones.
- **Split tool**: drag a line across one or more panels to cut them in two, with a gutter-wide gap.
- **Image tool**: add a photo to a panel (or double-tap the panel).
  - Drag to move it. Two fingers on the panel scale and rotate it. Fill, Fit and Flip are buttons.
  - The parts of the image outside the panel show faintly.
- **Pop out**: lets part of an image break out of its panel.
  - *Whole* shows the entire image over the frame (good for PNG cut-outs).
  - *Painted* shows only what you paint in pink.
  - The panel's layer (Front / Up / Down / Back, or the Layers list) decides what the pop-out covers.
- **Look** (in the Image tool): per-panel brightness and contrast, plus Grey, Halftone screentone or Ink line-art.
- **Text tool**: tap the page to add a speech balloon, thought cloud, shout burst, caption box or SFX lettering.
  - Balloons size themselves to the words.
  - The orange dot aims the tail; the square handle resizes.
  - Tilt, all-caps, colour and front/back are in the bottom bar. Double-tap a balloon to edit its words.
  - New balloons use the last size you picked for that kind. With nothing selected, *Text size* in the bar sets it.
- **Panel shapes**
  - Double-tap a selected panel's edge to add a corner; double-tap a corner to remove it.
  - Edge style: Straight, Rounded, Wavy (flashbacks and dreams) or Jagged (shock), with a size slider.
- **Saved layouts**: *Save layout* in the Panels bar keeps the current arrangement; it then appears under Layouts, stretched to fit any page.
- **Two-page spread**: a double-wide page format, with a dashed fold line. It fills a whole spread in a book.
- **Perspective** (in Draw): 1-, 2- or 3-point guides with draggable vanishing points. *Ruler* makes each line run straight along the closest guide.
  - A point that is off screen shows as a dashed dot on the screen edge, with an arrow toward it. Drag the dot to move the point, or tap it to bring the point into view.
- **Ink layer** (in Draw): final black lines that always export. Lines started inside a panel live in that panel's layer.
- **Draw tool (sketch layer)**: loose pressure-sensitive pencil lines for planning, with colours and an eraser.
  - Once you've used the Pencil, your finger pans instead of drawing.
  - With *Stick to panels* on, a line that starts inside a panel is clipped to it and moves with it. Each panel can hide its own sketch.
- **Books**: keep pages together in reading order.
  - Move pages earlier or later, and see them as two-page spreads.
  - ‹ › in the editor jumps to the previous or next page.
  - Export the whole book as one PDF.
- **Gestures**
  - Two fingers pan and zoom.
  - A two-finger tap undoes; a three-finger tap redoes.
  - On a keyboard: Cmd/Ctrl+Z undoes, and P, X, I and B switch tools.
- **Export**: PNG or JPEG at half, full or double size, with or without sketch lines. A scroll can be cut into 1280-tall slices. Use the Share sheet to save to Photos or Files.
- **Procreate** (in Export): a layered PSD of the whole page or the selected panel, at its exact pixel size.
  - Layers: Paper, Panel images, Ink, Panel borders, Balloons, Sketch, and a hidden Panel shapes layer for selecting a panel.
  - Share it to Procreate, or save it to Files and import it. *Copy borders + sketch* copies a picture you can paste instead.
- **Library (⋯ on the home screen)**: back up all pages into one JSON file, and restore it. Everything is stored on the device (IndexedDB).

## Running it locally

```powershell
python -m http.server 5173 --directory D:\art_projects\comic_app
```

Then open http://localhost:5173.

## Getting it onto the iPad

The iPad has to load it over **HTTPS** for offline use and reliable storage, so host the folder somewhere static, for example GitHub Pages or Netlify.
Then on the iPad:

1. Open the URL in Safari.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home-screen icon. It runs full-screen and works offline after the first load.

Data lives in the copy you installed on the Home Screen. Back up from the Library menu now and then.

## Files

- `js/editor.js`: the canvas editor (input, tools, rendering to SVG, undo)
- `js/render-canvas.js`: draws pages to a canvas for export and thumbnails
- `js/snap.js`, `js/geom.js`: snapping and polygon maths
- `js/layouts.js`: the starter layouts
- `js/formats.js`: page sizes
- `js/psd.js`: the layered PSD writer used for Procreate
- `sw.js`: the offline cache. Bump `CACHE` when the file list changes.
- `tools/make-icons.ps1`: regenerates the icons
