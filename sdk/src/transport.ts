// The runtime transport for produce(): a `client` (talks to ModelArk) plus an
// optional `stitch` capability. The default direct transport reuses the core's
// createDirectClient, so the SDK runs the whole loop in the caller's runtime with
// no Service API hop. Customers can swap in their own client/stitch.

import { createDirectClient, type Client } from './core';
import type { StitchFn } from './types';

export interface Transport {
  client: Client;
  /** Optional: assemble ordered shot URLs into one file/url. */
  stitch?: StitchFn;
}

/**
 * Build a transport that talks directly to ModelArk.
 * apiKey/baseUrl default to env MODELARK_API_KEY / MODELARK_API_BASE_URL.
 */
export const createDirectTransport = (opts: { apiKey?: string; baseUrl?: string; stitch?: StitchFn } = {}): Transport => ({
  client: createDirectClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl }),
  stitch: opts.stitch,
});
