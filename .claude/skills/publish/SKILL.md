---
name: publish
description: Publish an asset (file or directory) to Filecoin Onchain Cloud via filecoin-pin and return a shareable inbrowser.link/ipfs URL. Use when asked to publish, upload, pin, or share an asset from this repo.
allowed-tools: Bash, Read, Glob
---

# Publish an asset

Store an asset on Filecoin Onchain Cloud with `filecoin-pin` and hand back a
`https://inbrowser.link/ipfs/<cid>` link. The asset must be self-contained: a
single file, or a directory whose pages reference only relative paths (no CDN
or absolute URLs), so it renders from the gateway as-is.

## Environment — every command, no exceptions

Every `filecoin-pin` command in this skill runs with the repo's committed
runtime config and the local secrets loaded, in this exact form:

```bash
set -a; . <repo-root>/config.env; . <repo-root>/.env; set +a
```

`config.env` is committed and authoritative; treat its values as opaque and
never override them with flags or ad-hoc environment variables. `.env` holds
`PRIVATE_KEY` (gitignored, see `.env.example`). Never print either variable.

## Steps

1. **Load the environment** as above. If `.env` is missing, stop and ask the
   user to create it from `.env.example`.

2. **Preflight the wallet** so a partial upload never happens:

   ```bash
   npx --yes filecoin-pin@latest payments status
   ```

   This prints the wallet address and balances without exposing the key.
   If balances are insufficient or payment approvals are missing, stop and
   report exactly what `payments status` said; first-time setup is
   `npx --yes filecoin-pin@latest payments setup` (run it only with the
   user's go-ahead, since it spends funds).

3. **Publish**:

   ```bash
   npx --yes filecoin-pin@latest add <path>
   ```

   For a directory, pass the directory path; `filecoin-pin` packs it into a
   UnixFS CAR so relative links keep working.

4. **Verify and report.** Take the root CID from the `add` output, then
   confirm the content is reachable before sharing:

   ```bash
   curl -sfI "https://inbrowser.link/ipfs/<cid>" | head -1
   ```

   Done means: the URL returns a success status and you have reported the
   CID, the URL, and the data set id from the `add` output. If retrieval
   fails, report the failure with the CID rather than sharing a dead link.
