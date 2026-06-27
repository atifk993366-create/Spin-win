// ═══════════════════════════════════════════════
//  SPIN WHEEL — admin.js
//  Same Supabase credentials as app.js
// ═══════════════════════════════════════════════

const SUPABASE_URL  = 'https://estpclhdmaznsbcgevln.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdHBjbGhkbWF6bnNiY2dldmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTAzMjUsImV4cCI6MjA5ODA4NjMyNX0.zGoZ71GuRcRQ8ZZyZVZfpvwTCgXKIJMYiBhygIHtpAo';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// Admin password (store hashed in production — this is local check)
const ADMIN_PHONE = ''; // will be loaded from DB

const $ = id => document.getElementById(id);
let adminAuthed = false;

// ── TOAST ────────────────────────────────────────
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2500);
}

// ── HASH ─────────────────────────────────────────
async function hashPwd(pwd) {
  const enc = new TextEncoder().encode(pwd);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── ADMIN LOGIN ───────────────────────────────────
$('btnAdminLogin').addEventListener('click', async () => {
  const phone = $('a-phone').value.trim();
  const pass  = $('a-pass').value.trim();
  if (!phone || !pass) return;

  // Fetch admin phone from settings
  const { data: setting } = await db.from('admin_settings').select('value').eq('key', 'admin_phone').single();
  const adminPhone = setting?.value || '';

  if (phone !== adminPhone) {
    $('a-err').style.display = 'block';
    $('a-err').textContent = 'Access denied.';
    return;
  }

  const hash = await hashPwd(pass);
  const { data: user } = await db.from('users').select().eq('phone', phone).eq('password_hash', hash).single();

  if (!user) {
    $('a-err').style.display = 'block';
    $('a-err').textContent = 'Invalid credentials.';
    return;
  }

  adminAuthed = true;
  $('admin-login').style.display = 'none';
  $('admin-panel').style.display = 'flex';
  loadDashboard();
});

// ── LOGOUT ───────────────────────────────────────
$('btnAdminLogout').addEventListener('click', () => {
  adminAuthed = false;
  $('admin-login').style.display = 'flex';
  $('admin-panel').style.display = 'none';
});

// ── NAV TABS ─────────────────────────────────────
document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    $(`tab-${el.dataset.tab}`).classList.add('active');

    switch (el.dataset.tab) {
      case 'dashboard': loadDashboard(); break;
      case 'slots':     loadSlots();     break;
      case 'settings':  loadSettings();  break;
      case 'leads':     loadLeads();     break;
      case 'winners':   loadWinners();   break;
      case 'ip':        loadIPData();    break;
    }
  });
});

// ── DASHBOARD ────────────────────────────────────
async function loadDashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const [{ count: users }, { count: spins }, { count: winners }, { data: leads }] = await Promise.all([
    db.from('users').select('*', { count: 'exact', head: true }),
    db.from('spin_results').select('*', { count: 'exact', head: true }),
    db.from('spin_results').select('*', { count: 'exact', head: true }).eq('won', true).gte('spun_at', today),
    db.from('users').select('phone')
  ]);

  $('stat-users').textContent   = users || 0;
  $('stat-spins').textContent   = spins || 0;
  $('stat-winners').textContent = winners || 0;
  $('stat-leads').textContent   = (leads || []).length;
}

