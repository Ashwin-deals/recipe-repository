import logging
import sqlite3
import threading

import pytest

import auth
import database
import gcp
from app import analytics_rows


class FakeBlob:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def exists(self, timeout=None):
        return self.name in self.store

    def download_to_filename(self, path, timeout=None):
        with open(path, "wb") as fh:
            fh.write(self.store[self.name])

    def upload_from_filename(self, path, timeout=None):
        with open(path, "rb") as fh:
            self.store[self.name] = fh.read()
        self.store.uploads += 1


class Store(dict):
    uploads = 0


class FakeBucket:
    def __init__(self):
        self.store = Store()

    def blob(self, name):
        return FakeBlob(self.store, name)


def test_cloud_hooks_are_noops_by_default(app, tmp_path):
    assert not gcp.gcs_enabled(app.config)
    assert not gcp.bigquery_enabled(app.config)
    assert gcp.backup_db(app.config, app.config["DATABASE_PATH"]) is False
    assert gcp.restore_db(app.config, str(tmp_path / "missing.db")) is False
    assert gcp.mirror_events(app.config, [{"type": "x"}]) is None


def test_backup_runs_after_writes_only(make_app, monkeypatch):
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    gcp.flush_backup()  # the sign-up

    client.get("/")
    client.get("/api/list")
    assert gcp.flush_backup() is False
    client.post("/api/list/items", json={"line": "2 lemons"})
    assert gcp.flush_backup() is True
    assert bucket.store["cartchef.db"].startswith(b"SQLite format 3")


def test_backup_snapshot_contains_the_write(make_app, monkeypatch, tmp_path):
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    client.post("/api/list/items", json={"line": "2 lemons"})
    gcp.flush_backup()

    restored = tmp_path / "restored.db"
    restored.write_bytes(bucket.store["cartchef.db"])
    conn = sqlite3.connect(restored)
    assert conn.execute("SELECT name FROM shopping_list").fetchall() == [("lemons",)]
    conn.close()


def test_backup_failure_never_breaks_the_request(make_app, monkeypatch, caplog):
    def broken(config):
        raise RuntimeError("bucket missing")

    monkeypatch.setattr(gcp, "_bucket", broken)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    with caplog.at_level(logging.ERROR, logger="cartchef.gcp"):
        response = client.post("/api/list/items", json={"line": "2 lemons"})
        assert gcp.flush_backup() is False
    assert response.status_code == 201
    assert "backup to Cloud Storage failed" in caplog.text


def test_writes_never_wait_for_the_upload(make_app, monkeypatch):
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    assert client.post("/api/list/items", json={"line": "2 lemons"}).status_code == 201
    assert bucket.store.uploads == 0


def test_a_burst_of_writes_is_one_upload_with_all_of_them(make_app, monkeypatch, tmp_path):
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    for line in ("2 lemons", "1 onion", "3 eggs"):
        client.post("/api/list/items", json={"line": line})
    gcp.flush_backup()
    assert bucket.store.uploads == 1

    restored = tmp_path / "restored.db"
    restored.write_bytes(bucket.store["cartchef.db"])
    conn = sqlite3.connect(restored)
    assert len(conn.execute("SELECT * FROM shopping_list").fetchall()) == 3
    conn.close()


def test_a_write_after_a_backup_schedules_another(make_app, monkeypatch):
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    client = make_app(GCS_BUCKET="test-bucket").test_client()
    client.post("/api/list/items", json={"line": "2 lemons"})
    gcp.flush_backup()
    client.post("/api/list/items", json={"line": "1 onion"})
    gcp.flush_backup()
    assert bucket.store.uploads == 2


def test_scheduled_backup_runs_on_its_own(make_app, monkeypatch):
    uploaded = threading.Event()
    bucket = FakeBucket()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)
    real_backup = gcp.backup_db

    def backup_then_signal(config, path):
        result = real_backup(config, path)
        uploaded.set()
        return result

    monkeypatch.setattr(gcp, "backup_db", backup_then_signal)
    client = make_app(GCS_BUCKET="test-bucket", GCS_BACKUP_DELAY_SECONDS=0).test_client()
    client.post("/api/list/items", json={"line": "2 lemons"})
    assert uploaded.wait(timeout=5)
    assert bucket.store.uploads == 1


def test_restore_at_startup(make_app, monkeypatch, tmp_path):
    source = tmp_path / "source.db"
    database.init_db(str(source))
    conn = database.connect(str(source))
    uid = auth.create_user(conn, "restored@example.com", "!", "Restored")
    conn.commit()
    conn.close()
    bucket = FakeBucket()
    bucket.store["cartchef.db"] = source.read_bytes()
    monkeypatch.setattr(gcp, "_bucket", lambda config: bucket)

    app = make_app(GCS_BUCKET="test-bucket", DATABASE_PATH=str(tmp_path / "fresh" / "app.db"))
    conn = database.connect(app.config["DATABASE_PATH"])
    assert len(database.list_recipes(conn, uid)) == 6
    conn.close()


