# Listener patch

We patch `@sightread/lilypond-eventdocument` to support multiple scores and capture
more details for MusicXML. Our [`.ily` files](../src/lilypond/listener/) add code
that collects things like slurs, titles, and note positions. During builds,
`patch-package` applies the patch, and the [build script](../tools/build-listener.ts)
bundles everything into `listener.ts` for the app.

To change the upstream listener, edit its `event-document.ily` in `node_modules`, then run:

```sh
npx patch-package @sightread/lilypond-eventdocument
npm run build:listener
npm run test:fast
```
