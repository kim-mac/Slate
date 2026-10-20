"""Offline tests: all credentials, signatures and R2 responses are synthetic."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import urlencode


MODULE = Path(__file__).with_name("prepare_private_r2.py")
SPEC = importlib.util.spec_from_file_location("private_r2", MODULE)
api = importlib.util.module_from_spec(SPEC) if MODULE.exists() else None
if api is not None:
    SPEC.loader.exec_module(api)
ROOT = Path(__file__).resolve().parents[3]
NOW = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
EXPIRY = "2026-10-27"
DEADLINE = "2026-10-22T23:59:00-05:00"
ACCESS = "SYNTHETICACCESSID"
SECRET = "SYNTHETIC-SECRET-NEVER-OUTPUT"


def endpoint(ttl=475200, bucket="slate-updater-rehearsal"):
    return (
        "https://120138f0b183aa081c0d5fc96df3ceef.r2.cloudflarestorage.com/"
        f"{bucket}/slate-rehearsal/production-v029-v030-r1/"
        "updates/windows/rehearsal.json?"
        + urlencode(
            {
                "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
                "X-Amz-Credential": ACCESS + "/20261020/auto/s3/aws4_request",
                "X-Amz-Date": "20261020T120000Z",
                "X-Amz-Expires": str(ttl),
                "X-Amz-SignedHeaders": "host",
                "X-Amz-Signature": "b" * 64,
            }
        )
    )


class FakeR2:
    def __init__(self, bucket="slate-updater-rehearsal", failure=None):
        self.bucket = bucket
        self.failure = failure
        self.calls = []
        self.closed = False

    def list_objects_v2(self, **kwargs):
        self.calls.append(("list", kwargs))
        if self.failure:
            raise self.failure
        return {
            "Name": self.bucket,
            "KeyCount": 0,
            "ResponseMetadata": {"HTTPStatusCode": 200},
        }

    def generate_presigned_url(self, operation, **kwargs):
        self.calls.append((operation, kwargs))
        return endpoint(kwargs["ExpiresIn"])

    def close(self):
        self.closed = True


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(api, "secure production R2 preparer is not implemented")

    def workflow(self, client=None, expiry=EXPIRY, confirmation="CONFIRM"):
        # Never inspect or target an already-prepared real private-input.json.
        self.workflow_root = self.fixture()
        client = client or FakeR2()
        prompts = iter([confirmation, expiry, DEADLINE])
        secrets = iter([ACCESS, SECRET])
        saved = []
        result = api.prepare(
            self.workflow_root,
            lambda _: next(prompts),
            lambda _: next(secrets),
            lambda access, secret: client,
            lambda: NOW,
            lambda *args: None,
            lambda path, data: saved.append((path, data)),
        )
        return result, saved, client

    def test_exact_schema_with_no_credentials_and_both_architectures(self):
        result, saved, client = self.workflow()
        payload = json.loads(saved[0][1])
        self.assertEqual(
            set(payload),
            {"acknowledgement", "baselineEndpoint", "frontendDist", "policy"},
        )
        self.assertEqual(payload["acknowledgement"], api.ACKNOWLEDGEMENT)
        self.assertEqual(payload["policy"], api.POLICY)
        self.assertEqual(saved[0][0], self.workflow_root / api.OUTPUT)
        self.assertNotIn(SECRET, saved[0][1].decode())
        self.assertTrue(result["bothArchitecturesSupported"])
        self.assertFalse(result["apiSecretPersisted"])
        self.assertFalse(result["objectsModified"])
        self.assertTrue(client.closed)
        self.assertEqual([c[0] for c in client.calls], ["list", "get_object"])
        self.assertEqual(
            client.calls[0][1], {"Bucket": api.POLICY["bucket"], "MaxKeys": 1}
        )

    def test_invalid_credentials_fail_without_writing(self):
        with self.assertRaises(Exception):
            self.workflow(FakeR2(failure=RuntimeError(SECRET)))

    def test_wrong_bucket_rejected(self):
        with self.assertRaises(Exception):
            self.workflow(FakeR2(bucket="other-bucket"))

    def test_scope_confirmation_required(self):
        with self.assertRaises(Exception):
            self.workflow(confirmation="no")

    def test_expired_and_insufficient_lifetimes(self):
        for value in [
            "2026-10-19",
            "2026-10-24",
            "not-a-date",
            "2026-10-24T05:00:00Z",
            "2026-10-27T12:00:00",
        ]:
            with self.subTest(value=value), self.assertRaises(Exception):
                self.workflow(expiry=value)

    def test_date_only_is_conservative_and_six_day_cap(self):
        expiry = api.parse_time(EXPIRY)
        self.assertEqual(expiry.isoformat(), "2026-10-27T00:00:00+00:00")
        ttl = api.lifetime(NOW, expiry, api.parse_time(DEADLINE))
        self.assertEqual(ttl, 475200)
        self.assertLessEqual(ttl, 518400)

    def test_planned_window_cannot_be_shortened_and_ttl_cannot_exceed_six_days(self):
        with self.assertRaises(Exception):
            api.lifetime(
                NOW, api.parse_time(EXPIRY), api.parse_time("2026-10-21T00:00:00Z")
            )
        self.assertEqual(
            api.lifetime(NOW, NOW + api.timedelta(days=7), api.parse_time(DEADLINE)),
            518400,
        )

    def test_no_credential_or_url_in_child_arguments_or_environment(self):
        root = self.fixture()
        with patch.object(api.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "VALIDATED"
            api.validate(
                root,
                api.payload(root, endpoint()),
                NOW,
                api.parse_time(EXPIRY),
                api.parse_time(DEADLINE),
            )
        args, kwargs = run.call_args
        self.assertNotIn(ACCESS, str(args))
        self.assertNotIn(SECRET, str(args))
        self.assertNotIn(endpoint(), str(args))
        self.assertNotIn("env", kwargs)
        self.assertNotIn(SECRET, kwargs["input"])
        self.assertFalse(kwargs["shell"])

    def test_noninteractive_or_extra_arguments_stop_before_credentials(self):
        with patch.object(api.sys, "argv", ["helper", "override"]):
            with self.assertRaises(Exception):
                api.interactive()
        with patch.object(api.sys, "argv", ["helper"]), patch.object(
            api.sys.stdin, "isatty", return_value=False
        ):
            with self.assertRaises(Exception):
                api.interactive()

    def test_redaction_of_untrusted_errors_and_interruptions(self):
        for error in [RuntimeError(SECRET + endpoint()), KeyboardInterrupt()]:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = api.report(lambda: (_ for _ in ()).throw(error))
            self.assertEqual(code, 1)
            self.assertNotIn(SECRET, output.getvalue())
            self.assertNotIn(ACCESS, output.getvalue())
            self.assertNotIn("X-Amz-", output.getvalue())
            self.assertEqual(json.loads(output.getvalue())["inputPrepared"], False)

    def fixture(self):
        parent = ROOT / "dist/test"
        # New synthetic evidence only; never use or clean existing rehearsal files.
        root = Path(tempfile.mkdtemp(prefix="r2-preparer-unit-", dir=parent))
        (root / "dist/test").mkdir(parents=True)
        crate = root / "apps/desktop/src-tauri"
        (crate / "src/updater").mkdir(parents=True)
        (crate / "tauri.conf.json").write_bytes(
            (ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_bytes()
        )
        (crate / "src/updater/mod.rs").write_text(
            "                    installation_enabled: cfg!(windows) && driver.configured(),\n",
            encoding="utf8",
        )
        frontend = root / "apps/desktop/dist"
        frontend.mkdir()
        (frontend / "index.html").write_text("synthetic frontend", encoding="utf8")
        return root

    def test_real_contract_accepts_schema_and_rejects_invalid_trust(self):
        root = self.fixture()
        payload = api.payload(root, endpoint())
        api.validate(
            root, payload, NOW, api.parse_time(EXPIRY), api.parse_time(DEADLINE)
        )
        config_path = root / "apps/desktop/src-tauri/tauri.conf.json"
        original = json.loads(config_path.read_text())
        for version, key in [
            ("0.2.2", original["plugins"]["updater"]["pubkey"]),
            ("0.3.0", "VGVzdA=="),
        ]:
            config = json.loads(json.dumps(original))
            config["version"] = version
            config["plugins"]["updater"]["pubkey"] = key
            config_path.write_text(json.dumps(config), encoding="utf8")
            with self.assertRaises(Exception):
                api.validate(
                    root, payload, NOW, api.parse_time(EXPIRY), api.parse_time(DEADLINE)
                )

    def test_full_synthetic_workflow_uses_real_contract_and_atomic_writer(self):
        root = self.fixture()
        prompts = iter(["CONFIRM", EXPIRY, DEADLINE])
        secrets = iter([ACCESS, SECRET])
        client = FakeR2()
        result = api.prepare(
            root,
            lambda _: next(prompts),
            lambda _: next(secrets),
            lambda access, secret: client,
            lambda: NOW,
        )
        saved = json.loads((root / api.OUTPUT).read_text())
        self.assertEqual(saved, api.payload(root, endpoint()))
        self.assertTrue(result["inputPrepared"])
        self.assertTrue(client.closed)

    def test_missing_git_ignore_check_is_a_hard_failure(self):
        root = self.fixture()
        # Simulate Git rejecting check-ignore, leaving all other validation real.
        replaced = api.NODE_VALIDATOR.replace(
            "['check-ignore', '--no-index',", "['not-a-real-git-command', '--no-index',"
        )
        self.assertNotEqual(replaced, api.NODE_VALIDATOR)
        with patch.object(api, "NODE_VALIDATOR", replaced), self.assertRaises(
            Exception
        ):
            api.validate(
                root,
                api.payload(root, endpoint()),
                NOW,
                api.parse_time(EXPIRY),
                api.parse_time(DEADLINE),
            )

    def test_bad_urls_namespace_fields_and_ignore_protection(self):
        root = self.fixture()
        good = api.payload(root, endpoint())
        for change in [
            {"baselineEndpoint": "http://localhost/manifest.json"},
            {"baselineEndpoint": endpoint(bucket="wrong-bucket")},
            {"policy": {**api.POLICY, "prefix": "slate-rehearsal/v022-v023-r1"}},
            {"version": "0.2.2"},
            {"privateKey": "must-not-be-accepted"},
        ]:
            with self.subTest(change=list(change)), self.assertRaises(Exception):
                api.validate(
                    root,
                    {**good, **change},
                    NOW,
                    api.parse_time(EXPIRY),
                    api.parse_time(DEADLINE),
                )
        with patch.dict(
            os.environ,
            {
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "core.excludesFile",
                "GIT_CONFIG_VALUE_0": "NUL",
            },
        ):
            # Missing Git context must fail, not silently write outside a worktree.
            with self.assertRaises(Exception):
                api.validate(
                    Path(tempfile.gettempdir()),
                    good,
                    NOW,
                    api.parse_time(EXPIRY),
                    api.parse_time(DEADLINE),
                )

    def test_atomic_exclusive_publication_and_no_overwrite(self):
        root = self.fixture()
        target = root / api.OUTPUT
        api.publish(target, b"synthetic")
        self.assertEqual(target.read_bytes(), b"synthetic")
        with self.assertRaises(Exception):
            api.publish(target, b"overwrite")
        self.assertEqual(target.read_bytes(), b"synthetic")

    def test_partial_or_interrupted_write_never_publishes(self):
        for method in ["fsync", "rename"]:
            root = self.fixture()
            target = root / api.OUTPUT
            with patch.object(api.os, method, side_effect=OSError("synthetic")):
                with self.assertRaises(Exception):
                    api.publish(target, b"synthetic")
            self.assertFalse(target.exists())
            self.assertEqual(len(list(target.parent.glob(".private-input-*.tmp"))), 1)
            with self.assertRaises(Exception):
                api.publish(target, b"retry")

    def test_destination_created_during_publish_is_not_overwritten(self):
        root = self.fixture()
        target = root / api.OUTPUT
        rename = api.os.rename

        def competing_writer(source, destination):
            target.write_bytes(b"other-writer")
            return rename(source, destination)

        with patch.object(api.os, "rename", side_effect=competing_writer):
            with self.assertRaises(Exception):
                api.publish(target, b"our-writer")
        self.assertEqual(target.read_bytes(), b"other-writer")
        self.assertEqual(len(list(target.parent.glob(".private-input-*.tmp"))), 1)

    def test_short_write_is_rejected_and_private_temporary_file_retained(self):
        root = self.fixture()
        target = root / api.OUTPUT

        def partial_write(_):
            temporary = next(target.parent.glob(".private-input-*.tmp"))
            temporary.write_bytes(b"part")

        with patch.object(api.os, "fsync", side_effect=partial_write):
            with self.assertRaises(Exception):
                api.publish(target, b"complete-input")
        self.assertFalse(target.exists())
        self.assertEqual(len(list(target.parent.glob(".private-input-*.tmp"))), 1)

    def test_hardlinked_input_is_rejected(self):
        root = self.fixture()
        source = root / "synthetic-file"
        source.write_bytes(b"synthetic")
        alias = root / "hardlink"
        os.link(source, alias)
        with self.assertRaises(Exception):
            api.ordinary(alias)


if __name__ == "__main__":
    unittest.main()
