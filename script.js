// ============================================================
// Supabase client
// ============================================================
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

if (String(SUPABASE_URL).includes('YOUR-PROJECT-REF')) {
  console.warn('Gift Card Manager: set your Supabase URL and anon key in config.js.');
}

// ============================================================
// State
// ============================================================
const state = {
  session: null,
  cards: [],
  receipts: [],
  signedUrls: {},
};

let authMode = 'signin';
let lastAuthEmail = '';
let editingCardId = null;
let editingReceiptId = null;
let pendingReceiptFile = null;

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(n) {
  const v = Number.isFinite(n) ? n : 0;
  return '$' + v.toFixed(2);
}

function formatExpiry(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const FOILS = [
  { a: '#efc6c9', b: '#c98a8e' }, // rose gold
  { a: '#e3e3e3', b: '#a8a8a8' }, // silver
  { a: '#3f8d78', b: '#1b4238' }, // emerald
  { a: '#3c5c8f', b: '#16233a' }, // sapphire
  { a: '#c97a49', b: '#7a3e1d' }, // copper
  { a: '#ecdfae', b: '#b8a362' }, // champagne
];

function pickFoil(id) {
  return FOILS[hashString(id) % FOILS.length];
}

function pickTilt(id) {
  const h = hashString(id + 'tilt');
  return ((h % 7) - 3) * 0.6; // -1.8deg .. 1.8deg
}

function computeSpentMap(receipts) {
  const map = {};
  receipts.forEach((r) => {
    map[r.card_id] = (map[r.card_id] || 0) + Number(r.amount);
  });
  return map;
}

function barWidth(initial, remaining) {
  if (!initial || initial <= 0) return 0;
  const pct = (remaining / initial) * 100;
  return Math.max(0, Math.min(100, pct));
}

function toast(message, type = 'info') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ============================================================
// Auth — view state machine
// ============================================================
function setAuthMode(mode) {
  authMode = mode;

  const subtitle = document.getElementById('authSubtitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const fieldEmail = document.getElementById('fieldEmail');
  const fieldPassword = document.getElementById('fieldPassword');
  const fieldPasswordConfirm = document.getElementById('fieldPasswordConfirm');
  const passwordInput = document.getElementById('authPassword');
  const forgotBtn = document.getElementById('authForgotBtn');
  const toggleBtn = document.getElementById('authToggleBtn');
  const backBtn = document.getElementById('authBackBtn');
  const resendBtn = document.getElementById('authResendBtn');
  const form = document.getElementById('authForm');
  const message = document.getElementById('authMessage');
  const error = document.getElementById('authError');

  error.hidden = true;
  message.hidden = true;
  form.hidden = false;
  fieldEmail.hidden = false;
  fieldPassword.hidden = false;
  fieldPasswordConfirm.hidden = true;
  forgotBtn.hidden = true;
  toggleBtn.hidden = true;
  backBtn.hidden = true;
  resendBtn.hidden = true;
  submitBtn.hidden = false;
  passwordInput.required = true;
  passwordInput.placeholder = '';

  if (mode === 'signin') {
    subtitle.textContent = 'Sign in to your wallet';
    submitBtn.textContent = 'Sign in';
    forgotBtn.hidden = false;
    toggleBtn.hidden = false;
    toggleBtn.textContent = 'Need an account? Create one';
  } else if (mode === 'signup') {
    subtitle.textContent = 'Create your wallet';
    submitBtn.textContent = 'Create account';
    fieldPasswordConfirm.hidden = false;
    toggleBtn.hidden = false;
    toggleBtn.textContent = 'Already have an account? Sign in';
  } else if (mode === 'forgot') {
    subtitle.textContent = 'Reset your password';
    submitBtn.textContent = 'Send reset link';
    fieldPassword.hidden = true;
    passwordInput.required = false;
    backBtn.hidden = false;
  } else if (mode === 'confirm') {
    subtitle.textContent = 'Almost there';
    form.hidden = true;
    message.hidden = false;
    message.textContent = 'Check your email for a confirmation link to activate your wallet.';
    backBtn.hidden = false;
    resendBtn.hidden = false;
  } else if (mode === 'reset') {
    subtitle.textContent = 'Choose a new password';
    submitBtn.textContent = 'Update password';
    fieldEmail.hidden = true;
    fieldPasswordConfirm.hidden = false;
    passwordInput.placeholder = 'New password';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('authError');
  errorEl.hidden = true;

  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const passwordConfirm = document.getElementById('authPasswordConfirm').value;
  const submitBtn = document.getElementById('authSubmitBtn');

  try {
    submitBtn.disabled = true;

    if (authMode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (authMode === 'signup') {
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (password !== passwordConfirm) throw new Error("Passwords don't match.");
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      lastAuthEmail = email;
      if (!data.session) setAuthMode('confirm');
    } else if (authMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
      if (error) throw error;
      document.getElementById('authForm').hidden = true;
      const message = document.getElementById('authMessage');
      message.textContent = 'If that email has an account, a reset link is on its way.';
      message.hidden = false;
    } else if (authMode === 'reset') {
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (password !== passwordConfirm) throw new Error("Passwords don't match.");
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      toast('Password updated');
      setAuthMode('signin');
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Something went wrong.';
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleResendConfirmation() {
  if (!lastAuthEmail) {
    toast('Sign up again first, then resend.', 'error');
    return;
  }
  try {
    const { error } = await sb.auth.resend({ type: 'signup', email: lastAuthEmail });
    if (error) throw error;
    toast('Confirmation email resent');
  } catch (err) {
    toast(err.message || 'Could not resend email.', 'error');
  }
}

function showApp(session) {
  state.session = session;
  document.getElementById('authView').hidden = true;
  document.getElementById('appView').hidden = false;
  document.getElementById('userEmail').textContent = session.user.email;
  loadData();
}

function showAuth() {
  state.session = null;
  document.getElementById('appView').hidden = true;
  document.getElementById('authView').hidden = false;
  if (authMode !== 'reset') setAuthMode('signin');
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    document.getElementById('appView').hidden = true;
    document.getElementById('authView').hidden = false;
    setAuthMode('reset');
    return;
  }
  if (session) {
    showApp(session);
  } else {
    showAuth();
  }
});

// ============================================================
// Data loading
// ============================================================
async function loadData() {
  const [{ data: cards, error: cardsError }, { data: receipts, error: receiptsError }] = await Promise.all([
    sb.from('cards').select('*').order('created_at', { ascending: false }),
    sb.from('receipts').select('*').order('created_at', { ascending: false }),
  ]);

  if (cardsError) { toast(cardsError.message, 'error'); return; }
  if (receiptsError) { toast(receiptsError.message, 'error'); return; }

  state.cards = cards || [];
  state.receipts = receipts || [];
  state.signedUrls = await getSignedUrls(state.receipts);

  renderCards();
  renderReceipts();
  updateStats();
  document.getElementById('noCardsHint').hidden = state.cards.length > 0;
}

async function getSignedUrls(receipts) {
  const withImages = receipts.filter((r) => r.image_path);
  if (!withImages.length) return {};
  const entries = await Promise.all(
    withImages.map(async (r) => {
      const { data, error } = await sb.storage.from('receipts').createSignedUrl(r.image_path, 3600);
      return [r.id, error ? null : data.signedUrl];
    })
  );
  return Object.fromEntries(entries);
}

// ============================================================
// Rendering
// ============================================================
function renderCards() {
  const grid = document.getElementById('cardsGrid');
  const empty = document.getElementById('cardsEmpty');
  const addBtn = document.getElementById('addCardBtn');

  grid.querySelectorAll('.card-tile').forEach((el) => el.remove());
  empty.hidden = state.cards.length > 0;

  const spentMap = computeSpentMap(state.receipts);
  const today = startOfToday();

  state.cards.forEach((card) => {
    const spent = spentMap[card.id] || 0;
    const remaining = Number(card.initial_amount) - spent;
    const isExpired = card.expiry && new Date(card.expiry) < today;
    const foil = pickFoil(card.id);
    const tilt = pickTilt(card.id);
    const last4 = (card.card_number || '').replace(/\s/g, '').slice(-4);

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'card-tile';
    tile.style.setProperty('--foil-a', foil.a);
    tile.style.setProperty('--foil-b', foil.b);
    tile.style.setProperty('--tilt', tilt + 'deg');
    tile.setAttribute('aria-label', `Edit ${card.name}`);

    tile.innerHTML = `
      <div class="card-tile__top">
        <div class="card-tile__chip"></div>
        ${isExpired ? '<span class="card-tile__badge">Expired</span>' : '<span></span>'}
      </div>
      <div class="card-tile__bottom">
        <div class="card-tile__name">${escapeHtml(card.name)}</div>
        ${last4 ? `<div class="card-tile__number">•••• ${last4}</div>` : ''}
        <div class="card-tile__bar"><div class="card-tile__bar-fill" style="width:${barWidth(card.initial_amount, remaining)}%"></div></div>
        <div class="card-tile__balance-row">
          <span class="card-tile__balance">${formatMoney(remaining)}</span>
          ${card.expiry ? `<span class="card-tile__expiry">${formatExpiry(card.expiry)}</span>` : '<span></span>'}
        </div>
      </div>
    `;
    tile.addEventListener('click', () => openCardDialog(card.id));
    grid.insertBefore(tile, addBtn);
  });
}

function renderReceipts() {
  const grid = document.getElementById('receiptsGrid');
  const empty = document.getElementById('receiptsEmpty');
  grid.innerHTML = '';
  empty.hidden = state.receipts.length > 0;

  const cardById = Object.fromEntries(state.cards.map((c) => [c.id, c]));

  state.receipts.forEach((r) => {
    const card = cardById[r.card_id];
    const url = state.signedUrls[r.id];

    const slip = document.createElement('button');
    slip.type = 'button';
    slip.className = 'receipt-slip';
    slip.setAttribute('aria-label', 'Edit receipt');
    slip.innerHTML = `
      ${url ? `<img src="${url}" class="receipt-slip__img" alt="Receipt photo">` : '<div class="receipt-slip__img"></div>'}
      <div class="receipt-slip__amount">–${formatMoney(r.amount)}</div>
      <div class="receipt-slip__meta">
        ${card ? escapeHtml(card.name) : 'Deleted card'}<br>
        ${new Date(r.created_at).toLocaleDateString()}
        ${r.notes ? `<br>${escapeHtml(r.notes)}` : ''}
      </div>
    `;
    slip.addEventListener('click', () => openReceiptDialog(r.id));
    grid.appendChild(slip);
  });
}

function updateStats() {
  const spentMap = computeSpentMap(state.receipts);
  const today = startOfToday();
  let totalBalance = 0;
  let totalSpent = 0;
  let active = 0;

  state.cards.forEach((card) => {
    const spent = spentMap[card.id] || 0;
    totalBalance += Number(card.initial_amount) - spent;
    totalSpent += spent;
    const isExpired = card.expiry && new Date(card.expiry) < today;
    if (!isExpired) active++;
  });

  document.getElementById('statBalance').textContent = formatMoney(totalBalance);
  document.getElementById('statActive').textContent = String(active);
  document.getElementById('statSpent').textContent = formatMoney(totalSpent);
}

// ============================================================
// Card dialog
// ============================================================
function openCardDialog(cardId) {
  editingCardId = cardId;
  const dialog = document.getElementById('cardDialog');
  const title = document.getElementById('cardDialogTitle');
  const deleteBtn = document.getElementById('cardDeleteBtn');
  document.getElementById('cardError').hidden = true;

  if (cardId) {
    const card = state.cards.find((c) => c.id === cardId);
    title.textContent = 'Edit card';
    deleteBtn.hidden = false;
    document.getElementById('cardName').value = card.name || '';
    document.getElementById('cardNumber').value = card.card_number || '';
    document.getElementById('cardPin').value = card.pin || '';
    document.getElementById('cardAmount').value = card.initial_amount;
    document.getElementById('cardExpiry').value = card.expiry || '';
    document.getElementById('cardNotes').value = card.notes || '';
  } else {
    title.textContent = 'Add a card';
    deleteBtn.hidden = true;
    document.getElementById('cardForm').reset();
  }
  dialog.showModal();
}

async function handleCardSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('cardError');
  const name = document.getElementById('cardName').value.trim();
  const amount = parseFloat(document.getElementById('cardAmount').value);

  if (!name || isNaN(amount) || amount < 0) {
    errorEl.textContent = 'Enter a card name and a valid starting balance.';
    errorEl.hidden = false;
    return;
  }

  const payload = {
    name,
    card_number: document.getElementById('cardNumber').value.trim() || null,
    pin: document.getElementById('cardPin').value.trim() || null,
    initial_amount: amount,
    expiry: document.getElementById('cardExpiry').value || null,
    notes: document.getElementById('cardNotes').value.trim() || null,
  };

  const saveBtn = document.getElementById('cardSaveBtn');
  saveBtn.disabled = true;

  try {
    if (editingCardId) {
      const { error } = await sb.from('cards').update(payload).eq('id', editingCardId);
      if (error) throw error;
      toast('Card updated');
    } else {
      payload.user_id = state.session.user.id;
      const { error } = await sb.from('cards').insert(payload);
      if (error) throw error;
      toast('Card added');
    }
    document.getElementById('cardDialog').close();
    await loadData();
  } catch (err) {
    errorEl.textContent = err.message || 'Something went wrong saving this card.';
    errorEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
}

async function handleCardDelete() {
  if (!editingCardId) return;
  const cardReceipts = state.receipts.filter((r) => r.card_id === editingCardId);
  const confirmMsg = cardReceipts.length
    ? `Delete this card and its ${cardReceipts.length} receipt${cardReceipts.length === 1 ? '' : 's'}? This can't be undone.`
    : "Delete this card? This can't be undone.";
  if (!confirm(confirmMsg)) return;

  try {
    const paths = cardReceipts.map((r) => r.image_path).filter(Boolean);
    if (paths.length) await sb.storage.from('receipts').remove(paths);
    const { error } = await sb.from('cards').delete().eq('id', editingCardId);
    if (error) throw error;
    document.getElementById('cardDialog').close();
    toast('Card deleted');
    await loadData();
  } catch (err) {
    toast(err.message || 'Could not delete this card.', 'error');
  }
}

// ============================================================
// Receipt dialog
// ============================================================
function populateReceiptCardSelect(selectedId) {
  const select = document.getElementById('receiptCard');
  select.innerHTML = state.cards
    .map((c) => {
      const last4 = (c.card_number || '').replace(/\s/g, '').slice(-4);
      const label = last4 ? `${c.name} (••••${last4})` : c.name;
      return `<option value="${c.id}">${escapeHtml(label)}</option>`;
    })
    .join('');
  if (selectedId) select.value = selectedId;
}

function openReceiptDialog(receiptId, previewDataUrl) {
  editingReceiptId = receiptId;
  const dialog = document.getElementById('receiptDialog');
  const title = document.getElementById('receiptDialogTitle');
  const deleteBtn = document.getElementById('receiptDeleteBtn');
  const preview = document.getElementById('receiptPreview');
  const ocrStatus = document.getElementById('ocrStatus');

  document.getElementById('receiptError').hidden = true;
  ocrStatus.hidden = true;
  preview.hidden = true;

  if (receiptId) {
    const r = state.receipts.find((x) => x.id === receiptId);
    title.textContent = 'Edit receipt';
    deleteBtn.hidden = false;
    populateReceiptCardSelect(r.card_id);
    document.getElementById('receiptAmount').value = r.amount;
    document.getElementById('receiptNotes').value = r.notes || '';
    const url = state.signedUrls[r.id];
    if (url) {
      preview.src = url;
      preview.hidden = false;
    }
  } else {
    title.textContent = 'New receipt';
    deleteBtn.hidden = true;
    document.getElementById('receiptForm').reset();
    populateReceiptCardSelect(state.cards[0]?.id);
    if (previewDataUrl) {
      preview.src = previewDataUrl;
      preview.hidden = false;
    }
  }
  dialog.showModal();
}

function handleFileChosen(file) {
  if (!file) return;
  if (state.cards.length === 0) {
    toast('Add a gift card first.', 'error');
    return;
  }
  if (!file.type.startsWith('image/')) {
    toast('Please choose an image file.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast('Image must be under 5MB.', 'error');
    return;
  }

  pendingReceiptFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    openReceiptDialog(null, e.target.result);
    runOcr(file);
  };
  reader.readAsDataURL(file);
}

async function runOcr(file) {
  const status = document.getElementById('ocrStatus');
  status.hidden = false;
  status.textContent = 'Scanning receipt…';
  try {
    const result = await Tesseract.recognize(file, 'eng');
    const guess = guessAmountFromText(result.data.text);
    if (guess != null) {
      document.getElementById('receiptAmount').value = guess.toFixed(2);
      status.textContent = `Detected total: ${formatMoney(guess)} — double check before saving.`;
    } else {
      status.textContent = "Couldn't detect an amount — enter it manually.";
    }
  } catch (err) {
    status.textContent = "Couldn't scan this receipt — enter the amount manually.";
  }
}

function guessAmountFromText(text) {
  const lines = text.split('\n');
  const moneyRegex = /\$?\s?(\d{1,4}(?:[.,]\d{2}))\b/g;
  const all = [];
  let totalMatch = null;

  lines.forEach((line) => {
    for (const m of line.matchAll(moneyRegex)) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(val)) {
        all.push(val);
        if (totalMatch == null && /total/i.test(line)) totalMatch = val;
      }
    }
  });

  if (totalMatch != null) return totalMatch;
  if (all.length) return Math.max(...all);
  return null;
}

async function handleReceiptSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('receiptError');
  const amount = parseFloat(document.getElementById('receiptAmount').value);
  const cardId = document.getElementById('receiptCard').value;
  const notes = document.getElementById('receiptNotes').value.trim() || null;

  if (!cardId) {
    errorEl.textContent = 'Choose a card for this receipt.';
    errorEl.hidden = false;
    return;
  }
  if (isNaN(amount) || amount < 0) {
    errorEl.textContent = 'Enter a valid amount.';
    errorEl.hidden = false;
    return;
  }

  const saveBtn = document.getElementById('receiptSaveBtn');
  saveBtn.disabled = true;

  try {
    if (editingReceiptId) {
      const { error } = await sb.from('receipts').update({ amount, card_id: cardId, notes }).eq('id', editingReceiptId);
      if (error) throw error;
      toast('Receipt updated');
    } else {
      let imagePath = null;
      if (pendingReceiptFile) {
        const ext = (pendingReceiptFile.name.split('.').pop() || 'jpg').toLowerCase();
        imagePath = `${state.session.user.id}/${genId()}.${ext}`;
        const { error: uploadError } = await sb.storage.from('receipts').upload(imagePath, pendingReceiptFile);
        if (uploadError) throw uploadError;
      }
      const { error } = await sb.from('receipts').insert({
        user_id: state.session.user.id,
        card_id: cardId,
        amount,
        notes,
        image_path: imagePath,
      });
      if (error) throw error;
      toast('Receipt saved');
    }
    document.getElementById('receiptDialog').close();
    pendingReceiptFile = null;
    await loadData();
  } catch (err) {
    errorEl.textContent = err.message || 'Something went wrong saving this receipt.';
    errorEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
}

async function handleReceiptDelete() {
  if (!editingReceiptId) return;
  if (!confirm("Delete this receipt? This can't be undone.")) return;

  const receipt = state.receipts.find((r) => r.id === editingReceiptId);
  try {
    if (receipt?.image_path) await sb.storage.from('receipts').remove([receipt.image_path]);
    const { error } = await sb.from('receipts').delete().eq('id', editingReceiptId);
    if (error) throw error;
    document.getElementById('receiptDialog').close();
    toast('Receipt deleted');
    await loadData();
  } catch (err) {
    toast(err.message || 'Could not delete this receipt.', 'error');
  }
}

// ============================================================
// Tabs
// ============================================================
function switchTab(tab) {
  const walletBtn = document.getElementById('tabWalletBtn');
  const receiptsBtn = document.getElementById('tabReceiptsBtn');
  const walletPanel = document.getElementById('walletPanel');
  const receiptsPanel = document.getElementById('receiptsPanel');
  const isWallet = tab === 'wallet';

  walletBtn.classList.toggle('active', isWallet);
  receiptsBtn.classList.toggle('active', !isWallet);
  walletBtn.setAttribute('aria-selected', String(isWallet));
  receiptsBtn.setAttribute('aria-selected', String(!isWallet));
  walletPanel.hidden = !isWallet;
  receiptsPanel.hidden = isWallet;
}

// ============================================================
// Event wiring
// ============================================================
document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
document.getElementById('authToggleBtn').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
document.getElementById('authForgotBtn').addEventListener('click', () => setAuthMode('forgot'));
document.getElementById('authBackBtn').addEventListener('click', () => setAuthMode('signin'));
document.getElementById('authResendBtn').addEventListener('click', handleResendConfirmation);

document.getElementById('signOutBtn').addEventListener('click', () => sb.auth.signOut());

document.getElementById('tabWalletBtn').addEventListener('click', () => switchTab('wallet'));
document.getElementById('tabReceiptsBtn').addEventListener('click', () => switchTab('receipts'));

document.getElementById('addCardBtn').addEventListener('click', () => openCardDialog(null));
document.getElementById('cardForm').addEventListener('submit', handleCardSubmit);
document.getElementById('cardCancelBtn').addEventListener('click', () => document.getElementById('cardDialog').close());
document.getElementById('cardDeleteBtn').addEventListener('click', handleCardDelete);

document.getElementById('receiptForm').addEventListener('submit', handleReceiptSubmit);
document.getElementById('receiptCancelBtn').addEventListener('click', () => document.getElementById('receiptDialog').close());
document.getElementById('receiptDeleteBtn').addEventListener('click', handleReceiptDelete);

[document.getElementById('cardDialog'), document.getElementById('receiptDialog')].forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
});

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('click', () => {
  if (state.cards.length === 0) {
    toast('Add a gift card first.', 'error');
    return;
  }
  fileInput.click();
});
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    dropzone.click();
  }
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFileChosen(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  handleFileChosen(e.target.files[0]);
  fileInput.value = '';
});
