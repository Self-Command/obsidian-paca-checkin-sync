# Invoked only inside the official isolated Obsidian fixture after A is ready.
import shutil,ssl,base64
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import boto3
D_ROOT=pathlib.Path(os.environ['OBSIDIAN_SYNC_ROOT'])
cid='com.selfcommand.task-checkin'
cmanifest=json.loads((ROOT/f'release/wasm/{cid}/plugin.json').read_text())
request('POST','/admin/plugins',{'name':cid,'version':cmanifest['version'],'manifest':cmanifest,'enabled':True},201)
csecret=request('POST',f'/plugins/{cid}/admin/worker-credential',{},201)['secret']
states=request('GET',f'/projects/{project["id"]}/task-statuses')['data']['items']
progress_state=next(s['id'] for s in states if s['category']=='inprogress')
done_state=next(s['id'] for s in states if s['category']=='done' and s['id']!=archive_status['id'])
cp=f'/plugins/{cid}/projects/{project["id"]}'
request('PUT',cp+'/settings',{'revision':0,'config':{'enabled':True,'timezone':'Asia/Shanghai','start_minutes':10,'due_minutes':10,'retention_days':90,'progress_status':progress_state,'done_status':done_state,'archive_status':archive_status['id']}})
paired=request('POST',cp+'/pairing',{'name':'Official Obsidian fixture','connection_id':ui_connection_id},201)
cs=fixture_root/'checkin-secrets';cs.mkdir(mode=0o700)
cv={'worker':csecret,'api':pathlib.Path(worker_env['PACA_API_KEY_FILE']).read_text(),'action':secrets.token_hex(32),'grant':secrets.token_hex(32),'storage-access':'ci-access-key','storage-secret':'ci-secret-key'}
for n,v in cv.items():(cs/n).write_text(v);(cs/n).chmod(0o600)
cmd('docker','run','-d','--name','paca-sync-checkin-storage','--network','paca-ci','-p','127.0.0.1:19400:9000','--tmpfs','/data/rustfs0:mode=777','-e','RUSTFS_ACCESS_KEY=ci-access-key','-e','RUSTFS_SECRET_KEY=ci-secret-key','-e','RUSTFS_VOLUMES=/data/rustfs0','rustfs/rustfs:1.0.0-rc.6')
s3=boto3.client('s3',endpoint_url='http://127.0.0.1:19400',aws_access_key_id='ci-access-key',aws_secret_access_key='ci-secret-key',region_name='us-east-1')
for _ in range(60):
    try:s3.create_bucket(Bucket='checkin-private');break
    except Exception:time.sleep(1)
else:raise RuntimeError('isolated photo storage unavailable')
args=['docker','run','-d','--name','paca-sync-checkin-worker','--network','paca-ci','--user','0:0','-p','127.0.0.1:19382:8090','-v',f'{cs}:/run/e2e:ro']
ce={'PACA_API_URL':'http://paca-ci-api:8080','PUBLIC_URL':'https://127.0.0.1:19380','DATABASE_URL':'postgres://postgres:ci-only-password@paca-ci-db:5432/paca?sslmode=disable','PACA_API_KEY_FILE':'/run/e2e/api','WORKER_SECRET_FILE':'/run/e2e/worker','ACTION_SECRET_FILE':'/run/e2e/action','GRANT_SECRET_FILE':'/run/e2e/grant','STORAGE_ACCESS_KEY_FILE':'/run/e2e/storage-access','STORAGE_SECRET_KEY_FILE':'/run/e2e/storage-secret','CHECKIN_S3_ENDPOINT':'http://paca-sync-checkin-storage:9000','CHECKIN_BUCKET':'checkin-private'}
for k,v in ce.items():args+=['-e',f'{k}={v}']
cmd(*args,(ROOT/'checkin-image.txt').read_text().strip())
for _ in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:19382/healthz',timeout=2) as response:assert response.status==200
        break
    except OSError:time.sleep(1)
else:raise RuntimeError('isolated check-in worker unavailable')
class CheckinTlsProxy(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def forward(self):
        body=self.rfile.read(int(self.headers.get('Content-Length',0))) or None
        headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','content-length','connection')}
        upstream='http://127.0.0.1:8091' if self.path.startswith('/task-sync/') else 'http://127.0.0.1:19382'
        req=urllib.request.Request(upstream+self.path,data=body,method=self.command,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=25) as reply:status,payload,heads=reply.status,reply.read(),reply.headers
        except urllib.error.HTTPError as error:status,payload,heads=error.code,error.read(),error.headers
        self.send_response(status)
        for key,value in heads.items():
            if key.lower() not in ('server','date','transfer-encoding','connection','content-length'):self.send_header(key,value)
        self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    do_GET=forward;do_POST=forward
cert=fixture_root/'checkin.pem';key=fixture_root/'checkin.key'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','2','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
pub=subprocess.check_output(['openssl','x509','-in',str(cert),'-pubkey','-noout'])
der=subprocess.check_output(['openssl','pkey','-pubin','-outform','DER'],input=pub)
os.environ['OBSIDIAN_FIXTURE_SPKI']=base64.b64encode(hashlib.sha256(der).digest()).decode()
proxy=ThreadingHTTPServer(('127.0.0.1',19380),CheckinTlsProxy);tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);proxy.socket=tls.wrap_socket(proxy.socket,server_side=True);threading.Thread(target=proxy.serve_forever,daemon=True).start()
worker_env.update({'CHECKIN_WORKER_URL':'http://127.0.0.1:19382','CHECKIN_SERVICE_SECRET_FILE':str(cs/'action')})
dp=vault/'.obsidian/plugins/obsidian-paca-checkin-sync';dp.mkdir(parents=True)
for file in ['main.js','manifest.json','styles.css']:shutil.copyfile(D_ROOT/'release/obsidian-paca-checkin-sync'/file,dp/file)
(dp/'data.json').write_text(json.dumps({'settings':{'address':'https://127.0.0.1:19380','token':paired['token'],'auto':False,'minutes':5,'attachments':'PushGo附件','started':'in-progress','completed':'done','pacaStates':{'open':next(s['id'] for s in states if s['category']=='todo'),'in-progress':progress_state,'done':done_state}}}))
