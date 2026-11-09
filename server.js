const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Client ID Cache ──────────────────────────────────────────────────────────
let cachedClientId = null;
let clientIdTimestamp = 0;
const CLIENT_ID_TTL = 3600000; // 1 giờ

async function fetchClientId() {
  try {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

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
    console.error('❌ Lỗi fetchClientId:', err.message);
  }
  return null;
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

// ─── API: Lấy thông tin bài hát ──────────────────────────────────────────────
app.get('/api/track', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('soundcloud.com')) {
    return res.status(400).json({ error: 'URL SoundCloud không hợp lệ' });
  }

  try {
    const clientId = await getClientId();
    if (!clientId) return res.status(500).json({ error: 'Không thể lấy thông tin xác thực từ SoundCloud' });

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
    const fallback = transcodings.find((t) => t.format?.protocol === 'progressive');
    const preferred = progressive || fallback || hls;

    let streamData = null;
    if (preferred) {
      const { data: streamInfo } = await axios.get(
        `${preferred.url}?client_id=${clientId}`,
        { timeout: 10000 }
      );
      streamData = {
        url: streamInfo.url,
        protocol: preferred.format?.protocol,
        mimeType: preferred.format?.mime_type,
      };
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
      genre: track.genre || 'Không rõ',
      plays: formatCount(track.playback_count),
      likes: formatCount(track.likes_count),
      streamData,
      permalink: track.permalink_url,
    });
  } catch (err) {
    console.error('❌ /api/track:', err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'Không tìm thấy bài hát' });
    return res.status(500).json({ error: 'Lỗi máy chủ: ' + err.message });
  }
});

// ─── API: Stream Audio để nghe thử ──────────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  const { url, protocol } = req.query;
  if (!url) return res.status(400).json({ error: 'Thiếu URL' });

  try {
    if (protocol === 'hls') {
      const { data: m3u8 } = await axios.get(url, { timeout: 10000 });
      const segments = m3u8.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');

      for (const seg of segments) {
        if (res.writableEnded || res.destroyed) break;
        try {
          const { data: buf } = await axios.get(seg.trim(), {
            responseType: 'arraybuffer',
            timeout: 10000,
          });
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

  const safeName = (filename || 'audio').replace(/[<>:"/\\|?*]/g, '_');

  try {
    if (protocol === 'hls') {
      // HLS: tải từng segment và ghép lại
      const { data: m3u8 } = await axios.get(url, { timeout: 10000 });
      const segments = m3u8.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.mp3"`);

      for (const seg of segments) {
        try {
          const { data: buf } = await axios.get(seg.trim(), {
            responseType: 'arraybuffer',
            timeout: 10000,
          });
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
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.mp3"`);
    response.data.pipe(res);
  } catch (err) {
    console.error('❌ /api/download:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Lỗi khi tải: ' + err.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', brand: 'lkimlamdev' }));

app.listen(PORT, () => {
  console.log(`\n🎵  lkimlamdev SoundCloud Downloader`);
  console.log(`🚀  http://localhost:${PORT}\n`);
});
