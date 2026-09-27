# Vendored bull-board UI (`@bull-board/ui@5.23.0/dist`)

## Why is a dependency vendored here?

`@bull-board/api` locates its UI at runtime via
`eval('require.resolve(...)')` + express `res.render('index.ejs')` from that
directory. Vercel's serverless file tracer cannot follow either pattern, so a
deployed function ends up with `@bull-board/ui/package.json` but WITHOUT
`dist/` — live `/admin/queues` then 500s with
`Failed to lookup view "index.ejs"`.

`app.ts` passes `uiBasePath` pointing here (resolved relative to
`import.meta.url`, a pattern the tracer DOES follow), so the EJS shell +
static SPA ship inside the function bundle on every host. Docker/local behave
identically — one code path, no env branching.

If anything under `/queues` (the native dashboard) ever fully replaces
bull-board, delete this directory and the `uiBasePath` option.

## Regenerating (after a `@bull-board/*` upgrade — versions MUST match)

```bash
npm run vendor:bullboard            # run from apps/api (copies from root node_modules)
git add apps/api/vendor/bull-board-ui
```
