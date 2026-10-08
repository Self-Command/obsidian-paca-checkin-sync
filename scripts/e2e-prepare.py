import io,json,os,pathlib,subprocess,tarfile,hashlib,urllib.request,time
root=pathlib.Path(__file__).resolve().parent.parent
a=root/'acceptance/a';repo='Self-Command/paca-plugin-tasknotes-webhook';source=os.environ['PACA_A_SHA']
for attempt in range(30):
    runs=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/actions/runs?head_sha={source}&status=success']))['workflow_runs']
    if runs:break
    time.sleep(20)
else:raise RuntimeError('The pinned A source has not passed its Actions checks')
subprocess.run(['gh','run','download',str(runs[0]['id']),'--repo',repo,'-n','plugin-build','-D',str(a/'release')],check=True)
ainfo=json.loads((a/'release/assets/build-info.json').read_text());assert ainfo['source_sha']==source
release='https://github.com/Self-Command/paca-plugin-task-checkin/releases/download/v0.1.0-dev.31/'
def download(name):
    for attempt in range(60):
        try:
            with urllib.request.urlopen(release+name,timeout=60) as response:return response.read()
        except OSError:
            if attempt==59:raise
            time.sleep(10)
checks=download('checksums.txt').decode();package=download('plugin-install.tar.gz');expected=next(x.split()[0] for x in checks.splitlines() if x.endswith('plugin-install.tar.gz'));assert hashlib.sha256(package).hexdigest()==expected
cinfo=json.loads(download('build-info.json'));assert cinfo['source_sha']==os.environ['PACA_C_SHA']
with tarfile.open(fileobj=io.BytesIO(package),mode='r:gz') as archive:archive.extractall(a/'release',filter='data')
(a/'checkin-image.txt').write_bytes(download('image-digest.txt'))
