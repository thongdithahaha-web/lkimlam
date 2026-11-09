const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Fallback Client IDs ──────────────────────────────────────────────────────
const FALLBACK_CLIENT_IDS = [
  '39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ',
  'a3dd183a3579db9a34fb59c160b2244f',
  '2t9loNfh0ekOfbnfq6VJYWeAOdtDensity',
  'b45b1f107e7924e1279d0f98adb8b74e',
  'iZIs9mchVcX5lhVR1hnZWMM9nx44Huao',
];

// ─── Client ID Cache ──────────────────────────────────────────────────────────
let cachedClientId = null;
let clientIdTimestamp = 0;
const CLIENT_ID_TTL = 3600000; // 1 giờ

async function fetchClientId() {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    const response = await axios.get('https://soundcloud.com', { headers, timeout: 15000 });
    const html = response.data;

    // Lấy tất cả URL script từ CDN SoundCloud
    const scriptUrls = [
      ...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
    ].map((m) => m[1]);

    for (const scriptUrl of scriptUrls.reverse()) {
      try {
        const { data: script } = await axios.get(scriptUrl, { headers, timeout: 10000 });
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

  // Sử dụng fallback nếu không tìm thấy
  for (const fallbackId of FALLBACK_CLIENT_IDS) {
    try {
      await axios.get(`https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com&client_id=${fallbackId}`, { timeout: 5000 });
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

// Unshorten link SoundCloud dạng on.soundcloud.com hoặc thiếu https://
async function expandUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return res.request.res.responseUrl || url;
  } catch (e) {
    return url;
  }
}

// Trích xuất các segment MP3 từ m3u8
async function parseHlsSegments(m3u8Url) {
  const { data: m3u8 } = await axios.get(m3u8Url, { timeout: 10000 });
  const lines = m3u8.split('\n').map((l) => l.trim()).filter(Boolean);

  // Kiểm tra nếu là master playlist
  const variant = lines.find((l) => !l.startsWith('#') && l.includes('.m3u8'));
  if (variant) {
    const nextUrl = new URL(variant, m3u8Url).href;
    return parseHlsSegments(nextUrl);
  }

  const segments = lines
    .filter((l) => !l.startsWith('#'))
    .map((seg) => new URL(seg, m3u8Url).href);

  return segments;
}

// ─── API: Lấy thông tin bài hát ──────────────────────────────────────────────
app.get('/api/track', async (req, res) => {
  let { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Vui lòng cung cấp URL bài hát.' });
  }

  try {
    // Mở rộng URL nếu là dạng rút gọn on.soundcloud.com
    url = await expandUrl(url);

    if (!url.includes('soundcloud.com')) {
      return res.status(400).json({ error: 'URL không hợp lệ. Vui lòng nhập link bài hát từ soundcloud.com.' });
    }

    const clientId = await getClientId();
    if (!clientId) return res.status(500).json({ error: 'Không thể kết nối với dịch vụ SoundCloud.' });

    const { data: track } = await axios.get(
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
      { timeout: 15000 }
    );

    if (track.kind !== 'track') {
      return res.status(400).json({ error: 'URL này không phải bài hát đơn lẻ. Hãy dùng link trực tiếp đến một track.' });
    }

    // Chọn stream tốt nhất
    const transcodings = track.media?.transcodings || [];
    const progressive = transcodings.find(
      (t) => t.format?.protocol === 'progressive' && t.format?.mime_type === 'audio/mpeg'
    );
    const hls = transcodings.find(
      (t) => t.format?.protocol === 'hls' && t.format?.mime_type === 'audio/mpeg'
    );
    const fallback = transcodings.find((t) => t.format?.protocol === 'progressive') || transcodings[0];
    const preferred = progressive || hls || fallback;

    let streamData = null;
    if (preferred) {
      try {
        const { data: streamInfo } = await axios.get(
          `${preferred.url}?client_id=${clientId}`,
          { timeout: 10000 }
        );
        streamData = {
          url: streamInfo.url,
          protocol: preferred.format?.protocol || 'progressive',
          mimeType: preferred.format?.mime_type || 'audio/mpeg',
        };
      } catch (streamErr) {
        console.warn('Lỗi lấy streamInfo:', streamErr.message);
      }
    }

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
      streamData,
      permalink: track.permalink_url,
    });
  } catch (err) {
    console.error('❌ /api/track:', err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'Không tìm thấy bài hát. Có thể bài hát ở chế độ riêng tư hoặc bị giới hạn quốc gia.' });
    return res.status(500).json({ error: 'Lỗi máy chủ: ' + err.message });
  }
});

// ─── API: Stream Audio để nghe thử ──────────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  const { url, protocol } = req.query;
  if (!url) return res.status(400).json({ error: 'Thiếu URL' });

  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    if (protocol === 'hls') {
      const segments = await parseHlsSegments(url);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');

      for (const seg of segments) {
        if (isClosed || res.writableEnded || res.destroyed) break;
        try {
          const { data: buf } = await axios.get(seg, {
            responseType: 'arraybuffer',
            timeout: 10000,
          });
          if (isClosed) break;
          res.write(Buffer.from(buf));
        } catch (_) {}
      }
      return res.end();
    }

    const headers = {};
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

    response.data.pipe(res);
  } catch (err) {
    console.error('❌ /api/stream:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Lỗi stream: ' + err.message });
  }
});

// ─── API: Tải xuống ───────────────────────────────────────────────────────────
app.get('/api/download', async (req, res) => {
  const { url, filename, protocol } = req.query;
  if (!url) return res.status(400).json({ error: 'Thiếu URL' });

  // Tên file an toàn cho cả header ASCII và UTF-8
  const cleanName = (filename || 'lkimlamdev_soundcloud').replace(/[<>:"/\\|?*]/g, '_').trim();
  const asciiName = cleanName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_') || 'audio';

  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    if (protocol === 'hls') {
      const segments = await parseHlsSegments(url);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiName}.mp3"; filename*=UTF-8''${encodeURIComponent(cleanName)}.mp3`
      );

      for (const seg of segments) {
        if (isClosed || res.writableEnded || res.destroyed) break;
        try {
          const { data: buf } = await axios.get(seg, {
            responseType: 'arraybuffer',
            timeout: 10000,
          });
          if (isClosed) break;
          res.write(Buffer.from(buf));
        } catch (_) {}
      }
      return res.end();
    }

    // Progressive (MP3 trực tiếp)
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}.mp3"; filename*=UTF-8''${encodeURIComponent(cleanName)}.mp3`
    );

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
