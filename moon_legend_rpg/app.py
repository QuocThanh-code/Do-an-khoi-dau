#!/usr/bin/env python3
"""Moon Legend RPG local web server. Standard-library only."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from http.cookies import SimpleCookie
import hashlib, hmac, json, os, re, secrets, sqlite3, time, unicodedata, random

BASE = Path(__file__).resolve().parent
# Keep SQLite outside the static web root so it cannot be downloaded over HTTP.
DATA = BASE.parent / (BASE.name + '_private_data')
DB = DATA / 'moon_legend.sqlite3'
HOST = os.environ.get('RPG_HOST', '127.0.0.1')
PORT = int(os.environ.get('RPG_PORT', '8000'))
COOKIE_SECURE = os.environ.get('RPG_COOKIE_SECURE', '0') == '1'
SESSION_SECONDS = 7 * 24 * 3600
RESET_SECONDS = 5 * 60
CHALLENGE_SECONDS = 10 * 60
LOCK_SECONDS = 30 * 60

QUESTIONS = {
    'artist': 'Ca sĩ / nghệ sĩ bạn yêu thích là ai?',
    'food': 'Món ăn bạn yêu thích là gì?',
    'game': 'Tựa game bạn yêu thích là gì?',
    'color': 'Màu sắc bạn yêu thích là gì?',
    'nickname': 'Biệt danh bạn muốn dùng trong game là gì?'
}
ITEMS = {
    'moon_shard': 'Mảnh trăng',
    'slime_core': 'Lõi Slime',
    'wolf_fang': 'Nanh Sói',
    'forest_crystal': 'Tinh thể rừng'
}
INITIAL_ITEMS = {'moon_shard': 3, 'slime_core': 3, 'wolf_fang': 1, 'forest_crystal': 1}

def db():
    DATA.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn

def init_db():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          recovery_hashes TEXT NOT NULL,
          recovery_challenge TEXT,
          recovery_challenge_until INTEGER NOT NULL DEFAULT 0,
          recovery_fail_count INTEGER NOT NULL DEFAULT 0,
          recovery_locked_until INTEGER NOT NULL DEFAULT 0,
          reset_ticket_hash TEXT,
          reset_ticket_until INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS game_saves(
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          state_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory(
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
          PRIMARY KEY(user_id,item)
        );
        CREATE TABLE IF NOT EXISTS trades(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_user INTEGER NOT NULL REFERENCES users(id),
          to_user INTEGER NOT NULL REFERENCES users(id),
          give_item TEXT NOT NULL,
          give_qty INTEGER NOT NULL,
          want_item TEXT NOT NULL,
          want_qty INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trades_to ON trades(to_user,status);
        CREATE INDEX IF NOT EXISTS idx_trades_from ON trades(from_user,status);
        ''')

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return salt.hex() + '$' + digest.hex()

def check_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split('$', 1)
        digest = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False

def normalize_answer(value: str) -> str:
    value = unicodedata.normalize('NFKC', str(value)).casefold().strip()
    value = ''.join(ch for ch in value if ch.isalnum())
    return value

def hash_answer(answer: str) -> str:
    salt = secrets.token_bytes(16)
    value = normalize_answer(answer)
    digest = hashlib.scrypt(value.encode('utf-8'), salt=salt, n=2**13, r=8, p=1, dklen=32)
    return salt.hex() + '$' + digest.hex()

def check_answer(answer: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split('$', 1)
        digest = hashlib.scrypt(normalize_answer(answer).encode('utf-8'), salt=bytes.fromhex(salt_hex), n=2**13, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False

def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

class Handler(SimpleHTTPRequestHandler):
    server_version = 'MoonLegend/1.0'
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE), **kwargs)

    def log_message(self, fmt, *args):
        print('[%s] %s' % (self.log_date_time_string(), fmt % args))

    def send_json(self, code, data, extra_headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length > 1_000_000:
            raise ValueError('Dữ liệu gửi lên quá lớn.')
        raw = self.rfile.read(length) if length else b'{}'
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, dict):
            raise ValueError('Dữ liệu không hợp lệ.')
        return value

    def cookie_token(self):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        morsel = cookie.get('moon_session')
        return morsel.value if morsel else None

    def current_user(self, c):
        token = self.cookie_token()
        if not token:
            return None
        row = c.execute('''SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                           WHERE s.token_hash=? AND s.expires_at>?''', (token_hash(token), int(time.time()))).fetchone()
        return row

    def session_cookie(self, token, max_age=SESSION_SECONDS):
        secure = '; Secure' if COOKIE_SECURE else ''
        return ('Set-Cookie', f'moon_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}')

    def issue_session(self, c, user_id):
        token = secrets.token_urlsafe(32)
        c.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
                  (token_hash(token), user_id, int(time.time()) + SESSION_SECONDS))
        return token

    def account_summary(self, c, user):
        inv = c.execute('SELECT item,quantity FROM inventory WHERE user_id=? ORDER BY item', (user['id'],)).fetchall()
        return {'username': user['username'], 'inventory': {r['item']: r['quantity'] for r in inv}, 'items': ITEMS}

    def require_user(self, c):
        user = self.current_user(c)
        if not user:
            self.send_json(401, {'error': 'Bạn cần đăng nhập trước.'})
            return None
        return user

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            with db() as c:
                if path == '/api/me':
                    user = self.require_user(c)
                    if user: self.send_json(200, self.account_summary(c, user))
                    return
                if path == '/api/save':
                    user = self.require_user(c)
                    if user:
                        row = c.execute('SELECT state_json,updated_at FROM game_saves WHERE user_id=?', (user['id'],)).fetchone()
                        self.send_json(200, {'state': json.loads(row['state_json']) if row else None,
                                             'updated_at': row['updated_at'] if row else None})
                    return
                if path == '/api/trades':
                    user = self.require_user(c)
                    if not user: return
                    rows = c.execute('''SELECT t.*, a.username AS from_name, b.username AS to_name
                                        FROM trades t JOIN users a ON a.id=t.from_user JOIN users b ON b.id=t.to_user
                                        WHERE t.from_user=? OR t.to_user=? ORDER BY t.id DESC LIMIT 50''',
                                     (user['id'], user['id'])).fetchall()
                    payload = []
                    for r in rows:
                        payload.append({'id':r['id'],'from':r['from_name'],'to':r['to_name'],
                           'give_item':r['give_item'],'give_name':ITEMS[r['give_item']], 'give_qty':r['give_qty'],
                           'want_item':r['want_item'],'want_name':ITEMS[r['want_item']], 'want_qty':r['want_qty'],
                           'status':r['status'],'incoming':r['to_user']==user['id'],'created_at':r['created_at']})
                    inv = c.execute('SELECT item,quantity FROM inventory WHERE user_id=?', (user['id'],)).fetchall()
                    self.send_json(200, {'inventory':{r['item']:r['quantity'] for r in inv}, 'items':ITEMS, 'trades':payload})
                    return
            self.send_json(404, {'error':'Không tìm thấy API.'})
            return
        if path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith('/api/'):
            self.send_json(404, {'error':'Không tìm thấy.'}); return
        try:
            data = self.body()
        except Exception as exc:
            self.send_json(400, {'error':str(exc)}); return

        now = int(time.time())
        with db() as c:
            try:
                if path == '/api/register':
                    username = str(data.get('username','')).strip().lower()
                    password = str(data.get('password',''))
                    answers = data.get('answers', {})
                    if not re.fullmatch(r'[a-z0-9_]{3,20}', username):
                        self.send_json(400, {'error':'Tên tài khoản phải 3–20 ký tự, chỉ gồm chữ thường, số và dấu gạch dưới.'}); return
                    if len(password) < 8 or len(password) > 128:
                        self.send_json(400, {'error':'Mật khẩu cần từ 8 đến 128 ký tự.'}); return
                    if not isinstance(answers, dict) or set(answers.keys()) != set(QUESTIONS.keys()) or any(len(str(answers[k]).strip()) < 1 for k in QUESTIONS):
                        self.send_json(400, {'error':'Hãy trả lời đầy đủ cả 5 câu hỏi bảo mật.'}); return
                    recovery = {k:hash_answer(str(answers[k])) for k in QUESTIONS}
                    try:
                        cur = c.execute('INSERT INTO users(username,password_hash,recovery_hashes,created_at) VALUES(?,?,?,?)',
                                        (username,hash_password(password),json.dumps(recovery),now))
                    except sqlite3.IntegrityError:
                        self.send_json(409, {'error':'Tên tài khoản đã được sử dụng.'}); return
                    uid = cur.lastrowid
                    for item, qty in INITIAL_ITEMS.items():
                        c.execute('INSERT INTO inventory(user_id,item,quantity) VALUES(?,?,?)', (uid,item,qty))
                    token = self.issue_session(c,uid)
                    self.send_json(201, {'account':self.account_summary(c,c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()),
                                         'message':'Tài khoản đã được tạo.'}, [self.session_cookie(token)])
                    return

                if path == '/api/login':
                    username = str(data.get('username','')).strip().lower()
                    password = str(data.get('password',''))
                    user = c.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
                    if not user or not check_password(password,user['password_hash']):
                        self.send_json(401, {'error':'Tên tài khoản hoặc mật khẩu không đúng.'}); return
                    token = self.issue_session(c,user['id'])
                    self.send_json(200, {'account':self.account_summary(c,user),'message':'Đăng nhập thành công.'}, [self.session_cookie(token)])
                    return

                if path == '/api/logout':
                    token = self.cookie_token()
                    if token: c.execute('DELETE FROM sessions WHERE token_hash=?',(token_hash(token),))
                    self.send_json(200, {'message':'Đã đăng xuất.'}, [('Set-Cookie','moon_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')])
                    return

                if path == '/api/recovery/start':
                    username = str(data.get('username','')).strip().lower()
                    user = c.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
                    if not user:
                        self.send_json(404, {'error':'Không thể mở yêu cầu khôi phục cho tài khoản này.'}); return
                    if user['recovery_locked_until'] > now:
                        self.send_json(429, {'error':'Bạn đã nhập sai 3 lần. Vui lòng thử lại sau.',
                                             'retry_after':user['recovery_locked_until']-now}); return
                    if user['recovery_locked_until'] and user['recovery_locked_until'] <= now:
                        c.execute('UPDATE users SET recovery_fail_count=0,recovery_locked_until=0 WHERE id=?',(user['id'],))
                    ids = random.sample(list(QUESTIONS.keys()), 3)
                    c.execute('UPDATE users SET recovery_challenge=?,recovery_challenge_until=? WHERE id=?',
                              (json.dumps(ids),now+CHALLENGE_SECONDS,user['id']))
                    self.send_json(200, {'questions':[{'id':qid,'question':QUESTIONS[qid]} for qid in ids],
                                         'expires_in':CHALLENGE_SECONDS})
                    return

                if path == '/api/recovery/verify':
                    username = str(data.get('username','')).strip().lower()
                    submitted = data.get('answers',{})
                    user = c.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
                    if not user:
                        self.send_json(400, {'error':'Thông tin khôi phục không hợp lệ.'}); return
                    if user['recovery_locked_until'] > now:
                        self.send_json(429, {'error':'Tài khoản khôi phục đang bị khóa tạm thời.',
                                             'retry_after':user['recovery_locked_until']-now}); return
                    try: ids = json.loads(user['recovery_challenge'] or '[]')
                    except Exception: ids = []
                    if len(ids)!=3 or user['recovery_challenge_until'] < now:
                        self.send_json(400, {'error':'Bộ câu hỏi đã hết hạn. Hãy yêu cầu bộ câu hỏi mới.'}); return
                    if not isinstance(submitted,dict) or set(submitted.keys())!=set(ids):
                        self.send_json(400, {'error':'Hãy trả lời đủ cả 3 câu hỏi đang hiển thị.'}); return
                    saved = json.loads(user['recovery_hashes'])
                    correct = all(check_answer(str(submitted[q]),saved[q]) for q in ids)
                    if not correct:
                        fails = user['recovery_fail_count'] + 1
                        if fails >= 3:
                            c.execute('UPDATE users SET recovery_fail_count=0,recovery_locked_until=?,recovery_challenge=NULL,recovery_challenge_until=0 WHERE id=?',
                                      (now+LOCK_SECONDS,user['id']))
                            self.send_json(429, {'error':'Bạn đã sai 3 lần. Khôi phục tài khoản bị khóa 30 phút.', 'retry_after':LOCK_SECONDS}); return
                        c.execute('UPDATE users SET recovery_fail_count=? WHERE id=?',(fails,user['id']))
                        self.send_json(400, {'error':f'Câu trả lời chưa chính xác. Bạn còn {3-fails} lần thử.' , 'attempts_left':3-fails}); return
                    ticket = secrets.token_urlsafe(32)
                    c.execute('UPDATE users SET recovery_fail_count=0,recovery_challenge=NULL,recovery_challenge_until=0,reset_ticket_hash=?,reset_ticket_until=? WHERE id=?',
                              (token_hash(ticket),now+RESET_SECONDS,user['id']))
                    self.send_json(200, {'ticket':ticket,'expires_in':RESET_SECONDS,'message':'Xác minh thành công. Hãy đặt mật khẩu mới.'})
                    return

                if path == '/api/recovery/reset':
                    username = str(data.get('username','')).strip().lower()
                    ticket = str(data.get('ticket',''))
                    password = str(data.get('new_password',''))
                    if len(password)<8 or len(password)>128:
                        self.send_json(400, {'error':'Mật khẩu mới cần từ 8 đến 128 ký tự.'}); return
                    user = c.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
                    if not user or not user['reset_ticket_hash'] or user['reset_ticket_until']<now or not hmac.compare_digest(token_hash(ticket),user['reset_ticket_hash']):
                        self.send_json(400, {'error':'Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'}); return
                    c.execute('UPDATE users SET password_hash=?,reset_ticket_hash=NULL,reset_ticket_until=0 WHERE id=?',
                              (hash_password(password),user['id']))
                    c.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
                    self.send_json(200, {'message':'Đổi mật khẩu thành công. Hãy đăng nhập lại.'})
                    return

                if path == '/api/save':
                    user = self.require_user(c)
                    if not user:return
                    state = data.get('state')
                    if not isinstance(state,dict) or len(json.dumps(state,ensure_ascii=False))>500_000:
                        self.send_json(400, {'error':'Dữ liệu tiến trình không hợp lệ.'}); return
                    # Award one server-side trade material per newly recorded victory.
                    # IMMEDIATE transaction prevents duplicate drops from parallel tabs.
                    c.execute('BEGIN IMMEDIATE')
                    previous = c.execute('SELECT state_json FROM game_saves WHERE user_id=?', (user['id'],)).fetchone()
                    old_wins = 0
                    if previous:
                        try:
                            old_wins = max(0, int(json.loads(previous['state_json']).get('wins', 0)))
                        except Exception:
                            old_wins = 0
                    new_wins = max(0, int(state.get('wins', old_wins)))
                    delta = min(5, max(0, new_wins - old_wins))
                    loot = []
                    for _ in range(delta):
                        item = random.choice(list(ITEMS.keys()))
                        c.execute('''INSERT INTO inventory(user_id,item,quantity) VALUES(?,?,1)
                                     ON CONFLICT(user_id,item) DO UPDATE SET quantity=quantity+1''',
                                  (user['id'], item))
                        loot.append({'item': item, 'name': ITEMS[item], 'quantity': 1})
                    c.execute('''INSERT INTO game_saves(user_id,state_json,updated_at) VALUES(?,?,?)
                                 ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at''',
                              (user['id'],json.dumps(state,ensure_ascii=False),now))
                    c.commit()
                    self.send_json(200, {'message':'Đã đồng bộ tiến trình lên tài khoản.', 'loot':loot})
                    return

                if path == '/api/trades':
                    user = self.require_user(c)
                    if not user:return
                    to_name = str(data.get('to_username','')).strip().lower()
                    give = str(data.get('give_item',''))
                    want = str(data.get('want_item',''))
                    give_qty = data.get('give_qty',1); want_qty = data.get('want_qty',1)
                    if give not in ITEMS or want not in ITEMS or give==want:
                        self.send_json(400, {'error':'Hãy chọn hai loại vật phẩm khác nhau.'}); return
                    if not isinstance(give_qty,int) or not isinstance(want_qty,int) or not (1<=give_qty<=999 and 1<=want_qty<=999):
                        self.send_json(400, {'error':'Số lượng phải là số nguyên từ 1 đến 999.'}); return
                    target = c.execute('SELECT * FROM users WHERE username=?',(to_name,)).fetchone()
                    if not target or target['id']==user['id']:
                        self.send_json(400, {'error':'Không tìm thấy người nhận hợp lệ.'}); return
                    c.execute('BEGIN IMMEDIATE')
                    row = c.execute('SELECT quantity FROM inventory WHERE user_id=? AND item=?',(user['id'],give)).fetchone()
                    if not row or row['quantity']<give_qty:
                        c.rollback(); self.send_json(400, {'error':'Bạn không đủ vật phẩm để gửi.'}); return
                    c.execute('UPDATE inventory SET quantity=quantity-? WHERE user_id=? AND item=?',(give_qty,user['id'],give))
                    c.execute('INSERT INTO trades(from_user,to_user,give_item,give_qty,want_item,want_qty,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                              (user['id'],target['id'],give,give_qty,want,want_qty,'pending',now,now))
                    trade_id = c.execute('SELECT last_insert_rowid()').fetchone()[0]
                    c.commit()
                    self.send_json(201, {'message':f'Đã gửi đề nghị trao đổi #{trade_id}. Vật phẩm của bạn đang được giữ an toàn trong giao dịch.'})
                    return

                m = re.fullmatch(r'/api/trades/(\d+)/(accept|reject|cancel)',path)
                if m:
                    user = self.require_user(c)
                    if not user:return
                    trade_id=int(m.group(1)); action=m.group(2)
                    c.execute('BEGIN IMMEDIATE')
                    t=c.execute('SELECT * FROM trades WHERE id=?',(trade_id,)).fetchone()
                    if not t or t['status']!='pending':
                        c.rollback(); self.send_json(404, {'error':'Giao dịch không còn chờ xử lý.'}); return
                    if action in ('accept','reject') and t['to_user']!=user['id']:
                        c.rollback(); self.send_json(403, {'error':'Chỉ người nhận mới xử lý được đề nghị này.'}); return
                    if action=='cancel' and t['from_user']!=user['id']:
                        c.rollback(); self.send_json(403, {'error':'Chỉ người gửi mới hủy được đề nghị này.'}); return
                    if action=='accept':
                        row=c.execute('SELECT quantity FROM inventory WHERE user_id=? AND item=?',(user['id'],t['want_item'])).fetchone()
                        if not row or row['quantity']<t['want_qty']:
                            c.rollback(); self.send_json(400, {'error':'Bạn không đủ vật phẩm yêu cầu để chấp nhận giao dịch.'}); return
                        c.execute('UPDATE inventory SET quantity=quantity-? WHERE user_id=? AND item=?',(t['want_qty'],user['id'],t['want_item']))
                        c.execute('UPDATE inventory SET quantity=quantity+? WHERE user_id=? AND item=?',(t['give_qty'],user['id'],t['give_item']))
                        c.execute('UPDATE inventory SET quantity=quantity+? WHERE user_id=? AND item=?',(t['want_qty'],t['from_user'],t['want_item']))
                        c.execute('UPDATE trades SET status=?,updated_at=? WHERE id=?',('accepted',now,trade_id))
                        msg='Trao đổi thành công. Vật phẩm đã được chuyển cho hai bên.'
                    else:
                        c.execute('UPDATE inventory SET quantity=quantity+? WHERE user_id=? AND item=?',(t['give_qty'],t['from_user'],t['give_item']))
                        status='rejected' if action=='reject' else 'cancelled'
                        c.execute('UPDATE trades SET status=?,updated_at=? WHERE id=?',(status,now,trade_id))
                        msg='Đã từ chối giao dịch và hoàn lại vật phẩm.' if action=='reject' else 'Đã hủy giao dịch và hoàn lại vật phẩm.'
                    c.commit(); self.send_json(200, {'message':msg}); return

                self.send_json(404, {'error':'Không tìm thấy API.'})
            except sqlite3.Error as exc:
                try: c.rollback()
                except Exception: pass
                self.send_json(500, {'error':'Lỗi cơ sở dữ liệu. Vui lòng thử lại.'})

init_db()
if __name__ == '__main__':
    print(f'Moon Legend RPG đang chạy tại http://{HOST}:{PORT}')
    print('Nhấn Ctrl+C để dừng máy chủ. Dữ liệu tài khoản lưu trong thư mục data/.')
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
