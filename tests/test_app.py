import csv
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from replypilot import app as app_module
from replypilot.ai import AIError, ReplyWriter
from replypilot.db import Store


class FakeMessages:
    def __init__(self, text="Thanks so much, we'll see you again!", stop_reason="end_turn"):
        self.text, self.stop_reason, self.calls = text, stop_reason, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, content=[SimpleNamespace(type="text", text=self.text)])


def fake_writer(**kw):
    msgs = FakeMessages(**kw)
    return ReplyWriter(client=SimpleNamespace(beta=SimpleNamespace(messages=msgs))), msgs


@pytest.fixture
def client(tmp_path):
    app_module.app.state.store = Store(str(tmp_path / "t.db"))
    app_module.app.state.writer, _ = fake_writer()
    return TestClient(app_module.app)


REQ = {"business": "Rosa's", "review": "Great crust, slow service.", "rating": 4}


def test_free_tier_limit(client):
    for _ in range(3):
        r = client.post("/api/reply", json=REQ)
        assert r.status_code == 200 and r.json()["plan"] == "free"
    assert client.post("/api/reply", json=REQ).status_code == 429


def test_paid_key_and_cancellation(client):
    s = app_module.app.state.store
    key = s.upsert_subscription(email="a@b.c", plan="pro", stripe_customer="cus_1", stripe_subscription="sub_1")
    assert s.upsert_subscription(email="a@b.c", plan="pro", stripe_customer="cus_1", stripe_subscription="sub_1") == key
    r = client.post("/api/reply", json=REQ, headers={"X-Access-Key": key})
    assert r.status_code == 200 and r.json()["plan"] == "pro"
    s.deactivate_subscription("sub_1")
    assert client.post("/api/reply", json=REQ, headers={"X-Access-Key": key}).status_code == 401


def test_revenue_summary(tmp_path):
    s = Store(str(tmp_path / "r.db"))
    for i in range(3):
        s.upsert_subscription(email="", plan="pro", stripe_customer=f"c{i}", stripe_subscription=f"s{i}")
    assert s.revenue_summary()["mrr_usd"] == 237


def test_request_shape_and_refusal():
    w, msgs = fake_writer()
    w.review_reply(business="X", review="ok", rating=None, tone="formal")
    call = msgs.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["fallbacks"] == "default"
    w2, _ = fake_writer(stop_reason="refusal")
    with pytest.raises(AIError):
        w2.review_reply(business="X", review="ok", rating=None, tone="formal")


def test_validation(client):
    assert client.post("/api/reply", json={"business": "", "review": "x"}).status_code == 422


def test_daily_agent(tmp_path, monkeypatch):
    import scripts.daily_agent as agent
    monkeypatch.chdir(tmp_path)
    leads = tmp_path / "leads.csv"
    with open(leads, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["business", "email", "city"])
        w.writerow(["Rosa's", "rosa@example.com", "Austin"])
        w.writerow(["Bob's", "bob@example.com", "Austin"])
    writer, _ = fake_writer(text="Subject: Quick idea for Rosa's\n\nHi Rosa, ...")
    out = agent.run(str(leads), 10, "Sam", "https://x", writer)
    rows = list(csv.DictReader(open(out)))
    assert len(rows) == 2 and rows[0]["subject"] == "Quick idea for Rosa's"
    # second run skips already-contacted leads
    out = agent.run(str(leads), 10, "Sam", "https://x", writer)
    assert list(csv.DictReader(open(out))) == []
