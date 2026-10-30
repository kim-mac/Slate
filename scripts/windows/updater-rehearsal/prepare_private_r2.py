"""Interactive, local-only production rehearsal input preparation. No uploads.

Credentials enter only getpass/Botocore memory. The ignored output necessarily
contains a bearer URL (including its public access-key identifier), not the secret.
Do not run under transcription, terminal recording, debugging or redirected I/O.
"""

import getpass
import json
import logging
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid
import warnings
from datetime import datetime, timedelta, timezone


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path("dist/test/updater-production-rehearsal/private-input.json")
ACKNOWLEDGEMENT = "private-production-0.2.9-to-0.3.0-no-public-release"
POLICY = {
    "accountId": "120138f0b183aa081c0d5fc96df3ceef",
    "bucket": "slate-updater-rehearsal",
    "prefix": "slate-rehearsal/production-v029-v030-r1",
}
MAX_TTL = 6 * 24 * 60 * 60
OBJECT = POLICY["prefix"] + "/updates/windows/rehearsal.json"
MIN_DEADLINE = datetime(2026, 10, 23, 4, 59, tzinfo=timezone.utc)

# Existing strict contract, not a second implementation of SigV4/URL/key policy.
# All untrusted child output is captured and discarded, including error messages.
# Only the URL-bearing validation input goes over stdin; no S3 secret enters Node.
NODE_VALIDATOR = r"""
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
const request = JSON.parse(readFileSync(0, 'utf8'));
const { root, helper, payload, now, tokenEnd, deadline } = request;
const { configuration, artifacts, ACKNOWLEDGEMENT } = await import(helper);
const { ordinaryPath, auditWindowsPaths, readOrdinary } = await import(
  new URL('../updater-e2e/prepare.mjs', helper));
const { assertRehearsalEnvironment } = await import(new URL('./prepare.mjs', helper));
const { validateRehearsalUrl } = await import(new URL('../release-rehearsal.mjs', helper));
assertRehearsalEnvironment(process.env);
assert.equal(execFileSync('git', ['branch', '--show-current'], {
  cwd: root, encoding: 'utf8', windowsHide: true }).trim(), 'codex/desktop-updater');
const output = join(root, 'dist/test/updater-production-rehearsal/private-input.json');
ordinaryPath(output);
assert.ok(!existsSync(output));
assert.equal(execFileSync('git', ['check-ignore', '--no-index',
  'dist/test/updater-production-rehearsal/private-input.json'], {
  cwd: root, encoding: 'utf8', windowsHide: true }).trim().replaceAll('\\', '/'),
  'dist/test/updater-production-rehearsal/private-input.json');
const paths = [root, join(root, 'apps/desktop/src-tauri/tauri.conf.json'),
  join(root, 'apps/desktop/src-tauri/src/updater/mod.rs'),
  join(root, 'apps/desktop/dist/index.html')];
for (const path of paths) ordinaryPath(path);
auditWindowsPaths(paths);
const source = JSON.parse(readOrdinary(paths[1]).toString('utf8'));
const controller = readOrdinary(paths[2]).toString('utf8');
assert.equal([...controller.matchAll(/installation_enabled: (?:false|cfg!\(windows\) && driver\.configured\(\)),/g)].length, 1);
assert.ok(!controller.includes('SLATE_PRIVATE_REHEARSAL_'));
configuration(source, 'candidate');
for (const version of ['0.2.9', '0.3.0']) {
  assert.deepEqual(artifacts(version).map(a => a.platform).sort(),
    ['windows-aarch64', 'windows-x86_64']);
}
if (payload !== null) {
  assert.deepEqual(Object.keys(payload).sort(),
    ['acknowledgement', 'baselineEndpoint', 'frontendDist', 'policy']);
  assert.equal(payload.acknowledgement, ACKNOWLEDGEMENT);
  assert.equal(payload.frontendDist, join(root, 'apps/desktop/dist'));
  assert.deepEqual(payload.policy, {
    accountId: '120138f0b183aa081c0d5fc96df3ceef', bucket: 'slate-updater-rehearsal',
    prefix: 'slate-rehearsal/production-v029-v030-r1' });
  configuration(source, 'baseline', payload.baselineEndpoint, payload.policy, now);
  const { expiresAt } = validateRehearsalUrl(payload.baselineEndpoint, payload.policy,
    'updates/windows/rehearsal.json', now);
  const url = new URL(payload.baselineEndpoint);
  const ttl = Number(url.searchParams.get('X-Amz-Expires'));
  assert.ok(ttl >= 3600 && ttl <= 518400);
  assert.ok(Date.parse(expiresAt) <= tokenEnd - 86400000);
  assert.ok(Date.parse(expiresAt) > deadline + 3600000);
  assert.ok(deadline > now);
}
process.stdout.write('VALIDATED');
"""


