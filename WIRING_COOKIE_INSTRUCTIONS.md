# Get cookies for connector wiring downloads

The captures you've shared (jquery, sso.fordservicecontent.com, TableofContent on fordservicecontent.com) are **not sufficient** for Connector Views PDFs.

You need cookies from **`fordtechservice.dealerconnection.com`** (the PTS portal itself).

## Steps (Chrome / Brave)

1. Log into PTS: https://www.fordtechservice.dealerconnection.com
2. Select your 2016 Transit (VIN) and click **GO**
3. Open **DevTools** → **Network** tab
4. Click **Clear** (trash icon) to empty the list
5. Click the **Wiring** tab in PTS (top navigation)
6. In the Network filter box, type: `TableOfContents`
7. Click the request whose URL is exactly:
   ```
   https://www.fordtechservice.dealerconnection.com/wiring/TableOfContents
   ```
   **Important:** `dealerconnection.com` (not fordservicecontent.com), and **Contents** plural.

8. In the right panel → **Headers** → scroll to **Request Headers**
9. Find the line starting with `cookie:` (lowercase in Chrome)
10. **Triple-click** the cookie value (everything after `cookie: `) and Copy
11. Paste the **entire** copied string into:
    ```
    templates/cookieString.txt
    ```
    Replace the whole file. Do **not** include the word `Cookie:`.

## Alternative if cookie line is hard to copy

1. DevTools → **Application** tab
2. Left sidebar → **Cookies** → `https://www.fordtechservice.dealerconnection.com`
3. Select all cookie rows, or copy these if present:
   - `ASP.NET_SessionId`
   - `Ford.TSO.PTSSuite`
   - `PERSISTENT`
   - `PREFERENCES`
   - `TPS%2DMEMBERSHIP` or `TPS-MEMBERSHIP`
   - `TPS%2DPERM`
   - `AKA_A2`
4. Format as: `name1=value1; name2=value2; ...` on one line
5. **Also append** your CONTENT_AUTH and CONTENT_PERMISSIONS from fordservicecontent (separated by `; `)

## What success looks like

The cookie string should be **much longer** than what you have now (~500+ characters) and should include `ASP.NET_SessionId=...`.