def test_restore_skips_when_local_db_exists(monkeypatch, tmp_path):
    existing = tmp_path / "app.db"
    existing.write_bytes(b"")
    monkeypatch.setattr(gcp, "_bucket", lambda config: (_ for _ in ()).throw(AssertionError("not called")))
    assert gcp.restore_db({"GCS_BUCKET": "b", "GCS_DB_OBJECT": "x"}, str(existing)) is False


def test_restore_failure_starts_fresh(make_app, monkeypatch, tmp_path, caplog):
    def broken(config):
        raise RuntimeError("no credentials")

    monkeypatch.setattr(gcp, "_bucket", broken)
    with caplog.at_level(logging.ERROR, logger="cartchef.gcp"):
        app = make_app(GCS_BUCKET="test-bucket", DATABASE_PATH=str(tmp_path / "new.db"))
    assert app.test_client().get("/healthz").json == {"status": "ok"}
    assert "restore" in caplog.text


def test_committed_events_are_mirrored(make_app, monkeypatch):
    mirrored = []
    monkeypatch.setattr(gcp, "mirror_events", lambda config, events: mirrored.extend(events))
    client = make_app().test_client()
    client.post("/api/list/items", json={"line": "2 lemons"})
    assert [e["type"] for e in mirrored] == ["ingredient_added"]
    assert '"line": "2 lemons"' in mirrored[0]["payload"]


def test_rolled_back_events_are_not_mirrored(db, uid):
    mirrored = []
    db.on_commit = mirrored.extend
    database.log_event(db, uid, "list_cleared", {"removed": 1})
    db.rollback()
    db.commit()
    assert mirrored == []
    database.log_event(db, uid, "list_cleared", {"removed": 2})
    db.commit()
    assert [e["type"] for e in mirrored] == ["list_cleared"]


def test_bigquery_rows_are_sent_in_a_background_thread(monkeypatch):
    seen = {}

    def fake_insert(config, rows):
        import threading
        seen.update(thread=threading.current_thread().name, rows=rows, config=config)

    monkeypatch.setattr(gcp, "_insert_rows", fake_insert)
    config = {"GOOGLE_CLOUD_PROJECT": "p", "BIGQUERY_DATASET": "d", "BIGQUERY_TABLE": "events"}
    future = gcp.mirror_events(config, [{"type": "item_checked", "payload": "{}", "created_at": "now"}])
    future.result(timeout=5)
    assert seen["thread"].startswith("bigquery")
    assert seen["rows"][0]["type"] == "item_checked"


def test_bigquery_failure_is_logged_not_raised(monkeypatch, caplog):
    from google.cloud import bigquery

    def broken_client(*args, **kwargs):
        raise RuntimeError("no credentials")

    monkeypatch.setattr(bigquery, "Client", broken_client)
    monkeypatch.setattr(gcp, "_bq_clients", {})
    config = {"GOOGLE_CLOUD_PROJECT": "p", "BIGQUERY_DATASET": "d", "BIGQUERY_TABLE": "events"}
    with caplog.at_level(logging.ERROR, logger="cartchef.gcp"):
        gcp.mirror_events(config, [{"type": "x", "payload": "{}", "created_at": "now"}]).result(timeout=5)
    assert "BigQuery failed" in caplog.text


def test_proxy_fix_lets_rate_limits_see_the_real_client(make_app):
    client = make_app(TRUST_PROXY_HOPS=1, LOGIN_RATE_LIMIT="1/minute").test_client(email=None)

    def call(ip):
        body = {"email": "nobody@example.com", "password": "wrong password"}
        return client.post("/api/auth/login", json=body, headers={"X-Forwarded-For": ip}).status_code

    assert call("203.0.113.1") == 401
    assert call("203.0.113.1") == 429
    assert call("203.0.113.2") == 401


def test_forwarded_header_ignored_without_proxy_setting(make_app):
    client = make_app(TRUST_PROXY_HOPS=0, AI_RATE_LIMIT="1/minute").test_client()

    def call(ip):
        return client.post("/api/substitute", json={"ingredient": "egg"}, headers={"X-Forwarded-For": ip}).status_code

    assert call("203.0.113.1") == 200
    assert call("203.0.113.2") == 429  # spoofed header cannot dodge the limit


