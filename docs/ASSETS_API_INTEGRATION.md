# Integrating the ModelArk Assets API — Customer Integration Guide

> **Audience:** an engineer (or coding agent) adding **ModelArk (BytePlus) Assets API** support to
> their own application.
> **This guide is self-contained.** It includes the request-signing code you need verbatim, the
> API action reference, the end-to-end orchestration, and the operational gotchas — so you can
> integrate without any external sample project.

---

## 1. What the Assets API is and when to use it

The Assets API is ModelArk's **private asset library**. You register an image or video (by public
URL) and it returns a permanent **asset id**. Downstream generation models (Seedance video,
Animate) then reference that asset as `asset://<assetId>` instead of a raw image URL.

Reach for it when one of these applies — otherwise a plain public `image_url` is simpler:

| Problem | Raw image URL | Registered `asset://` |
|---|---|---|
| **Photoreal humans** get rejected with *"input image may contain real person"* | ❌ blocked | ✅ trusted, passes |
| **URL expiry** — generated/staged URLs die (e.g. ~24h, presigned ≤7d) → later `400`s | ❌ breaks | ✅ permanent (library keeps its own copy) |
| **Private-bucket objects** aren't publicly fetchable | ❌ `403` | ✅ ingested once, then stable |

---

## 2. Prerequisites & credentials

### 2.1 What to obtain first
- A **BytePlus ModelArk** account with the Assets API enabled (region `ap-southeast-1`).
- An **Access Key / Secret Key (AK/SK)** pair with Assets permissions. This is the top-level
  gateway AK/SK — **not** the bearer API key you use for inference.
- A **TOS bucket** (BytePlus Object Storage, S3-equivalent) in the same region — required only if
  you need to register **local files** (the API ingests by URL, so local bytes must first be staged
  to a fetchable URL). If you only ever register already-public URLs, TOS is optional.
- Docs: <https://docs.byteplus.com/en/docs/ModelArk/2333565>

### 2.2 Environment variables

Pick your own variable names; these are the ones used throughout this guide. **Never commit real
values** — treat AK/SK as secrets.

```bash
# --- Assets API signing config (top-level BytePlus gateway) ---
REGION=ap-southeast-1
SERVICE=ark
VERSION=2024-01-01
BASE_URL=https://ark.ap-southeast-1.byteplusapi.com/
TERMINAL=request                # last component of the credential scope
POLL_INTERVAL_MS=3000           # GetAsset poll cadence
POLL_MAX_ATTEMPTS=40            # ~120s ceiling before giving up

# --- Assets API credentials (AK/SK — NOT the inference bearer token) ---
MODELARK_ASSET_ACCESS_KEY=<your-access-key>
MODELARK_ASSET_SECRET_KEY=<your-secret-key>

# --- TOS staging (only needed for LOCAL file uploads) ---
MODELARK_TOS_BUCKET=<your-bucket>
MODELARK_TOS_REGION=ap-southeast-1
MODELARK_TOS_ENDPOINT=tos-ap-southeast-1.bytepluses.com
MODELARK_TOS_OBJECT_PREFIX=assets           # folder prefix inside the bucket
MODELARK_TOS_PUBLIC_BASE_URL=               # leave EMPTY for private buckets → presigned GET is used

# --- Default asset group (any string; auto-created on first use) ---
MODELARK_ASSET_GROUP_ID=my_asset_group
```

> ⚠️ `MODELARK_TOS_REGION` must be a **region** (`ap-southeast-1`), never a domain.

---

## 3. The integration at a glance

You will build five small pieces. Names are suggestions — adapt to your stack.

| # | Piece | Responsibility | Needs |
|---|---|---|---|
| 1 | **Signer** (`signer.js`) | Sign & send Assets API calls (HMAC-SHA256 V4). Provided in full in §4. | env only |
| 2 | **Group util** (inline) | Default/validate the asset-group id | — |
| 3 | **TOS stager** (`tos.js`) | Stage local bytes → a **presigned** fetchable URL. §5. | `@volcengine/tos-sdk` |
| 4 | **Register helper** (`register.js`) | CreateAsset (+ auto-create group) + poll to Active → `assetId`. §6–7. | 1 |
| 5 | **Backend endpoint** (`POST /api/assets`) | Orchestrate: URL-or-file → stage → register → poll. §7. | 1,3,4 |

Minimum viable integration = pieces **1, 4, 5** (public-URL only). Add **3** for local-file uploads.

