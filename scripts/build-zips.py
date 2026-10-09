"""Builds kw-time-logger.zip (Chrome, Edge, Brave) and kw-time-logger-firefox.zip. Run from the repo root."""
import os
import zipfile

FILES = ["background.js", "styles.css", "popup.html", "popup.css", "popup.js", "options.html", "options.js"]
DIRS = ["src", "icons", "fonts"]


def build(out, manifest):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(manifest, "manifest.json")  # the browser always wants this name
        for f in FILES:
            z.write(f)
        for d in DIRS:
            for root, _, names in os.walk(d):
                for n in names:
                    z.write(os.path.join(root, n), os.path.join(root, n).replace(os.sep, "/"))
    print(out, len(zipfile.ZipFile(out).namelist()), "files")


build("kw-time-logger.zip", "manifest.json")
build("kw-time-logger-firefox.zip", "manifest.firefox.json")