// ── SLOTS ─────────────────────────────────────────
async function loadSlots() {
  const { data: slots } = await db.from('spin_slots').select().order('id');
  const tbody = $('slots-tbody');
  tbody.innerHTML = '';

  (slots || []).forEach(slot => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:13px">${slot.id}</td>
      <td><input type="text" value="${slot.name}" id="slot-name-${slot.id}" /></td>
      <td><input type="url" value="${slot.redirect_url || ''}" id="slot-url-${slot.id}" placeholder="https://yourstore.com/product" /></td>
      <td>
        <select id="slot-type-${slot.id}">
          <option value="true" ${slot.is_winner ? 'selected' : ''}>🏆 Winner</option>
          <option value="false" ${!slot.is_winner ? 'selected' : ''}>😔 Loser</option>
        </select>
      </td>
      <td><input type="number" value="${slot.weight}" id="slot-weight-${slot.id}" min="1" max="100" style="width:70px" /></td>
      <td><input type="color" value="${slot.color || '#FF6B6B'}" id="slot-color-${slot.id}" /></td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="saveSlot(${slot.id})">Save</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.saveSlot = async (id) => {
  const name    = $(`slot-name-${id}`).value.trim();
  const url     = $(`slot-url-${id}`).value.trim();
  const winner  = $(`slot-type-${id}`).value === 'true';
  const weight  = parseInt($(`slot-weight-${id}`).value) || 10;
  const color   = $(`slot-color-${id}`).value;

  if (!name) return toast('Slot name cannot be empty');

  const { error } = await db.from('spin_slots').update({
    name, redirect_url: url || null, is_winner: winner, weight, color,
    updated_at: new Date().toISOString()
  }).eq('id', id);

  if (error) toast('Error saving slot');
  else toast(`Slot ${id} saved ✓`);
};

// ── SETTINGS ─────────────────────────────────────
async function loadSettings() {
  const { data: settings } = await db.from('admin_settings').select();
  const cfg = {};
  (settings || []).forEach(s => cfg[s.key] = s.value);

  $('set-win-rate').value  = cfg['ip_win_rate']            || 10;
  $('set-max-wins').value  = cfg['max_wins_per_ip_per_day']|| 10;
  $('set-force-win').checked = cfg['force_next_win'] === 'true';
}

$('btnSaveSettings').addEventListener('click', async () => {
  const winRate = $('set-win-rate').value;
  const maxWins = $('set-max-wins').value;
  const forceWin = $('set-force-win').checked ? 'true' : 'false';

  await Promise.all([
    db.from('admin_settings').update({ value: winRate,   updated_at: new Date().toISOString() }).eq('key', 'ip_win_rate'),
    db.from('admin_settings').update({ value: maxWins,   updated_at: new Date().toISOString() }).eq('key', 'max_wins_per_ip_per_day'),
    db.from('admin_settings').update({ value: forceWin,  updated_at: new Date().toISOString() }).eq('key', 'force_next_win'),
  ]);
  toast('Settings saved ✓');
});

// ── LEADS ─────────────────────────────────────────
async function loadLeads() {
  const { data: users } = await db.from('users').select('phone, created_at, total_referrals, total_spins_used, spins_available').order('created_at', { ascending: false });
  const tbody = $('leads-tbody');
  tbody.innerHTML = '';

  (users || []).forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${u.phone}</td>
      <td style="color:var(--muted);font-size:13px">${new Date(u.created_at).toLocaleDateString('en-IN')}</td>
      <td>${u.total_referrals || 0}</td>
      <td>${u.total_spins_used || 0}</td>
      <td><span class="badge ${(u.spins_available||0)>0 ? 'badge-win' : 'badge-lose'}">${u.spins_available || 0}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

$('btnExportLeads').addEventListener('click', async () => {
  const { data: users } = await db.from('users').select('phone, created_at, total_referrals, total_spins_used').order('created_at', { ascending: false });
  if (!users) return;

  const rows = [['Phone', 'Joined', 'Referrals', 'Spins Used']];
  users.forEach(u => rows.push([u.phone, u.created_at, u.total_referrals || 0, u.total_spins_used || 0]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leads_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exported ✓');
});

// ── WINNERS ──────────────────────────────────────
async function loadWinners() {
  const { data: results } = await db
    .from('spin_results')
    .select(`spun_at, ip_address, won, slot_id, user_id, users(phone), spin_slots(name)`)
    .eq('won', true)
    .order('spun_at', { ascending: false })
    .limit(100);

  const tbody = $('winners-tbody');
  tbody.innerHTML = '';

  (results || []).forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${r.users?.phone || '—'}</td>
      <td><span class="badge badge-win">${r.spin_slots?.name || '—'}</span></td>
      <td style="color:var(--muted);font-size:13px">${new Date(r.spun_at).toLocaleString('en-IN')}</td>
      <td style="color:var(--muted);font-size:12px">${r.ip_address || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── IP DATA ───────────────────────────────────────
async function loadIPData() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: ips } = await db
    .from('ip_win_tracking')
    .select()
    .eq('date', today)
    .order('total_spins', { ascending: false });

  const tbody = $('ip-tbody');
  tbody.innerHTML = '';

  (ips || []).forEach(ip => {
    const rate = ip.total_spins > 0 ? ((ip.total_wins / ip.total_spins) * 100).toFixed(1) : '0.0';
    const tr   = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:monospace;font-size:13px">${ip.ip_address}</td>
      <td>${ip.total_spins}</td>
      <td>${ip.total_wins}</td>
      <td><span class="badge ${parseFloat(rate)>20 ? 'badge-win' : 'badge-lose'}">${rate}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}