```bash
npm install @volcengine/tos-sdk   # only needed for TOS staging (local files)
```
Everything else uses Node built-ins (`crypto`) and the platform `fetch`.

---

## 4. The request signer (use verbatim)

The Assets API uses the **BytePlus/Volcengine V4 signature** (HMAC-SHA256), *not* a bearer token.
This is fiddly to get right; use this module as-is. Copy into `signer.js`:

```js
// signer.js — BytePlus/Volcengine V4 (HMAC-SHA256) signer for the Assets API.
import crypto from 'crypto';

const sha256Hex = (v) => crypto.createHash('sha256').update(v).digest('hex');
const hmac = (key, v, enc) => crypto.createHmac('sha256', key).update(v).digest(enc);

const formatAmzDate = (date) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, shortDate: iso.slice(0, 8) };
};

const encodeQueryValue = (v) =>
  encodeURIComponent(String(v)).replace(/\+/g, '%20')
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const normalizeQuery = (params) =>
  Object.keys(params).sort()
    .map((k) => `${encodeQueryValue(k)}=${encodeQueryValue(params[k])}`).join('&');

export const getAssetApiConfig = () => {
  const region = String(process.env.REGION || '').trim();
  const service = String(process.env.SERVICE || '').trim();
  const version = String(process.env.VERSION || '').trim();
  const baseUrl = String(process.env.BASE_URL || '').trim();
  const terminal = String(process.env.TERMINAL || '').trim();
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS);
  const pollMaxAttempts = Number(process.env.POLL_MAX_ATTEMPTS);
  if (!region || !service || !version || !baseUrl || !terminal) {
    throw new Error('Assets config incomplete. Set REGION, SERVICE, VERSION, BASE_URL, TERMINAL.');
  }
  if (!Number.isFinite(pollIntervalMs) || !Number.isFinite(pollMaxAttempts)) {
    throw new Error('Set POLL_INTERVAL_MS and POLL_MAX_ATTEMPTS.');
  }
  const base = baseUrl.replace(/\/+$/, '');
  return { region, service, version, baseUrl: `${base}/`, terminal, pollIntervalMs, pollMaxAttempts, host: new URL(base).host };
};

const signRequest = ({ action, payload, accessKey, secretKey }) => {
  const cfg = getAssetApiConfig();
  const body = JSON.stringify(payload || {});
  const payloadHash = sha256Hex(body);
  const { amzDate, shortDate } = formatAmzDate(new Date());
  const canonicalQuery = normalizeQuery({ Action: action, Version: cfg.version });
  const canonicalHeaders =
    ['content-type:application/json', `host:${cfg.host}`, `x-content-sha256:${payloadHash}`, `x-date:${amzDate}`].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = ['POST', '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${shortDate}/${cfg.region}/${cfg.service}/${cfg.terminal}`;
  const stringToSign = ['HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from(secretKey, 'utf8'), shortDate), cfg.region), cfg.service), cfg.terminal);
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    url: `${cfg.baseUrl}?${canonicalQuery}`,
    body,
    headers: {
      'Content-Type': 'application/json',
      Host: cfg.host,
      'X-Date': amzDate,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
};

// The one function you call for every action (CreateAsset, GetAsset, CreateAssetGroup).
export const callAssetApi = async ({ action, payload, accessKey, secretKey }) => {
  const signed = signRequest({ action, payload, accessKey, secretKey });
  const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.body });
  const data = await res.json();
  const err = data?.ResponseMetadata?.Error;
  if (!res.ok || err) throw new Error(err?.Message || `${action} failed: ${res.status}`);
  return data;
};
```

**Why it breaks if you tweak it:** the body’s SHA-256 goes into both `x-content-sha256` and the
canonical request; any whitespace/key-order change invalidates the signature (`403
SignatureDoesNotMatch`). The credential scope is `{yyyymmdd}/{REGION}/{SERVICE}/{TERMINAL}` →
e.g. `20260701/ap-southeast-1/ark/request`. Keep the error unwrapping — the group auto-create in
§6 depends on matching the *"asset_group … not found"* message.

---

## 5. Staging local files to TOS (`tos.js`)

`CreateAsset` ingests by URL, so a local file must first become a **publicly fetchable** URL. The
critical rule: on a **private** bucket the unsigned object URL `403`s when the Assets backend tries
to download it — pass a **presigned GET URL** instead.

```js
// tos.js
import { TosClient } from '@volcengine/tos-sdk';
import crypto from 'crypto';

