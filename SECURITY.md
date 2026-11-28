# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/citegraph-ir/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the CiteGraph-IR browser workbench, retrieval engine, audit exports, citation cascade lab, report verification and URL hash state handling.

In scope:

- A cross-site scripting or HTML injection path through corpus text, query text, report import, audit export or URL hash state.
- A parser or verifier flaw that accepts a tampered checksummed report as authentic.
- A CSV, JSON, Markdown or HTML export flaw that permits formula injection or script execution when opened.
- A URL hash decoder flaw that bypasses validation, corrupts application state or executes attacker-controlled code.
- A provenance or retraction-simulation boundary failure that causes attacker-controlled content to be rendered as trusted application chrome.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Disagreement with retrieval quality, ranking metrics or benchmark design when validation and output integrity are intact.
- Vulnerabilities in downstream applications that copy example code without their own validation.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
