# Continues the live official Obsidian UI fixture after its six-event tests.
import struct,zlib
ui_page.wait_for_function('()=>Boolean(app.plugins.plugins["obsidian-paca-checkin-sync"]?.engine)',timeout=30000)
command('TaskNotes create','Create new task')
ui_page.locator('.title-input:visible,.title-input-detailed:visible').first.fill('拍照回写验收任务')
ui_page.locator('.tn-task-modal__button-bar button.mod-cta').click()
source_task=wait_event('task.created','拍照回写验收任务')
linked=request('GET',f'/plugins/{plugin_id}/projects/{project["id"]}/connections/{ui_connection_id}/sources')['items']
paca_task=next(row['task_id'] for row in linked if row.get('path',row.get('source_key'))==source_task['path'])
now=datetime.datetime.now(datetime.timezone.utc)
start=(now+datetime.timedelta(minutes=8)).isoformat();due=(now+datetime.timedelta(minutes=9)).isoformat()
request('PUT',cp+f'/tasks/{paca_task}/checkin',{'revision':0,'config':{'enabled':True,'start':start,'due':due}})
req=urllib.request.Request('http://127.0.0.1:19382/internal/v1/action',data=json.dumps({'project_id':project['id'],'task_id':paca_task,'kind':'due','target':due}).encode(),method='POST',headers={'Content-Type':'application/json','Authorization':'Bearer '+cv['action']})
with urllib.request.urlopen(req,timeout=20) as response:card=json.load(response)
def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
photo=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\xff\x00\x00'))+chunk(b'IEND',b'')
photo_context=pw.chromium.launch(headless=True).new_context(ignore_https_errors=True,viewport={'width':390,'height':844})
photo_page=photo_context.new_page();photo_page.goto(card['metadata']['action_url']);photo_page.locator('input[type=file]').first.set_input_files({'name':'打卡.png','mimeType':'image/png','buffer':photo})
photo_page.get_by_role('button',name='确认打卡',exact=True).click();photo_page.get_by_text('打卡成功',exact=False).first.wait_for(timeout=30000)
photo_page.screenshot(path=str(ROOT/'verification/checkin-mobile-photo.png'));photo_context.close()
# Use the public user command. TaskNotes mutations are performed by the real plugin.
def pull():
    ui_page.evaluate('()=>app.commands.executeCommandById("obsidian-paca-checkin-sync:sync-checkin-records")')
    ui_page.wait_for_function('()=>app.plugins.plugins["obsidian-paca-checkin-sync"].status!=="正在同步"',timeout=30000)
pull()
problem=ui_page.evaluate('()=>({status:app.plugins.plugins["obsidian-paca-checkin-sync"].status,rows:Object.values(app.plugins.plugins["obsidian-paca-checkin-sync"].state.pending).map(x=>({done:x.done,problem:x.problem}))})')
assert all(row['done'] for row in problem['rows']),problem
local=ui_page.evaluate('async path=>{const tn=app.plugins.plugins.tasknotes;const task=await tn.api.tasks.get(path);const file=app.vault.getAbstractFileByPath(path);return {status:task.status,text:await app.vault.read(file),photos:app.vault.getFiles().filter(f=>f.path.startsWith("PushGo附件/")).map(f=>f.path)}}',source_task['path'])
assert local['status']=='done' and '结束打卡' in local['text'] and '![[PushGo附件/' in local['text'] and len(local['photos'])==1,local
for _ in range(60):
    core=request('GET',f'/projects/{project["id"]}/tasks/{paca_task}')['data']
    if core['status_id']==done_state:break
    time.sleep(0.5)
else:raise AssertionError('check-in status outbox did not update Paca')
pull();pull()
assert len(ui_page.evaluate('()=>app.vault.getFiles().filter(f=>f.path.startsWith("PushGo附件/")).map(f=>f.path)'))==1
assert len(request('GET',f'/plugins/{plugin_id}/projects/{project["id"]}/connections/{ui_connection_id}/sources')['items'])==2
# Wait for official Webhook echoes to be acknowledged without replacing C metadata.
time.sleep(3)
core=request('GET',f'/projects/{project["id"]}/tasks/{paca_task}')['data'];assert core['status_id']==done_state and '_checkin_state_v1' in core['custom_fields']
rows=request('GET',f'/plugins/{plugin_id}/projects/{project["id"]}/connections/{ui_connection_id}/deliveries')['items']
assert not any(row['state'] in ('error','conflict') for row in rows),[{'state':r['state'],'error':r['error']} for r in rows]
ui_page.screenshot(path=str(ROOT/'verification/obsidian-photo-writeback.png'))
(ROOT/'verification/writeback-report.json').write_text(json.dumps({'d_source':os.environ['GITHUB_SHA'],'a_source':os.environ['PACA_A_SHA'],'c_source':os.environ['PACA_C_SHA'],'official_ui_created_task':True,'passwordless_mobile_photo':True,'paca_status_outbox':True,'public_tasknotes_api_status':True,'independent_photo_directory':True,'manual_command':True,'repeat_pull_no_extra_media':True,'writeback_echo_preserves_checkin_metadata':True,'phone_device_test':False},indent=2))
if os.environ.get('TASK_SYNC_E2E')=='1':exec((D_ROOT/'scripts/e2e-task-sync.py').read_text(),globals(),locals())