def require(condition):
    if not condition:
        raise RuntimeError("Preparation refused")


def parse_time(value):
    require(isinstance(value, str) and value == value.strip())
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    require(
        re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})", value)
    )
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def lifetime(now, token_end, deadline):
    require(deadline >= MIN_DEADLINE and deadline > now and token_end > now)
    # A newly issued one-week token must not be mistaken for a permanent identity.
    require(token_end <= now + timedelta(days=7))
    ttl = min(MAX_TTL, int((token_end - timedelta(hours=24) - now).total_seconds()))
    require(ttl >= 3600)
    require(now + timedelta(seconds=ttl) > deadline + timedelta(hours=1))
    return ttl


def ordinary(path):
    cursor = Path(os.path.abspath(path))
    while True:
        if os.path.lexists(cursor):
            info = cursor.lstat()
            require(not stat.S_ISLNK(info.st_mode))
            require(not getattr(info, "st_file_attributes", 0) & 0x400)
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
            if stat.S_ISREG(info.st_mode):
                require(info.st_nlink == 1)
            require(
                os.path.normcase(os.path.realpath(cursor))
                == os.path.normcase(str(cursor))
            )
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def output_preflight(target):
    ordinary(target)
    require(not os.path.lexists(target))
    if target.parent.exists():
        require(not any(target.parent.glob(".private-input-*.tmp")))


def payload(root, endpoint):
    return {
        "acknowledgement": ACKNOWLEDGEMENT,
        "baselineEndpoint": endpoint,
        "frontendDist": str(root / "apps/desktop/dist"),
        "policy": dict(POLICY),
    }


def validate(root, value, now, token_end, deadline):
    request = {
        "root": str(root),
        "helper": (
            ROOT / "scripts/windows/updater-rehearsal/production-rehearsal.mjs"
        ).as_uri(),
        "payload": value,
        "now": int(now.timestamp() * 1000),
        "tokenEnd": int(token_end.timestamp() * 1000),
        "deadline": int(deadline.timestamp() * 1000),
    }
    result = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_VALIDATOR],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        cwd=root,
        timeout=45,
        shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    require(result.returncode == 0 and result.stdout == "VALIDATED")


def publish(target, data):
    # Windows os.rename is atomic and refuses an existing destination. Do not use
    # os.replace (overwrites) or allow POSIX rename's different overwrite behavior.
    require(os.name == "nt")
    output_preflight(target)
    require(target.parent.parent.is_dir())
    target.parent.mkdir(exist_ok=True)
    output_preflight(target)
    temporary = target.parent / (".private-input-" + uuid.uuid4().hex + ".tmp")
    with temporary.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    ordinary(temporary)
    require(temporary.read_bytes() == data)
    ordinary(target.parent)
    require(not os.path.lexists(target))
    os.rename(temporary, target)
    # On failure, retain any private temporary file for deliberate local review.
    # Never overwrite a completed input or automatically delete partial evidence.


