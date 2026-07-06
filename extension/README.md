# Focus OS Blocker (browser extension)

Blocks the websites your active Focus OS block lists (its "block website" actions).
When no block is active — or Focus OS isn't running — it blocks nothing.

## Install (once, ~30 seconds)

1. Open `chrome://extensions` (Chrome/Brave) or `edge://extensions` (Edge).
2. Turn on **Developer mode** (toggle, top-right).
3. Click **Load unpacked** and select this `extension` folder.

Done. No further setup — it finds the Focus OS app automatically on
`127.0.0.1:48210` and re-checks every 30 seconds.

## IMPORTANT: also enable it for Incognito

Chrome disables extensions in incognito windows by default, which would make
incognito a free escape hatch around your blocks. Close it:

1. `chrome://extensions` → **Focus OS Blocker** → **Details**
2. Toggle **"Allow in Incognito"** ON (Edge calls it "Allow in InPrivate")

## How it behaves

- While a block with "block website" actions is active, any tab on a blocked
  domain (including subdomains) is redirected to a "Not now." page — already-open
  tabs too, not just new ones.
- Reopening the site during the block just lands you back on the blocked page.
- The moment the block ends, sites work again automatically.