// Turn a `data:<type>;base64,<...>` string into { contentType, buffer }.
export const parseDataUrl = (value) => {
  const s = String(value || '');
  const semi = s.indexOf(';'), comma = s.indexOf(',');
  if (!s.startsWith('data:') || semi < 0 || comma < 0 || s.slice(semi + 1, comma) !== 'base64') {
    throw new Error('Expected a base64 data URL.');
  }
  return { contentType: s.slice(5, semi), buffer: Buffer.from(s.slice(comma + 1), 'base64') };
};

export async function stageToTos({ accessKey, secretKey, bucket, region, endpoint, prefix, buffer, contentType, name }) {
  const client = new TosClient({ accessKeyId: accessKey, accessKeySecret: secretKey, region, endpoint });
  const safe = String(name || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const key = `${(prefix || 'assets').replace(/^\/+/, '')}/${crypto.randomUUID()}-${safe}`;
  // 1) Upload the bytes via a short-lived presigned PUT.
  const putUrl = client.getPreSignedUrl({ bucket, key, method: 'PUT', expires: 900 });
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: buffer });
  if (!put.ok) throw new Error(`TOS PUT failed: ${put.status} ${await put.text()}`);
  // 2) Presigned GET (max 7 days) — works on a PRIVATE bucket. This is what CreateAsset ingests.
  const getUrl = client.getPreSignedUrl({ bucket, key, method: 'GET', expires: 604800 });
  return { key, getUrl };
}
```

> `MODELARK_TOS_REGION` must be a region like `ap-southeast-1`; a domain there is a configuration
> error. Default endpoint is `tos-<region>.bytepluses.com`.

---

## 6. API actions reference

All three go through `callAssetApi({ action, payload, accessKey, secretKey })`.

### `CreateAssetGroup`
```jsonc
{ "Name": "my_asset_group", "Description": "", "GroupType": "AIGC", "ProjectName": "default" }
// → Result.Id  (the group id to use in CreateAsset)
```

### `CreateAsset`
```jsonc
{
  "GroupId": "my_asset_group",
  "URL": "https://.../portrait.png",   // MUST be publicly fetchable by the backend
  "AssetType": "Image",                 // "Image" | "Video"  (video ≤ 15s)
  "Name": "hero-closeup",               // optional, ≤120 chars
  "ProjectName": "default"
}
// → Result.Id  (this is your assetId → reference as asset://<id>)
```
If the group doesn’t exist, `CreateAsset` fails with *"The specified asset_group … is not found."*
Catch that, call `CreateAssetGroup`, then retry once (see §7). This makes first-run work with a
fresh group id.

### `GetAsset` (poll for readiness)
```jsonc
{ "Id": "asset-456", "ProjectName": "default" }
// → Result.Status ∈ { "Pending", "Processing", "Active", "Failed" }, Result.URL, ...
```
An asset is only usable as `asset://` **after** `Active`. Poll every `POLL_INTERVAL_MS` up to
`POLL_MAX_ATTEMPTS`, stopping on `Active`/`Failed`.

---

## 7. Orchestration: the register helper + endpoint

### 7.1 `register.js`
```js
import { callAssetApi } from './signer';

export async function registerAsset({ accessKey, secretKey, url, name, assetType = 'Image', groupId, projectName = 'default' }) {
  const base = { GroupId: groupId, URL: url, AssetType: assetType, ProjectName: projectName, ...(name ? { Name: String(name).slice(0, 120) } : {}) };
  const create = (gid) => callAssetApi({ action: 'CreateAsset', payload: { ...base, GroupId: gid }, accessKey, secretKey });
  try {
    return (await create(groupId))?.Result?.Id || null;
  } catch (err) {
    if (!/asset_group/i.test(err.message) || !/not found/i.test(err.message)) throw err;
    // Group missing → create it, retry once.
    const g = await callAssetApi({ action: 'CreateAssetGroup', payload: { Name: groupId, Description: '', GroupType: 'AIGC', ProjectName: projectName }, accessKey, secretKey });
    return (await create(g?.Result?.Id || groupId))?.Result?.Id || null;
  }
}

export async function pollUntilActive({ accessKey, secretKey, assetId, projectName = 'default', intervalMs = 3000, maxAttempts = 40 }) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const r = await callAssetApi({ action: 'GetAsset', payload: { Id: assetId, ProjectName: projectName }, accessKey, secretKey });
    const status = r?.Result?.Status;
    if (status === 'Active' || status === 'Failed') return { status, asset: r.Result };
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { status: 'Timeout', asset: null };
}
```

