"""Generates workflows/*.json (importable n8n exports) from src/*.js, so the code that is unit-tested is exactly the code inside the workflow.

python build.py            # rewrite workflows/
python build.py --check    # exit 1 when workflows/ is out of date (used by the tests)
"""
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NS = uuid.UUID("6f9c1d3e-0b1a-4c52-9a53-7a1e2b7f0001")


def uid(*parts):
    return str(uuid.uuid5(NS, "/".join(parts)))


def src(name):
    with open(os.path.join(HERE, "src", name + ".js"), encoding="utf-8") as fh:
        return fh.read().replace("\r\n", "\n")


def webhook(wf, path):
    return {"parameters": {"httpMethod": "POST", "path": path, "responseMode": "responseNode", "options": {}}, "id": uid(wf, "webhook"), "name": "Webhook",
            "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": uid(wf, "webhook-id")}


def code(wf, name, js, x=240):
    return {"parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js}, "id": uid(wf, name), "name": name,
            "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, 0]}


def respond(wf, body_expr, x):
    return {"parameters": {"respondWith": "json", "responseBody": body_expr, "options": {"responseCode": "={{ $('Compute').first().json.error ? 422 : 200 }}"}},
            "id": uid(wf, "respond"), "name": "Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.4, "position": [x, 0]}


def simple(wf_id, title, path, js_name, note):
    nodes = [webhook(wf_id, path), code(wf_id, "Compute", src(js_name)), respond(wf_id, "={{ $('Compute').first().json.error ? { error: $('Compute').first().json.error } : $('Compute').first().json }}", 480)]
    conns = {"Webhook": {"main": [[{"node": "Compute", "type": "main", "index": 0}]]}, "Compute": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]}}
    return {"name": title, "id": uid(wf_id, "workflow")[:16].replace("-", ""), "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}, "active": False,
            "pinData": {}, "meta": {"description": note}, "tags": []}


def sla_alert():
    wf = "sla-alert"
    nodes = [
        webhook(wf, "sla-check"),
        code(wf, "Compute", src("sla-alert")),
        {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2}, "conditions": [
            {"id": uid(wf, "c1"), "leftValue": "={{ $json.alerts }}", "rightValue": 0, "operator": {"type": "number", "operation": "gt"}},
            {"id": uid(wf, "c2"), "leftValue": "={{ $json.slack_url }}", "rightValue": "", "operator": {"type": "string", "operation": "notEmpty", "singleValue": True}}],
            "combinator": "and"}, "options": {}}, "id": uid(wf, "if"), "name": "Alerts and Slack URL?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [480, 0]},
        {"parameters": {"method": "POST", "url": "={{ $json.slack_url }}", "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.slack_payload) }}", "options": {"timeout": 10000}},
         "id": uid(wf, "slack"), "name": "Post to Slack", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [740, -100], "onError": "continueRegularOutput"},
        respond(wf, "={{ (() => { const c = $('Compute').first().json; if (c.error) return { error: c.error }; const slack = $('Post to Slack').isExecuted ? { attempted: true, ok: !$('Post to Slack').first().json.error } : { attempted: false }; return { checked: c.checked, alerts: c.alerts, breaches: c.breaches, warnings: c.warnings, skipped: c.skipped, slack }; })() }}", 1000),
    ]
    conns = {
        "Webhook": {"main": [[{"node": "Compute", "type": "main", "index": 0}]]},
        "Compute": {"main": [[{"node": "Alerts and Slack URL?", "type": "main", "index": 0}]]},
        "Alerts and Slack URL?": {"main": [[{"node": "Post to Slack", "type": "main", "index": 0}], [{"node": "Respond", "type": "main", "index": 0}]]},
        "Post to Slack": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {"name": "SLA alert to Slack", "id": uid(wf, "workflow")[:16].replace("-", ""), "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}, "active": False, "pinData": {}, "tags": []}


def all_workflows():
    return {
        "ticket-triage": simple("ticket-triage", "Ticket triage and routing", "triage", "ticket-triage", "Classifies a support ticket, sets priority, queue and SLA."),
        "sla-alert": sla_alert(),
        "invoice-extract": simple("invoice-extract", "Invoice field extraction", "invoice", "invoice-extract", "Extracts invoice number, dates, total and currency from text."),
        "lead-enrich": simple("lead-enrich", "Lead qualification from e-mail", "lead", "lead-enrich", "Validates and scores a lead e-mail and routes it."),
    }


def render(wf):
    return json.dumps(wf, indent=2, ensure_ascii=False) + "\n"


def main(argv):
    out = os.path.join(HERE, "workflows")
    os.makedirs(out, exist_ok=True)
    stale = []
    for name, wf in all_workflows().items():
        path = os.path.join(out, name + ".json")
        text = render(wf)
        if "--check" in argv:
            cur = open(path, encoding="utf-8", newline="").read().replace("\r\n", "\n") if os.path.exists(path) else None
            if cur != text:
                stale.append(name)
        else:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
    if stale:
        print("out of date: " + ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
