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
  precedence: request override ▸ env var. **There are no built-in defaults** — an
  unconfigured slot errors with the exact `MODELARK_MODEL_*` variable to set, so
  nothing can silently run against someone else's account endpoints.

| Slot | Env var | What it is | Where to find yours |
| --- | --- | --- | --- |
| Reasoner | `MODELARK_MODEL_REASONER` | Seed 2.0 Pro (agents, division, director) | public model name |
| Image Lite | `MODELARK_MODEL_SEEDREAM` | Seedream 5.0 Lite endpoint | Ark console → your endpoint id (`ep-…`) |
| Image Pro | `MODELARK_MODEL_SEEDREAM_PRO` | Seedream 5.0 Pro | public model name |
| Video | `MODELARK_MODEL_SEEDANCE` | Seedance 2.0 endpoint | Ark console (`ep-…`) |
| Video Fast | `MODELARK_MODEL_SEEDANCE_FAST` | Seedance 2.0 Fast endpoint | Ark console (`ep-…`) |
| Video Mini | `MODELARK_MODEL_SEEDANCE_MINI` | Seedance 2.0 Mini endpoint | Ark console (`ep-…`) |
| Audio | `MODELARK_MODEL_SEED_AUDIO` | Seed Audio 1.0 | public model name |
| TTS | `MODELARK_MODEL_SEED_TTS` | Seed TTS 2.0 | public model name |

`ep-…` ids are **account-scoped**: create the endpoint for the model in *your* Ark
console and paste its id. Base URLs: `MODELARK_API_BASE_URL` (Ark region) and
`BYTEPLUSVOICE_BASE_URL` (voice region).

## Storage

Generated/uploaded media is content-addressed: bytes mirror to your TOS bucket at
`projects/media/<sha>` (source of truth) with a local disk cache, and project
autosaves live at `projects/<id>/project.json` in the same bucket. Configure the
`MODELARK_TOS_*` / `MODELARK_ASSET_*` variables — without them, media durability and
cloud project saves are disabled.

## Access control (read this)

The app has **no built-in auth**. With a server API key configured, anyone who can
reach the URL generates at your expense. Deploy behind your VPN, SSO proxy, or IP
allowlist.

## Runtime requirements

- Node 18+ (Next.js app; any VM or container host).
- `ffmpeg` on PATH for frame extraction, audio extraction and Stitch.
- Writable disk for the media cache (`~/.modelark-starter-kit/media`); the TOS mirror
  is the source of truth, the disk is a cache.
