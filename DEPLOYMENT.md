# Deploying the Film Agent canvas

Everything is configured through environment variables — no code edits. Copy
`.env.example` to `.env.local` (or set the same vars in your platform's env), then:

```bash
npm install
npm run build
npm start          # or: npm run dev
```

## Configuration model

- **All secrets live server-side.** The Ark API key, TOS keys, Assets creds and the
  voice key are read only by API routes. The browser fetches non-secret resolved
  config (model ids, base urls, a `hasServerKey` boolean) from `GET /api/film/config`.
- **Key-less UI.** When `MODELARK_API_KEY` is set, end users never enter a key — the
  canvas detects the server key and generation just works. Without it, the UI asks
  each user for their own key (the open starter-kit experience).
- **Model slots.** Every model the suite calls resolves through one table with
  precedence: request override ▸ env var. The code has **no built-in defaults** — an
  unconfigured slot errors with the exact `MODELARK_MODEL_*` variable to set.
  `.env.example` fills every slot with the model's public name, so a copy works as is.
- **Create endpoints for the proper experience.** Public names share your account's
  default limits; an endpoint per model (Ark console → Model Hub → the model → Create
  endpoint) gives each model its own rate limits, quota and usage tracking. Paste the
  `ep-…` id in place of the public name.

| Slot | Env var | What it is | Public name (default in `.env.example`) |
| --- | --- | --- | --- |
| Reasoner | `MODELARK_MODEL_REASONER` | Seed 2.0 Pro (agents, division, director) | `seed-2-0-pro-260328` |
| Reasoner Turbo | `MODELARK_MODEL_REASONER_21_TURBO` | Seed 2.1 Turbo, the default planner | `dola-seed-2-1-turbo-260628` |
| Reasoner SC | `MODELARK_MODEL_REASONER_SC` | Seed-SC planner (optional) | none — endpoint only (`ep-…`) |
| Reasoner Evolving | `MODELARK_MODEL_REASONER_EVOLVING` | Seed-Evolving planner | `dola-seed-evolving` |
| Image Lite | `MODELARK_MODEL_SEEDREAM` | Seedream 5.0 Lite | `seedream-5-0-260128` |
| Image Pro | `MODELARK_MODEL_SEEDREAM_PRO` | Seedream 5.0 Pro | `dola-seedream-5-0-pro-260628` |
| Image 5.5 | `MODELARK_MODEL_SEEDREAM_55` | Seedream 5.5 | `dola-seedream-5-5-261028` |
| Video | `MODELARK_MODEL_SEEDANCE` | Seedance 2.0 | `dreamina-seedance-2-0-260128` |
| Video Fast | `MODELARK_MODEL_SEEDANCE_FAST` | Seedance 2.0 Fast | `dreamina-seedance-2-0-fast-260128` |
| Video Mini | `MODELARK_MODEL_SEEDANCE_MINI` | Seedance 2.0 Mini | `dreamina-seedance-2-0-mini-260615` |
| Video 2.5 | `MODELARK_MODEL_SEEDANCE_25` | Seedance 2.5 (needs a 2.5 resource pack) | `dreamina-seedance-2-5-260628` |
| Video 2.5 Premium | `MODELARK_MODEL_SEEDANCE_25_PREMIUM` | Seedance 2.5 Premium | `dreamina-seedance-2-5-premium-260915` |
| Audio | `MODELARK_MODEL_SEED_AUDIO` | Seed Audio 1.0 | `seed-audio-1.0` |

`ep-…` ids are **account-scoped**: an endpoint id works only on the account that
created it. Base URLs: `MODELARK_API_BASE_URL` (Ark region) and
`BYTEPLUSVOICE_BASE_URL` (voice region). Audio/TTS additionally need
`BYTEPLUSVOICE_API_KEY` (the voice console key — separate from the Ark key).

Optional: `MODELARK_REASONER_PROTOCOL=responses|chat` — set it only when your
reasoner slot is an `ep-…` endpoint id (its API shape can't be inferred from the
name; public `seed-2-0-*` names need nothing).

## Storage

Generated/uploaded media is content-addressed: bytes mirror to your TOS bucket at
`projects/media/<sha>` (source of truth) with a local disk cache, and project
autosaves live at `projects/<id>/project.json` in the same bucket. Deleting a
project from the Cloud-open dialog garbage-collects its media (reference-counted —
bytes shared with other projects are kept).

Required for storage: `MODELARK_ASSET_ACCESS_KEY`, `MODELARK_ASSET_SECRET_KEY`,
`MODELARK_TOS_BUCKET`, `MODELARK_TOS_REGION` (a region like `ap-southeast-1` —
required, there is no default). Optional: `MODELARK_TOS_ENDPOINT` (derived from the
region when unset), `MODELARK_TOS_OBJECT_PREFIX`, `MODELARK_TOS_PUBLIC_BASE_URL`
(only for public-read buckets). Without the required four, media durability and
cloud project saves are disabled.

## Access control (read this)

The app has **no built-in auth**. With a server API key configured, anyone who can
reach the URL generates at your expense. Deploy behind your VPN, SSO proxy, or IP
allowlist.

## Runtime requirements

- Node 18+ (Next.js app; any VM or container host).
- ffmpeg is **bundled** (`ffmpeg-static`, installed by `npm install`) — no system
  install. It powers frame/poster extraction, audio extraction and Stitch.
- Writable disk for the media cache (`~/.modelark-starter-kit/media`); the TOS mirror
  is the source of truth, the disk is a cache.

## Packaging a release

Ship exactly the tracked tree — never a working-directory copy (`.env.local` and
caches stay out by construction):

```bash
git archive --format=zip -o ModelArkStarterKit-$(git rev-parse --short HEAD).zip HEAD
```

The customer's path: unzip → `cp .env.example .env.local` → fill their keys and
endpoint ids → `npm install && npm run build && npm start`.
