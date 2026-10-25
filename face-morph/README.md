# Face Morph

Live face-landmark detection from your camera or a photo, and a smooth morph between any two faces, all running on
your own device.

**Live:** https://kathuman.github.io/claude-projects/face-morph/

## What it does

- **Live detection.** Start the camera and the app finds your face and its 68 landmarks (jaw, eyebrows, eyes, nose
  and mouth) about six times a second. The landmarks can be shown on the video.
- **Captures.** Capture a face from the camera or upload a photo (a clear, front-facing, evenly lit face works best;
  one face per photo).
- **Morph.** Pick any two captures as A and B, then drag the blend slider or press Play to morph between them. Show
  the triangle mesh, or download the current frame as an image.

## Privacy

Everything runs in the browser. No video frame, photo or landmark is ever uploaded. The two model files load once
from this folder, and captures live only in the tab's memory: reloading the page clears them. Nothing is saved
unless you click Download Frame.

## How it works

- **Detection.** Two small neural networks run in the browser through TensorFlow.js
  ([face-api.js](https://github.com/justadudewhohacks/face-api.js) by Vincent Mühler, MIT licence). A TinyFaceDetector finds the face, then a
  68-point landmark network places the points inside it. Together the weights are under 600 KB.
- **Capture.** A capture is a 480×480 image with its 68 landmarks, plus 8 points around the frame's edge, so the
  whole image warps, not just the face.
- **Morph.** The 76 points always mean the same thing in the same order, so the app uses one fixed triangulation of
  142 triangles. It was computed once offline on a template face and checked to tile the frame exactly: the triangle
  areas add up to the frame's area, with no gaps or overlaps. At blend t, every triangle's shape is the mix of its
  shapes in A and B. Both images are warped into those shapes, triangle by triangle, with an affine transform on a
  canvas, then cross-dissolved.

## Files

```
index.html                    the app: camera, upload, captures, detection, morph
vendor/face-api.min.js        face-api.js (MIT)
vendor/weights/               the TinyFaceDetector and 68-point landmark model weights
vendor/LICENSE-face-api       face-api.js licence
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
