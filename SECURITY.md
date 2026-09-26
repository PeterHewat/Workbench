# Security Policy

These are static, client-side tools. There is no server and no account: everything a tool stores
stays in your own browser, and nothing you draw or import is sent anywhere. The public site may
send anonymous page-view analytics to Cloudflare.

## Reporting

Report a vulnerability privately through
[GitHub Security Advisories](https://github.com/PeterHewat/Workbench/security/advisories/new).
Please do not open a public issue for an undisclosed vulnerability.

## Scope

In scope: anything that could run attacker-controlled code in a visitor's browser, or read data
out of it — for example a file an app imports (SVG, JSON) being parsed unsafely.

Out of scope: the absence of a backend, rate limiting or authentication. There is none by design.
