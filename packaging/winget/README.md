# winget

Templates for the Windows Package Manager (`winget install AppShape.AppShape`). They go to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) as a pull request, once per
release, after the installer is **signed** (winget's checks flag unsigned installers).

For a release:

1. Publish the release (the installer and `SHA256SUMS.txt` are on it).
2. Replace `VERSION`, `OWNER/REPO`, `YYYY-MM-DD` and `SHA256_FROM_SHA256SUMS_TXT` (the line for
   `AppShape-Setup-<version>.exe` in `SHA256SUMS.txt`).
3. Check: `winget validate --manifest packaging/winget`, then install it locally:
   `winget install --manifest packaging/winget`.
4. Submit: `wingetcreate submit packaging/winget` (or a pull request by hand).

Later releases: `wingetcreate update AppShape.AppShape --version <v> --urls <installer url> --submit`
does steps 2–4 (it can run in the release workflow with a token).

The installer is per-user NSIS (no admin rights), installs silently with `/S`, and updates itself
from GitHub releases; winget upgrades simply install the newer version over it.
