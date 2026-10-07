/**
 * ゆるつな — 地域と「好き」でゆるくつながるコミュニティ
 * GAS バックエンド（Web App / JSON API）
 *
 * フロントからは Content-Type: text/plain で JSON を POST する（CORS プリフライト回避）。
 * 更新したら VERSION を上げ、「デプロイを管理 → 編集 → 新バージョン」で再デプロイ（URL は変わらない）。
 */

const VERSION = '1.0.0';
const APP_NAME = 'ゆるつな';
const SHEET_USERS = 'Users';
const HEADERS = [
  'userId', 'email', 'nickname', 'prefecture', 'area', 'hobbies', 'bio', 'iconFileId',
  'passwordHash', 'salt', 'tempHash', 'tempExpiresAt', 'mustChangePassword',
  'failCount', 'lockedUntil', 'status', 'createdAt', 'updatedAt', 'lastLoginAt'
];

const TEMP_PW_HOURS = 24;      // 仮パスワードの有効期限
const SESSION_SEC = 21600;     // セッション 6時間（CacheService の上限）
const MAX_FAIL = 5;            // 連続失敗でロック
const LOCK_MIN = 15;           // ロック時間（分）
const HASH_ROUNDS = 500;       // ストレッチング回数
const AI_PER_HOUR = 20;        // AI 利用回数 / 人 / 時間
const FORGOT_INTERVAL_SEC = 180; // 再発行の連打防止

const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

/* ============ エントリーポイント ============ */

function doGet() {
  return json_({ ok: true, app: APP_NAME, version: VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'リクエストの形式が正しくありません' });
  }
  const routes = {
    register: apiRegister,
    login: apiLogin,
    changePassword: apiChangePassword,
    forgotPassword: apiForgotPassword,
    logout: apiLogout,
    me: apiMe,
    updateProfile: apiUpdateProfile,
    uploadIcon: apiUploadIcon,
    listMembers: apiListMembers,
    aiSuggestTags: apiAiSuggestTags,
    aiWriteBio: apiAiWriteBio
  };
  const fn = routes[req.action];
  if (!fn) return json_({ ok: false, error: '不明な操作です' });
  try {
    return json_(Object.assign({ ok: true, version: VERSION }, fn(req) || {}));
  } catch (err) {
    if (err instanceof AppError) return json_({ ok: false, error: err.message, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'サーバーでエラーが起きました。時間をおいてもう一度試してください' });
  }
}

/* ============ 初期設定（エディタから1回実行） ============ */

function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', randomToken_() + randomToken_());
  const sh = sheet_();
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head.join() !== HEADERS.join()) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  // ハッシュ・ソルトが数値に化けないよう書式を「書式なしテキスト」に
  ['passwordHash', 'salt', 'tempHash', 'userId', 'email'].forEach(function (h) {
    const col = HEADERS.indexOf(h) + 1;
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  iconFolder_();
  Logger.log('セットアップ完了 / version ' + VERSION);
}

/* ============ API：認証 ============ */

function apiRegister(req) {
  const email = normEmail_(req.email);
  const nickname = cleanText_(req.nickname, 20);
  const prefecture = String(req.prefecture || '');
  const area = cleanText_(req.area, 30);
  const hobbies = cleanHobbies_(req.hobbies);

  if (!isEmail_(email)) fail_('メールアドレスの形式を確認してください');
  if (!nickname) fail_('ニックネームを入力してください');
  if (PREFS.indexOf(prefecture) < 0) fail_('都道府県を選んでください');
  if (!hobbies.length) fail_('好きなことを1つ以上選んでください');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (findByEmail_(email)) {
      fail_('このメールアドレスは登録済みです。「パスワードをお忘れの方」から再発行できます', 'DUP');
    }
    const temp = genTempPw_();
    const salt = randomToken_();
    const now = new Date();
    const u = {
      userId: 'u_' + randomToken_().slice(0, 12),
      email: email, nickname: nickname, prefecture: prefecture, area: area,
      hobbies: hobbies.join(','), bio: '', iconFileId: '',
      passwordHash: '', salt: salt,
      tempHash: hash_(temp, salt), tempExpiresAt: Date.now() + TEMP_PW_HOURS * 3600e3,
      mustChangePassword: true, failCount: 0, lockedUntil: 0, status: 'active',
      createdAt: now, updatedAt: now, lastLoginAt: ''
    };
    sendTempMail_(email, nickname, temp, 'register'); // 送信に失敗したら登録しない
    sheet_().appendRow(rowOf_(u));
  } finally {
    lock.releaseLock();
  }
  return { message: '仮パスワードをメールで送りました' };
}

