# Project Tracking & Changelog

This document serves as a persistent record of all completed steps, architectural decisions, and features implemented during the development of the Media Downloader Pro extension.

## [Hotfix] - 2026-07-04 - Safety checks on variants
**Status: Completed**

- **Bugfix:** Added optional chaining (`?.`) throughout `src/popup/Popup.tsx` for `img.variants` to prevent potential React "Objects are not valid as a React child" rendering errors if variant extraction returns unexpected formats or `undefined`.
- **Git Commit:** Committed with message `fix: add safety optional chaining for media variants`.

## [Phase 1.5] - 2026-07-04 - UX/UI Overhaul & Quality Selection
**Status: Completed**

- **UI Refactoring:** Replaced the initial dark/glassmorphic design with a clean, professional SaaS-style interface (light theme, subtle borders).
- **Icons:** Integrated `lucide-react` for crisp vector iconography.
- **Preview Feature (Lightbox):** Added a central modal to preview images at a larger scale before downloading.
- **Quality Extraction:** Enhanced `src/content/index.ts` to parse `srcset` and `<picture>` tags, allowing the extension to detect multiple resolutions of a single image.
- **Action Buttons:** Added quick-action buttons on image hover, including a direct download button and a quality selection dropdown.
- **Batch Selection:** Added checkboxes to images and a global "Download Selected" button for batch processing.
- **Git Commit:** Committed with message `feat: implement professional UI, multiple selection, preview modal and quality settings`.

## [Phase 1.0] - 2026-07-04 - Initial Setup & MVP
**Status: Completed**

- **Project Initialization:** Bootstrapped the extension using Vite, React, and TypeScript.
- **Styling:** Configured Tailwind CSS for rapid UI development.
- **WebExtensions Configuration:** Added `@crxjs/vite-plugin` and defined the Manifest V3 (`src/manifest.json`).
- **Core Scripts:** 
  - Created `src/background/index.ts` (Service Worker).
  - Created `src/content/index.ts` (Content Script) capable of detecting `<img>` tags on the active page.
  - Created `src/popup/Popup.tsx` to display detected media.
- **Documentation:** Created an English `README.md` featuring a Mermaid architectural diagram.
- **Git Commit:** Committed with message `feat: initial project setup with vite, react, and tailwind css`.

---
*Note: All future steps and modifications will be documented here prior to Git commits.*
