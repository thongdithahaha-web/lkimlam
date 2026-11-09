/* ═══════════════════════════════════════════════════════════
   lkimlamdev – SoundCloud Downloader  |  app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── DOM refs ──────────────────────────────────────────────
const urlInput        = document.getElementById('url-input');
const pasteBtn        = document.getElementById('paste-btn');
const fetchBtn        = document.getElementById('fetch-btn');
const loadingOverlay  = document.getElementById('loading-overlay');
const resultSection   = document.getElementById('result-section');
const errorToast      = document.getElementById('error-toast');
const errorMsg        = document.getElementById('error-message');
const toastClose      = document.getElementById('toast-close');
const downloadMp3Btn  = document.getElementById('download-mp3-btn');

// Result elements
const elArtwork      = document.getElementById('result-artwork');
const elTitle        = document.getElementById('result-title');
const elArtistName   = document.getElementById('result-artist-name');
const elArtist       = document.getElementById('result-artist');
const elDuration     = document.getElementById('result-duration');
const elGenre        = document.getElementById('result-genre');
const elPlays        = document.getElementById('result-plays');
const elLikes        = document.getElementById('result-likes');
const elScLink       = document.getElementById('soundcloud-link');
const audioPreview   = document.getElementById('audio-preview');
const audioPlayer    = document.getElementById('audio-player');
const progressWrap   = document.getElementById('progress-wrap');
const progressFill   = document.getElementById('progress-fill');
const progressLabel  = document.getElementById('progress-label');

// ── State ─────────────────────────────────────────────────
let currentTrack = null;
let toastTimer   = null;

// ── Particles Canvas ──────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function createParticle() {
    return {
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 2 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      a:  Math.random(),
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, createParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,85,0,${p.a * 0.5})`;
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init();
  draw();
})();

// ── Paste button ──────────────────────────────────────────
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text.trim();
    urlInput.focus();
    if (isSoundCloudUrl(urlInput.value)) {
      urlInput.style.color = '';
      triggerFetch();
    }
  } catch {
    urlInput.focus();
    showError('Không thể đọc clipboard. Hãy dán thủ công.');
  }
});

// ── Enter key ─────────────────────────────────────────────
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') triggerFetch();
});

urlInput.addEventListener('input', () => {
  hideError();
});

// ── Fetch button ──────────────────────────────────────────
fetchBtn.addEventListener('click', triggerFetch);

async function triggerFetch() {
  const url = urlInput.value.trim();
  if (!url) {
    showError('Vui lòng nhập hoặc dán link SoundCloud.');
    urlInput.focus();
    return;
  }
  if (!isSoundCloudUrl(url)) {
    showError('Link không hợp lệ. Vui lòng dùng link từ soundcloud.com.');
    return;
  }
  await fetchTrack(url);
}

// ── Validate SoundCloud URL ───────────────────────────────
function isSoundCloudUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'soundcloud.com' || u.hostname.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

// ── Fetch Track Info ──────────────────────────────────────
async function fetchTrack(url) {
  showLoading(true);
  hideError();
  resultSection.style.display = 'none';

  try {
    const res = await fetch(`/api/track?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');

    currentTrack = data;
    renderResult(data);

    resultSection.style.display = 'block';
    setTimeout(() => {
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  } catch (err) {
    showError(err.message || 'Không thể lấy thông tin bài hát. Thử lại sau.');
  } finally {
    showLoading(false);
  }
}

// ── Render Result ─────────────────────────────────────────
function renderResult(track) {
  document.title = `${track.title} – lkimlamdev`;

  // Artwork
  elArtwork.src = track.artwork || 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#1a1a2e"/>
      <text x="50%" y="50%" font-size="64" text-anchor="middle" dominant-baseline="middle">🎵</text>
    </svg>`
  );
  elArtwork.onerror = () => {
    elArtwork.src = 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1a1a2e"/><text x="50%" y="50%" font-size="64" text-anchor="middle" dominant-baseline="middle">🎵</text></svg>`
    );
  };

  elTitle.textContent        = track.title        || 'Không có tiêu đề';
  elArtistName.textContent   = track.artist        || 'Không rõ';
  elDuration.textContent     = track.duration      || '0:00';
  elGenre.textContent        = track.genre         || 'Nhạc';
  elPlays.textContent        = track.plays         || '0';
  elLikes.textContent        = track.likes         || '0';
  elArtist.href              = track.artistUrl     || '#';
  elScLink.href              = track.permalink     || '#';

  // Audio preview
  if (track.streamData?.url) {
    audioPlayer.src = track.streamData.url;
    audioPreview.style.display = 'block';
  } else {
    audioPreview.style.display = 'none';
    audioPlayer.src = '';
  }

  // Reset download button
  downloadMp3Btn.disabled = !track.streamData;
  progressWrap.style.display = 'none';
  progressFill.style.width   = '0%';
}

// ── Download ──────────────────────────────────────────────
downloadMp3Btn.addEventListener('click', () => {
  if (!currentTrack?.streamData) {
    showError('Không có nguồn âm thanh để tải.');
    return;
  }
  startDownload(currentTrack);
});

async function startDownload(track) {
  const { url, protocol } = track.streamData;
  const filename = sanitizeFilename(`${track.artist} - ${track.title}`);

  downloadMp3Btn.disabled = true;
  progressWrap.style.display = 'flex';
  animateProgress();
  setProgressLabel('Đang kết nối...');

  try {
    const downloadUrl =
      `/api/download?url=${encodeURIComponent(url)}` +
      `&filename=${encodeURIComponent(filename)}` +
      `&protocol=${protocol || 'progressive'}`;

    setProgressLabel('Đang tải xuống...');

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Lỗi khi tải file');
    }

    setProgressLabel('Đang xử lý file...');
    progressFill.style.width = '80%';

    const blob = await res.blob();
    progressFill.style.width = '100%';
    setProgressLabel('Hoàn thành! Đang mở hộp thoại lưu...');

    // Trigger browser download
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${filename}.mp3`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

    setTimeout(() => {
      progressWrap.style.display = 'none';
      progressFill.style.width   = '0%';
      downloadMp3Btn.disabled    = false;
      setProgressLabel('Đang chuẩn bị...');
    }, 3000);
  } catch (err) {
    showError('Tải thất bại: ' + err.message);
    progressWrap.style.display = 'none';
    downloadMp3Btn.disabled    = false;
  }
}

let progressInterval = null;

function animateProgress() {
  if (progressInterval) clearInterval(progressInterval);
  let v = 0;
  progressInterval = setInterval(() => {
    if (v >= 70) { clearInterval(progressInterval); return; }
    v += Math.random() * 4;
    if (v > 70) v = 70;
    progressFill.style.width = v + '%';
  }, 300);
}

function setProgressLabel(text) {
  progressLabel.textContent = text;
}

// ── Helpers ───────────────────────────────────────────────
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200);
}

function showLoading(show) {
  if (show) {
    loadingOverlay.classList.add('active');
    fetchBtn.disabled = true;
  } else {
    loadingOverlay.classList.remove('active');
    fetchBtn.disabled = false;
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorToast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideError, 6000);
}

function hideError() {
  errorToast.classList.remove('show');
}

toastClose.addEventListener('click', hideError);

// ── FAQ Accordion ─────────────────────────────────────────
document.querySelectorAll('.faq-question').forEach((btn) => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    // Close all
    document.querySelectorAll('.faq-item').forEach((el) => el.classList.remove('open'));
    btn.setAttribute('aria-expanded', 'false');

    if (!isOpen) {
      item.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});

// ── Header shadow on scroll ───────────────────────────────
window.addEventListener('scroll', () => {
  const header = document.querySelector('.header');
  header.style.background = window.scrollY > 20
    ? 'rgba(13,13,26,0.95)'
    : 'rgba(13,13,26,0.75)';
}, { passive: true });

// ── Auto-detect pasted URL ────────────────────────────────
urlInput.addEventListener('paste', (e) => {
  setTimeout(() => {
    const pasted = urlInput.value.trim();
    if (isSoundCloudUrl(pasted)) {
      triggerFetch();
    }
  }, 50);
});