function apiLogin(req) {
  const email = normEmail_(req.email);
  const pw = String(req.password || '');
  const generic = 'メールアドレスかパスワードが違います';
  const u = findByEmail_(email);
  if (!u || u.status !== 'active' || !pw) fail_(generic, 'AUTH');

  const now = Date.now();
  if (Number(u.lockedUntil) > now) {
    fail_('ログインに続けて失敗したため、' + LOCK_MIN + '分間ロックしています。時間をおいて試してください', 'LOCKED');
  }

  const h = hash_(pw, u.salt);
  let usedTemp = false;
  if (u.passwordHash && h === u.passwordHash) {
    // 本パスワードで入れた＝思い出せた。保留中の仮パスワードは無効にする
    u.tempHash = '';
    u.tempExpiresAt = 0;
  } else if (u.tempHash && h === u.tempHash) {
    if (Number(u.tempExpiresAt) < now) {
      fail_('仮パスワードの有効期限（' + TEMP_PW_HOURS + '時間）が切れています。「パスワードをお忘れの方」から再発行してください', 'EXPIRED');
    }
    usedTemp = true;
  } else {
    u.failCount = Number(u.failCount || 0) + 1;
    if (u.failCount >= MAX_FAIL) {
      u.lockedUntil = now + LOCK_MIN * 60e3;
      u.failCount = 0;
    }
    save_(u);
    fail_(generic, 'AUTH');
  }

  u.failCount = 0;
  u.lockedUntil = 0;
  u.lastLoginAt = new Date();
  if (usedTemp) u.mustChangePassword = true;
  save_(u);

  return {
    token: createSession_(u.userId),
    mustChangePassword: isTrue_(u.mustChangePassword),
    user: publicSelf_(u)
  };
}

function apiChangePassword(req) {
  const u = authUser_(req.token, { allowMustChange: true });
  const np = String(req.newPassword || '');
  validatePw_(np);
  if (!isTrue_(u.mustChangePassword)) {
    if (hash_(String(req.currentPassword || ''), u.salt) !== u.passwordHash) {
      fail_('今のパスワードが違います');
    }
  }
  const salt = randomToken_();
  u.salt = salt;
  u.passwordHash = hash_(np, salt);
  u.tempHash = '';
  u.tempExpiresAt = 0;
  u.mustChangePassword = false;
  u.updatedAt = new Date();
  save_(u);
  return { message: 'パスワードを設定しました', user: publicSelf_(u) };
}

function apiForgotPassword(req) {
  const email = normEmail_(req.email);
  const msg = '登録済みのアドレスなら、仮パスワードを送りました。メールを確認してください';
  if (!isEmail_(email)) fail_('メールアドレスの形式を確認してください');
  const u = findByEmail_(email);
  if (!u || u.status !== 'active') return { message: msg }; // 登録有無は明かさない

  const cache = CacheService.getScriptCache();
  const key = 'fg_' + u.userId;
  if (cache.get(key)) return { message: msg };
  cache.put(key, '1', FORGOT_INTERVAL_SEC);

  // 本パスワードは残したまま、仮パスワードを別枠で発行（第三者の再発行で締め出されない）
  const temp = genTempPw_();
  u.tempHash = hash_(temp, u.salt);
  u.tempExpiresAt = Date.now() + TEMP_PW_HOURS * 3600e3;
  u.updatedAt = new Date();
  sendTempMail_(u.email, u.nickname, temp, 'reset');
  save_(u);
  return { message: msg };
}

