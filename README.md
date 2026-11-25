# Luma

Luma is a lightweight, cross-platform desktop photo viewer for Windows and Linux. It is designed for quickly browsing images, with a special focus on HEIC/HEIF photos from Samsung phones. Its interface keeps photography front and center while making common controls easy to reach.

## Features

- Add photos with the file picker or by dragging them into the window.
- View JPG/JPEG, PNG, and WebP images directly, and HEIC/HEIF images through the Rust backend decoder.
- Open photos in the viewer, adjust zoom, pan around enlarged images, and browse the collection.
- Check image properties such as format, file size, modification date, and dimensions.
- Read GPS coordinates from EXIF metadata. When a photo includes a location, you can load an OpenStreetMap map; map tiles are requested from the service only when you choose to load the map.
- Convert an image to JPG, PNG, or WebP and save a copy to Downloads. Conversion never modifies the original.

## Current status

Luma is under development. Photos added to the app remain in the current session; they are not yet stored in a persistent library or indexed from folders automatically. After closing or reloading the app, you will need to add them again.

HEIC/HEIF reading and preview generation happen locally. The current HEIC processing limits are 80 MB per file and 64 megapixels. Support for HEVC variants, color profiles, and metadata can vary by file and still needs testing with a broader photo collection.

## Technology stack

- **Interface:** React, TypeScript, and Vite.
- **Desktop framework:** Tauri 2.
- **Image processing:** Rust, `image`, `heif-oxide`, and `kamadak-exif`.

## Development

You need Node.js, npm, Rust, and the desktop dependencies required by Tauri for your operating system.

```sh
npm install
npx tauri dev
```

To build the frontend:

```sh
npm run build
```

See the [official Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for setup instructions for Windows and Linux.
