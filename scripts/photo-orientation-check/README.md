# Photo orientation browser check

This harness runs the real `src/lib/image.ts` `prepareUpload` path against three
small JPEG fixtures carrying EXIF orientation 1, 6, and 8. Each fixture stores
the same upright four-corner marker after its EXIF transform; the page decodes
the prepared JPEG and checks the marker colors and `120x80` output dimensions.

From WSL, run the automated check with Windows Chrome:

```sh
npm run check:orientation
```

`LEARNING_CREW_CHROME` may point at another Windows Chrome executable. The
runner starts an ephemeral Vite server, opens the harness in headless Chrome,
prints its JSON verdict, and removes the temporary browser profile.

To inspect the page manually in another browser, run:

```sh
npm run dev -- --host 0.0.0.0
```

Then open `http://localhost:5173/scripts/photo-orientation-check/` on the same
machine. From a different machine, replace `localhost` with the development
machine's reachable host name or IP. The page is a standalone development
entry and is not referenced by the production application bundle.

The checked-in fixtures can be regenerated with Windows Chrome:

```sh
node scripts/photo-orientation-check/generate-fixtures.mjs
```