function apiLogout(req) {
  if (req.token) CacheService.getScriptCache().remove('s_' + req.token);
  return { message: 'ログアウトしました' };
}

function apiMe(req) {
  const u = authUser_(req.token, { allowMustChange: true });
  return { user: publicSelf_(u), mustChangePassword: isTrue_(u.mustChangePassword) };
}

/* ============ API：プロフィール・なかま ============ */

function apiUpdateProfile(req) {
  const u = authUser_(req.token);
  const nickname = cleanText_(req.nickname, 20);
  const prefecture = String(req.prefecture || '');
  const hobbies = cleanHobbies_(req.hobbies);
  if (!nickname) fail_('ニックネームを入力してください');
  if (PREFS.indexOf(prefecture) < 0) fail_('都道府県を選んでください');
  if (!hobbies.length) fail_('好きなことを1つ以上選んでください');

  u.nickname = nickname;
  u.prefecture = prefecture;
  u.area = cleanText_(req.area, 30);
  u.hobbies = hobbies.join(',');
  u.bio = cleanText_(req.bio, 300, true);
  u.updatedAt = new Date();
  save_(u);
  return { message: 'プロフィールを保存しました', user: publicSelf_(u) };
}

function apiUploadIcon(req) {
  const u = authUser_(req.token);
  const m = String(req.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) fail_('この画像の形式には対応していません（JPEG / PNG / WebP）');
  if (m[2].length > 700000) fail_('画像が大きすぎます');

  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], u.userId + '_' + Date.now() + '.' + ext);
  const file = iconFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('共有設定に失敗: ' + e);
  }
  if (u.iconFileId) {
    try { DriveApp.getFileById(u.iconFileId).setTrashed(true); } catch (e) { /* 既に無い */ }
  }
  u.iconFileId = file.getId();
  u.updatedAt = new Date();
  save_(u);
  return { iconUrl: iconUrl_(u.iconFileId) };
}

function apiListMembers(req) {
  const me = authUser_(req.token);
  const pref = String(req.prefecture || '');
  const hobby = String(req.hobby || '');
  const myH = splitH_(me.hobbies);

  const members = readAll_()
    .filter(function (u) {
      return u.userId !== me.userId && u.status === 'active' && u.passwordHash && !isTrue_(u.mustChangePassword);
    })
    .filter(function (u) { return !pref || u.prefecture === pref; })
    .filter(function (u) { return !hobby || splitH_(u.hobbies).indexOf(hobby) >= 0; })
    .map(function (u) {
      const pm = publicMember_(u);
      pm.shared = pm.hobbies.filter(function (h) { return myH.indexOf(h) >= 0; }).length;
      pm._score = pm.shared * 2 + (u.prefecture === me.prefecture ? 1 : 0);
      pm._t = new Date(u.lastLoginAt || u.updatedAt || 0).getTime() || 0;
      return pm;
    })
    .sort(function (a, b) { return (b._score - a._score) || (b._t - a._t); })
    .slice(0, 60)
    .map(function (m) { delete m._score; delete m._t; return m; });

  return { members: members };
}

/* ============ API：AI（Gemini） ============ */

function apiAiSuggestTags(req) {
  const me = authUser_(req.token);
  aiQuota_(me.userId);
  const text = cleanText_(req.text, 300, true);
  if (!text) fail_('好きなことを少し書いてください');

  const prompt = [
    'あなたは、地域や趣味で気軽に友達を作るコミュニティの案内役です。',
    '次の文章を書いた人に合う「趣味タグ」を6個提案してください。',
    '条件：',
    '- 1つ8文字以内の短い日本語',
    '- 同じ趣味の人が見つけやすい一般的な言葉（例：カフェ、散歩、サウナ、キャンプ）',
    '- 文章に書かれていなくても、関連して楽しめそうなものを1〜2個混ぜてよい',
    '- 出力はJSON配列のみ（例：["カフェ","散歩"]）',
    '',
    '文章：' + text
  ].join('\n');

  const arr = gemini_(prompt);
  const tags = (Array.isArray(arr) ? arr : [])
    .map(function (t) { return cleanText_(t, 12).replace(/,/g, ''); })
    .filter(Boolean)
    .filter(function (t, i, a) { return a.indexOf(t) === i; })
    .slice(0, 8);
  return { tags: tags };
}