def test_secret_key_is_generated_once_and_reused(make_app):
    first = make_app(SECRET_KEY=None).config["SECRET_KEY"]
    second = make_app(SECRET_KEY=None).config["SECRET_KEY"]
    assert first == second and len(first) == 64


class FakeBigQuery:
    """Stands in for bigquery.Client: records tables and inserts; queue errors per call."""

    def __init__(self, *, exists=False, get_error=None, create_error=None, insert_not_found=0):
        self.exists, self.get_error, self.create_error = exists, get_error, create_error
        self.insert_not_found = insert_not_found
        self.get_calls, self.created, self.inserted = 0, [], []

    def __call__(self, project=None):  # used as the Client class
        return self

    def get_table(self, table_id, timeout=None):
        from google.api_core.exceptions import NotFound
        self.get_calls += 1
        if self.get_error:
            raise self.get_error
        if not self.exists:
            raise NotFound("table not found")

    def create_table(self, table, exists_ok=False, timeout=None):
        if self.create_error:
            raise self.create_error
        self.created.append(table)
        self.exists = True

    def insert_rows_json(self, table_id, rows, timeout=None):
        from google.api_core.exceptions import NotFound
        if self.insert_not_found:
            self.insert_not_found -= 1
            raise NotFound("table not ready")
        self.inserted.append((table_id, rows))
        return []


BQ_CONFIG = {"GOOGLE_CLOUD_PROJECT": "p", "BIGQUERY_DATASET": "d", "BIGQUERY_TABLE": "events"}
ROW = {"type": "item_checked", "payload": "{}", "created_at": "2026-10-03T12:00:00+00:00"}


@pytest.fixture
def fake_bq(monkeypatch):
    from google.cloud import bigquery

    def install(**kwargs):
        fake = FakeBigQuery(**kwargs)
        monkeypatch.setattr(bigquery, "Client", fake)
        monkeypatch.setattr(gcp, "_bq_clients", {})
        monkeypatch.setattr(gcp, "_bq_ready_tables", set())
        monkeypatch.setattr(gcp.time, "sleep", lambda seconds: None)
        return fake
    return install


def send(rows=(ROW,)):
    gcp.mirror_events(BQ_CONFIG, list(rows)).result(timeout=5)


def test_missing_events_table_is_created_with_the_schema(fake_bq):
    fake = fake_bq()
    send()
    (table,) = fake.created
    assert table.table_id == "events" and table.dataset_id == "d" and table.project == "p"
    assert [(f.name, f.field_type, f.mode) for f in table.schema] == [
        ("type", "STRING", "REQUIRED"), ("payload", "STRING", "REQUIRED"), ("created_at", "TIMESTAMP", "REQUIRED"),
    ]
    assert table.time_partitioning.field == "created_at"
    assert fake.inserted == [("p.d.events", [ROW])]


def test_existing_table_is_left_alone_and_checked_once(fake_bq):
    fake = fake_bq(exists=True)
    send()
    send()
    assert fake.created == [] and fake.get_calls == 1 and len(fake.inserted) == 2


def test_inserts_into_a_just_created_table_are_retried(fake_bq):
    fake = fake_bq(insert_not_found=2)
    send()
    assert len(fake.created) == 1 and fake.inserted == [("p.d.events", [ROW])]


def test_missing_dataset_is_logged_and_retried_on_the_next_batch(fake_bq, caplog):
    from google.api_core.exceptions import NotFound
    fake = fake_bq(create_error=NotFound("Dataset p:d was not found"))
    with caplog.at_level(logging.ERROR, logger="cartchef.gcp"):
        send()
    assert "BigQuery failed" in caplog.text and fake.inserted == []
    fake.create_error = None
    send()
    assert len(fake.created) == 1 and len(fake.inserted) == 1


def test_no_permission_to_check_the_table_still_inserts(fake_bq, caplog):
    from google.api_core.exceptions import Forbidden
    fake = fake_bq(exists=True, get_error=Forbidden("bigquery.tables.get denied"))
    with caplog.at_level(logging.WARNING, logger="cartchef.gcp"):
        send()
    assert "permission denied" in caplog.text and fake.created == [] and len(fake.inserted) == 1


def test_schema_json_matches_the_rows_the_app_sends(app, uid):
    schema = gcp.events_schema_json()
    assert [f["name"] for f in schema] == ["type", "payload", "created_at"]
    conn = database.connect(app.config["DATABASE_PATH"])
    database.log_event(conn, uid, "item_checked", {"item_id": 1})
    (row,) = analytics_rows(app.config["SECRET_KEY"], conn.pending_events)
    conn.close()
    assert set(row) == {f["name"] for f in schema} and all(row[f["name"]] is not None for f in schema)
