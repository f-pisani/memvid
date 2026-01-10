# npm Release Process

Release a new version of `@fpisani/memvid` to npm.

## Prerequisites

- All changes merged to `main`
- Tests passing locally (`cd native && npm test`)
- Clean working directory

## Steps

### 1. Checkout and pull main

```bash
git checkout main && git pull
```

### 2. Create release branch

```bash
git checkout -b release/vX.Y.Z
```

### 3. Bump version in native/package.json

```bash
cd native && npm version X.Y.Z --no-git-tag-version && cd ..
```

### 4. Commit version bump

```bash
git add native/package.json
git commit -m "chore: bump native package version to X.Y.Z"
```

### 5. Push and create draft PR

```bash
git push -u origin release/vX.Y.Z
gh pr create --draft --title "chore: release vX.Y.Z" --body "Bump version for npm release"
```

### 6. Mark PR ready and merge

```bash
gh pr ready
gh pr merge --merge
```

### 7. Pull merged changes

```bash
git checkout main && git pull
```

### 8. Create and push tag

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 9. Create GitHub release

This triggers the `npm-publish.yml` workflow which builds and publishes to npm:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

## What happens automatically

Once the GitHub release is published:
1. `npm-publish.yml` workflow triggers
2. Builds native binaries for all platforms (linux x64, macos x64, macos arm64, windows x64)
3. Publishes platform-specific packages to npm
4. Publishes main `@fpisani/memvid` package to npm

## Troubleshooting

### "You cannot publish over previously published versions"

The tag/release was created before package.json version was bumped. Fix:

```bash
# Delete old tag
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# Ensure package.json has correct version on main, then recreate
git checkout main && git pull
git tag vX.Y.Z
git push origin vX.Y.Z

# Republish release if it became draft
gh release edit vX.Y.Z --draft=false
```

### Release became a draft after deleting tag

```bash
gh release edit vX.Y.Z --draft=false
```

### Workflow not triggering

The `npm-publish.yml` triggers on `release: [published]`. Ensure the release is published (not draft).

You can also manually trigger via workflow_dispatch:
```bash
gh workflow run npm-publish.yml
```
