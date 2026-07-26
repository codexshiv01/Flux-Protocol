# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.4.x | Yes |
| 0.3.x | Best effort |
| &lt; 0.3 | No |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Email the maintainer via GitHub: [@codexshiv01](https://github.com/codexshiv01) (use a private security advisory on this repository when possible: **Security → Advisories → New draft security advisory**).

Include:

- Affected package / path (`@flux/runtime`, demo servers, etc.)
- Reproduction steps or PoC
- Impact assessment (auth bypass, DoS, data exposure, …)

We aim to acknowledge reports within a few days and ship fixes for confirmed issues in a patch release.

## Hardening references

- [Production deployment](./docs/PRODUCTION.md)
- [Security guide](./docs/SECURITY.md)
- [HTTP/3 & early-data notes](./docs/HTTP3.md)
