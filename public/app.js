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
const elArtworkWrap  = document.getElementById('artwork-wrap');
const elArtworkPlayIcon = document.getElementById('artwork-play-icon');
const elArtworkPauseIcon = document.getElementById('artwork-pause-icon');
const elTitle        = document.getElementById('result-title');
const elArtistName   = document.getElementById('result-artist-name');
const elArtist       = document.getElementById('result-artist');
const elDuration     = document.getElementById('result-duration');
const elGenre        = document.getElementById('result-genre');
const elPlays        = document.getElementById('result-plays');
const elLikes        = document.getElementById('result-likes');
const elScLink       = document.getElementById('soundcloud-link');

// Audio Player elements
const audioPreview   = document.getElementById('audio-preview');
const audioPlayer    = document.getElementById('audio-player');
const playerMainBtn  = document.getElementById('player-main-btn');
const ctrlPlayIcon   = document.getElementById('ctrl-play-icon');
const ctrlPauseIcon  = document.getElementById('ctrl-pause-icon');
const playerCurrentTime = document.getElementById('player-current-time');
const playerTotalTime   = document.getElementById('player-total-time');
const soundWaveAnim     = document.getElementById('sound-wave-anim');
const progressContainer = document.getElementById('player-progress-container');
const playerProgressFill = document.getElementById('player-progress-fill');
const playerProgressThumb = document.getElementById('player-progress-thumb');
const volumeToggleBtn   = document.getElementById('volume-toggle-btn');
const volHighIcon       = document.getElementById('vol-high-icon');
const volMuteIcon       = document.getElementById('vol-mute-icon');
const volumeSlider      = document.getElementById('volume-slider');

// Action buttons
const previewBtn        = document.getElementById('preview-btn');
const previewBtnPlayIcon = document.getElementById('preview-btn-play-icon');
const previewBtnPauseIcon = document.getElementById('preview-btn-pause-icon');
const previewBtnText    = document.getElementById('preview-btn-text');
const downloadMp3Btn    = document.getElementById('download-mp3-btn');

const progressWrap   = document.getElementById('progress-wrap');
const progressFill   = document.getElementById('progress-fill');
const progressLabel  = document.getElementById('progress-label');

// ── State ─────────────────────────────────────────────────
let currentTrack = null;
let toastTimer   = null;
let hlsPlayer    = null;
let isAudioPlaying = false;

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
  let url = urlInput.value.trim();
  if (!url) {
    showError('Vui lòng nhập hoặc dán link SoundCloud.');
    urlInput.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
    urlInput.value = url;
  }
  if (!isSoundCloudUrl(url)) {
    showError('Link không hợp lệ. Vui lòng dùng link từ soundcloud.com.');
    return;
  }
  await fetchTrack(url);
}

// ── Validate SoundCloud URL ───────────────────────────────
function isSoundCloudUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
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

  // Dừng bài hát trước đó nếu đang phát
  pauseAudio();
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }

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

  playerTotalTime.textContent = track.duration      || '0:00';
  playerCurrentTime.textContent = '0:00';
  playerProgressFill.style.width = '0%';
  playerProgressThumb.style.left = '0%';

  // Cấu hình nguồn phát nhạc preview
  if (track.streamData?.url) {
    setupAudioStream(track.streamData);
    audioPreview.style.display = 'block';
    previewBtn.style.display = 'inline-flex';
  } else {
    audioPreview.style.display = 'none';
    previewBtn.style.display = 'none';
    audioPlayer.src = '';
  }

  // Reset download button
  downloadMp3Btn.disabled = !track.streamData;
  progressWrap.style.display = 'none';
  progressFill.style.width   = '0%';
}

// ── Setup Audio Stream (HLS or Progressive) ───────────────
function setupAudioStream(streamData) {
  const { url, protocol } = streamData;

  if (protocol === 'hls') {
    if (window.Hls && Hls.isSupported()) {
      hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsPlayer.loadSource(url);
      hlsPlayer.attachMedia(audioPlayer);
      hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('HLS fatal error, fallback to proxy stream', data);
          audioPlayer.src = `/api/stream?url=${encodeURIComponent(url)}&protocol=hls`;
        }
      });
    } else if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS Native HLS
      audioPlayer.src = url;
    } else {
      // Fallback endpoint proxy
      audioPlayer.src = `/api/stream?url=${encodeURIComponent(url)}&protocol=hls`;
    }
  } else {
    // Progressive MP3
    audioPlayer.src = url;
  }
}

