# ModelArk Assets API — Integration Architecture

> Companion to the **Assets API Integration Guide**. This is the **flow-level view** for a
> solutions architect evaluating or planning the integration: system context, components,
> sequences, state, trust boundaries, and failure paths. All diagrams are Mermaid (render on
> GitHub or any Mermaid viewer).
>
> **One-line summary:** a browser hands your app a media URL or local file; your app (server-side,
> holding AK/SK) optionally stages local bytes to **TOS**, calls the **Assets API** to register a
> permanent asset id, polls until `Active`, and returns an `asset://<id>` that downstream
> generation models trust.

---

## 0. Whole flow at a glance

The complete pipeline on one canvas — **register** an asset (blue) once, then **reuse** it
downstream (purple) forever. The rest of this document breaks these same steps into context,
sequence, state, and failure views.

![ModelArk Assets API — whole flow, end to end: user provides media, the server ensures a fetchable URL (staging local files to TOS), calls CreateAsset (auto-creating the group if missing), polls GetAsset until Active for a permanent asset id, then stores it and references it as asset:// in downstream Seedance or Animate generation.](assets-api-whole-flow.svg)

---

## 1. System context (C4 level 1)

```mermaid
graph TB
    user([User / Creator]):::actor

    subgraph app[Your Application · server-side]
        ui[Upload UI]
        api["Upload endpoint<br/>orchestrator"]
        gen[Generation request builder]
    end

    subgraph byteplus[BytePlus / ModelArk Cloud · ap-southeast-1]
        tos[(TOS Object Storage<br/>S3-equivalent)]
        assets[Assets API<br/>CreateAsset · GetAsset · CreateAssetGroup]
        models[Generation Models<br/>Seedance video / Animate]
    end

    user -->|drops file / pastes URL| ui
    ui -->|POST JSON| api
    api -->|1 · stage local bytes<br/>presigned PUT| tos
    api -->|2 · CreateAsset URL<br/>signed AK/SK| assets
    assets -.->|3 · downloads URL to ingest| tos
    api -->|4 · poll GetAsset → Active| assets
    api -->|assetId| ui
    gen -->|asset://id as image_url| models
    models -.->|resolves trusted asset| assets

    classDef actor fill:#2b6cb0,color:#fff,stroke:#1a4971;
```

**Key boundary:** AK/SK never leave the server. The browser only ever sees `asset://<id>` and
public URLs — never credentials.

---

## 2. Component / container view (C4 level 2)

Names are role-based; map them to whatever modules you create.

```mermaid
graph LR
    subgraph client[Browser]
        tab[Upload UI<br/>image/video · URL or file · poll toggle]
    end

    subgraph server[App Server · server-side]
        route[Upload endpoint<br/>ORCHESTRATOR]
        reg[Register helper<br/>CreateAsset + poll]
        sign[Signer<br/>V4 HMAC sign + call]
        stage[TOS stager<br/>presigned PUT/GET]
        gid[Group-id util<br/>default + validate]
    end

    subgraph cloud[BytePlus Cloud]
        tos[(TOS Bucket)]
        assets[[Assets API Gateway]]
    end

    tab -->|POST /api/assets| route
    route --> gid
    route --> stage
    route --> reg
    reg --> sign
    stage -->|PUT bytes / presign GET| tos
    sign -->|signed POST Action=*| assets
    assets -.->|GET ingest| tos

    style route fill:#fef3c7,stroke:#d97706
    style sign fill:#dbeafe,stroke:#2563eb
    style stage fill:#dcfce7,stroke:#16a34a
```

| Component | Trust level | Holds secrets? |
|---|---|---|
| Upload UI | untrusted (browser) | no |
| Upload endpoint (orchestrator) | trusted (server) | reads env |
| Register helper | trusted (server) | reads env |
| Signer | trusted (server) | signs with AK/SK |
| TOS stager | trusted (server) | AK/SK for presign |
| Group-id util | pure util | no |

---

## 3. Primary flow — register a **local file** (happy path)

This is the full pipeline. A public-URL registration skips steps 2–4.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (Upload UI)
    participant R as Upload endpoint
    participant S as TOS stager
    participant T as TOS bucket
    participant A as Signer
    participant G as Assets API

    B->>R: POST { localImageData(base64), assetType, pollUntilReady }
    Note over R: validate AK/SK present · file or URL present
    R->>S: stageToTos(base64)
    S->>T: PUT bytes via presigned URL (900s)
    T-->>S: 200 OK
    S-->>R: { key, presigned GET url (7d) }
    Note over R: private bucket → use PRESIGNED GET url<br/>(unsigned object url would 403 at ingest)
    R->>A: callAssetApi(CreateAsset, GroupId URL AssetType)
    A->>G: signed POST Action=CreateAsset
    alt group missing
        G-->>A: Error "asset_group ... not found"
        A-->>R: throw
        R->>A: callAssetApi(CreateAssetGroup, Name GroupType=AIGC)
        A->>G: signed POST Action=CreateAssetGroup
        G-->>A: Result.Id
        R->>A: callAssetApi(CreateAsset) retry
        A->>G: signed POST Action=CreateAsset
    end
    G-->>R: { Result.Id = assetId }
    loop until Active/Failed or POLL_MAX_ATTEMPTS
        R->>A: callAssetApi(GetAsset, Id)
        A->>G: signed POST Action=GetAsset
        G-->>R: { Status: Processing → Active }
        Note over R: sleep POLL_INTERVAL_MS between attempts
    end
    R-->>B: { assetId, ref: asset://id, status: Active }
```

---

## 4. Consumption flow — using `asset://` downstream

Registration only pays off when the id is referenced. This is where the "real person" filter and
URL-expiry problems are actually solved.

```mermaid
sequenceDiagram
    autonumber
    participant B as Client / agent
    participant R as Generation endpoint
    participant N as Reference normalizer
    participant M as Seedance / Animate
    participant G as Assets API

    B->>R: content item with stored assetId
    R->>N: normalize items
    N-->>R: image_url with url = asset://ID, role
    R->>M: generation request (asset:// in image_url slot)
    M->>G: resolve asset://ID
    G-->>M: trusted image bytes (consented identity)
    M-->>R: video / animation result
    Note over M,G: photoreal human refs pass here that a raw<br/>http image_url would reject as "may contain real person"
```

---

## 5. Asset lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> LocalOrURL: user provides media
    LocalOrURL --> Staged: local file → TOS (presigned)
    LocalOrURL --> HasURL: already public URL
    Staged --> HasURL: fetchable URL ready
    HasURL --> Creating: CreateAsset
    Creating --> Processing: Result.Id returned
    Creating --> GroupMissing: "asset_group not found"
    GroupMissing --> Creating: CreateAssetGroup + retry
    Processing --> Active: ingest complete (asset:// usable)
    Processing --> Failed: ingest error
    Active --> [*]: reference as asset://id (permanent)
    Failed --> [*]: surface error, retry registration

    note right of Active
        Permanent — the library keeps
        its own copy. Survives source
        URL expiry.
    end note
```

**Readiness gate:** an asset is only resolvable downstream in `Active`. Never emit `asset://<id>`
for a `Processing` asset — poll first.

---

## 6. Trust boundaries & secrets flow

```mermaid
flowchart TB
    subgraph untrusted[UNTRUSTED · Browser]
        b1[media URL or base64 file]
        b2[receives: assetId + public URLs only]
    end
    subgraph trusted[TRUSTED · App Server]
        env[[env config<br/>AK · SK · TOS · signing cfg]]
        s1[sign requests · V4 HMAC]
        s2[presign TOS URLs]
    end
    subgraph cloud[BytePlus Cloud]
        c1[TOS bucket]
        c2[Assets API]
    end

    b1 -->|POST JSON| trusted
    env -.->|read server-side only| s1
    env -.->|read server-side only| s2
    s1 -->|Authorization HMAC-SHA256 Credential AK/scope| c2
    s2 -->|presigned PUT/GET| c1
    trusted -->|assetId · presigned/public URL| b2

    classDef secret fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    class env secret
```

**Rules:**
- AK/SK and TOS keys are **server-only**. Only the (non-secret) asset-group *name* is safe to expose
  to the client if you need it there.
- Signing happens per-request; the signature embeds a dated credential scope
  `{date}/{region}/{service}/{terminal}` so leaked signatures expire.
- Presigned TOS URLs are time-boxed: **PUT 900s**, **GET 7 days** (the presign max) — long enough
  for ingest, short enough to limit exposure on a private bucket.

---

## 7. Decision & failure paths

```mermaid
flowchart TD
    start([POST /api/assets]) --> m{method POST?}
    m -- no --> e405[405 Method Not Allowed]
    m -- yes --> creds{AK & SK set?}
    creds -- no --> e400a[400 keys not configured]
    creds -- yes --> media{URL or local file?}
    media -- neither --> e400b[400 provide URL or file]
    media -- URL --> httpchk{http/https?}
    httpchk -- no --> e400c[400 must be public http url]
    httpchk -- yes --> create
    media -- local file --> bucket{TOS bucket set?}
    bucket -- no --> e400d[400 TOS not configured]
    bucket -- yes --> stage[stage → TOS presigned GET] --> create
    create[CreateAsset]
    create --> grp{group exists?}
    grp -- no --> mkgrp[CreateAssetGroup + retry] --> poll
    grp -- yes --> poll{pollUntilReady?}
    poll -- yes --> loop[poll GetAsset → Active/Failed] --> ok
    poll -- no --> one[single GetAsset] --> ok
    ok["200 · assetId · asset · poll"]

    classDef err fill:#fee2e2,stroke:#dc2626;
    class e405,e400a,e400b,e400c,e400d err
```

---

## 8. Deployment & scaling notes

| Concern | Guidance |
|---|---|
| **Where it runs** | The orchestrator is a **server-side** route (any Node backend). It must never run in the browser — it holds AK/SK. |
| **Latency** | Dominated by ingest polling. Budget `POLL_INTERVAL_MS × attempts` (default up to ~120s). For UX, allow `pollUntilReady:false` and let the client poll, or register asynchronously and reference later. |
| **Idempotency** | `CreateAsset` is not idempotent — each call mints a new asset id. De-dupe upstream (e.g. hash the source) if re-registration is a risk. |
| **Group strategy** | One long-lived group is the simplest model; a `group-{ts}-{rand}` scheme also supports per-session/per-project groups. Groups auto-create on first use. |
| **Private vs public bucket** | Private bucket + presigned GET is the secure default. Only configure a public base URL if the bucket is genuinely public-read. |
| **Secrets management** | Keep AK/SK/TOS keys in a secrets manager (Vault / SM / Parameter Store) in production. Rotating AK/SK invalidates nothing already ingested (assets are permanent). |
| **Failure isolation** | Treat registration as an **enhancement, not a hard dependency** unless the real-person bypass is mandatory: wrap it in try/catch so a flaky Assets call never blocks the primary upload. |
| **Region** | Everything is `ap-southeast-1`. Cross-region adds egress + latency; keep bucket, Assets API, and models co-located. |

---

## 9. Minimal integration surface

```mermaid
graph LR
    root([Assets API integration]):::hub

    root --> cred[Credentials]
    cred --> cred1[AK / SK]
    cred --> cred2[TOS keys]
    cred --> cred3[signing cfg env]

    root --> files[Server pieces]
    files --> f1[Signer]
    files --> f2[TOS stager]
    files --> f3[Group-id util]
    files --> f4[Upload endpoint]

    root --> contract[Contract]
    contract --> c1[POST url or file]
    contract --> c2[returns assetId]
    contract --> c3[poll to Active]

    root --> cons[Consumption]
    cons --> u1[store assetId]
    cons --> u2[emit asset:// ref]
    cons --> u3[downstream image_url]

    root --> guard[Guardrails]
    guard --> g1[presigned on private bucket]
    guard --> g2[wait for Active]
    guard --> g3[group auto-create]

    classDef hub fill:#2b6cb0,color:#fff,stroke:#1a4971;
```

See the **Assets API Integration Guide** for the credential list, the verbatim signer code, and
the endpoint contract.
