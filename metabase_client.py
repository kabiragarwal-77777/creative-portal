"""
Metabase SQL query client for analytics.univest.in
Usage:
    from metabase_client import run_query
    df = run_query("SELECT * FROM users LIMIT 10")
"""

import os
import requests

METABASE_URL = "https://analytics.univest.in"
SESSION_TOKEN = os.environ.get("METABASE_SESSION_TOKEN", "")


def get_session_token(username=None, password=None):
    """Authenticate and get a session token. Store it in .env for reuse."""
    if not username or not password:
        raise ValueError("Provide username and password to authenticate")
    resp = requests.post(f"{METABASE_URL}/api/session", json={
        "username": username,
        "password": password,
    })
    resp.raise_for_status()
    return resp.json()["id"]


def run_query(sql, database_id=1):
    """Run a SQL query against Metabase and return results as a list of dicts."""
    if not SESSION_TOKEN:
        raise ValueError("Set METABASE_SESSION_TOKEN env var or call get_session_token() first")

    resp = requests.post(
        f"{METABASE_URL}/api/dataset",
        headers={"X-Metabase-Session": SESSION_TOKEN},
        json={
            "database": database_id,
            "type": "native",
            "native": {"query": sql},
        },
    )
    resp.raise_for_status()
    data = resp.json()

    cols = [col["name"] for col in data["data"]["cols"]]
    rows = data["data"]["rows"]
    return [dict(zip(cols, row)) for row in rows]


def run_query_df(sql, database_id=1):
    """Run a SQL query and return results as a pandas DataFrame."""
    import pandas as pd
    results = run_query(sql, database_id)
    return pd.DataFrame(results)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        sql = " ".join(sys.argv[1:])
        results = run_query(sql)
        for row in results[:10]:
            print(row)
        if len(results) > 10:
            print(f"... ({len(results)} total rows)")
    else:
        print("Usage: python metabase_client.py 'SELECT * FROM users LIMIT 10'")