// ── Audio Controls & Sync UI ──────────────────────────────
function toggleAudio() {
  if (!currentTrack) return;
  if (!currentTrack.streamData) {
    showError('Không tìm thấy nguồn âm thanh cho bài hát này.');
    return;
  }

  if (isAudioPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

function playAudio() {
  audioPlayer.play().then(() => {
    isAudioPlaying = true;
    updateAudioUI(true);
  }).catch((err) => {
    console.error('Lỗi phát nhạc:', err);
    // Nếu link trực tiếp bị chặn CORS, thử fallback qua API backend stream
    if (currentTrack?.streamData?.url) {
      const fallbackUrl = `/api/stream?url=${encodeURIComponent(currentTrack.streamData.url)}&protocol=${currentTrack.streamData.protocol || 'progressive'}`;
      if (audioPlayer.src !== fallbackUrl) {
        audioPlayer.src = fallbackUrl;
        audioPlayer.play().then(() => {
          isAudioPlaying = true;
          updateAudioUI(true);
        }).catch((e) => showError('Không thể phát trước bài hát này: ' + e.message));
        return;
      }
    }
    showError('Không thể phát trước bài hát: ' + err.message);
  });
}

function pauseAudio() {
  audioPlayer.pause();
  isAudioPlaying = false;
  updateAudioUI(false);
}

function updateAudioUI(playing) {
  // Đồng bộ Artwork
  if (playing) {
    elArtworkWrap?.classList.add('is-playing');
    elArtworkPlayIcon.style.display = 'none';
    elArtworkPauseIcon.style.display = 'block';
  } else {
    elArtworkWrap?.classList.remove('is-playing');
    elArtworkPlayIcon.style.display = 'block';
    elArtworkPauseIcon.style.display = 'none';
  }

  // Đồng bộ Player controls
  if (playing) {
    ctrlPlayIcon.style.display = 'none';
    ctrlPauseIcon.style.display = 'block';
    soundWaveAnim?.classList.add('is-playing');
  } else {
    ctrlPlayIcon.style.display = 'block';
    ctrlPauseIcon.style.display = 'none';
    soundWaveAnim?.classList.remove('is-playing');
  }

  // Đồng bộ Action button "Nghe trước"
  if (playing) {
    previewBtn?.classList.add('is-playing');
    previewBtnPlayIcon.style.display = 'none';
    previewBtnPauseIcon.style.display = 'block';
    previewBtnText.textContent = 'Tạm dừng';
  } else {
    previewBtn?.classList.remove('is-playing');
    previewBtnPlayIcon.style.display = 'block';
    previewBtnPauseIcon.style.display = 'none';
    previewBtnText.textContent = 'Nghe trước';
  }
}

// Bấm vào Artwork để play/pause
elArtworkWrap?.addEventListener('click', toggleAudio);

// Bấm nút Play/Pause trên Player
playerMainBtn?.addEventListener('click', toggleAudio);

// Bấm nút "Nghe trước"
previewBtn?.addEventListener('click', toggleAudio);

// Cập nhật tiến trình phát nhạc
audioPlayer.addEventListener('timeupdate', () => {
  if (!audioPlayer.duration || isNaN(audioPlayer.duration)) return;

  const current = audioPlayer.currentTime;
  const total = audioPlayer.duration;
  playerCurrentTime.textContent = formatAudioSeconds(current);

  const pct = (current / total) * 100;
  playerProgressFill.style.width = pct + '%';
  playerProgressThumb.style.left = pct + '%';
});

// Khi tải xong metadata bài hát
audioPlayer.addEventListener('loadedmetadata', () => {
  if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
    playerTotalTime.textContent = formatAudioSeconds(audioPlayer.duration);
  }
});

// Khi bài hát phát hết
audioPlayer.addEventListener('ended', () => {
  isAudioPlaying = false;
  updateAudioUI(false);
  playerProgressFill.style.width = '0%';
  playerProgressThumb.style.left = '0%';
  playerCurrentTime.textContent = '0:00';
});

// Tua bài hát khi click vào timeline
progressContainer?.addEventListener('click', (e) => {
  if (!audioPlayer.duration || isNaN(audioPlayer.duration)) return;
  const rect = progressContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  audioPlayer.currentTime = pct * audioPlayer.duration;
  playerProgressFill.style.width = (pct * 100) + '%';
  playerProgressThumb.style.left = (pct * 100) + '%';
});

// Điều khiển Volume
volumeSlider?.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  audioPlayer.volume = val;
  audioPlayer.muted = (val === 0);
  updateVolumeUI(val > 0);
});

volumeToggleBtn?.addEventListener('click', () => {
  audioPlayer.muted = !audioPlayer.muted;
  if (audioPlayer.muted) {
    updateVolumeUI(false);
  } else {
    updateVolumeUI(audioPlayer.volume > 0);
  }
});

function updateVolumeUI(hasSound) {
  if (hasSound) {
    volHighIcon.style.display = 'block';
    volMuteIcon.style.display = 'none';
  } else {
    volHighIcon.style.display = 'none';
    volMuteIcon.style.display = 'block';
  }
}

function formatAudioSeconds(sec) {
  const s = Math.floor(sec || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
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
