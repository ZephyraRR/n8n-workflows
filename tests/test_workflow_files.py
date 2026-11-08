"""Static checks on the generated workflow exports (no docker needed)."""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, "workflows")
FILES = sorted(os.listdir(WF))


def load(f):
    return json.load(open(os.path.join(WF, f), encoding="utf-8"))


def test_exports_are_up_to_date_with_the_sources():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "build.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + "  (run: python build.py)"


def test_four_workflows_exist():
    assert FILES == ["invoice-extract.json", "lead-enrich.json", "sla-alert.json", "ticket-triage.json"]


def test_connections_point_at_existing_nodes_and_every_node_is_reachable():
    for f in FILES:
        wf = load(f)
        names = {n["name"] for n in wf["nodes"]}
        assert len(names) == len(wf["nodes"]), f
        reached = set()
        for src, outs in wf["connections"].items():
            assert src in names, (f, src)
            for branch in outs["main"]:
                for c in branch:
                    assert c["node"] in names, (f, c)
                    reached.add(c["node"])
        assert names - reached == {"Webhook"}, (f, names - reached)


def test_node_and_workflow_ids_are_unique_and_stable():
    ids = [n["id"] for f in FILES for n in load(f)["nodes"]] + [load(f)["id"] for f in FILES]
    assert len(ids) == len(set(ids))


def test_webhooks_are_post_only_and_respond_through_a_respond_node():
    paths = []
    for f in FILES:
        hook = next(n for n in load(f)["nodes"] if n["type"] == "n8n-nodes-base.webhook")
        assert hook["parameters"]["httpMethod"] == "POST" and hook["parameters"]["responseMode"] == "responseNode"
        paths.append(hook["parameters"]["path"])
    assert len(paths) == len(set(paths))


def test_no_secrets_or_real_urls_are_baked_in():
    blob = "".join(open(os.path.join(WF, f), encoding="utf-8").read() for f in FILES)
    assert not re.search(r"hooks\.slack\.com/services|xox[bp]-|sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]", blob)
    assert "$env" not in blob            # n8n 2.x blocks $env in nodes by default, and secrets belong in credentials


def test_code_nodes_contain_exactly_the_source_files():
    for f in FILES:
        wf = load(f)
        name = f[:-5]
        code = next(n for n in wf["nodes"] if n["type"] == "n8n-nodes-base.code")["parameters"]["jsCode"]
        assert code == open(os.path.join(ROOT, "src", name + ".js"), encoding="utf-8").read().replace("\r\n", "\n")
