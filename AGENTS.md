# Luma — Project Instructions

## Project Overview

Luma is a modern, minimalist, cross-platform photo viewer for Windows 11 and Linux.

Its primary objective is to provide a fast and lightweight photo viewing experience, with particular emphasis on HEIC/HEIF compatibility for photographs captured using Samsung smartphones.

The visual direction is inspired by Google Photos, combining modern aesthetics with a clean and minimalist interface.

## Technology Stack

- **Backend:** Rust
- **Desktop Framework:** Tauri 2
- **Frontend:** React
- **Frontend Language:** TypeScript
- **Styling:** Tailwind CSS
- **Icons:** Lucide
- **Database:** SQLite, when required

## Supported Platforms

- Windows 11
- Linux (Fedora is the initial Linux development target)

Keep the architecture portable. Avoid unnecessary operating-system-specific dependencies.

## Architecture

Keep frontend and backend responsibilities separated.

Rust modules should be organized by responsibility:

- `commands/`: Tauri commands exposed to the frontend.
- `image/`: Image decoding, processing and thumbnail generation.
- `filesystem/`: Local file and directory operations.
- `database/`: Local persistence and indexing.

React should contain:

- Components
- Pages
- Hooks
- Services
- Styles

Follow the existing project structure whenever possible.

## Image Engine

Image compatibility is a core requirement.

Planned formats:

- JPEG / JPG
- PNG
- WebP
- HEIC / HEIF

HEIC/HEIF support must be investigated carefully.

Test:
- HEVC 8-bit and 10-bit images.
- EXIF orientation.
- ICC color profiles.
- High-resolution photographs.
- Samsung smartphone photographs.

Evaluate Rust-native decoders and mature alternatives such as libheif.

Never modify original photographs during normal viewing.

## Design Guidelines

- Modern and minimalist interface.
- Photography must be the primary visual element.
- Minimal visible controls.
- Discreet sidebar.
- Large, organized thumbnails.
- Dark and light themes.
- Smooth, subtle animations.
- Consistent spacing and typography.

Avoid unnecessary visual complexity.

## Development Guidelines

1. Inspect existing files before making changes.
2. Never recreate or overwrite the project unnecessarily.
3. Prefer small, incremental changes.
4. Explain important architectural decisions.
5. Avoid unnecessary dependencies.
6. Test changes after implementation.
7. Preserve Windows and Linux compatibility.
8. Keep code maintainable and modular.
9. Do not implement unrequested features.
10. Never claim a feature works without testing it.

## Current Development Stage

Project initialization.

The project was generated using Tauri 2 with React and TypeScript.

Development environment:
- Windows 11
- Visual Studio Code
- Rust and Cargo
- Node.js and npm

Project location:

`G:\Codes\luma`

## Immediate Priorities

1. Verify that the initial Tauri application runs.
2. Establish the main Luma interface.
3. Implement the minimalist gallery layout.
4. Build the image engine.
5. Investigate and implement HEIC/HEIF support.
6. Test on Windows and Fedora Linux.