def prepare(
    root,
    prompt,
    secret_prompt,
    client_factory,
    clock,
    validator=validate,
    publisher=publish,
):
    now = clock()
    output_preflight(root / OUTPUT)
    validator(root, None, now, now, now)
    require(
        prompt(
            "Confirm in Cloudflare: token slate-production-rehearsal, Object Read & Write, "
            "ONLY bucket slate-updater-rehearsal, public access DISABLED. "
            "Type CONFIRM only if all are verified: "
        )
        == "CONFIRM"
    )
    token_end = parse_time(
        prompt(
            "Dashboard-confirmed token expiry (YYYY-MM-DD means 00:00 UTC, or ISO timestamp): "
        )
    )
    deadline = parse_time(
        prompt(
            "Testing completion timestamp with timezone (planned 2026-10-22T23:59:00-05:00): "
        )
    )
    lifetime(clock(), token_end, deadline)
    access = secret_prompt("R2 Access Key ID (masked): ")
    secret = secret_prompt("R2 Secret Access Key (masked): ")
    for value in (access, secret):
        require(
            isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_+/=-]+", value))
        )
    client = None
    try:
        client = client_factory(access, secret)
        response = client.list_objects_v2(Bucket=POLICY["bucket"], MaxKeys=1)
        require(response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 200)
        require(response.get("Name") == POLICY["bucket"])
        require(response.get("KeyCount") in (0, 1))
        now = clock()
        ttl = lifetime(now, token_end, deadline)
        endpoint = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": POLICY["bucket"], "Key": OBJECT},
            ExpiresIn=ttl,
            HttpMethod="GET",
        )
        value = payload(root, endpoint)
        validator(root, value, now, token_end, deadline)
        # Recheck time immediately before publication; never extend the signed URL.
        lifetime(clock(), token_end, deadline)
        publisher(root / OUTPUT, (json.dumps(value, indent=2) + "\n").encode("utf8"))
        return {
            "inputPrepared": True,
            "urlValidated": True,
            "credentialEntry": "PASS",
            "r2ReadAccess": "PASS",
            "scopeAndExpiry": "maintainer-confirmed",
            "bothArchitecturesSupported": True,
            "apiSecretPersisted": False,
            "objectsModified": False,
            "manifestExpiresAt": (now + timedelta(seconds=ttl)).isoformat(),
        }
    finally:
        if client is not None:
            client.close()


def interactive():
    require(os.name == "nt" and len(sys.argv) == 1)
    require(all(stream.isatty() for stream in (sys.stdin, sys.stdout, sys.stderr)))
    require(
        not any(
            re.match(
                r"^(CI|NODE_OPTIONS|NODE_PATH|AWS_.*|TAURI_.*PRIVATE_KEY.*)$",
                name,
                re.I,
            )
            for name in os.environ
        )
    )
    warnings.simplefilter("error", getpass.GetPassWarning)
    logging.disable(logging.CRITICAL)
    import botocore.session
    from botocore.config import Config

    def connect(access, secret):
        return botocore.session.get_session().create_client(
            "s3",
            endpoint_url=f"https://{POLICY['accountId']}.r2.cloudflarestorage.com",
            region_name="auto",
            aws_access_key_id=access,
            aws_secret_access_key=secret,
            verify=True,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=10,
                read_timeout=15,
                retries={"max_attempts": 0},
            ),
        )

    return prepare(
        ROOT, input, getpass.getpass, connect, lambda: datetime.now(timezone.utc)
    )


def report(action):
    try:
        print(json.dumps(action()))
        return 0
    except (Exception, KeyboardInterrupt):
        print(
            json.dumps(
                {
                    "inputPrepared": False,
                    "status": "STOP: preflight, confirmation, lifetime, R2 or input validation failed. "
                    "Preserve existing inputs/partial files; do not retry blindly.",
                }
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(report(interactive))
