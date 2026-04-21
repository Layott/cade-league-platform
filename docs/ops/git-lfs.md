# git-lfs operations runbook

Plan 20 — Large camera/video assets are tracked under git-lfs to keep the working clone fast + GitHub bandwidth sane. Current tracked globs (see `.gitattributes` at repo root):

```
*.ARW, *.arw    # Sony RAW (player photo sources)
*.CR3, *.cr3    # Canon RAW (player photo sources)
*.NEF, *.nef    # Nikon RAW (future)
*.mp4, *.MP4    # reference videos (brand-assets/videos)
*.mov, *.MOV    # reference videos
```

## First-time clone

Ensure git-lfs is installed:

```
# Windows
winget install GitHub.GitLFS
# macOS
brew install git-lfs
# Linux (Debian/Ubuntu)
sudo apt install git-lfs
```

Then:

```
git lfs install
git clone https://github.com/Layott/cade-league-platform.git
cd cade-league-platform
git lfs pull   # pulls LFS blobs if not auto-pulled
```

## Adding a new RAW or video

Just `git add` — the `.gitattributes` filter routes it automatically.

```
cp "~/Pictures/NEWPOSE 1.ARW" KNOWLEDGE/brand-assets/players/
git add KNOWLEDGE/brand-assets/players/NEWPOSE\ 1.ARW
git status         # will show "Git LFS: 1 new file(s)"
git commit -m "feat(brand): new pose for NEWPOSE"
git push           # uploads the LFS object separately from the commit
```

## Verify LFS is active for a file

```
git lfs ls-files | grep "<filename>"
# Or inspect the pointer itself
git show HEAD:path/to/file.ARW | head   # should print an LFS pointer (<~150 bytes)
```

## Storage quota

GitHub free tier: **1 GB LFS storage + 1 GB/month bandwidth** per account. Repo currently holds:

- 41 ARW/CR3 files × ~47 MB = ~1.9 GB (NOT migrated retroactively — see §History).
- 11 MP4 files × ~3-10 MB = ~60 MB.

Future LFS uploads will tick against quota. Consider:

- Add a **data pack** (paid, $5/50 GB/mo storage + 50 GB bandwidth).
- OR migrate existing binaries to an external bucket (Backblaze B2, Cloudflare R2, S3) and reference via signed URLs from `KNOWLEDGE/brand-assets/*/manifest.json`.

## History rewrite (deferred)

The current `origin/main` history already contains the 41 RAW files as regular blobs (pushed before LFS was configured). Repo weight is ~1.7 GB end-to-end.

To retroactively migrate, someone with maintainer rights runs:

```
git lfs migrate import --everything --include="*.ARW,*.arw,*.CR3,*.cr3,*.mp4,*.MP4,*.mov,*.MOV"
git push --force origin main
```

**This is destructive:** rewrites every commit SHA → everyone must re-clone, CI + Vercel deploys may need reconfiguration, in-flight feature branches need rebase.

Recommendation: defer history rewrite until someone complains about clone time. New RAW adds from now on automatically go through LFS so the problem stops growing.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git clone` succeeds but RAW files are tiny (~150 bytes, look like text) | LFS not installed when cloned | `git lfs install && git lfs pull` |
| Push fails with `GH001: Large files detected` | LFS pattern doesn't match file extension | Update `.gitattributes`, commit, re-push |
| `git lfs fetch` says `batch response: This repository is over its data quota` | Quota exhausted | Buy data pack OR migrate to external bucket |
| Windows users see literal pointer text in file | Line-ending normalization | `.gitattributes` already sets `-text` on each LFS pattern. If still broken, `git lfs checkout` |
