// ═══════════════════════════════════════════════════════
//  SPIN WHEEL — app.js
//  Replace SUPABASE_URL and SUPABASE_ANON_KEY below
// ═══════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://estpclhdmaznsbcgevln.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdHBjbGhkbWF6bnNiY2dldmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTAzMjUsImV4cCI6MjA5ODA4NjMyNX0.zGoZ71GuRcRQ8ZZyZVZfpvwTCgXKIJMYiBhygIHtpAo';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── STATE ────────────────────────────────────────────────
let currentUser  = null;
let slots        = [];
let isSpinning   = false;
let pendingPhone = null;   // phone awaiting OTP
let pendingMode  = null;   // 'register' | 'login'
let pendingData  = null;   // extra data during register

// ── HELPERS ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const show = id => { $('screen-register').classList.remove('active'); $('screen-otp').classList.remove('active'); $('screen-login').classList.remove('active'); $('screen-spin').classList.remove('active'); $(id).classList.add('active'); };

function showAlert(id, msg, type='error') {
  const el = $(id);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}
function hideAlert(id) { $(id).classList.remove('show'); }

function genReferralCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}

async function hashPassword(pwd) {
  const enc = new TextEncoder().encode(pwd);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function getUserIP() {
  // Returns a fingerprint-based pseudo-IP since real IP needs server
  const nav = navigator;
  const raw = [nav.language, nav.platform, screen.width, screen.height, nav.hardwareConcurrency].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  return 'fp_' + Math.abs(hash).toString(16);
}

// ── OTP via 2Factor (Voice Call — no DLT needed) ────────
const TWOFACTOR_KEY = '2503bcf6-237e-11f1-bcb0-0200cd936042';

async function sendOTP(phone) {
  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Invalidate old OTPs for this phone
  await db.from('otp_codes').update({ used: true }).eq('phone', phone).eq('used', false);

  // Store OTP in DB
  await db.from('otp_codes').insert({ phone, code, expires_at: expires });

  // Send via 2Factor Voice Call (works without DLT registration)
  try {
    const url = `https://2factor.in/API/V1/${TWOFACTOR_KEY}/VOICE/${phone}/${code}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.Status !== 'Success') {
      console.error('2Factor error:', data);
      return false;
    }
  } catch (err) {
    console.error('OTP send error:', err);
    return false;
  }

  return true;
}

async function verifyOTP(phone, code) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('otp_codes')
    .select()
    .eq('phone', phone)
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return false;

  await db.from('otp_codes').update({ used: true }).eq('id', data.id);
  return true;
}

// ── REFERRAL CODE FROM URL ────────────────────────────────
function getReferralFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('ref') || '';
}

// ── AUTH: REGISTER ────────────────────────────────────────
$('btnRegister').addEventListener('click', async () => {
  hideAlert('reg-error');
  const phone    = $('reg-phone').value.trim();
  const password = $('reg-password').value.trim();
  const refCode  = $('reg-referral').value.trim().toUpperCase();

  if (!/^\d{10}$/.test(phone)) return showAlert('reg-error', 'Enter a valid 10-digit mobile number.');
  if (password.length < 6)     return showAlert('reg-error', 'Password must be at least 6 characters.');

  // Check if phone already exists
  const { data: existing } = await db.from('users').select('id').eq('phone', phone).single();
  if (existing) return showAlert('reg-error', 'This number is already registered. Please sign in.');

  $('btnRegister').disabled = true;
  $('btnRegister').innerHTML = '<span class="loader"></span>Sending OTP…';

  await sendOTP(phone);

  pendingPhone = phone;
  pendingMode  = 'register';
  pendingData  = { password, refCode };

  $('otp-phone-hint').textContent = `OTP sent to +91 ${phone}`;
  $('btnRegister').disabled = false;
  $('btnRegister').textContent = 'Send OTP';
  show('screen-otp');
});

// ── AUTH: LOGIN ───────────────────────────────────────────
$('btnLogin').addEventListener('click', async () => {
  hideAlert('login-error');
  const phone    = $('login-phone').value.trim();
  const password = $('login-password').value.trim();

  if (!/^\d{10}$/.test(phone)) return showAlert('login-error', 'Enter a valid 10-digit mobile number.');
  if (!password)               return showAlert('login-error', 'Enter your password.');

  $('btnLogin').disabled = true;
  $('btnLogin').innerHTML = '<span class="loader"></span>Checking…';

  const hash = await hashPassword(password);
  const { data: user, error } = await db.from('users').select().eq('phone', phone).eq('password_hash', hash).single();

  $('btnLogin').disabled = false;
  $('btnLogin').textContent = 'Sign In';

  if (error || !user) return showAlert('login-error', 'Invalid phone or password.');
  if (!user.is_verified) return showAlert('login-error', 'Account not verified. Please register again.');

  // OTP login (optional second factor) — skip for returning users, just set session
  currentUser = user;
  await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
  localStorage.setItem('sw_uid', user.id);
  loadSpinScreen();
});

// ── AUTH: VERIFY OTP ──────────────────────────────────────
$('btnVerifyOtp').addEventListener('click', async () => {
  const code = $('otp-input').value.trim();
  if (code.length !== 6) return showAlert('otp-error', 'Enter the 6-digit OTP.');

  $('btnVerifyOtp').disabled = true;
  $('btnVerifyOtp').innerHTML = '<span class="loader"></span>Verifying…';

  const valid = await verifyOTP(pendingPhone, code);
  if (!valid) {
    $('btnVerifyOtp').disabled = false;
    $('btnVerifyOtp').textContent = 'Verify & Continue';
    return showAlert('otp-error', 'Invalid or expired OTP. Try again.');
  }

  if (pendingMode === 'register') {
    await completeRegistration();
  }

  $('btnVerifyOtp').disabled = false;
  $('btnVerifyOtp').textContent = 'Verify & Continue';
});

$('btnResendOtp').addEventListener('click', async () => {
  if (!pendingPhone) return;
  await sendOTP(pendingPhone);
  showAlert('otp-error', 'OTP resent!', 'success');
});

// ── COMPLETE REGISTRATION ─────────────────────────────────
async function completeRegistration() {
  const { password, refCode } = pendingData;
  const hash = await hashPassword(password);
  const ip   = getUserIP();

  // Check if referral code is valid
  let referrerId = null;
  if (refCode) {
    const { data: referrer } = await db.from('users').select('id').eq('referral_code', refCode).single();
    if (referrer) referrerId = referrer.id;
  }

  const newUser = {
    phone:         pendingPhone,
    password_hash: hash,
    is_verified:   true,
    referral_code: genReferralCode(),
    referred_by:   referrerId,
    spins_available: 1,
    ip_address:    ip,
    created_at:    new Date().toISOString()
  };

  const { data: created, error } = await db.from('users').insert(newUser).select().single();
  if (error) { showAlert('otp-error', 'Registration failed. Try again.'); return; }

  // Insert referral record & update referrer count
  if (referrerId) {
    await db.from('referrals').insert({ referrer_id: referrerId, referred_user_id: created.id });
    await db.rpc('handle_referral_completion', { referrer_uuid: referrerId });
  }

  currentUser = created;
  localStorage.setItem('sw_uid', created.id);
  loadSpinScreen();
}

// ── LOAD SPIN SCREEN ──────────────────────────────────────
async function loadSpinScreen() {
  // Fetch fresh user data
  const { data: user } = await db.from('users').select().eq('id', currentUser.id).single();
  currentUser = user;

  // Fetch slots
  const { data: slotData } = await db.from('spin_slots').select().order('id');
  slots = slotData || [];

  drawWheel();
  updateSpinUI();
  show('screen-spin');
}

function updateSpinUI() {
  $('spinsLeft').textContent = currentUser.spins_available || 0;
  $('referralCodeDisplay').textContent = currentUser.referral_code || '---';
  const refCount = currentUser.total_referrals || 0;
  $('referralCount').textContent = refCount % 10;
}

// ── WHEEL DRAWING ─────────────────────────────────────────
const SLOT_COLORS = [
  '#E63946','#F4A261','#E9C46A','#2A9D8F',
  '#457B9D','#9B5DE5','#F15BB5','#00BBF9',
  '#00F5D4','#FEE440'
];

function drawWheel(rotation = 0) {
  const canvas = $('wheel');
  const ctx    = canvas.getContext('2d');
  const cx     = canvas.width / 2;
  const cy     = canvas.height / 2;
  const r      = cx - 10;
  const arc    = (2 * Math.PI) / slots.length;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  slots.forEach((slot, i) => {
    const start = rotation + i * arc - Math.PI / 2;
    const end   = start + arc;

    // Segment
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = slot.color || SLOT_COLORS[i % SLOT_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${slots.length > 8 ? 11 : 13}px 'Segoe UI', sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = 3;

    const text  = slot.name;
    const maxW  = r - 40;
    let display = text;
    if (ctx.measureText(text).width > maxW) {
      while (ctx.measureText(display + '…').width > maxW && display.length > 0) {
        display = display.slice(0, -1);
      }
      display += '…';
    }
    ctx.fillText(display, r - 16, 5);
    ctx.restore();
  });

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, 2 * Math.PI);
  ctx.fillStyle = '#0D0D0F';
  ctx.fill();
  ctx.strokeStyle = '#C8A96E';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ── SPIN LOGIC ────────────────────────────────────────────
$('btnSpin').addEventListener('click', async () => {
  if (isSpinning) return;
  if ((currentUser.spins_available || 0) < 1) {
    alert('No spins left! Refer 10 friends to earn a spin.');
    return;
  }

  isSpinning = true;
  $('btnSpin').disabled = true;
  $('btnSpin').textContent = '…';

  // Deduct spin immediately (prevents double spin)
  await db.from('users').update({ spins_available: currentUser.spins_available - 1, total_spins_used: (currentUser.total_spins_used || 0) + 1 }).eq('id', currentUser.id);

  // Determine result from backend logic
  const result = await determineSpinResult();

  // Animate wheel to the result slot
  await animateWheel(result.slotIndex);

  // Record result
  await db.from('spin_results').insert({
    user_id:      currentUser.id,
    slot_id:      slots[result.slotIndex].id,
    ip_address:   getUserIP(),
    won:          result.won,
    redirect_url: result.redirectUrl,
    spun_at:      new Date().toISOString()
  });

  // Refresh user state
  const { data: freshUser } = await db.from('users').select().eq('id', currentUser.id).single();
  currentUser = freshUser;
  updateSpinUI();

  isSpinning = false;
  $('btnSpin').disabled = false;
  $('btnSpin').textContent = 'SPIN!';

  if (result.won) {
    showWin(slots[result.slotIndex], result.redirectUrl);
  } else {
    showLose();
  }
});

// ── DETERMINE RESULT ──────────────────────────────────────
async function determineSpinResult() {
  const ip = getUserIP();

  // Fetch admin settings
  const { data: settings } = await db.from('admin_settings').select();
  const cfg = {};
  (settings || []).forEach(s => cfg[s.key] = s.value);

  const forceWin = cfg['force_next_win'] === 'true';
  const winRate  = parseInt(cfg['ip_win_rate'] || '10');
  const maxWins  = parseInt(cfg['max_wins_per_ip_per_day'] || '10');

  // Check IP win tracking
  const today = new Date().toISOString().slice(0, 10);
  let { data: ipTrack } = await db.from('ip_win_tracking').select().eq('ip_address', ip).eq('date', today).single();

  if (!ipTrack) {
    await db.from('ip_win_tracking').insert({ ip_address: ip, date: today, total_spins: 0, total_wins: 0 });
    ipTrack = { total_spins: 0, total_wins: 0 };
  }

  // Increment spins
  await db.from('ip_win_tracking').update({ total_spins: ipTrack.total_spins + 1 }).eq('ip_address', ip).eq('date', today);

  // Determine win/lose
  let shouldWin = false;

  if (forceWin) {
    shouldWin = true;
    // Reset force_next_win
    await db.from('admin_settings').update({ value: 'false' }).eq('key', 'force_next_win');
  } else if (ipTrack.total_wins < maxWins) {
    // Win rate check: wins so far / total spins should stay <= winRate%
    const ratio = (ipTrack.total_wins + 1) / (ipTrack.total_spins + 1);
    shouldWin = ratio <= winRate / 100;
  }

  // Pick slot
  let slotIndex;
  const winnerSlots = slots.map((s, i) => ({ s, i })).filter(x => x.s.is_winner);
  const loserSlots  = slots.map((s, i) => ({ s, i })).filter(x => !x.s.is_winner);

  if (shouldWin && winnerSlots.length > 0) {
    // Weighted random from winner slots
    const totalWeight = winnerSlots.reduce((sum, x) => sum + (x.s.weight || 10), 0);
    let rand = Math.random() * totalWeight;
    slotIndex = winnerSlots[winnerSlots.length - 1].i;
    for (const x of winnerSlots) {
      rand -= (x.s.weight || 10);
      if (rand <= 0) { slotIndex = x.i; break; }
    }
    await db.from('ip_win_tracking').update({ total_wins: ipTrack.total_wins + 1 }).eq('ip_address', ip).eq('date', today);
  } else {
    // Pick a loser slot
    slotIndex = loserSlots.length > 0
      ? loserSlots[Math.floor(Math.random() * loserSlots.length)].i
      : Math.floor(Math.random() * slots.length);
  }

  return {
    won:         shouldWin && slots[slotIndex]?.is_winner,
    slotIndex,
    redirectUrl: slots[slotIndex]?.redirect_url || null
  };
}

// ── ANIMATE WHEEL ─────────────────────────────────────────
function animateWheel(targetSlotIndex) {
  return new Promise(resolve => {
    const arc          = (2 * Math.PI) / slots.length;
    const targetAngle  = arc * targetSlotIndex + arc / 2; // center of target slot
    const minSpins     = 5;
    const totalRotation = minSpins * 2 * Math.PI + (2 * Math.PI - targetAngle);

    const duration  = 5000;
    const startTime = performance.now();
    let   lastRot   = 0;

    function easeOut(t) {
      return 1 - Math.pow(1 - t, 4);
    }

    function frame(now) {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const rotation = easeOut(progress) * totalRotation;
      lastRot = rotation;
      drawWheel(rotation % (2 * Math.PI));

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        // Snap exactly to target
        drawWheel((2 * Math.PI - targetAngle) % (2 * Math.PI));
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// ── WIN / LOSE UI ─────────────────────────────────────────
function showWin(slot, redirectUrl) {
  $('winPrizeName').textContent = slot.name;
  $('winOverlay').classList.add('show');
  startConfetti();

  const url    = redirectUrl || slot.redirect_url || '#';
  let seconds  = 5;
  $('redirectCountdown').textContent = seconds;

  const timer = setInterval(() => {
    seconds--;
    $('redirectCountdown').textContent = seconds;
    if (seconds <= 0) {
      clearInterval(timer);
      window.location.href = url;
    }
  }, 1000);

  $('btnGoToStore').onclick = () => { clearInterval(timer); window.location.href = url; };
}

function showLose() {
  $('loseOverlay').classList.add('show');
}

$('btnCloseLose').addEventListener('click', () => {
  $('loseOverlay').classList.remove('show');
});

// ── CONFETTI ──────────────────────────────────────────────
function startConfetti() {
  const canvas = $('confettiCanvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -10,
    r: Math.random() * 8 + 4,
    d: Math.random() * 2 + 1,
    color: ['#C8A96E','#E8C98E','#FF6B6B','#48DBFB','#FECA57','#FF9FF3'][Math.floor(Math.random()*6)],
    tilt: Math.random() * 20 - 10,
    tiltSpeed: Math.random() * 0.2 - 0.1
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.y += p.d + Math.sin(frame * 0.01 + p.x) * 0.5;
      p.tilt += p.tiltSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.tilt * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r / 2);
      ctx.restore();
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
    });
    frame++;
    if (frame < 300) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

// ── REFERRAL CODE COPY ────────────────────────────────────
$('referralCodeDisplay').addEventListener('click', () => {
  if (!currentUser?.referral_code) return;
  const url = `${window.location.origin}${window.location.pathname}?ref=${currentUser.referral_code}`;
  navigator.clipboard.writeText(url).then(() => {
    $('referralCodeDisplay').textContent = 'Copied!';
    setTimeout(() => { $('referralCodeDisplay').textContent = currentUser.referral_code; }, 1500);
  });
});

// ── LOGOUT ────────────────────────────────────────────────
$('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('sw_uid');
  currentUser = null;
  show('screen-login');
});

// ── NAVIGATION ────────────────────────────────────────────
$('goLogin').addEventListener('click', e => { e.preventDefault(); show('screen-login'); });
$('goRegister').addEventListener('click', e => { e.preventDefault(); show('screen-register'); });

// ── AUTO-FILL REFERRAL FROM URL ───────────────────────────
const urlRef = getReferralFromURL();
if (urlRef) {
  $('ref-field').style.display = 'flex';
  $('reg-referral').value = urlRef;
} else {
  $('ref-field').style.display = 'flex'; // always show so user can manually enter
}

// ── AUTO LOGIN (session persist) ──────────────────────────
(async () => {
  const uid = localStorage.getItem('sw_uid');
  if (uid) {
    const { data: user } = await db.from('users').select().eq('id', uid).single();
    if (user && user.is_verified) {
      currentUser = user;
      await loadSpinScreen();
      return;
    }
  }
  show('screen-register');
})();