function apiAiWriteBio(req) {
  const me = authUser_(req.token);
  aiQuota_(me.userId);
  const nickname = cleanText_(req.nickname, 20) || me.nickname;
  const prefecture = PREFS.indexOf(req.prefecture) >= 0 ? req.prefecture : me.prefecture;
  const area = cleanText_(req.area, 30);
  const hobbies = cleanHobbies_(req.hobbies);
  const keywords = cleanText_(req.keywords, 100);
  const tones = {
    yuru: 'ゆるくて親しみやすい口調',
    teinei: 'ていねいで落ち着いた口調',
    genki: '明るく元気な口調（絵文字は1〜2個まで）'
  };
  const tone = tones[req.tone] || tones.yuru;

  const prompt = [
    '地域や趣味でゆるく友達を作るWebサービスの「自己紹介文」を3案作ってください。',
    '条件：',
    '- 各80〜120文字',
    '- 口調：' + tone,
    '- しがらみのない気楽さが伝わり、初めての人も声をかけやすい一言で締める',
    '- 本名・詳しい住所・勤務先など個人が特定される情報は入れない',
    '- 書かれていない経歴や実績をでっちあげない',
    '- 出力はJSON配列のみ（例：["案1","案2","案3"]）',
    '',
    'ニックネーム：' + nickname,
    '地域：' + prefecture + (area ? ' ' + area : ''),
    '好きなこと：' + (hobbies.length ? hobbies.join('、') : splitH_(me.hobbies).join('、')),
    'ひとこと：' + (keywords || '（なし）')
  ].join('\n');

  const arr = gemini_(prompt);
  const bios = (Array.isArray(arr) ? arr : [])
    .map(function (t) { return cleanText_(t, 300, true); })
    .filter(Boolean)
    .slice(0, 3);
  if (!bios.length) fail_('AIが文章を作れませんでした。もう一度どうぞ');
  return { bios: bios };
}

function gemini_(prompt) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) fail_('AI機能は準備中です（APIキー未設定）');
  const model = prop_('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText());
    fail_('AIの応答に失敗しました。少し待ってもう一度どうぞ');
  }
  const d = JSON.parse(res.getContentText());
  const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    fail_('AIの応答を読み取れませんでした。もう一度どうぞ');
  }
}

function aiQuota_(userId) {
  const c = CacheService.getScriptCache();
  const k = 'ai_' + userId;
  const n = Number(c.get(k) || 0);
  if (n >= AI_PER_HOUR) fail_('AIのお手伝いは1時間に' + AI_PER_HOUR + '回までです。少し休憩してからどうぞ');
  c.put(k, String(n + 1), 3600);
}

/* ============ セッション ============ */

function createSession_(userId) {
  const t = randomToken_() + randomToken_();
  CacheService.getScriptCache().put('s_' + t, userId, SESSION_SEC);
  return t;
}

function authUser_(token, opt) {
  opt = opt || {};
  if (!token) fail_('ログインしてください', 'SESSION');
  const c = CacheService.getScriptCache();
  const uid = c.get('s_' + token);
  if (!uid) fail_('ログインの有効期限が切れました。もう一度ログインしてください', 'SESSION');
  const u = findById_(uid);
  if (!u || u.status !== 'active') fail_('ログインしてください', 'SESSION');
  if (!opt.allowMustChange && isTrue_(u.mustChangePassword)) fail_('先にパスワードを設定してください', 'MUST_CHANGE');
  c.put('s_' + token, uid, SESSION_SEC); // 使うたびに延長
  return u;
}

/* ============ パスワード・ハッシュ ============ */

