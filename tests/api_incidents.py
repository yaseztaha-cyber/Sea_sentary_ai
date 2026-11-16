"""API-level integration test for incident persistence, escalation and review lifecycle.

Uses controlled TEST observations (isTest=true) so nothing is presented as a
real detection. Verifies level 3 → level 4 escalation, acknowledgment keeping
the incident open, and manual resolution.
"""
from __future__ import annotations

import json
import urllib.request

BASE = "http://127.0.0.1:3000"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())


def obs(level, track=9901):
    return {
        "observation": {
            "at": "2026-01-01T00:00:00.000Z",
            "level": level,
            "riskLevel": "CRITICAL" if level == 4 else "SUSPECTED",
            "kind": f"TEST API level {level}",
            "trackId": track,
            "zone": "API Test Zone",
            "durationSeconds": 7.0,
            "summary": "Controlled API integration test observation. Not a real detection.",
            "features": {"source": "api test", "heuristicScore": 0.61},
            "thresholds": {"criticalScore": 0.72},
            "reached": ["API integration test"],
            "ruleVersion": "test",
            "test": True,
        },
        "source": "API integration test",
        "modelVersion": "test",
        "trackHistory": [],
    }


def main():
    created = req("POST", "/api/incidents", obs(3))
    assert created["grouped"] is False and created["severity"] == "SUSPECTED", created
    iid = created["id"]
    grouped = req("POST", "/api/incidents", obs(4))
    assert grouped["grouped"] is True and grouped["id"] == iid, grouped
    assert grouped["severity"] == "CRITICAL", grouped
    detail = req("GET", f"/api/incidents/{iid}")
    assert detail["severity"] == "CRITICAL"
    assert detail["observationCount"] == 2
    assert any(e["type"] == "ESCALATED" for e in detail["events"]), detail["events"]
    req("PATCH", f"/api/incidents/{iid}", {"action": "acknowledge", "note": "api test"})
    mid = req("GET", f"/api/incidents/{iid}")
    assert mid["status"] == "ACKNOWLEDGED", mid["status"]
    req("PATCH", f"/api/incidents/{iid}", {"action": "resolve", "note": "api test complete"})
    end = req("GET", f"/api/incidents/{iid}")
    assert end["status"] == "RESOLVED", end["status"]
    print(json.dumps({"incident": iid, "escalation": "SUSPECTED→CRITICAL", "ack_kept_open": True, "final": end["status"]}, indent=2))


if __name__ == "__main__":
    main()
