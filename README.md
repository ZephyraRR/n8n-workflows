# n8n-workflows

Four importable **n8n** workflows for support and operations teams, each with its logic in a plain JavaScript file, unit tests for that logic, a request/response test payload, and an end-to-end test that runs the real workflow in a real n8n container.

| Workflow | Webhook | What it does |
|---|---|---|
| Ticket triage and routing | `POST /webhook/triage` | Classifies a ticket (security, outage, billing, account, bug, abuse, feature), sets priority from the category and customer tier, picks the queue and the SLA in minutes. |
| SLA alert to Slack | `POST /webhook/sla-check` | Takes open tickets, finds first-response and resolution breaches and "at risk" tickets (80% of the limit), posts one Slack message when there is something to say. |
| Invoice field extraction | `POST /webhook/invoice` | Pulls invoice number, dates, currency, total and tax id out of invoice text (US, European and Serbian number and date formats), lists what is missing, scores confidence. |
| Lead qualification | `POST /webhook/lead` | Validates an e-mail address, detects free-mail, disposable and role addresses, guesses the company, scores 0 to 100, routes to sales, nurture or reject. |

## Why the code lives in `src/`

Logic inside n8n Code nodes is hard to test and review. Here every Code node is generated from a file in `src/` by `build.py`, so the code that is unit-tested is byte for byte the code inside the exported workflow (a test fails if `workflows/` is out of date). Workflows end in a **Respond to Webhook** node and answer HTTP 422 with `{"error": "..."}` for bad input instead of failing silently.

## Use

1. In n8n: Workflows, Import from file, pick a file from `workflows/`.
2. Publish it. The production webhook URL is `https://<your n8n>/webhook/<path>` (the table above).
3. Try it with the payloads that the tests use:

```bash
curl -s -X POST http://localhost:5678/webhook/triage -H 'Content-Type: application/json' \
  -d '{"id": 101, "subject": "Account hacked", "body": "Someone made an unauthorized login", "customer_tier": "enterprise"}'
# {"id":101,"category":"security","priority":"urgent","queue":"security","sla_minutes":15,...}
```

**SLA alert and Slack:** the Slack incoming-webhook URL is passed in the request (`slack_webhook_url`) so the repository contains no secret and the test can point it at a mock. In production, call it from a scheduler that holds the URL, or replace the HTTP Request node with n8n's Slack node and a credential. The URL must be `http` or `https`; the Slack call failing does not fail the workflow (the response says `slack.ok: false`).

**Tune the rules:** edit the file in `src/`, run `python build.py`, re-import. The triage keyword table, SLA minutes, free-mail and disposable domain lists are plain constants at the top of each file.

## Tests

```bash
npm run test:unit          # 43 Node tests of the Code-node logic, no dependencies, under a second
npm run test:static        # 7 checks on the exported JSON (up to date, connections, unique ids, no secrets, POST only)
npm run test:integration   # 18 end-to-end tests, needs Docker; pulls n8nio/n8n (about 2 GB) on first run
```

The integration test imports the exports into a throwaway n8n container (`n8n import:workflow`, `n8n publish:workflow`, restart), posts every case in `tests/payloads/`, compares the HTTP status and the response, and uses a local mock server to check what is sent to Slack, including the Slack-is-down case. It was run against **n8n 2.46.6**. I also broke the SLA boundary and the invoice sub-total rule on purpose and confirmed the unit tests fail.

## Limits (honest)

- Rule-based on purpose: it is deterministic, free, and explainable, but it is keyword matching, not understanding. A ticket written in another language falls to `other`. For free-text invoices from scans use an OCR or LLM step in front and keep this node as the validator.
- The invoice parser reads one invoice per request and picks the last line labelled as a total; invoices with several totals (for example per-page totals) need review. Slash dates such as 03/04/2025 are read as day first and flagged as ambiguous.
- Lead scoring is a heuristic, not a data-enrichment service: it does not look the company up anywhere.
- Credentials, schedules and error workflows are not included, because they are specific to your instance.
- Tested on n8n 2.x. Node versions are pinned in the exports; older n8n releases may not know them.

## License

MIT
