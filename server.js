const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const m3u8stream = require('m3u8stream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Fallback Client IDs ──────────────────────────────────────────────────────
const FALLBACK_CLIENT_IDS = [
  '39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ',
  'a3dd183a3579db9a34fb59c160b2244f',
  'b45b1f107e7924e1279d0f98adb8b74e',
  'iZIs9mchVcX5lhVR1hnZWMM9nx44Huao',
];

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: '*/*',
};

// ─── Client ID Cache ──────────────────────────────────────────────────────────
let cachedClientId = null;
let clientIdTimestamp = 0;
const CLIENT_ID_TTL = 3600000; // 1 giờ

async function fetchClientId() {
  try {
    const response = await axios.get('https://soundcloud.com', { headers: DEFAULT_HEADERS, timeout: 15000 });
    const html = response.data;

    const scriptUrls = [
      ...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
    ].map((m) => m[1]);

    for (const scriptUrl of scriptUrls.reverse()) {
      try {
        const { data: script } = await axios.get(scriptUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
        const patterns = [
          /client_id:"([a-zA-Z0-9]{32})"/,
          /clientId:"([a-zA-Z0-9]{32})"/,
          /"client_id":"([a-zA-Z0-9]{32})"/,
          /client_id=([a-zA-Z0-9]{32})/,
        ];
        for (const p of patterns) {
          const m = script.match(p);
          if (m?.[1]) {
            console.log('✅ Lấy client_id thành công:', m[1]);
            return m[1];
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('⚠️ Lỗi fetchClientId động:', err.message);
  }

  for (const fallbackId of FALLBACK_CLIENT_IDS) {
    try {
      await axios.get(
        `https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com&client_id=${fallbackId}`,
        { headers: DEFAULT_HEADERS, timeout: 5000 }
      );
      console.log('✅ Dùng fallback client_id:', fallbackId);
      return fallbackId;
    } catch (_) {}
  }

  return FALLBACK_CLIENT_IDS[0];
}

async function getClientId() {
  if (cachedClientId && Date.now() - clientIdTimestamp < CLIENT_ID_TTL) return cachedClientId;
  cachedClientId = await fetchClientId();
  if (cachedClientId) clientIdTimestamp = Date.now();
  return cachedClientId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// Mở rộng link SoundCloud dạng rút gọn (on.soundcloud.com)
async function expandUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 10000,
      headers: DEFAULT_HEADERS,
    });
    return res.request.res.responseUrl || url;
  } catch (e) {
    return url;
  }
}

// Lấy thông tin track và stream tươi mới nhất
async function resolveSoundCloudTrack(trackUrl, clientId) {
  const finalUrl = await expandUrl(trackUrl);
  const { data: track } = await axios.get(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(finalUrl)}&client_id=${clientId}`,
    { headers: DEFAULT_HEADERS, timeout: 15000 }
  );

  if (track.kind !== 'track') {
    throw new Error('URL này không phải bài hát đơn lẻ. Hãy dùng link trực tiếp đến một track.');
  }

  const transcodings = track.media?.transcodings || [];
  // Ưu tiên progressive MP3, nếu không có thì lấy HLS chất lượng cao nhất
  const progressive = transcodings.find(
    (t) => t.format?.protocol === 'progressive'
  );
  const hls = transcodings.find(
    (t) => t.format?.protocol === 'hls'
  );
  const preferred = progressive || hls || transcodings[0];

  let freshStreamUrl = null;
  let protocol = 'progressive';
  let mimeType = 'audio/mpeg';

  if (preferred) {
    protocol = preferred.format?.protocol || 'progressive';
    mimeType = preferred.format?.mime_type || 'audio/mpeg';
    const { data: streamInfo } = await axios.get(
      `${preferred.url}?client_id=${clientId}`,
      { headers: DEFAULT_HEADERS, timeout: 10000 }
    );
    freshStreamUrl = streamInfo.url;
  }

  return { track, freshStreamUrl, protocol, mimeType };
}

// ─── API: Lấy thông tin bài hát ──────────────────────────────────────────────
app.get('/api/track', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Vui lòng cung cấp URL bài hát.' });

  try {
    const clientId = await getClientId();
    if (!clientId) return res.status(500).json({ error: 'Không thể kết nối với dịch vụ SoundCloud.' });

    const { track, freshStreamUrl, protocol, mimeType } = await resolveSoundCloudTrack(url, clientId);

    const artwork =
      (track.artwork_url || track.user?.avatar_url || '').replace('-large', '-t500x500');

    return res.json({
      id: track.id,
      title: track.title,
      artist: track.user?.username,
      artistUrl: track.user?.permalink_url,
      artwork,
      duration: formatDuration(track.duration),
      durationMs: track.duration,
      genre: track.genre || 'SoundCloud',
      plays: formatCount(track.playback_count),
      likes: formatCount(track.likes_count),
      streamData: freshStreamUrl ? { url: freshStreamUrl, protocol, mimeType } : null,
      permalink: track.permalink_url,
    });
  } catch (err) {
    console.error('❌ /api/track:', err.message);
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Không tìm thấy bài hát. Có thể bài hát ở chế độ riêng tư hoặc bị giới hạn quốc gia.' });
    }
    return res.status(500).json({ error: err.message || 'Lỗi máy chủ.' });
  }
});

// ─── API: Stream Audio để nghe thử ──────────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  let { url, trackUrl, protocol } = req.query;

  try {
    const clientId = await getClientId();

    // Nếu có trackUrl thì lấy stream tươi mới nhất để không bao giờ bị 403
    if (trackUrl && (!url || protocol === 'hls')) {
      const resolved = await resolveSoundCloudTrack(trackUrl, clientId);
      url = resolved.freshStreamUrl;
      protocol = resolved.protocol;
    }

    if (!url) return res.status(400).json({ error: 'Thiếu URL stream' });

    if (protocol === 'hls' || url.includes('.m3u8')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');

      const stream = m3u8stream(url, {
        requestOptions: { headers: DEFAULT_HEADERS },
      });

      req.on('close', () => {
        try { stream.end(); } catch (_) {}
      });

      stream.on('error', (err) => {
        console.error('m3u8stream error:', err.message);
        if (!res.headersSent) res.status(500).end();
      });

      return stream.pipe(res);
    }

    // Progressive MP3 Stream
    const headers = { ...DEFAULT_HEADERS };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      headers,
      timeout: 30000,
    });

    res.status(response.status);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
    if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');

    req.on('close', () => {
      try { response.data.destroy(); } catch (_) {}
    });

    response.data.pipe(res);
  } catch (err) {
    console.error('❌ /api/stream:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Lỗi stream: ' + err.message });
  }
});

// ─── API: Tải xuống MP3 ───────────────────────────────────────────────────────
app.get('/api/download', async (req, res) => {
  let { url, trackUrl, filename, protocol } = req.query;

  try {
    const clientId = await getClientId();

    // Luôn lấy stream tươi mới nhất nếu có trackUrl để không bao giờ bị 403
    if (trackUrl) {
      const resolved = await resolveSoundCloudTrack(trackUrl, clientId);
      url = resolved.freshStreamUrl;
      protocol = resolved.protocol;
      if (!filename && resolved.track) {
        filename = `${resolved.track.user?.username || 'Artist'} - ${resolved.track.title || 'Track'}`;
      }
    }

    if (!url) return res.status(400).json({ error: 'Thiếu thông tin URL để tải' });

    const cleanName = (filename || 'lkimlamdev_soundcloud').replace(/[<>:"/\\|?*]/g, '_').trim();
    const asciiName = cleanName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_') || 'audio';

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}.mp3"; filename*=UTF-8''${encodeURIComponent(cleanName)}.mp3`
    );

    if (protocol === 'hls' || url.includes('.m3u8')) {
      const stream = m3u8stream(url, {
        requestOptions: { headers: DEFAULT_HEADERS },
      });

      req.on('close', () => {
        try { stream.end(); } catch (_) {}
      });

      stream.on('error', (err) => {
        console.error('❌ Download m3u8stream error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Lỗi khi tải stream: ' + err.message });
      });

      return stream.pipe(res);
    }

    // Progressive (MP3 trực tiếp)
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: DEFAULT_HEADERS,
      timeout: 60000,
    });

    req.on('close', () => {
      try { response.data.destroy(); } catch (_) {}
    });

    response.data.pipe(res);
  } catch (err) {
    console.error('❌ /api/download:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Lỗi khi tải bài hát: ' + err.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', brand: 'lkimlamdev' }));

app.listen(PORT, () => {
  console.log(`\n🎵  lkimlamdev SoundCloud Downloader`);
  console.log(`🚀  http://localhost:${PORT}\n`);
});
