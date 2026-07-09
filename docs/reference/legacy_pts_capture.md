# Legacy PTS capture — exploration notes (pre-2003)

**Status:** **TEMPLATE — operator must complete before Dev Guide 06 implementation**  
**Purpose:** Document real PTS UI steps for `modelYear < 2003`; AI must not guess selectors from this file until filled.  
**Dev guide:** [../dev_guides/2026-07-08_dev_guide_06_legacy_capture.md](../dev_guides/2026-07-08_dev_guide_06_legacy_capture.md)  
**Upstream manual reference:** [../../README.md](../../README.md) § "2002 or older"

---

## Gate

- [ ] PTS Chrome running (`./scripts/launch-pts-chrome.sh`), logged in
- [ ] Bulk/capture **stopped** or legacy vehicle tested in isolation (avoid CDP contention)
- [ ] Test vehicle selected: _________________ (recommend `2002-excursion`)

---

## Vehicle under test

| Field | Value |
|-------|-------|
| Queue id | |
| modelYear | |
| ptsModel | |
| Expected manual name(s) in Workshop tab | |

---

## Navigation steps (fill during live session)

Document **exact** clicks, tab names, and wait conditions. Add screenshots to `docs/reference/img/` if helpful.

### 1. Entry point

- [ ] Start URL after login: _________________
- [ ] Differs from 2003+ Vehicle ID iframe? Yes / No — notes:

### 2. Workshop tab

- [ ] How to open Workshop: _________________
- [ ] Manual list appearance (selectors / visible text): _________________
- [ ] Which manual selected for test: _________________

### 3. Alphabetical Index URL

- [ ] How to reach Alphabetical Index (sidebar? link text?): _________________
- [ ] **Real URL** copied (OK to paste URL shape; redact session tokens if any): _________________
- [ ] URL host/path pattern for validation regex: _________________

### 4. Wiring intercept (same as modern?)

- [ ] Wiring tab click: _________________
- [ ] Intercept URL seen (TableofContent): _________________
- [ ] `environment`, `bookType`, `languageCode` captured: _________________
- [ ] `TableOfContents` request for `WiringBookCode` / `WiringBookTitle`: _________________

### 5. Timing / pitfalls

- [ ] Modals or popups to dismiss: _________________
- [ ] Typical `page.goto` / iframe wait (ms): _________________
- [ ] Failures observed: _________________

---

## Example captured `params.json` (paste after manual success)

```json
{
  "workshop": { },
  "wiring": { },
  "pre_2003": {
    "alphabeticalIndexURL": ""
  }
}
```

---

## Validation rules (for Dev Guide 06 implementation)

After exploration, confirm:

- [ ] URL must **not** equal placeholder `https://www.fordservicecontent.com/pubs/content/.....`
- [ ] URL must be `https://` and host contains `fordservicecontent.com` (or document exception)
- [ ] `yarn start` on this params file downloads alphabetical index PDFs (operator verified)

---

## Sign-off

| | |
|--|--|
| Explored by | |
| Date | |
| Ready for Guide 06 code | Yes / No |