function hash_(pw, salt) {
  const pepper = prop_('PEPPER');
  if (!pepper) fail_('初期設定（setup）が未実行です', 'SETUP');
  let h = String(salt) + String(pw) + pepper;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function validatePw_(pw) {
  if (pw.length < 8 || pw.length > 64) fail_('パスワードは8〜64文字にしてください');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) fail_('パスワードには英字と数字を両方入れてください');
}

function genTempPw_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[(bytes[i] & 0xff) % chars.length];
  return s;
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function toHex_(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return s;
}

/* ============ メール ============ */

function sendTempMail_(email, nickname, temp, kind) {
  const appUrl = prop_('APP_URL') || '';
  const isReg = kind === 'register';
  const lines = [
    nickname + ' さん',
    '',
    isReg ? APP_NAME + 'への登録ありがとうございます。' : 'パスワード再発行のリクエストを受け付けました。',
    '',
    '仮パスワード： ' + temp,
    '有効期限： ' + TEMP_PW_HOURS + '時間',
    '',
    'ログイン後に、ご自身のパスワードを設定してください。'
  ];
  if (appUrl) lines.push('ログインはこちら： ' + appUrl);
  if (!isReg) lines.push('', '心当たりがない場合は、このメールを無視してください。今のパスワードはそのまま使えます。');
  lines.push('', '―― ' + APP_NAME);

  MailApp.sendEmail({
    to: email,
    subject: '【' + APP_NAME + '】' + (isReg ? '仮パスワードのお知らせ' : 'パスワード再発行のお知らせ'),
    body: lines.join('\n'),
    name: APP_NAME
  });
}

/* ============ シート操作 ============ */

let _sheet = null;
function sheet_() {
  if (_sheet) return _sheet;
  const id = prop_('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_USERS);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  _sheet = sh;
  return sh;
}

function readAll_() {
  const vals = sheet_().getDataRange().getValues();
  const head = vals[0];
  return vals.slice(1).map(function (r, i) {
    const o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  }).filter(function (o) { return o.userId; });
}

function findByEmail_(email) {
  return readAll_().filter(function (u) { return String(u.email).toLowerCase() === email; })[0] || null;
}

function findById_(id) {
  return readAll_().filter(function (u) { return u.userId === id; })[0] || null;
}

function save_(u) {
  sheet_().getRange(u._row, 1, 1, HEADERS.length).setValues([rowOf_(u)]);
}

// 数式インジェクション対策：= + - @ で始まる文字列は文字列として保存
function rowOf_(u) {
  return HEADERS.map(function (h) {
    let v = u[h];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v;
    return v;
  });
}

/* ============ 変換・検証ヘルパー ============ */

function publicSelf_(u) {
  const m = publicMember_(u);
  m.email = u.email;
  return m;
}

function publicMember_(u) {
  return {
    userId: u.userId,
    nickname: String(u.nickname),
    prefecture: String(u.prefecture),
    area: String(u.area || ''),
    hobbies: splitH_(u.hobbies),
    bio: String(u.bio || ''),
    iconUrl: u.iconFileId ? iconUrl_(u.iconFileId) : ''
  };
}

function iconUrl_(id) {
  return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w256';
}

function iconFolder_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('ICON_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 作り直す */ }
  }
  const f = DriveApp.createFolder(APP_NAME + '_プロフィール画像');
  p.setProperty('ICON_FOLDER_ID', f.getId());
  return f;
}

function splitH_(s) {
  return String(s || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
}

function cleanHobbies_(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach(function (t) {
    const v = cleanText_(t, 12).replace(/,/g, '');
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  return out.slice(0, 10);
}

function cleanText_(v, max, multiline) {
  let s = String(v == null ? '' : v);
  s = multiline ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim().slice(0, max);
}

function normEmail_(v) {
  return String(v || '').trim().toLowerCase();
}

function isEmail_(v) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v) && v.length <= 254;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'ERR';
  }
}

function fail_(message, code) {
  throw new AppError(message, code);
}
