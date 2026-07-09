/**
 * Detect auth-related failures in vehicle download logs.
 */
const fs = require("fs");

const AUTH_RE =
  /HTTP 403|Access Denied|403 Forbidden|Ford CDN returned Access Denied|subscriptionExpired|PTS auth redirect|Connector capture stopped after|Connector access: FAILED|Connector probe failed|Connector access check failed/;

const TS_COMPILE_RE = /TSError|Unable to compile TypeScript/;

function authFailureIsRecentInText(logText) {
  return AUTH_RE.test(logText) && !TS_COMPILE_RE.test(logText);
}

function authFailureIsRecent(logPath) {
  try {
    const text = fs.readFileSync(logPath, "utf8");
    return authFailureIsRecentInText(text);
  } catch {
    return false;
  }
}

module.exports = {
  authFailureIsRecent,
  authFailureIsRecentInText,
};
