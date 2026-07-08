# 2016 Ford Transit Manual Download

## Status
**Complete** — workshop + wiring + connectors. See `BULK_DOWNLOAD_GUIDE.md` for multi-vehicle downloads.

## Output location
`/Users/tom/Documents/Git/fetch-ford-service-manuals/manuals/2016-transit/`

## Config files
- `templates/params.json` — vehicle parameters from DevTools
- `templates/cookieString.txt` — auth cookies (keep private, do not commit)

## Re-run command
```bash
cd /Users/tom/Documents/Git/fetch-ford-service-manuals
yarn start \
  -c templates/params.json \
  -s templates/cookieString.txt \
  -o manuals/2016-transit \
  --noCookieTest \
  --saveHTML \
  --ignoreSaveErrors
```

## Notes
- Patched `src/index.ts` to use `category: 32` / `CategoryDescription: ODYXML` from params (Transit-specific; repo had hardcoded 33/GSIXML).
- Switched `.yarnrc.yml` to `nodeLinker: node-modules` for Playwright compatibility on macOS.
- Cookie warnings for dealerconnection session cookies are expected; CONTENT_AUTH cookies were sufficient for workshop download.

## If download fails mid-run
1. Re-collect cookies from DevTools while logged into PTS (Wiring tab → `TableOfContents` request on fordtechservice.dealerconnection.com).
2. Paste full Cookie header into `templates/cookieString.txt` (no `Cookie:` prefix).
3. Re-run with same command.
