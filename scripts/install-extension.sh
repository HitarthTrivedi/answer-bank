#!/usr/bin/env bash
# Opens Chrome's extensions page and reveals the extension folder, so installing is a
# drag rather than a hunt through a file picker.
#
#   ./scripts/install-extension.sh
#
# Chrome deliberately offers no way to install an unpacked extension from a link, so
# this is as short as it legitimately gets.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../extension" && pwd)"

if [ ! -f "$DIR/manifest.json" ]; then
  echo "✗ No manifest.json in $DIR — is this the right checkout?" >&2
  exit 1
fi

echo "Prism extension: $DIR"
echo

case "$(uname -s)" in
  Darwin)
    open -a "Google Chrome" "chrome://extensions" 2>/dev/null \
      || echo "  (couldn't open Chrome — go to chrome://extensions yourself)"
    open -R "$DIR/manifest.json"          # reveals the folder, selected, in Finder
    printf '%s' "$DIR" | pbcopy 2>/dev/null && PASTED=" (also copied to your clipboard)" || PASTED=""
    ;;
  Linux)
    (google-chrome "chrome://extensions" >/dev/null 2>&1 &) || true
    (xdg-open "$DIR" >/dev/null 2>&1 &) || true
    printf '%s' "$DIR" | xclip -selection clipboard 2>/dev/null && PASTED=" (also copied to your clipboard)" || PASTED=""
    ;;
  *)
    PASTED=""
    ;;
esac

cat <<EOF
Now, in the Chrome tab that just opened:

  1. Turn on  Developer mode   (toggle, top right)
  2. Drag the  extension  folder from the file window onto the page
     — or click "Load unpacked" and pick it${PASTED}
  3. Reload http://localhost:5173 — the header should read "● Extension ready"

Nothing to connect afterwards: the extension reads your session from the app's own page.
EOF