### 7.2 The backend endpoint (`POST /api/assets`)
```js
import { getAssetApiConfig } from './signer';
import { registerAsset, pollUntilActive } from './register';
import { stageToTos, parseDataUrl } from './tos';

// Raise your framework's JSON body limit (~50mb) — base64 files are large.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { imageUrl, localImageData, localImageName, assetName, assetType = 'Image', pollUntilReady = true } = req.body || {};
  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  const groupId   = process.env.MODELARK_ASSET_GROUP_ID;
  if (!accessKey || !secretKey) return res.status(400).json({ error: 'AK/SK not configured' });

  try {
    // 1) Resolve a publicly-fetchable URL.
    let url = String(imageUrl || '').trim();
    if (!url) {
      if (!localImageData) return res.status(400).json({ error: 'Provide a URL or a local file' });
      const { buffer, contentType } = parseDataUrl(localImageData);
      const staged = await stageToTos({
        accessKey, secretKey,
        bucket: process.env.MODELARK_TOS_BUCKET, region: process.env.MODELARK_TOS_REGION,
        endpoint: process.env.MODELARK_TOS_ENDPOINT, prefix: process.env.MODELARK_TOS_OBJECT_PREFIX,
        buffer, contentType, name: localImageName,
      });
      url = staged.getUrl;                       // presigned GET → private-bucket safe
    } else if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'URL must be public http(s)' });
    }

    // 2) Register (auto-creates the group on first run).
    const assetId = await registerAsset({ accessKey, secretKey, url, name: assetName, assetType, groupId });
    if (!assetId) throw new Error('CreateAsset returned no id');

    // 3) Poll until Active so asset://id is resolvable downstream.
    const cfg = getAssetApiConfig();
    const poll = pollUntilReady
      ? await pollUntilActive({ accessKey, secretKey, assetId, intervalMs: cfg.pollIntervalMs, maxAttempts: cfg.pollMaxAttempts })
      : null;

    return res.status(200).json({ assetId, ref: `asset://${assetId}`, status: poll?.status || 'Processing', asset: poll?.asset || null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
```

**Contract to preserve** regardless of framework: `POST` only; require AK/SK; accept a public URL
**or** a base64 local file; reject non-`http(s)` URLs; on a private bucket pass the **presigned GET**
URL to `CreateAsset`; bump the JSON body size limit.

---

## 8. Consuming the asset downstream (`asset://`)

Registration only pays off at the reference. **Store the `assetId`** on whatever entity uses the
image, then at request-build time emit `asset://<assetId>` in the `image_url` slot of your Seedance
/ Animate call:

```js
const referenceItem = {
  type: 'image_url',
  image_url: { url: `asset://${assetId}` },
  role: 'reference_image',
};
```

A raw `http` URL in that same slot is the fallback that trips the real-person filter — prefer the
asset ref for any photoreal human.

---

## 9. Verification

**Live smoke test (real credentials):**
```bash
curl -sS -X POST http://localhost:3000/api/assets \
  -H 'Content-Type: application/json' \
  -d '{"imageUrl":"https://picsum.photos/512","assetName":"smoke-test","pollUntilReady":true}' | jq
# Expect: { "assetId": "...", "ref": "asset://...", "status": "Active" }
```
Then confirm `asset://<assetId>` resolves by feeding it to your downstream model.

**Automated test (no network):** mock `fetch` and the TOS SDK and assert the four behaviours that
lock the contract: (1) group auto-create-then-retry on *"not found"*, (2) local-path/`file://`
rejection, (3) presigned-GET URL is the one passed to `CreateAsset` for local files, (4) poll stops
on `Active`/`Failed`.

---

## 10. Gotchas (ranked by how often they bite)

1. **Private bucket + unsigned URL → `403` at ingest.** Pass the **presigned GET** URL to
   `CreateAsset` when no public base URL is set.
2. **Using the asset before it’s `Active`.** Fresh assets are `Processing`; downstream models
   can’t resolve them yet. Poll first.
3. **Wrong AK/SK.** The Assets API AK/SK ≠ your inference bearer token. Mixing them → `403
   SignatureDoesNotMatch`.
4. **Region as a domain.** `MODELARK_TOS_REGION` must be `ap-southeast-1`, not a hostname.
5. **First run with a brand-new group id.** Relies on the CreateAsset → CreateAssetGroup → retry
   fallback; don’t strip it.
6. **Video > 15s.** Enforce a 15-second cap (client- and server-side) if you expose video.
7. **Body size.** Base64 images/videos blow past default ~1 MB body limits — raise the limit.
