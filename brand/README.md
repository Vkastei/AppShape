# AppShape brand

The logo and the icon. `source/` holds the original artwork (2000 × 2000 px); everything else is
made from it.

| File | Use |
|---|---|
| `appshape-logo.png` | The logo, transparent, trimmed (black lettering, for light backgrounds) |
| `appshape-logo-white.png` | The logo with white lettering, for dark backgrounds |
| `appshape-logo-160.png`, `appshape-logo-white-160.png` | The same, 160 px high (the board and the start page) |
| `appshape-icon-<size>.png` | The icon, square, 16 to 1024 px (favicons, app icons) |
| `appshape-icon.ico` | The icon for Windows (16 to 256 px) |

Brand color: purple **#8E44D6** (the board's `accent-500`), with ink `#1F1B2E` and white.

Used by: the board and the start page (`packages/editor`: favicon in `index.html`, `Logo.tsx`), the
desktop app (`packages/desktop/build/icon.png` and `icon.ico`, copied by
`node packages/desktop/scripts/icon.mjs`), and the README.
