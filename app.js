/* ゆるつな フロントエンド */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const FRONT_VERSION = '1.0.0';
  const TOKEN_KEY = 'yurutsuna_token';
  const MAX_TAGS = 10;

  const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

  const HOBBIES = [
    ['☕','カフェ'],['🚶','散歩'],['♨️','サウナ'],['🎮','ゲーム'],['📚','読書'],['📷','写真'],
    ['🍜','食べ歩き'],['🏃','ランニング'],['🚴','サイクリング'],['⛺','キャンプ'],['🎤','カラオケ'],
    ['🎨','お絵かき'],['🎵','音楽'],['🎬','映画'],['🍳','料理'],['🌱','園芸'],['🐱','ねこ'],
    ['🐶','いぬ'],['♟️','ボードゲーム'],['✈️','旅行'],['⚽','スポーツ観戦'],['🧶','手芸'],['🍺','お酒'],['⛰️','山歩き']
  ];
  const EMOJI = Object.fromEntries(HOBBIES.map(([e, n]) => [n, e]));
  const TILTS = [-3, 2, -1, 3, -2, 1, 4, -4];

  const EYE_OPEN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1"/><path d="M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  const state = {
    token: safeGet(TOKEN_KEY),
    me: null,
    regTags: new Set(),
    meTags: new Set(),
    filterHobby: '',
    serverVersion: ''
  };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- 共通 ---------- */

  function safeGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setToken(t) { state.token = t; try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
  function clearToken() { state.token = ''; state.me = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(action, data = {}, { auth = true } = {}) {
    if (!CFG.GAS_URL || CFG.GAS_URL.includes('XXXX')) {
      throw new Error('config.js の GAS_URL を設定してください');
    }
    const body = Object.assign({ action }, data);
    if (auth && state.token) body.token = state.token;
    let res;
    try {
      res = await fetch(CFG.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // プリフライトを発生させない
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('通信できませんでした。電波の良いところでもう一度どうぞ');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('サーバーの応答を読み取れませんでした'); }
    if (json.version) state.serverVersion = json.version;
    if (!json.ok) {
      const err = new Error(json.error || 'エラーが起きました');
      err.code = json.code;
      if (err.code === 'SESSION') { clearToken(); show('login'); }
      if (err.code === 'MUST_CHANGE') show('setpw');
      throw err;
    }
    return json;
  }

  let toastTimer;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, type === 'error' ? 4200 : 2800);
  }

  async function busy(btn, fn) {
    if (btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'お待ちください…';
    try { await fn(); }
    catch (e) { toast(e.message || 'エラーが起きました', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = label; }
  }

  function show(name) {
    $$('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + name; });
    window.scrollTo(0, 0);
    const h = $('#screen-' + name + ' h2, #screen-' + name + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function avatarHtml(u, size = '') {
    const idx = [...String(u.userId || u.nickname || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
    if (u.iconUrl) return `<span class="avatar ${size} c${idx}"><img src="${esc(u.iconUrl)}" alt="" referrerpolicy="no-referrer"></span>`;
    return `<span class="avatar ${size} c${idx}" aria-hidden="true">${esc([...String(u.nickname || '?')][0])}</span>`;
  }

  function stkHtml(name, i, extra = '') {
    return `<span class="stk c${i % 4} ${extra}" style="--tilt:${TILTS[i % TILTS.length]}deg">${EMOJI[name] || '🏷️'} ${esc(name)}</span>`;
  }

  /* ---------- パスワード表示切り替え ---------- */

  function initPwToggles() {
    $$('.pw').forEach(w => {
      if ($('.pw-eye', w)) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pw-eye';
      b.setAttribute('aria-label', 'パスワードを表示');
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = EYE_OPEN;
      w.appendChild(b);
    });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.pw-eye');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    b.innerHTML = showing ? EYE_OFF : EYE_OPEN;
    b.setAttribute('aria-pressed', String(showing));
    b.setAttribute('aria-label', showing ? 'パスワードを隠す' : 'パスワードを表示');
    input.focus({ preventScroll: true });
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (err) {}
  });

  function hidePasswords(form) {
    $$('.pw input', form).forEach(i => { i.type = 'password'; });
    $$('.pw-eye', form).forEach(b => { b.innerHTML = EYE_OPEN; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'パスワードを表示'); });
  }

  function pwCheck(pw, confirm) {
    return {
      len: pw.length >= 8 && pw.length <= 64,
      mix: /[A-Za-z]/.test(pw) && /\d/.test(pw),
      same: pw.length > 0 && pw === confirm
    };
  }
  function pwError(r) {
    if (!r.len) return 'パスワードは8文字以上にしてください';
    if (!r.mix) return 'パスワードには英字と数字を両方入れてください';
    if (!r.same) return '確認用のパスワードが一致しません';
    return '';
  }

  /* ---------- 地域・タグ ---------- */

  function fillPrefSelects() {
    $$('.pref-select').forEach(sel => {
      const head = sel.hasAttribute('data-allow-all')
        ? '<option value="">📍 すべての地域</option>'
        : '<option value="" disabled selected>都道府県を選ぶ</option>';
      sel.innerHTML = head + PREFS.map(p => `<option value="${p}">${p}</option>`).join('');
    });
  }

  function renderTagPicker(el, set) {
    el.innerHTML = '';
    const names = [...HOBBIES.map(h => h[1]), ...[...set].filter(t => !EMOJI[t])];
    names.forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stk-tag c' + (i % 4);
      b.style.setProperty('--tilt', TILTS[i % TILTS.length] + 'deg');
      b.setAttribute('aria-pressed', String(set.has(name)));
      b.textContent = (EMOJI[name] || '🏷️') + ' ' + name;
      b.addEventListener('click', () => {
        if (set.has(name)) set.delete(name);
        else {
          if (set.size >= MAX_TAGS) return toast(`選べるのは${MAX_TAGS}個までです`);
          set.add(name);
        }
        b.setAttribute('aria-pressed', String(set.has(name)));
      });
      el.appendChild(b);
    });

    const wrap = document.createElement('div');
    wrap.className = 'tag-add';
    wrap.innerHTML = '<input maxlength="12" placeholder="ほかの好きなことを追加" aria-label="好きなことを追加"><button type="button" class="btn btn-small">追加</button>';
    const inp = $('input', wrap);
    const add = () => {
      const v = inp.value.trim().replace(/,/g, '');
      if (!v) return;
      if (!set.has(v) && set.size >= MAX_TAGS) return toast(`選べるのは${MAX_TAGS}個までです`);
      set.add(v);
      renderTagPicker(el, set);
    };
    $('button', wrap).addEventListener('click', add);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    el.appendChild(wrap);
  }

  /* ---------- 登録 ---------- */

  $('#form-register').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = {
      email: f.email.value.trim(),
      nickname: f.nickname.value.trim(),
      prefecture: f.prefecture.value,
      area: f.area.value.trim(),
      hobbies: [...state.regTags]
    };
    if (!data.email) return toast('メールアドレスを入力してください', 'error');
    if (!data.nickname) return toast('ニックネームを入力してください', 'error');
    if (!data.prefecture) return toast('都道府県を選んでください', 'error');
    if (!data.hobbies.length) return toast('好きなことを1つ以上選んでください', 'error');

    busy($('[type=submit]', f), async () => {
      await api('register', data, { auth: false });
      $('#sent-email').textContent = data.email;
      $('#form-login').email.value = data.email;
      f.reset();
      state.regTags.clear();
      renderTagPicker($('#reg-tags'), state.regTags);
      show('sent');
    });
  });

  /* ---------- ログイン ---------- */

  $('#form-login').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return toast('メールアドレスとパスワードを入力してください', 'error');

    busy($('[type=submit]', f), async () => {
      const r = await api('login', { email, password }, { auth: false });
      setToken(r.token);
      state.me = r.user;
      f.password.value = '';
      hidePasswords(f);
      if (r.mustChangePassword) show('setpw');
      else enterHome();
    });
  });

  /* ---------- 本パスワード設定（強制） ---------- */

  const setpwForm = $('#form-setpw');
  setpwForm.addEventListener('input', () => {
    const r = pwCheck(setpwForm.newPassword.value, setpwForm.confirm.value);
    $$('#setpw-rules li').forEach(li => li.classList.toggle('ok', r[li.dataset.rule]));
  });
  setpwForm.addEventListener('submit', e => {
    e.preventDefault();
    const np = setpwForm.newPassword.value;
    const msg = pwError(pwCheck(np, setpwForm.confirm.value));
    if (msg) return toast(msg, 'error');

    busy($('[type=submit]', setpwForm), async () => {
      const r = await api('changePassword', { newPassword: np });
      state.me = r.user;
      setpwForm.reset();
      hidePasswords(setpwForm);
      $$('#setpw-rules li').forEach(li => li.classList.remove('ok'));
      toast('パスワードを設定しました。ようこそ！');
      enterHome();
    });
  });

  /* ---------- 再発行 ---------- */

  $('#form-forgot').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!email) return toast('メールアドレスを入力してください', 'error');
    busy($('[type=submit]', f), async () => {
      const r = await api('forgotPassword', { email }, { auth: false });
      $('#form-login').email.value = email;
      f.reset();
      toast(r.message);
      show('login');
    });
  });

  /* ---------- メイン ---------- */

  function enterHome() {
    renderMe();
    fillProfileForm();
    $('#f-pref').value = state.me.prefecture || '';
    state.filterHobby = '';
    renderHobbyFilter();
    switchTab('find');
    show('home');
    loadMembers();
  }

  function renderMe() {
    const m = state.me;
    $('#me-avatar').outerHTML = avatarHtml(m, 'sm').replace('class="avatar', 'id="me-avatar" class="avatar');
    $('#me-name').textContent = m.nickname;
    $('#prof-avatar').outerHTML = avatarHtml(m, 'lg').replace('class="avatar', 'id="prof-avatar" class="avatar');
    $('#version-label').textContent = `画面 v${FRONT_VERSION} / サーバー v${state.serverVersion || '-'}`;
  }

  function switchTab(name) {
    $('#tab-find').hidden = name !== 'find';
    $('#tab-me').hidden = name !== 'me';
    $$('.tabbar button').forEach(b => {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  function renderHobbyFilter() {
    const mine = state.me.hobbies || [];
    const rest = HOBBIES.map(h => h[1]).filter(n => !mine.includes(n));
    const all = ['', ...mine, ...rest];
    const row = $('#f-hobby');
    row.innerHTML = '';
    all.forEach(name => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = name ? `${EMOJI[name] || '🏷️'} ${name}` : 'ぜんぶ';
      b.setAttribute('aria-pressed', String(state.filterHobby === name));
      b.addEventListener('click', () => {
        state.filterHobby = name;
        $$('.chip', row).forEach(c => c.setAttribute('aria-pressed', String(c === b)));
        loadMembers();
      });
      row.appendChild(b);
    });
  }

  $('#f-pref').addEventListener('change', loadMembers);

  let loadSeq = 0;
  async function loadMembers() {
    const seq = ++loadSeq;
    const list = $('#member-list');
    list.innerHTML = '<p class="empty">さがしています…</p>';
    try {
      const r = await api('listMembers', { prefecture: $('#f-pref').value, hobby: state.filterHobby });
      if (seq !== loadSeq) return;
      renderMembers(r.members || []);
    } catch (e) {
      if (seq !== loadSeq) return;
      list.innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button class="btn btn-small" id="retry-btn">もう一度読み込む</button></div>`;
      const rb = $('#retry-btn');
      if (rb) rb.addEventListener('click', loadMembers);
    }
  }

  function renderMembers(members) {
    const list = $('#member-list');
    list.innerHTML = '';
    if (!members.length) {
      const narrowed = $('#f-pref').value || state.filterHobby;
      list.innerHTML = `<div class="empty card"><div class="big-emoji" aria-hidden="true">🌱</div>
        <p>${narrowed ? 'この条件のなかまは、まだいません。条件をゆるめると見つかるかもしれません。' : 'まだ誰もいません。最初のひとりとして、プロフィールを整えておきましょう。'}</p>
        ${narrowed ? '<button class="btn btn-small" id="widen-btn">条件をゆるめる</button>' : ''}</div>`;
      const wb = $('#widen-btn');
      if (wb) wb.addEventListener('click', () => {
        $('#f-pref').value = '';
        state.filterHobby = '';
        renderHobbyFilter();
        loadMembers();
      });
      return;
    }
    const mine = state.me.hobbies || [];
    members.forEach(m => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'member card';
      const tags = m.hobbies.slice().sort((a, b) => mine.includes(b) - mine.includes(a)).slice(0, 4);
      el.innerHTML = `${avatarHtml(m)}
        <div>
          <div class="m-name">${esc(m.nickname)}</div>
          <div class="m-area">📍 ${esc(m.prefecture)}${m.area ? ' ' + esc(m.area) : ''}</div>
          ${m.shared ? `<span class="m-shared">共通の「好き」が${m.shared}つ</span>` : ''}
          <p class="m-bio">${esc(m.bio || '自己紹介はまだありません')}</p>
          <div class="m-tags">${tags.map((t, i) => stkHtml(t, i, mine.includes(t) ? 'shared' : '')).join('')}</div>
        </div>`;
      el.addEventListener('click', () => openMember(m));
      list.appendChild(el);
    });
  }

  function openMember(m) {
    const mine = state.me.hobbies || [];
    $('#member-detail').innerHTML = `
      <div class="detail-head">${avatarHtml(m, 'lg')}
        <div><h3>${esc(m.nickname)}</h3><div class="m-area">📍 ${esc(m.prefecture)}${m.area ? ' ' + esc(m.area) : ''}</div>
        ${m.shared ? `<span class="m-shared">共通の「好き」が${m.shared}つ</span>` : ''}</div>
      </div>
      <div class="detail-tags">${m.hobbies.map((t, i) => stkHtml(t, i, mine.includes(t) ? '' : 'soft')).join('')}</div>
      <p class="detail-bio">${esc(m.bio || '自己紹介はまだありません')}</p>`;
    const d = $('#member-dialog');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  $('#member-dialog').addEventListener('click', e => {
    if (e.target.matches('[data-close]') || e.target === e.currentTarget) e.currentTarget.close();
  });

  /* ---------- プロフィール ---------- */

  function fillProfileForm() {
    const f = $('#form-profile');
    const m = state.me;
    f.nickname.value = m.nickname || '';
    f.prefecture.value = m.prefecture || '';
    f.area.value = m.area || '';
    f.bio.value = m.bio || '';
    state.meTags = new Set(m.hobbies || []);
    renderTagPicker($('#me-tags'), state.meTags);
    $('#ai-tag-result').innerHTML = '';
    $('#ai-bio-result').innerHTML = '';
  }

  $('#form-profile').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = {
      nickname: f.nickname.value.trim(),
      prefecture: f.prefecture.value,
      area: f.area.value.trim(),
      hobbies: [...state.meTags],
      bio: f.bio.value.trim()
    };
    if (!data.nickname) return toast('ニックネームを入力してください', 'error');
    if (!data.prefecture) return toast('都道府県を選んでください', 'error');
    if (!data.hobbies.length) return toast('好きなことを1つ以上選んでください', 'error');

    busy($('[type=submit]', f), async () => {
      const r = await api('updateProfile', data);
      state.me = Object.assign(state.me, r.user);
      renderMe();
      renderHobbyFilter();
      toast('プロフィールを保存しました');
    });
  });

  // アイコン画像：端末で256pxの正方形に縮めてから送る
  $('#icon-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('画像ファイルを選んでください', 'error');
    toast('写真をアップロードしています…');
    try {
      const dataUrl = await resizeImage(file, 256);
      const r = await api('uploadIcon', { dataUrl });
      state.me.iconUrl = r.iconUrl + '&t=' + Date.now();
      renderMe();
      toast('写真を変えました');
    } catch (err) {
      toast(err.message || '写真を変えられませんでした', 'error');
    }
  });

  function resizeImage(file, size) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした')); };
      img.src = url;
    });
  }

  // AI：タグ提案
  $('#ai-tag-btn').addEventListener('click', e => {
    const text = $('#ai-tag-text').value.trim();
    if (!text) return toast('好きなことを少し書いてください', 'error');
    busy(e.currentTarget, async () => {
      const r = await api('aiSuggestTags', { text });
      const box = $('#ai-tag-result');
      box.innerHTML = '';
      (r.tags || []).forEach((t, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'stk-tag c' + (i % 4);
        b.style.setProperty('--tilt', TILTS[i % TILTS.length] + 'deg');
        b.textContent = '＋ ' + t;
        b.disabled = state.meTags.has(t);
        b.addEventListener('click', () => {
          if (state.meTags.size >= MAX_TAGS) return toast(`選べるのは${MAX_TAGS}個までです`);
          state.meTags.add(t);
          b.disabled = true;
          b.setAttribute('aria-pressed', 'true');
          renderTagPicker($('#me-tags'), state.meTags);
        });
        box.appendChild(b);
      });
      if (!r.tags || !r.tags.length) box.textContent = 'うまく提案できませんでした。書き方を変えてもう一度どうぞ。';
    });
  });

  // AI：自己紹介の下書き
  $('#ai-bio-btn').addEventListener('click', e => {
    const f = $('#form-profile');
    const data = {
      nickname: f.nickname.value.trim(),
      prefecture: f.prefecture.value,
      area: f.area.value.trim(),
      hobbies: [...state.meTags],
      keywords: $('#ai-bio-kw').value.trim(),
      tone: ($('input[name=tone]:checked', f) || {}).value || 'yuru'
    };
    busy(e.currentTarget, async () => {
      const r = await api('aiWriteBio', data);
      const box = $('#ai-bio-result');
      box.innerHTML = '';
      (r.bios || []).forEach(text => {
        const d = document.createElement('div');
        d.className = 'draft';
        d.innerHTML = `<p>${esc(text)}</p><button type="button" class="btn btn-small">これを使う</button>`;
        $('button', d).addEventListener('click', () => {
          f.bio.value = text;
          f.bio.focus();
          toast('自己紹介に入れました。「プロフィールを保存」で反映されます');
        });
        box.appendChild(d);
      });
    });
  });

  // パスワード変更（通常）
  $('#form-changepw').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (!f.currentPassword.value) return toast('今のパスワードを入力してください', 'error');
    const msg = pwError(pwCheck(f.newPassword.value, f.confirm.value));
    if (msg) return toast(msg, 'error');
    busy($('[type=submit]', f), async () => {
      await api('changePassword', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
      f.reset();
      hidePasswords(f);
      toast('パスワードを変更しました');
    });
  });

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('logout'); } catch (e) {}
    clearToken();
    show('welcome');
  });

  /* ---------- 画面遷移 ---------- */

  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { show(go.dataset.go); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) switchTab(tab.dataset.tab);
  });

  /* ---------- 起動 ---------- */

  async function boot() {
    fillPrefSelects();
    renderTagPicker($('#reg-tags'), state.regTags);
    initPwToggles();

    if (!state.token) return show('welcome');
    try {
      const r = await api('me');
      state.me = r.user;
      if (r.mustChangePassword) show('setpw');
      else enterHome();
    } catch (e) {
      clearToken();
      show('welcome');
      if (e.code !== 'SESSION') toast(e.message, 'error');
    }
  }

  boot();
})();
