"""Imports the generated workflows into a real n8n container, publishes them, and posts every payload in tests/payloads/*.json.

Needs docker. The first run pulls the n8n image (about 2 GB) and takes a few minutes; later runs take about 40 seconds.
Environment: N8N_IMAGE (default n8nio/n8n:latest).
"""
import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAYLOADS = os.path.join(ROOT, "tests", "payloads")
WORKFLOWS = os.path.join(ROOT, "workflows")
IMAGE = os.environ.get("N8N_IMAGE", "n8nio/n8n:latest")


def sh(*args, check=True, timeout=300):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError("%s failed: %s" % (" ".join(args[:4]), (r.stdout + r.stderr)[-600:]))
    return r


class SlackMock:
    def __init__(self):
        self.posts = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(n).decode()
                if self.path.startswith("/fail"):
                    self.send_response(500)
                    self.end_headers()
                    return
                outer.posts.append(json.loads(body))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

        self.srv = HTTPServer(("0.0.0.0", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()


def wait_health(port, seconds=120):
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen("http://127.0.0.1:%s/healthz" % port, timeout=3) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(1.5)
    return False


@pytest.fixture(scope="module")
def n8n():
    try:
        sh("docker", "version", timeout=20)
    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired):
        pytest.skip("docker is not available")
    if sh("docker", "image", "inspect", IMAGE, check=False).returncode != 0:
        sh("docker", "pull", IMAGE, timeout=1500)
    slack = SlackMock()
    name = "n8n-workflows-test-%d" % os.getpid()
    sh("docker", "run", "-d", "--name", name, "-p", "127.0.0.1::5678", "--add-host=host.docker.internal:host-gateway",
       "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SECURE_COOKIE=false", "-e", "N8N_PERSONALIZATION_ENABLED=false", IMAGE)
    try:
        port = sh("docker", "port", name, "5678/tcp").stdout.strip().splitlines()[0].rsplit(":", 1)[1]
        assert wait_health(port), "n8n did not become healthy"
        sh("docker", "cp", WORKFLOWS, name + ":/tmp/workflows")
        sh("docker", "exec", name, "n8n", "import:workflow", "--separate", "--input=/tmp/workflows")
        for f in sorted(os.listdir(WORKFLOWS)):
            wid = json.load(open(os.path.join(WORKFLOWS, f), encoding="utf-8"))["id"]
            sh("docker", "exec", name, "n8n", "publish:workflow", "--id=" + wid)
        sh("docker", "restart", name)
        port = sh("docker", "port", name, "5678/tcp").stdout.strip().splitlines()[0].rsplit(":", 1)[1]      # a random host port is chosen again after a restart
        assert wait_health(port), "n8n did not come back after the restart"
        time.sleep(4)                                            # active workflows register their webhooks right after startup
        yield {"base": "http://127.0.0.1:%s/webhook" % port, "slack": slack, "name": name,
               "slack_url": "http://host.docker.internal:%d/ok" % slack.port, "slack_fail_url": "http://host.docker.internal:%d/fail" % slack.port}
    finally:
        logs = sh("docker", "logs", "--tail", "60", name, check=False)
        os.environ["N8N_LAST_LOGS"] = (logs.stdout + logs.stderr)[-3000:]
        sh("docker", "rm", "-f", name, check=False)
        slack.stop()


def post(base, path, body):
    req = urllib.request.Request("%s/%s" % (base, path), data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def subset(expect, got, where="$"):
    if isinstance(expect, dict):
        assert isinstance(got, dict), "%s: expected an object, got %r" % (where, got)
        for k, v in expect.items():
            assert k in got, "%s: missing key %r in %r" % (where, k, got)
            subset(v, got[k], where + "." + k)
    else:
        assert got == expect, "%s: expected %r, got %r" % (where, expect, got)


def fill(obj, n8n):
    s = json.dumps(obj).replace("@SLACK_URL@", n8n["slack_url"]).replace("@SLACK_FAIL_URL@", n8n["slack_fail_url"])
    return json.loads(s)


def all_cases():
    out = []
    for f in sorted(os.listdir(PAYLOADS)):
        spec = json.load(open(os.path.join(PAYLOADS, f), encoding="utf-8"))
        for c in spec["cases"]:
            out.append(pytest.param(spec["path"], c, id="%s: %s" % (f[:-5], c["name"])))
    return out


@pytest.mark.parametrize("path,case", all_cases())
def test_workflow_case(n8n, path, case):
    before = len(n8n["slack"].posts)
    status, body = post(n8n["base"], path, fill(case["request"], n8n))
    assert status == case["status"], (status, body, os.environ.get("N8N_LAST_LOGS", ""))
    subset(case["expect"], body)
    posted = n8n["slack"].posts[before:]
    if "slack_posts" in case:
        assert len(posted) == case["slack_posts"]
    for needle in case.get("slack_text_contains", []):
        assert posted and needle in posted[-1]["text"], (needle, posted)


def test_unknown_path_is_404(n8n):
    status, _ = post(n8n["base"], "does-not-exist", {})
    assert status == 404


def test_get_is_not_accepted(n8n):
    req = urllib.request.Request(n8n["base"] + "/triage", method="GET")
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=30)
    assert e.value.code in (404, 405)
