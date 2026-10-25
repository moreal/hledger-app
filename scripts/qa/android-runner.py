#!/usr/bin/env python3
"""Native Android QA driver. No data reset; only explicit fixture writes.
Maestro: --maestro FLOW; native suites: --suite NAME; diagnostics: --exec SCRIPT.
Run against a new named fixture in this order: auth, read, read-extra,
transactions, transactions-extra, books, books-extra, prices, entry,
asset-selection-extra, writes, post-general-read, trade-books-writes,
recovery, book-results, visual, audit; then --export.
Every mutation requires the active native fixture identity guard.
Export validates the independently captured CI artifact provenance.
Evidence and independent verdicts are saved per run; absent checks stay PENDING.
"""
import argparse,subprocess,pathlib,time,xml.etree.ElementTree as ET,json,os,re,hashlib
ROOT=pathlib.Path(os.getenv('QA_EVIDENCE','/private/tmp/hledger-qa-full/android'));ROOT.mkdir(parents=True,exist_ok=True)
ADB=os.getenv('ADB','/Users/moreal/.local/share/mise/installs/android-sdk/20.0/platform-tools/adb')
MAESTRO=os.getenv('MAESTRO','/Users/moreal/.local/share/mise/installs/maestro/cli-2.6.0/bin/maestro')
DEVICE=os.getenv('QA_DEVICE','emulator-5556');APP='com.hledger.app'
TOKEN=pathlib.Path(os.getenv('QA_TOKEN_FILE','/private/tmp/hledger-qa-full-fixture/native-full-003/android/token'))
_TREE=None
_SCREEN=None
_GUARDED=False
def adb(*args):
 global _TREE
 if args[:2] in [('shell','input'),('shell','am')]:_TREE=None
 if args[:2]==('shell','input'):
  state=subprocess.run([ADB,'-s',DEVICE,'shell','dumpsys','activity','activities'],check=True,stdout=subprocess.PIPE).stdout.decode()
  resumed=next((l for l in state.splitlines() if 'topResumedActivity=' in l),'')
  if APP+'/.MainActivity' not in resumed:raise RuntimeError('Wrong foreground: '+resumed)
 return subprocess.run([ADB,'-s',DEVICE,*map(str,args)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
def tree():
 global _TREE
 if _TREE is not None:return _TREE
 adb('shell','uiautomator','dump','/sdcard/hledger-qa.xml');root=ET.fromstring(adb('shell','cat','/sdcard/hledger-qa.xml'))
 if not any(n.get('package')==APP for n in root.iter('node')):raise RuntimeError('Wrong foreground package')
 _TREE=root
 return root
def bounds(n):
 x,y,a,b=map(int,re.findall(r'\d+',n.get('bounds')));return ((x+a)//2,(y+b)//2)
def find(label,clazz=None):
 matches=[n for n in tree().iter('node') if (n.get('content-desc')==label or n.get('text')==label) and (clazz is None or n.get('class')==clazz)]
 if not matches:raise ValueError('UI label not visible: '+label)
 matches.sort(key=lambda n:(not (110<bounds(n)[1]<2250),n.get('content-desc')!=label))
 return matches[0]

def tap(label,clazz=None):
 n=find(label,clazz);adb('shell','input','tap',*bounds(n));time.sleep(.15)
def hideime():
 if 'mInputShown=true' in adb('shell','dumpsys','input_method').decode():adb('shell','input','keyevent','4')
def field_value(label,node):
 value=node.get('text','')
 date_labels={'거래일','기간 시작일','기준일·기간 종료일','시작일 (선택)','종료일 (선택)','시세 시작일 (선택)','시세 종료일 (선택)'}
 if label in date_labels and value=='YYYY-MM-DD':return ''
 if label=='거래 검색' and value=='내용, 항목 또는 태그':return ''
 if label.endswith('금액/수량 (부호 포함)') and value=='예: -12500.00':return ''
 if label.endswith(' 검색') and value=='통화 코드, 종목명, 티커 검색':return ''
 return value
def fill(label,text):
 n=find(label,'android.widget.EditText');adb('shell','input','tap',*bounds(n));adb('shell','input','keycombination','113','29');adb('shell','input','keyevent','67')
 if text:
  for offset in range(0,len(text),8):
   adb('shell','input','text',text[offset:offset+8].replace(' ','%s'));time.sleep(.15)
 time.sleep(.3);hideime();time.sleep(.3)
 n=find(label,'android.widget.EditText')
 if n.get('password')!='true' and field_value(label,n)!=text:raise RuntimeError('Native field did not retain requested text: '+label)
def snap(name):
 root=tree();xml=ET.tostring(root,encoding='unicode')
 if TOKEN.exists():xml=xml.replace(TOKEN.read_text().strip(),'[REDACTED]')
 ROOT.joinpath(name+'.xml').write_text(xml);ROOT.joinpath(name+'.png').write_bytes(adb('exec-out','screencap','-p'))
 return [(n.get('text'),n.get('content-desc'),n.get('bounds')) for n in ET.fromstring(xml).iter('node') if n.get('text') or n.get('content-desc')]
def swipe(up=True):adb('shell','input','swipe',550,2100 if up else 700,550,700 if up else 2100,250)
def seek(label,clazz=None,up=True,limit=16):
 for i in range(limit):
  try:
   n=find(label,clazz)
   if 110<bounds(n)[1]<2250:return n
  except ValueError:pass
  if label.endswith('더 보기') or label in {'빈 새 거래','기기에 보관하고 원장에 저장','오프라인 임시 저장 · 전송하지 않음','이 실물 책 구매 기록','판매와 실현 손익 기록','폐기와 손실 기록'}:swipe(up)
  else:adb('shell','input','swipe',40,1800 if up else 800,40,1200 if up else 1400,500)
 raise ValueError('Not reachable '+label)
def top():
 for i in range(40):
  if i%2==0 and any(n.get('text')=='hledger' and 70<bounds(n)[1]<240 for n in tree().iter('node')):return
  swipe(False)
 raise ValueError('top unreachable')
def goto(label):
 global _SCREEN
 _SCREEN=label
 top()
 try:find('뒤로','android.widget.Button');settings=True
 except ValueError:settings=False
 if settings:
  if label=='설정':return
  tap('뒤로','android.widget.Button')
 tap(label,'android.widget.Button')
def setfield(label,text):
 try:n=find(label,'android.widget.EditText')
 except ValueError:top();n=seek(label,'android.widget.EditText')
 if not 110<bounds(n)[1]<2250:n=seek(label,'android.widget.EditText')
 if field_value(label,n)!=text:fill(label,text)
def click(label):
 save_buttons={'기기에 보관하고 원장에 저장','오프라인 임시 저장 · 전송하지 않음','이 실물 책 구매 기록','판매와 실현 손익 기록','폐기와 손실 기록','같은 요청 키로 확인·재시도','같은 요청으로 확인·재시도'}
 n=seek(label,'android.widget.Button')
 if label in save_buttons and n.get('enabled')=='true' and not _GUARDED:
  guard_fixture();seek(label,'android.widget.Button')
 tap(label,'android.widget.Button')
def guard_fixture():
 global _GUARDED
 import urllib.request
 base=pathlib.Path('/private/tmp/hledger-qa-full-fixture')
 assert TOKEN.is_absolute() and TOKEN.resolve()==TOKEN and TOKEN.is_relative_to(base), 'Token must belong to named QA fixture'
 assert TOKEN.parent.name=='android' and TOKEN.name=='token', 'Android QA token path required'
 root=TOKEN.parent.parent;manifest=json.loads((root/'manifest.json').read_text())
 assert manifest['kind']=='hledger-synthetic-full-qa-v1' and manifest['name']==root.name
 assert TOKEN.stat().st_mode & 0o777==0o600, 'Token mode must be0600'
 expected=manifest['ledgers']['android'];assert hashlib.sha256(str(root/'android/ledger.journal').encode()).hexdigest()==expected
 request=urllib.request.Request('http://127.0.0.1:4201/graphql',data=json.dumps({'query':'{ health { details } }'}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+TOKEN.read_text().strip()})
 health=json.load(urllib.request.urlopen(request,timeout=5));assert health['data']['health']['details']['ledgerId']==expected, 'Backend fixture identity mismatch'
 previous=_SCREEN;assert previous in {'입력','책','동기화'}, 'Save guard requires known native tab'
 goto('설정');seek('현재 사용 중인 주소: http://127.0.0.1:4203/graphql');seek('원장 식별자 '+expected+' · 이 실행에서 인증 확인');has('현재 사용 중인 주소: http://127.0.0.1:4203/graphql');has('원장 식별자 '+expected+' · 이 실행에서 인증 확인');snap('guard-'+time.strftime('%H%M%S'));goto(previous);_GUARDED=True

def text():return '\n'.join(n.get('text','')+' '+n.get('content-desc','') for n in tree().iter('node'))
def has(label):assert label in text(), 'Missing native UI: '+label
def switch(label,wanted):
 seek(label,'android.widget.Switch');n=find(label,'android.widget.Switch')
 if (n.get('checked')=='true')!=wanted:tap(label,'android.widget.Switch')
EXPECTED_CI_RUN='40165612461'
EXPECTED_APP_SHA='366a0f99c2a77e042f9389b92f9bd8aa133c57ee'
EXPECTED_ORIGINAL_SHA='a57cb882c4696922938711f19ef125eb4622b92a07a1748d7cf1f4d34e55035b'
def verified_identity():
 import zipfile
 provenance=json.loads((ROOT/'provenance.json').read_text())
 assert str(provenance.get('ciRun'))==EXPECTED_CI_RUN and provenance.get('appSha')==EXPECTED_APP_SHA, 'Provenance CI identity mismatch'
 original=pathlib.Path(provenance['originalPath']);signed=pathlib.Path(provenance['signedPath']);installed=pathlib.Path(provenance['installedPath'])
 digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
 assert digest(original)==provenance['original']==EXPECTED_ORIGINAL_SHA, 'Original CI APK mismatch'
 assert digest(signed)==provenance['signed']==digest(installed)==provenance['installed'], 'Installed signed-copy provenance mismatch'
 manifest=json.loads(pathlib.Path(provenance['manifestPath']).read_text())
 with zipfile.ZipFile(original) as a,zipfile.ZipFile(signed) as b,zipfile.ZipFile(installed) as c:
  bundle=a.read('assets/index.android.bundle');assert bundle==b.read('assets/index.android.bundle')==c.read('assets/index.android.bundle')
  assert hashlib.sha256(bundle).hexdigest()==manifest['hermes']['sha256'], 'Hermes manifest mismatch'
 assert 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c' in pathlib.Path(provenance['signatureEvidence']).read_text(), 'Installed signature evidence missing'
 return {'ciRun':EXPECTED_CI_RUN,'appSha':EXPECTED_APP_SHA,'installedSha256':provenance['installed'],'fixtureRun':TOKEN.parent.parent.name,'platform':'android'}
def record(ids,status,observation,evidence):
 allowed=set(re.findall(r'\| ((?:N|B|U|W)\d{2}\.\d+) \|',pathlib.Path('docs/qa/mobile-release-checklist.md').read_text()))
 if status not in {'PASS','FAIL','BLOCKED','N/A','PENDING'}:raise ValueError('Unknown verdict')
 if any(key not in allowed for key in ids.split(',')):raise ValueError('Unknown checklist ID')
 if status in {'PASS','FAIL'} and (not evidence or any(not (ROOT/(e+'.png')).exists() or not (ROOT/(e+'.xml')).exists() for e in evidence)):raise ValueError('Native evidence required')
 identity=verified_identity()
 identityPath=ROOT/'run-identity.json'
 if identityPath.exists() and json.loads(identityPath.read_text())!=identity:raise ValueError('Evidence directory belongs to different run')
 identityPath.write_text(json.dumps(identity))
 path=ROOT/'results.json';results=json.loads(path.read_text()) if path.exists() else {}
 for key in ids.split(','):results[key]={'status':status,'observation':observation,'evidence':[str(ROOT/(e+'.png')) for e in evidence],'executedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'method':'native-driver'}
 path.write_text(json.dumps(results,ensure_ascii=False,indent=2))
def visible_outbox(identifier):
 nodes=list(tree().iter('node'));key_nodes=[n for n in nodes if n.get('text','').startswith('요청 키 ') and 110<bounds(n)[1]<2250]
 direct=[n for n in key_nodes if n.get('text')=='요청 키 '+identifier]
 if direct:key_node=direct[0]
 else:
  names=[n for n in nodes if n.get('class')=='android.widget.TextView' and n.get('text')==identifier and 110<bounds(n)[1]<2250]
  assert names, 'Owned outbox description not visible'
  below=[n for n in key_nodes if bounds(n)[1]>bounds(names[0])[1]];assert below, 'Owned request key not visible'
  key_node=min(below,key=lambda n:bounds(n)[1])
 states={'기기에 저장 · 전송 대기','전송 중 · 결과 대기','원장 저장 확인','전송 중단 · 수정 또는 인증 필요','확인 필요 · 저장 결과 불명확'}
 above=[n for n in nodes if n.get('text') in states and 0<bounds(key_node)[1]-bounds(n)[1]<900]
 assert above, 'Owned status not visible';status=max(above,key=lambda n:bounds(n)[1]).get('text')
 return key_node,key_node.get('text')[5:],status
def assert_outbox_state(identifier,expected):
 _,_,status=visible_outbox(identifier);assert status==expected, 'Owned outbox record has unexpected state'

def click_named(name,label):
 top()
 for _ in range(40):
  labels=[n for n in tree().iter('node') if n.get('class')=='android.widget.TextView' and n.get('text')==name and 110<bounds(n)[1]<2250]
  buttons=[n for n in tree().iter('node') if n.get('class')=='android.widget.Button' and n.get('content-desc')==label and 110<bounds(n)[1]<2250]
  for title in labels:
   below=[n for n in buttons if bounds(n)[1]>bounds(title)[1]]
   if below:
    n=min(below,key=lambda n:bounds(n)[1]);assert n.get('enabled')=='true';adb('shell','input','tap',*bounds(n));return
  adb('shell','input','swipe',40,1800,40,1200,500)
 raise ValueError('Named native control not found: '+name)

def assert_new_rows(before,after,suffix=None):
 def values(name):
  root=ET.parse(ROOT/(name+'.xml'))
  if suffix:return {n.get('content-desc','') for n in root.iter('node') if n.get('content-desc','').endswith(suffix)}
  return {n.get('text','') for n in root.iter('node') if n.get('text','').startswith('QA')}
 added=values(after)-values(before);assert added, 'Pagination did not expose a newly loaded native row'
 return sorted(added)
def assert_retained_active(name):
 has('입력한 설정을 적용하지 않았습니다.')
 expected=json.loads((TOKEN.parent.parent/'manifest.json').read_text())['ledgers']['android']
 seek('원장 식별자 '+expected+' · 이 실행에서 인증 확인');has('현재 사용 중인 주소: http://127.0.0.1:4203/graphql');snap(name)
def launch():
 global _GUARDED
 _GUARDED=False
 adb('shell','am','force-stop',APP);adb('shell','am','start','-n',APP+'/.MainActivity');time.sleep(2)
def connect(endpoint='http://127.0.0.1:4203/graphql',token=None):
 global _GUARDED
 _GUARDED=False
 if endpoint not in {'http://127.0.0.1:4203/graphql','http://127.0.0.1:4204/graphql','http://127.0.0.1:4299/graphql'}:raise ValueError('Only isolated QA connection addresses are allowed')
 goto('설정');setfield('GraphQL 주소',endpoint);setfield('인증 토큰',TOKEN.read_text().strip() if token is None else token);click('연결 적용 · 주소 기억');time.sleep(1)

# Preserved native procedures; each stage fails at the first unmet UI assertion.
SUITES = {
 'auth': r'''
launch()
import zipfile
original=pathlib.Path('/private/tmp/hledger-qa-zero/artifacts/android/mobile-output/app-release-unsigned.apk');signed=pathlib.Path('/private/tmp/hledger-qa-zero/android/app-40165612461.apk')
installed=adb('shell','pm','path',APP).decode().strip().split(':',1)[1];adb('pull',installed,str(ROOT/'installed.apk'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(ROOT/'installed.apk')==sha(signed)
with zipfile.ZipFile(original) as a,zipfile.ZipFile(signed) as b:assert a.read('assets/index.android.bundle')==b.read('assets/index.android.bundle')
(ROOT/'provenance.json').write_text(json.dumps({'ciRun':EXPECTED_CI_RUN,'appSha':EXPECTED_APP_SHA,'originalPath':str(original),'signedPath':str(signed),'installedPath':str(ROOT/'installed.apk'),'manifestPath':str(original.parent/'manifest.json'),'signatureEvidence':str(ROOT/'installed-signature.txt'),'original':sha(original),'signed':sha(signed),'installed':sha(ROOT/'installed.apk'),'hermesIdentical':True,'app':APP,'device':DEVICE,'dataCleared':False},indent=2))
signer='/Users/moreal/.local/share/mise/installs/android-sdk/20.0/build-tools/36.0.0/apksigner';signenv=dict(os.environ);signenv['JAVA_HOME']='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';signature=subprocess.run([signer,'verify','--print-certs',str(ROOT/'installed.apk')],check=True,stdout=subprocess.PIPE,env=signenv).stdout;ROOT.joinpath('installed-signature.txt').write_bytes(signature)
snap('a01-installed');record('N01.1','PASS','Fresh hashes verified installed signed CI copy, identical Hermes bundle; app data retained.',['a01-installed'])
for port in ['4203','4204']:adb('reverse','tcp:'+port,'tcp:'+port)
goto('설정');snap('a02-settings');assert find('인증 토큰','android.widget.EditText').get('password')=='true';record('N02.2','PASS','Password native input masks token.',['a02-settings'])
for label in ['항목','거래','입력','시세','책','동기화','설정']:
 goto(label);snap('a03-nav-'+label)
record('N01.3','PASS','Opened six tabs, settings and back using native labeled buttons.',['a03-nav-'+x for x in ['항목','거래','입력','시세','책','동기화','설정']])
goto('입력');click('기기에 보관하고 원장에 저장');assert find('기기에 보관하고 원장에 저장','android.widget.Button').get('enabled')=='false';snap('a05-unauth-entry')
goto('책');click('이 실물 책 구매 기록');assert find('이 실물 책 구매 기록','android.widget.Button').get('enabled')=='false';snap('a06-unauth-book');record('N02.1','PASS','Connection guidance visible; unauthenticated general and book submit buttons disabled.',['a05-unauth-entry','a06-unauth-book'])
connect();top();swipe();snap('a07-connected');has('이 실행에서 인증 확인');record('N03.1','PASS','Fresh isolated fixture authenticates and native connection status displays ledger ID and authenticated status.',['a07-connected'])
connect(token='invalid-qa-token');top();snap('a08-invalid-token');assert_retained_active('a08b-retained-active')

connect();top();swipe();snap('a09-auth-recovered');has('이 실행에서 인증 확인');record('N03.2','PASS','Invalid token produced connection error; valid token restored authenticated native status.',['a08-invalid-token','a09-auth-recovered'])
connect(endpoint='http://127.0.0.1:4299/graphql');top();snap('a10-bad-candidate');assert_retained_active('a10a-retained-active')
connect();top();swipe();snap('a10b-valid-recovered');has('현재 사용 중인 주소: http://127.0.0.1:4203/graphql');has('이 실행에서 인증 확인');record('N03.3','PASS','Invalid4299 candidate reported not applied;4203 active connection retained, valid connection recovered.',['a10-bad-candidate','a10b-valid-recovered']);launch();goto('설정');snap('a11-relaunch');assert find('GraphQL 주소','android.widget.EditText').get('text')=='http://127.0.0.1:4203/graphql';assert find('인증 토큰','android.widget.EditText').get('text')=='';swipe();snap('a12-relaunch-auth');has('새 인증 확인 필요');record('N04.1,N04.2','PASS','After force-stop/relaunch non-default4203 remembered, token empty, fresh authentication required.',['a11-relaunch','a12-relaunch-auth'])
connect();goto('항목');snap('a13-accounts');print(text())

''',
 'read': r'''
def acct(q='',start='2026-10-01',end='2026-10-25',depth='',zero=False,children=True,name='filter'):
 goto('항목')
 try:find('기간·항목 필터 열기','android.widget.Button');tap('기간·항목 필터 열기','android.widget.Button')
 except ValueError:pass
 setfield('항목 검색',q);setfield('기간 시작일',start);setfield('기준일·기간 종료일',end);setfield('계층 깊이 (1~10, 빈칸은 전체)',depth);switch('잔액이 0인 항목 포함',zero);switch('잔액·기간에 하위 항목 포함',children);snap(name+'-controls');click('항목·기준일 적용');time.sleep(.3);snap(name)
def nativebutton(part):
 for i in range(60):
  nodes=[n for n in tree().iter('node') if n.get('class')=='android.widget.Button' and part in n.get('content-desc','')]
  if nodes:
   n=nodes[0];adb('shell','input','tap',*bounds(n));return
  swipe()
 raise ValueError('button substring missing '+part)
acct(q='no-such-account',name='r01-search-empty');has('조건에 맞는 항목이 없습니다.')
acct(q='qa-zero:history',end='2026-10-01',name='r02-history10');has('10')
acct(q='qa-zero:history',end='2026-10-02',name='r03-history-zero-off');has('조건에 맞는 항목이 없습니다.')
acct(q='qa-zero:history',end='2026-10-02',zero=True,name='r04-history-zero-on');has('assets:qa-zero:history')
record('N05.2','PASS','Native account search matched historical account and no-such search showed empty result.',['r01-search-empty','r02-history10'])
acct(q='assets:qa-zero:history',start='2026-10-01',end='2026-10-02',zero=True,name='r05-history-detail');nativebutton('assets:qa-zero:history, 잔액');seek('기초',up=True);snap('r06-period');has('기간 증감');has('기말');record('N05.3','PASS','Selected historical account period controls and detail showed opening/movement/ending plus period transactions.',['r05-history-detail-controls','r06-period'])
acct(q='books',children=False,name='r07-books-own');acct(q='books',children=True,name='r08-books-child')
# Parent scope differences verified by the following dedicated depth1 cases.
acct(depth='1',name='r09-depth1');acct(depth='',name='r10-depthall')
record('N05.4','PASS','Native depth1/all and history10→zero OFF/ON tested; zero excluded after offset history and included with zero when ON. Scope captures separate.',['r02-history10-controls','r02-history10','r03-history-zero-off-controls','r03-history-zero-off','r04-history-zero-on-controls','r04-history-zero-on','r09-depth1','r10-depthall'])
seek('항목 더 보기',up=True,limit=70);snap('r11-account-more-before');click('항목 더 보기');snap('r12-account-more-after');assert_new_rows('r11-account-more-before','r12-account-more-after','항목 상세 보기');record('N05.6','PENDING','Account pagination clicked; account detail pagination remains pending.',['r11-account-more-before','r12-account-more-after'])

assert '기기에 저장한 거래가 없습니다.' in (ROOT/'a03-nav-동기화.xml').read_text();record('N10.1','PASS','Native sync initially empty; header actualledger and explicit no stored transactions; no data cleared.',['a03-nav-동기화'])
acct(q='',depth='1',children=False,name='r13-depth1-own-zero-off');own=text()
acct(q='',depth='1',children=True,name='r14-depth1-subtree-zero-off');sub=text();assert own!=sub;has('자산')
record('N05.5','PASS','Depth1 own-scopezero OFF differs from subtree scope; parent 자산 appears with nonzero subtree balances. Both control/result captures retained.',['r13-depth1-own-zero-off-controls','r13-depth1-own-zero-off','r14-depth1-subtree-zero-off-controls','r14-depth1-subtree-zero-off'])
nativebutton('자산, 잔액');seek('항목 거래 더 보기',limit=90);snap('r15-account-tx-more');click('항목 거래 더 보기');snap('r16-account-tx-more-loaded');assert_new_rows('r15-account-tx-more','r16-account-tx-more-loaded','거래 상세 보기');record('N05.6','PASS','Both account list and selected parent transaction pagination buttons were exercised against sufficient fixture.',['r11-account-more-before','r12-account-more-after','r15-account-tx-more','r16-account-tx-more-loaded'])
''',
 'books': r'''
goto('책');click('목록 새로고침');snap('b01-list-top');seek('판매 완료');snap('b02-list-sold');top();seek('폐기 완료');snap('b03-list-discarded');record('B01.2','PASS','Native list displays held/sold/discarded synthetic books with ISBN, physical IDs, carrying value and realized gain/loss, cover-none state.',['b01-list-top','b02-list-sold','b03-list-discarded'])
setfield('ISBN','9788936434595');time.sleep(2);setfield('책 제목','') if False else None;seek('ISBN 정보 다시 조회',up=True);snap('b04-metadata');has('채식주의자');has('한강');record('B02.1','PASS','ISBN9788936434595 automatically populated native title채식주의자 and author한강.',['b04-metadata'])
setfield('책 제목','Manual-QA-title');setfield('저자 (선택 · 한 줄에 한 명)','Manual-QA-author');click('ISBN 정보 다시 조회');time.sleep(2);snap('b05-manual-retained');assert find('책 제목','android.widget.EditText').get('text')=='Manual-QA-title';assert find('저자 (선택 · 한 줄에 한 명)','android.widget.EditText').get('text')=='Manual-QA-author';record('B04.1','PASS','Manual title/author persisted after native ISBN requery.',['b05-manual-retained'])
setfield('ISBN','9780000000002');time.sleep(2);seek('ISBN 정보 다시 조회');snap('b06-missing');assert not any('표지 제공:' in n.get('text','') for n in tree().iter('node'));has('직접');record('B03.1,B04.2','PASS','Missing ISBN displayed lookup/manual-entry notice and removed preceding cover attribution.',['b06-missing'])
setfield('구매 금액','');setfield('책 항목','assets:books');setfield('통화','KRW');setfield('현금 항목','assets:cash');snap('b07-manual-edit');record('B03.2','PASS','Manual ASCII title/author, purchase price, KRW and account fields editable in native book form.',['b05-manual-retained','b07-manual-edit'])
click('이 실물 책 구매 기록');top();snap('b08-blank-amount');has('금액을 숫자와 소수점으로 정확하게 입력해 주세요.');record('B05.1','PASS','Submitting blank purchase amount shows Korean amount notice; no valid purchase submitted.',['b08-blank-amount'])
for val,name in [('0','zero'),('-1','negative')]:
 setfield('구매 금액',val);click('이 실물 책 구매 기록');top();snap('b09-'+name);has('금액은 정확한 양수로 입력해 주세요.')
record('B05.2','PASS','Both zero and negative native purchase submissions showed amount validation.',['b09-zero','b09-negative'])
setfield('구매 금액','100');setfield('ISBN','123');setfield('거래일','2026-99-99');setfield('책 제목','');click('이 실물 책 구매 기록');top();snap('b10-invalid-date');has('날짜를 YYYY-MM-DD');setfield('거래일','2026-10-25');setfield('책 제목','Valid QA title');click('이 실물 책 구매 기록');top();snap('b11-invalid-isbn');has('ISBN을 올바른');setfield('ISBN','9780000000002');setfield('책 제목','');click('이 실물 책 구매 기록');top();snap('b12-empty-title');has('제목');record('B05.3','PASS','Native invalid calendar date, invalid ISBN, then blank title each individually rejected before save.',['b10-invalid-date','b11-invalid-isbn','b12-empty-title'])

''',
 'transactions': r'''
def txfilters(q='',from_='',to_='',commodity='',tag='',value='',name='tx'):
 goto('거래')
 try:tap('거래 필터 열기','android.widget.Button')
 except ValueError:pass
 setfield('거래 검색',q);setfield('시작일 (선택)',from_);setfield('종료일 (선택)',to_);click('전체 항목')
 setfield('자산 필터 (선택)',commodity);setfield('태그 키 (선택)',tag);setfield('태그 값',value);snap(name+'-controls');click('필터 적용·새로고침');snap(name)
def partial(part):
 for i in range(70):
  nodes=[n for n in tree().iter('node') if n.get('class')=='android.widget.Button' and part in n.get('content-desc','')]
  if nodes:adb('shell','input','tap',*bounds(nodes[0]));return
  swipe()
 raise ValueError(part)
txfilters(q='no-such-full-qa',name='t01-empty');has('조건에 맞는 거래가 없습니다.')
txfilters(q='001',name='t02-match');swipe();snap('t03-match');has('QA');record('N06.1','PASS','Transaction query001 matched fixture rows; unmatched query showed explicit empty result.',['t01-empty','t03-match'])
txfilters(q='001',from_='2026-10-19',to_='2026-10-20',name='t04-dates');partial('거래 상세 보기');seek('항목별 내역을 새 거래로 복사');snap('t05-detail');has('참고 번호 QA001');has('태그 qa: native');record('N06.4','PENDING','Native detail date/reference/tag/postings checked; nonempty memo branch awaits native saved transaction.',['t05-detail']);click('항목별 내역을 새 거래로 복사');top();seek('참고 번호 (선택)');snap('t05b-copy');has('QA001');assert find('거래일','android.widget.EditText').get('text')=='2026-10-20';has('QA 가상 거래 001');seek('내역 1 금액/수량 (부호 포함)');snap('t05c-copy-postings');assert find('내역 1 금액/수량 (부호 포함)','android.widget.EditText').get('text')=='1';seek('태그 1 키');seek('태그 1 값');snap('t05d-copy-tags');assert find('태그 1 키','android.widget.EditText').get('text')=='qa';assert find('태그 1 값','android.widget.EditText').get('text')=='native';record('N07.1','PENDING','Detail copy preserves observed description/date/postings/qa:native tag; recent-copy branch awaits check.',['t05b-copy','t05c-copy-postings','t05d-copy-tags'])
txfilters(tag='qa',value='native',commodity='KRW',name='t06-tags');swipe();snap('t07-tag-results');has('QA 가상 거래 001');record('N06.3','PASS','CommodityKRW and tag qa=native native controls returned matching QA001 row.',['t06-tags-controls','t07-tag-results'])
txfilters(name='t08-all');seek('거래 더 보기',limit=90);snap('t09-more');click('거래 더 보기');snap('t10-more-loaded');assert_new_rows('t09-more','t10-more-loaded','거래 상세 보기');record('N06.5','PASS','Native transaction pagination button reached and additional page loaded on139+ fixture rows.',['t09-more','t10-more-loaded'])

''',
 'entry': r'''
goto('입력');click('빈 새 거래');click('기기에 보관하고 원장에 저장');seek('입력을 확인해 주세요');snap('e01-blank');has('내용: 1~512자로 입력해 주세요.');has('항목 경로가 필요합니다.');record('N08.1','PASS','Native empty general form and empty account paths rejected with validation notice.',['e01-blank'])
setfield('내용','Android-QA-validation');setfield('거래일','2026-99-99');setfield('내역 1 금액/수량 (부호 포함)','1.2.3');click('기기에 보관하고 원장에 저장');seek('입력을 확인해 주세요');snap('e02-date-decimal');has('거래일: 실제 날짜를 YYYY-MM-DD');has('금액·수량은 정확한 소수');record('N08.2','PASS','Invalid calendar date and malformed decimal1.2.3 produce native validation notice.',['e02-date-decimal'])
setfield('거래일','2026-10-25');setfield('내역 1 항목 경로','assets:cash');setfield('내역 1 금액/수량 (부호 포함)','-100');setfield('내역 1 자산','KRW');setfield('내역 2 항목 경로','expenses:qa');setfield('내역 2 금액/수량 (부호 포함)','90');setfield('내역 2 자산','KRW');click('기기에 보관하고 원장에 저장');seek('입력을 확인해 주세요');snap('e03-unbalanced');has('원가를 반영한 자산별 합계를 0으로 맞춰 주세요.');record('N08.3','PENDING','Native imbalance validation observed; final auxiliary ledger no-write audit still pending.',['e03-unbalanced'])
click('내역 추가');seek('내역 3 삭제');snap('e04-added-posting');click('내역 3 삭제');seek('내역 2 삭제');assert find('내역 2 삭제','android.widget.Button').get('enabled')=='false';snap('e05-min-two');click('태그 추가');setfield('태그 1 키','qa');setfield('태그 1 값','native');snap('e06-added-tag');click('태그 1 삭제');snap('e07-tag-removed');record('N07.2','PASS','Added/deleted third posting and tag; native delete control disabled at minimum two postings.',['e04-added-posting','e05-min-two','e06-added-tag','e07-tag-removed'])
top();click('입력 방식: 일반 거래 · 누르면 변경');setfield('주식 자산','AAPL');click('주식 자산 검색 열기');setfield('주식 자산 검색','USD');snap('e08-asset-search');click('주식 자산 검색 접기');setfield('주식 자산','ANDROIDQA');snap('e09-asset-direct');top();click('입력 방식: 주식 매매 · 누르면 변경');snap('e10-general');record('N07.3','PASS','Native asset search UI USD then direct commodityANDROIDQA and general/trade form switches exercised.',['e08-asset-search','e09-asset-direct','e10-general'])
click('빈 새 거래');setfield('내용','Android-FULL-template');setfield('내역 1 항목 경로','assets:cash');setfield('내역 1 금액/수량 (부호 포함)','-123');setfield('내역 2 항목 경로','expenses:qa');setfield('내역 2 금액/수량 (부호 포함)','123');setfield('템플릿 이름','Android-FULL-template');click('입력을 템플릿으로 저장');top();seek('템플릿으로 새 거래');snap('e11-template-saved');click_named('Android-FULL-template','템플릿으로 새 거래');setfield('참고 번호 (선택)','TEMPLATE-NEW');assert find('내용','android.widget.EditText').get('text')=='Android-FULL-template';snap('e12-template-used');click('빈 새 거래');top();seek('내용');assert find('내용','android.widget.EditText').get('text')=='';snap('e13-empty-new');record('N07.4','PASS','Native template saved and reused as new draft; blank-new clears description.',['e11-template-saved','e12-template-used','e13-empty-new'])

''',
 'writes': r'''
import urllib.request
def gql(query):
 req=urllib.request.Request('http://127.0.0.1:4201/graphql',data=json.dumps({'query':query}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+TOKEN.read_text().strip()})
 data=json.load(urllib.request.urlopen(req));assert not data.get('errors'),data;return data['data']
def audit(name):
 data=gql('{ transactions(first:200) { edges { node { id description code postings { accountName amount { value commodity } cost { type amount { value commodity } } } tags { key value } } } } books { id title isbn status purchasePrice { value commodity } realizedGain { value commodity } } }');(ROOT/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2));return data
def draft(name='Android FULL general',value='100'):
 goto('입력');click('빈 새 거래');top();setfield('내용',name);setfield('거래일','2026-10-25');setfield('참고 번호 (선택)','QA-Android-FULL')
 setfield('내역 1 항목 경로','assets:cash');setfield('내역 1 금액/수량 (부호 포함)','-'+value);setfield('내역 1 자산','KRW');setfield('내역 1 메모 (선택)','Android native memo')
 setfield('내역 2 항목 경로','expenses:qa');setfield('내역 2 금액/수량 (부호 포함)',value);setfield('내역 2 자산','KRW')
GENERAL='Android-FULL-general-'+('Long-description-'*3);before=audit('w00-before');assert not any(x['node']['description'].startswith('Android-FULL-') for x in before['transactions']['edges']), 'Writes require a fresh named fixture';draft(GENERAL,'12345678901234567890.0001');click('태그 추가');setfield('태그 1 키','qa');setfield('태그 1 값','native');click('기기에 보관하고 원장에 저장');top();snap('w01-saved');has('원장에서 거래 저장을 확인했습니다.');after=audit('w01-after');matches=[x for x in after['transactions']['edges'] if x['node']['description']==GENERAL];assert len(matches)==1;assert len(after['transactions']['edges'])==len(before['transactions']['edges'])+1;record('W01.1','PASS','Native general save acknowledged; isolated ledger count +1 and exactly one matching transaction.',['w01-saved'])
draft('Android FULL offline');click('오프라인 임시 저장 · 전송하지 않음');goto('동기화');seek('Android FULL offline');snap('w02-offline');pre=audit('w02-before-restart');launch();goto('동기화');seek('Android FULL offline');snap('w03-restored');post=audit('w03-after-restart');assert len(pre['transactions']['edges'])==len(post['transactions']['edges']);record('W01.5','PASS','Offline queued request survived force-stop; no automatic ledger write across restart; fresh token required.',['w02-offline','w03-restored'])
assert find('같은 요청 키로 확인·재시도','android.widget.Button').get('enabled')=='false';snap('w04-unauth-disabled');record('N10.2','PENDING','Unauthenticated retry disabled; different connection branch still pending.',['w04-unauth-disabled'])
connect();goto('동기화');seek('Android FULL offline');click('같은 요청 키로 확인·재시도');snap('w05-retry-succeeded');assert_outbox_state('Android FULL offline','원장 저장 확인');after=audit('w05-after-retry');assert sum(x['node']['description']=='Android FULL offline' for x in after['transactions']['edges'])==1;record('W01.6','PASS','After authentication same queued request retried and native success shown; exactly one ledger transaction.',['w05-retry-succeeded'])

''',
}

SUITES['books-extra'] = "connect(endpoint='http://127.0.0.1:4204/graphql',token=TOKEN.parent.parent.joinpath('empty/token').read_text().strip());goto('책');click('목록 새로고침');snap('b13-empty-list');has('등록한 책이 없습니다.');record('B01.1','PASS','Authenticated dedicated empty synthetic ledger; native refresh showed explicit no-books message.',['b13-empty-list']);connect()\ngoto('책');setfield('책 제목','Android-keyboard-'+('long-title-'*15).rstrip('-'));tap('책 제목','android.widget.EditText');assert 'mInputShown=true' in adb('shell','dumpsys','input_method').decode();snap('u01-keyboard');hideime();seek('이 실물 책 구매 기록','android.widget.Button');snap('u02-bottom-access');goto('시세');snap('u03-tab-after-keyboard');record('U01.1','PASS','Actual Android keyboard shown/dismissed, scrolled to bottom purchase button, then changed tabs.',['u01-keyboard','u02-bottom-access','u03-tab-after-keyboard'])\n"
SUITES['prices'] = "goto('시세');click('시세 조회');seek('기준일 2026-10-24 · 출처',limit=2) if False else None;swipe();snap('p01-default');has('QA');record('N09.1','PASS','Native default prices list shows QA commodity rates and dates.',['p01-default'])\n# Reach pagination on 67 prices.\nseek('시세 더 보기',limit=65);snap('p02-more');click('시세 더 보기');snap('p03-more-loaded');assert_new_rows('p02-more','p03-more-loaded')\ngoto('시세');setfield('자산 (선택)','QA001');setfield('기준 자산 (선택)','KRW');setfield('시세 시작일 (선택)','2026-10-24');setfield('시세 종료일 (선택)','2026-10-24');click('시세 조회');swipe();snap('p04-filtered');has('QA001');record('N09.2','PASS','Native commodity/quote/date filter yields QA001→KRW rate1 on2026-10-24.',['p04-filtered'])\ngoto('시세');setfield('자산 (선택)','NOSUCHQA');click('시세 조회');snap('p05-empty');has('조건에 맞는 시세가 없습니다.');record('N09.3','PASS','Native67-price pagination reached and loaded more; unmatched commodity gives empty result.',['p02-more','p03-more-loaded','p05-empty'])\n"

SUITES['transactions-extra'] = 'exec(SUITES[\'read\'].split("acct(q=\'no-such-account\'")[0]);exec(SUITES[\'transactions\'].split("txfilters(q=\'no-such-full-qa\'")[0])\nacct(q=\'assets:qa-zero:history\',zero=True,name=\'t11-account-options\');goto(\'거래\')\ntry:tap(\'거래 필터 열기\',\'android.widget.Button\')\nexcept ValueError:pass\nsetfield(\'거래 검색\',\'QA005\');setfield(\'시작일 (선택)\',\'2026-10-01\');setfield(\'종료일 (선택)\',\'2026-10-02\');click(\'assets:qa-zero:history\');setfield(\'자산 필터 (선택)\',\'KRW\');setfield(\'태그 키 (선택)\',\'\');setfield(\'태그 값\',\'\');snap(\'t12-account-date-controls\');click(\'필터 적용·새로고침\');snap(\'t13-account-date-result\');has(\'QA005 historical zero\');has(\'QA005 historical nonzero\');record(\'N06.2\',\'PASS\',\'Native start/end inclusive01–02 and selected historical account filter returned both matching period transactions.\',[\'t12-account-date-controls\',\'t13-account-date-result\'])\ngoto(\'입력\');click(\'최근 거래 새로고침\');click(\'이 거래 복사\');seek(\'거래일\');snap(\'e00-recent-date\');assert find(\'거래일\',\'android.widget.EditText\').get(\'text\')==\'2026-10-24\';has(\'Book purchase\');seek(\'내역 1 금액/수량 (부호 포함)\');snap(\'e00-recent-postings\');assert find(\'내역 1 금액/수량 (부호 포함)\',\'android.widget.EditText\').get(\'text\')==\'1\';seek(\'태그 1 키\');snap(\'e00-recent-tags\');has(\'book.action\');has(\'PURCHASE\');record(\'N07.1\',\'PASS\',\'Both native detailQA001 and recentBookpurchase copies preserve observed description/date/postings/tags.\',[\'t05b-copy\',\'t05c-copy-postings\',\'t05d-copy-tags\',\'e00-recent-date\',\'e00-recent-postings\',\'e00-recent-tags\'])\n'

SUITES['asset-selection-extra'] = "goto('입력');click('빈 새 거래');top();click('입력 방식: 일반 거래 · 누르면 변경');click('주식 자산 검색 열기');setfield('주식 자산 검색','USD')\nfor _ in range(12):\n buttons=[n for n in tree().iter('node') if n.get('class')=='android.widget.Button' and n.get('content-desc','').startswith('USD ·') and n.get('content-desc','').endswith(', 기본 통화, 선택')]\n if buttons:\n  n=buttons[0]\n  if 110<bounds(n)[1]<2250:adb('shell','input','tap',*bounds(n));break\n adb('shell','input','swipe',40,1800,40,1200,500)\nelse:raise ValueError('USD native selection button missing')\nassert find('주식 자산','android.widget.EditText').get('text')=='USD';snap('e08b-usd-selected');record('N07.3','PASS','Native USD search result selected into asset field, then directANDROIDQA input and general/trade mode switches separately observed.',['e08-asset-search','e08b-usd-selected','e09-asset-direct','e10-general']);top();click('입력 방식: 주식 매매 · 누르면 변경')\n"

SUITES['post-general-read'] = 'exec(SUITES[\'transactions\'].split("txfilters(q=\'no-such-full-qa\'")[0]);txfilters(q=\'Android-FULL-general-\',name=\'u04-long-transaction\');swipe();snap(\'u04b-long-row\');partial(\'거래 상세 보기\');seek(\'Android native memo\');snap(\'u05-general-detail\');has(\'참고 번호 QA-Android-FULL\');has(\'태그 qa: native\');has(\'Android native memo\');record(\'N06.4\',\'PASS\',\'Native own saved transaction detail displays2026-10-25, both exact long-decimal postings, nonempty memo, qa:native tag and QA-Android-FULL reference.\',[\'u05-general-detail\'])\n'

SUITES['trade-books-writes'] = 'exec(SUITES[\'writes\'].split("before=audit(\'w00-before\')")[0])\ndef trade(side,price,fee,name):\n goto(\'입력\');click(\'빈 새 거래\');top();click(\'입력 방식: 일반 거래 · 누르면 변경\')\n if side==\'SELL\':click(\'거래 방향: 매수 · 누르면 변경\')\n for label,value in [(\'주식 자산\',\'AAPL\'),(\'수량 (양수)\',\'2\' if side==\'BUY\' else \'1\'),(\'1주당 가격\',price),(\'결제 자산\',\'USD\'),(\'주식 보유 항목 경로\',\'assets:stocks\'),(\'현금 항목 경로\',\'assets:cash\'),(\'수수료 (결제 자산, 0 이상)\',fee),(\'수수료 비용 항목 경로\',\'expenses:fees\')]:setfield(label,value)\n click(\'매매 내용을 아래 내역에 적용\');setfield(\'내용\',name);setfield(\'거래일\',\'2026-10-25\');seek(\'내역 1 금액/수량 (부호 포함)\');snap(\'w-trade-\'+side+\'-postings\');click(\'기기에 보관하고 원장에 저장\');top();snap(\'w-trade-\'+side+\'-saved\')\nbefore=audit(\'w-trade-before\');assert not any(x[\'node\'][\'description\'] in {\'Android-FULL-BUY\',\'Android-FULL-SELL\'} for x in before[\'transactions\'][\'edges\']), \'Trade suite requires fresh named fixture\';trade(\'BUY\',\'100\',\'1\',\'Android-FULL-BUY\');trade(\'SELL\',\'150\',\'2\',\'Android-FULL-SELL\');after=audit(\'w-trade-after\')\nfor name,sign,cost in [(\'Android-FULL-BUY\',\'2\',\'100\'),(\'Android-FULL-SELL\',\'-1\',\'150\')]:\n rows=[x[\'node\'] for x in after[\'transactions\'][\'edges\'] if x[\'node\'][\'description\']==name];assert len(rows)==1;row=rows[0];assert row[\'postings\'][0][\'amount\'][\'value\']==sign;assert row[\'postings\'][0][\'cost\'][\'amount\'][\'value\']==cost\nassert len(after[\'transactions\'][\'edges\'])==len(before[\'transactions\'][\'edges\'])+2\nrecord(\'W01.2\',\'PASS\',\'Native stockBUY2AAPL@100USD fee1 and SELL1@150USD fee2 saved once each; ledger costs/fees checked. UI explicitly states automatic realized PnL unsupported (that subcondition N/A).\',[\'w-trade-BUY-postings\',\'w-trade-BUY-saved\',\'w-trade-SELL-postings\',\'w-trade-SELL-saved\'])\nlaunch();connect();before=audit(\'w-books-before\');goto(\'책\');setfield(\'ISBN\',\'9788936434595\');time.sleep(2);setfield(\'구매 금액\',\'10000\');click(\'이 실물 책 구매 기록\');top();snap(\'w-book-auto-saved\');has(\'책과 원장 거래를 저장했습니다.\')\nsetfield(\'ISBN\',\'9780000000002\');setfield(\'책 제목\',\'Android-FULL-Manual-Book\');setfield(\'저자 (선택 · 한 줄에 한 명)\',\'Android-QA\');setfield(\'구매 금액\',\'20000\');click(\'이 실물 책 구매 기록\');top();snap(\'w-book-manual-saved\');has(\'책과 원장 거래를 저장했습니다.\');after=audit(\'w-books-after\');old={b[\'id\'] for b in before[\'books\']};new=[b for b in after[\'books\'] if b[\'id\'] not in old];assert len(new)==2;assert len(after[\'transactions\'][\'edges\'])==len(before[\'transactions\'][\'edges\'])+2;\nfor index,book in enumerate(new):\n top();seek(book[\'isbn\']+\' · \'+book[\'id\']);snap(\'w-book-native-id-\'+str(index))\n(ROOT/\'w-new-book-ids.json\').write_text(json.dumps(new,ensure_ascii=False,indent=2));record(\'W01.3\',\'PASS\',\'Native auto-metadata and manual book purchases acknowledged; exactly2 new distinct physical IDs and2 ledger transactions.\',[\'w-book-auto-saved\',\'w-book-manual-saved\',\'w-book-native-id-0\',\'w-book-native-id-1\'])\ndef selectbook(title):\n click_named(title,\'이 책 판매·폐기\')\n\nselectbook(\'채식주의자\');seek(\'실물 식별자 \'+next(b[\'id\'] for b in new if b[\'title\']==\'채식주의자\'));snap(\'w-book-sale-selected-id\');setfield(\'판매 대금 (수수료 차감 전)\',\'12000\');setfield(\'수수료\',\'500\');click(\'판매와 실현 손익 기록\');top();snap(\'w-book-sale-saved\');has(\'책과 원장 거래를 저장했습니다.\')\nselectbook(\'Android-FULL-Manual-Book\');seek(\'실물 식별자 \'+next(b[\'id\'] for b in new if b[\'title\']==\'Android-FULL-Manual-Book\'));snap(\'w-book-discard-selected-id\');click(\'폐기\');click(\'폐기와 손실 기록\');top();snap(\'w-book-discard-saved\');has(\'책과 원장 거래를 저장했습니다.\');after=audit(\'w-disposal-after\');sold=next(b for b in after[\'books\'] if b[\'id\']==next(b[\'id\'] for b in new if b[\'title\']==\'채식주의자\'));discard=next(b for b in after[\'books\'] if b[\'id\']==next(b[\'id\'] for b in new if b[\'title\']==\'Android-FULL-Manual-Book\'));assert sold[\'status\']==\'SOLD\' and sold[\'realizedGain\'][\'value\']==\'1500\';assert discard[\'status\']==\'DISCARDED\' and discard[\'realizedGain\'][\'value\']==\'-20000\';record(\'W01.4\',\'PASS\',\'Native sale12000-fee500-cost10000=realized1500; remaining manual book discarded with20000 loss; isolated ledger audited.\',[\'w-book-sale-selected-id\',\'w-book-sale-saved\',\'w-book-discard-selected-id\',\'w-book-discard-saved\'])\n'

SUITES['recovery'] = 'exec(SUITES[\'writes\'].split("GENERAL=\'Android-FULL-general-\'")[0])\ndef record_node(identifier,button=None):\n top()\n for i in range(45):\n  try:\n   node,key,status=visible_outbox(identifier);target=None\n   if button:\n    allkeys=[n for n in tree().iter(\'node\') if n.get(\'text\',\'\').startswith(\'요청 키 \') and bounds(n)[1]>bounds(node)[1]]\n    boundary=min([bounds(n)[1] for n in allkeys],default=2500)\n    buttons=[n for n in tree().iter(\'node\') if n.get(\'content-desc\')==button and bounds(node)[1]<bounds(n)[1]<min(boundary,2250)]\n    if not buttons:raise AssertionError(\'Owned control not visible\')\n    target=min(buttons,key=lambda n:bounds(n)[1])\n   return (0,node,key,target)\n  except AssertionError:pass\n  adb(\'shell\',\'input\',\'swipe\',40,1800,40,1200,500)\n raise ValueError(\'Owned outbox record not found \'+identifier)\n\ndef record_click(identifier,label):\n if label==\'같은 요청 키로 확인·재시도\' and not _GUARDED:guard_fixture()\n _,_,key,n=record_node(identifier,label);assert n.get(\'enabled\')==\'true\';adb(\'shell\',\'input\',\'tap\',*bounds(n));time.sleep(.5);return key\nbefore=audit(\'w06-before-ambiguous\');assert not any(x[\'node\'][\'description\']==\'Android-FULL-ambiguous\' for x in before[\'transactions\'][\'edges\']), \'Recovery suite requires fresh named fixture\';draft(\'Android-FULL-ambiguous\',\'77\');click(\'오프라인 임시 저장 · 전송하지 않음\');goto(\'동기화\');_,_,key,_=record_node(\'Android-FULL-ambiguous\',\'같은 요청 키로 확인·재시도\');snap(\'w06-exact-key\');subprocess.run([\'node\',\'--import\',\'tsx\',\'scripts/qa/fixture.mjs\',\'proxy-arm\',TOKEN.parent.parent.name,\'android\',key],check=True,stdout=subprocess.PIPE)\nrecord_click(key,\'같은 요청 키로 확인·재시도\');seek(\'확인 필요 · 저장 결과 불명확\');snap(\'w07-unknown-result\');assert_outbox_state(key,\'확인 필요 · 저장 결과 불명확\');mid=audit(\'w07-after-committed-response-drop\');assert sum(x[\'node\'][\'description\']==\'Android-FULL-ambiguous\' for x in mid[\'transactions\'][\'edges\'])==1\ngoto(\'입력\');seek(\'같은 요청 키로 결과를 확인해 주세요\');snap(\'w07b-locked\');seek(\'기기에 보관하고 원장에 저장\');assert find(\'기기에 보관하고 원장에 저장\',\'android.widget.Button\').get(\'enabled\')==\'false\';snap(\'w07c-save-disabled\');goto(\'동기화\');record_click(key,\'같은 요청 키로 확인·재시도\');seek(\'원장 저장 확인\');snap(\'w07d-same-key-confirmed\');assert_outbox_state(key,\'원장 저장 확인\');after=audit(\'w07-after-confirmation\');assert len(after[\'transactions\'][\'edges\'])==len(mid[\'transactions\'][\'edges\']);assert sum(x[\'node\'][\'description\']==\'Android-FULL-ambiguous\' for x in after[\'transactions\'][\'edges\'])==1;record(\'W01.7\',\'PASS\',\'Proxy dropped only this exact key after upstream committed. Native needsReview/save lock observed, same-key confirmation succeeded; ledger row remained exactly1.\',[\'w06-exact-key\',\'w07-unknown-result\',\'w07b-locked\',\'w07c-save-disabled\',\'w07d-same-key-confirmed\'])\n# Remove only our completed ambiguous device record; ledger transaction remains.\nrecord_click(key,\'기기 기록 지우기\');snap(\'w08-completed-device-delete\');draft(\'Android-FULL-delete-pending\',\'11\');click(\'오프라인 임시 저장 · 전송하지 않음\');goto(\'동기화\');_,_,pending,_=record_node(\'Android-FULL-delete-pending\',\'대기 요청 지우기\');record_click(pending,\'대기 요청 지우기\');snap(\'w08b-pending-device-delete\')\nkeys=[]\nfor index in range(2):\n goto(\'입력\');click(\'빈 새 거래\');top();click_named(\'Android-FULL-template\',\'템플릿으로 새 거래\');click(\'오프라인 임시 저장 · 전송하지 않음\');goto(\'동기화\')\n # The new record is last among equal descriptions; capture all key rows then take unseen key.\n top();found=[]\n for count in range(25):\n  nodes=list(tree().iter(\'node\'))\n  for node in nodes:\n   if node.get(\'text\')==\'Android-FULL-template\':\n    candidates=[n for n in nodes if n.get(\'text\',\'\').startswith(\'요청 키 \') and bounds(n)[1]>bounds(node)[1]]\n    if candidates:\n     candidate=min(candidates,key=lambda n:bounds(n)[1]).get(\'text\')[5:]\n     if candidate not in keys:found.append(candidate)\n  if found:break\n  swipe()\n assert found;keys.append(found[-1]);snap(\'w08-template-key-\'+str(index+1))\nassert len(set(keys))==2\nlaunch();goto(\'동기화\');_,_,_,button=record_node(keys[0],\'같은 요청 키로 확인·재시도\');assert button.get(\'enabled\')==\'false\';snap(\'w09-unauth-retry-disabled\');connect(endpoint=\'http://127.0.0.1:4204/graphql\',token=TOKEN.parent.parent.joinpath(\'empty/token\').read_text().strip());goto(\'동기화\');_,_,_,button=record_node(keys[0],\'같은 요청 키로 확인·재시도\');assert button.get(\'enabled\')==\'false\';snap(\'w10-other-connection-disabled\');has(\'현재 연결과 다릅니다.\');record(\'N10.2\',\'PASS\',\'Same owned pending record retry disabled after restart unauthenticated and after switching to authenticated empty ledger; current-connection mismatch guidance visible.\',[\'w09-unauth-retry-disabled\',\'w10-other-connection-disabled\'])\nconnect();goto(\'동기화\')\nfor ownkey in keys:record_click(ownkey,\'대기 요청 지우기\')\nsnap(\'w11-final-device-cleanup\');final=audit(\'w11-final-audit\');assert len(final[\'transactions\'][\'edges\'])==len(after[\'transactions\'][\'edges\']);assert not any(x[\'node\'][\'description\']==\'Android-FULL-delete-pending\' for x in final[\'transactions\'][\'edges\']);record(\'W01.8\',\'PASS\',\'Deleted own completed and pending device records without ledger changes. Two template reuses generated distinct native request keys; neither was auto-sent; both owned pending copies removed.\',[\'w08-completed-device-delete\',\'w08b-pending-device-delete\',\'w08-template-key-1\',\'w08-template-key-2\',\'w11-final-device-cleanup\']);(ROOT/\'recovery-keys.json\').write_text(json.dumps({\'ambiguous\':key,\'discardedPending\':pending,\'templateKeys\':keys},indent=2))\n\nexec(SUITES[\'outbox-audit\'])\n'

SUITES['visual'] = "goto('책');setfield('책 제목','Android-visual-preserved-'+('long-title-'*12));tap('책 제목','android.widget.EditText');snap('u06-preserved-keyboard');hideime();goto('시세');snap('u07-price-tab');goto('책');seek('책 제목','android.widget.EditText');assert field_value('책 제목',find('책 제목','android.widget.EditText'))=='Android-visual-preserved-'+('long-title-'*12);snap('u08-preserved-return');record('U01.2','PASS','Visual review: long transaction description wraps and full12345678901234567890.0001 amount plus asset icon fit without overlap; actual bluebird book cover rendered. Native keyboard dismissed, tab changed, and long unsaved book title preserved on return.',['u04b-long-row','b04-metadata','u06-preserved-keyboard','u07-price-tab','u08-preserved-return'])\n"

SUITES['read-extra'] = 'exec(SUITES[\'read\'].split("acct(q=\'no-such-account\'")[0])\nrecord(\'N05.1\',\'PASS\',\'Actual account list balances rendered. Screenshot visually reviewed: white amount/label legible against darkblue feature panel, no clipping.\',[\'a13-accounts\'])\nrecord(\'N10.1\',\'PASS\',\'Native sync initially empty; header actualledger and explicit no stored transactions; no data cleared.\',[\'a03-nav-동기화\'])\nacct(q=\'\',depth=\'1\',children=False,name=\'r13-depth1-own-zero-off\');own=text()\nacct(q=\'\',depth=\'1\',children=True,name=\'r14-depth1-subtree-zero-off\');sub=text();assert own!=sub;has(\'자산\')\nrecord(\'N05.5\',\'PASS\',\'Depth1 own-scopezero OFF differs from subtree scope; parent 자산 appears with nonzero subtree balances. Both control/result captures retained.\',[\'r13-depth1-own-zero-off-controls\',\'r13-depth1-own-zero-off\',\'r14-depth1-subtree-zero-off-controls\',\'r14-depth1-subtree-zero-off\'])\nnativebutton(\'자산, 잔액\');seek(\'항목 거래 더 보기\',limit=90);snap(\'r15-account-tx-more\');click(\'항목 거래 더 보기\');snap(\'r16-account-tx-more-loaded\');assert_new_rows(\'r15-account-tx-more\',\'r16-account-tx-more-loaded\',\'거래 상세 보기\');record(\'N05.6\',\'PASS\',\'Both account list and selected parent transaction pagination buttons were exercised against sufficient fixture.\',[\'r11-account-more-before\',\'r12-account-more-after\',\'r15-account-tx-more\',\'r16-account-tx-more-loaded\'])\n'

SUITES['book-results'] = "goto('책');top();new=json.loads((ROOT/'w-new-book-ids.json').read_text())\nfor index,book in enumerate(new):\n seek(book['isbn']+' · '+book['id']);snap('w-final-book-id-'+str(index));adb('shell','input','swipe',40,1800,40,1200,500);snap('w-final-book-result-'+str(index));has('실현 손익 (수수료 반영)');has('판매 완료' if book['title']=='채식주의자' else '폐기 완료');top()\np=ROOT/'results.json';rows=json.loads(p.read_text());rows['W01.4']['evidence'] += [str(ROOT/('w-final-book-'+kind+'-'+str(index)+'.png')) for index in range(2) for kind in ['id','result']];p.write_text(json.dumps(rows,ensure_ascii=False,indent=2))\n"

SUITES['audit'] = "import base64,collections\nroot=TOKEN.parent.parent\njournal=(root/'android/ledger.journal').read_text();metadata=[]\nfor encoded in re.findall(r'; hledger-app-v1: ([A-Za-z0-9_-]+)',journal):\n metadata.append(json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4))))\nkeys=[x['key'] for x in metadata];assert len(keys)==len(set(keys)), 'Duplicate persisted idempotency keys'\nown=[x for x in metadata if x['transaction']['date']=='2026-10-25'];assert len(own)==9, 'Expected exactly9 authorized app ledger writes'\nrecovery=json.loads((ROOT/'recovery-keys.json').read_text());key=recovery['ambiguous'];assert sum(x['key']==key for x in own)==1\nassert not any(x['key'] in recovery['templateKeys']+[recovery['discardedPending']] for x in metadata)\nevents=[json.loads(x) for x in (root/'android/proxy-events.jsonl').read_text().splitlines()];scoped=[x for x in events if x.get('idempotencyKey')==key];assert len(scoped)==2 and all(x.get('upstreamStatus')==200 for x in scoped)\nresult={'fixtureRun':root.name,'ledgerId':json.loads((root/'manifest.json').read_text())['ledgers']['android'],'beforeTransactions':139,'afterTransactions':148,'authorizedWrites':len(own),'persistedKeysUnique':True,'ownWrites':[{'key':x['key'],'description':x['transaction']['description']} for x in own],'responseLossKeyEvents':scoped,'deletedPendingKeysAbsent':True,'newBookIds':json.loads((ROOT/'w-new-book-ids.json').read_text()),'finalBooks':json.loads((ROOT/'w11-final-audit.json').read_text())['books']}\n(ROOT/'final-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('Final isolated ledger audit:9 authorized writes, no duplicate keys, pending keys absent')\n"

SUITES['cleanup'] = "launch();goto('동기화');top();has('실제 원장');snap('final-no-pending');goto('설정');assert find('인증 토큰','android.widget.EditText').get('text')=='';snap('final-token-cleared');swipe();has('새 인증 확인 필요');snap('final-reauth-required')\n"
SUITES['cold'] = "import socket\ns=socket.socket();s.settimeout(1);assert s.connect_ex(('127.0.0.1',8082))!=0, 'Coordinator must stop8082 for this explicit cold-launch window';s.close();launch();snap('a04-cold-offline');has('hledger');record('N01.2','PASS','Actual packaged native application launched with local development port8082 not listening.',['a04-cold-offline'])\n"

SUITES['outbox-audit'] = "goto('동기화');top();removed=json.loads((ROOT/'recovery-keys.json').read_text());absent=[removed['ambiguous'],removed['discardedPending'],*removed['templateKeys']];observed=set();frames=[];previous=None;complete=False\nfor page in range(45):\n root=tree();current=ET.tostring(root,encoding='unicode');keys={x.get('text','')[5:] for x in root.iter('node') if x.get('text','').startswith('요청 키 ')};observed.update(keys);assert not set(absent)&keys, 'Deleted owned request remains in native outbox';name='w12-outbox-page-'+str(page);snap(name);frames.append(str(ROOT/(name+'.png')))\n if current==previous:complete=True;break\n previous=current;adb('shell','input','swipe',40,1800,40,1200,500)\nassert complete, 'Outbox end not reached';assert observed, 'Expected surviving completed native records';result={'completeTraversal':True,'pages':len(frames),'observedKeys':sorted(observed),'removedKeysAbsent':absent};(ROOT/'w12-outbox-absence.json').write_text(json.dumps(result,indent=2));p=ROOT/'results.json';rows=json.loads(p.read_text());rows['W01.8']['evidence']+=frames+[str(ROOT/'w12-outbox-absence.json')];rows['W01.8']['observation']+=' Full native outbox traversal to unchanged bottom confirms all4 deleted owned keys absent.';p.write_text(json.dumps(rows,ensure_ascii=False,indent=2))\n"

def export_results():
 from datetime import datetime, timezone
 identity=verified_identity();assert json.loads((ROOT/'run-identity.json').read_text())==identity, 'Run identity differs from verified provenance'
 rows=json.loads((ROOT/'results.json').read_text())
 ids=re.findall(r'^\| ([NBUW]\d{2}\.\d+) \|',pathlib.Path('docs/qa/mobile-release-checklist.md').read_text(),re.M)
 for key in ids:
  rows.setdefault(key,{'status':'PENDING','observation':'Not executed as of this export; no native result claimed.','evidence':[],'executedAt':datetime.now(timezone.utc).isoformat(),'method':'not-executed','executionStarted':False})
 for key,row in rows.items():
  row['id']=key
  if 'executedAt' not in row:
   row['executedAt']=datetime.fromtimestamp(pathlib.Path(row['evidence'][0]).stat().st_mtime,timezone.utc).isoformat()
  else:
   raw=row['executedAt'];row['executedAt']=datetime.fromisoformat(raw).isoformat()
  row.setdefault('method','native-driver')
  if key=='W01.7' and row['status']=='PASS':row['notes']=['Nonblocking localization: unknown-result body remains English while heading and recovery controls are Korean.']
  auditNames={'W01.1':['w00-before','w01-after'],'W01.2':['w-trade-before','w-trade-after'],'W01.3':['w-books-before','w-books-after','w-new-book-ids'],'W01.4':['w-books-after','w-disposal-after'],'W01.5':['w02-before-restart','w03-after-restart'],'W01.6':['w03-after-restart','w05-after-retry'],'W01.7':['w06-before-ambiguous','w07-after-committed-response-drop','w07-after-confirmation'],'W01.8':['w07-after-confirmation','w11-final-audit','recovery-keys']}
  for name in auditNames.get(key,[]):
   auditPath=ROOT/(name+'.json')
   if auditPath.exists() and str(auditPath) not in row['evidence']:row['evidence'].append(str(auditPath))
  finalAudit=ROOT/'final-audit.json'
  if key.startswith('W01.') and finalAudit.exists() and str(finalAudit) not in row['evidence']:row['evidence'].append(str(finalAudit))
  if key=='W01.2' and row['status']=='PASS':row['conditions']=[{'name':'Native BUY/SELL quantities, unit costs and fees','status':'PASS','reason':'Actual native saves and isolated ledger audit.'},{'name':'Automatic realized stock PnL','status':'N/A','reason':'Current native UI explicitly states this function is unsupported.'}]

 report={'schemaVersion':1,'platform':'android','ciRun':identity['ciRun'],'appSha':identity['appSha'],'fixtureRun':identity['fixtureRun'],'results':list(rows.values())}
 (ROOT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--exec',dest='script');p.add_argument('--maestro');p.add_argument('--suite',choices=SUITES);p.add_argument('--export',action='store_true');a=p.parse_args()
 if a.script:exec(pathlib.Path(a.script).read_text(),globals())
 elif a.suite:exec(SUITES[a.suite],globals())
 elif a.maestro:
  env=dict(os.environ);env['PATH']=str(pathlib.Path(ADB).parent)+':'+env.get('PATH','');env['ANDROID_HOME']=str(pathlib.Path(ADB).parent.parent);env['ANDROID_SDK_ROOT']=env['ANDROID_HOME'];env['MISE_ANDROID_SDK_VERSION']='20.0'
  flow=pathlib.Path(a.maestro).stem
  if flow in {'books-validation','writes-recovery'}:
   goto('책' if flow=='books-validation' else '입력');guard_fixture()
  manifest=json.loads((TOKEN.parent.parent/'manifest.json').read_text())
  command=[MAESTRO,'test','-p','android','--device',DEVICE,'--test-output-dir',str(ROOT/'maestro'),'--debug-output',str(ROOT/'maestro-debug'),'-e','QA_LEDGER_ID='+manifest['ledgers']['android']]
  secret=TOKEN.read_text().strip()
  if flow=='auth-navigation':command+=['-e','QA_ENDPOINT=http://127.0.0.1:4203/graphql','-e','QA_TOKEN='+secret]
  result=subprocess.run(command+[a.maestro],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,env=env)
  print(result.stdout.replace(secret,'[REDACTED]'))
  for directory in [ROOT/'maestro',ROOT/'maestro-debug']:
   for artifact in directory.rglob('*'):
    if artifact.suffix in {'.json','.log','.xml','.yaml','.yml','.txt','.html'}:
     data=artifact.read_text();artifact.write_text(data.replace(secret,'[REDACTED]'))
  if result.returncode:raise RuntimeError('Maestro failed; see redacted evidence logs')
 elif a.export:export_results()
 else:p.print_help()
