import { useEffect, useState } from 'react';

// A master the browser can't play gets an H.264 copy to watch. `r` is { url, type, format }.
export const usePlayable = (r) => {
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => {
    setUrl('');
    setProblem('');
    if (!r?.url) return undefined;
    if (r.type !== 'video' || r.format !== 'mov') { setUrl(r.url); return undefined; }
    let live = true;
    fetch('/api/film/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: r.url }) })
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error); if (live) setUrl(j.url); })
      .catch((e) => { if (live) setProblem(e.message); });
    return () => { live = false; };
  }, [r?.url, r?.format, r?.type]);
  return { url, problem };
};
