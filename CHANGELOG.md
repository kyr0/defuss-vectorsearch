# Changelog

## Unreleased

### Fixed

- `modelProfile: "winzling"` no longer runs the pinned Winzling graph under another repo ID. Before, `loadModel()` with the Harrier ID or a fork kept the profile and returned Winzling embeddings while `model` reported the other ID. Repo sources other than `kyr0/Winzling-Embed-a8m-64k` now throw. HTTP(S) mirrors work as before.
- A mirror URL with a trailing slash now uses the same cache keys in `prefetchModel()`, `inspectModelCache()` and `clearModelCache()` as in inference. Such URLs re-download their files once.
- `package.json` credits Aron Homberg as author, matching `LICENSE`.

### Changed

- Development uses Bun (`bun.lock`) and `make` verbs (`setup`, `lint`, `test`, `coverage`, `e2e`, `verify`) instead of npm. Node 22.18+ still runs the package. CI runs `make setup` and `make verify`.
