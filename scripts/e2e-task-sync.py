"""Real official TaskNotes UI and public companion command against fixed A/C artifacts."""
sync_project=request('POST','/projects',{'name':'双向同步界面验收','task_id_prefix':'BIDIR'},201)['data']
sync_states=request('GET',f'/projects/{sync_project["id"]}/task-statuses')['data']['items']
sync_archive=request('POST',f'/projects/{sync_project["id"]}/task-statuses',{'name':'归档','category':'done','position':99},201)['data']
sync_status_map={'open':next(s['id'] for s in sync_states if s['category']=='todo'),'in-progress':next(s['id'] for s in sync_states if s['category']=='inprogress'),'done':next(s['id'] for s in sync_states if s['category']=='done'),'@archived':sync_archive['id']}
sync_conn=request('POST',f'/plugins/{plugin_id}/projects/{sync_project["id"]}/connections',{'name':'官方界面双向来源','secret':obsidian_sender_secret,'status_map':sync_status_map},201)
sync_base=f'/plugins/{plugin_id}/projects/{sync_project["id"]}/connections/{sync_conn["id"]}'
native_tasks=[]
for title,status in [('Paca 批量一','open'),('Paca 批量二','in-progress'),('已有完成任务','done'),('已有归档任务','@archived'),('同名任务','open'),('同名任务','open')]:
    native_tasks.append(request('POST',f'/projects/{sync_project["id"]}/tasks',{'title':title,'status_id':sync_status_map[status],'importance':35,'description':[{'type':'paragraph','content':[{'type':'text','text':'完整任务内容','styles':{}}],'children':[]}]},201)['data'])
request('PUT',sync_base+'/sync-config',{'mode':'preview','revision':1,'reverse_status_map':{sync_archive['id']:'open'}})
for _ in range(180):
    preview=request('GET',sync_base+'/sync-preview')
    if int(preview['total'])==6 and not any(item['warning'] for item in preview['items']):break
    time.sleep(.5)
else:raise AssertionError('full completed/archived preview was not prepared')
request('PUT',sync_base+'/sync-config',{'mode':'enabled','revision':2,'reverse_status_map':{sync_archive['id']:'open'}})
task_pair=request('POST',sync_base+'/pairing',{},201)
receive_path=f'/api/v1/plugins/{plugin_id}/receive/{sync_conn["id"]}'
new_receive='http://127.0.0.1:18280'+receive_path
ui_page.evaluate('async cfg=>{const tn=app.plugins.plugins.tasknotes;tn.settings.webhooks[0].url=cfg.webhook;await tn.saveSettings();const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.taskToken=cfg.token;d.settings.taskSync=true;d.settings.checkinSync=false;await d.persist();d.resetEngine()}',{'token':task_pair['token'],'webhook':new_receive})
def sync_pull():
    ui_page.evaluate('()=>app.commands.executeCommandById("obsidian-paca-checkin-sync:sync-checkin-records")')
    ui_page.wait_for_function('()=>app.plugins.plugins["obsidian-paca-checkin-sync"].status!=="正在同步"',timeout=45000)
def sync_links():return ui_page.evaluate('()=>app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.links')
def no_sync_problems():
    data=ui_page.evaluate('()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];return {status:d.status,problems:d.taskState.problems,operations:Object.values(d.taskState.operations).map(o=>({state:o.state,problem:o.problem,kind:o.body.kind,base_revision:o.body.base_revision,fields:Object.keys(o.body.changes)}))}}')
    assert data['status']=='同步完成' and not data['problems'] and not any(op['state'] in ('conflict','failed') for op in data['operations']),data
sync_pull();no_sync_problems()
links=sync_links();assert len(links)==6,links
assert all(link['base']['scheduled'] is None for link in links.values()),'date-only defaults became a server schedule'
local_tasks=ui_page.evaluate('async()=>app.plugins.plugins.tasknotes.api.tasks.list()')
assert len([t for t in local_tasks if t['title']=='同名任务'])==2,{'reason':'same-title imports were merged','tasks':[{'title':t['title'],'path':t['path']} for t in local_tasks]}
assert any(t['title']=='已有完成任务' and t['status']=='done' for t in local_tasks)
assert any(t['title']=='已有归档任务' and t.get('archived') for t in local_tasks)
for _ in range(3):sync_pull()
assert len(sync_links())==6
first=next(item for item in request('GET',sync_base+'/sync-preview')['items'] if item['task_id']==native_tasks[0]['id'])
path=sync_links()[first['sync_id']]['path']
request('PATCH',f'/projects/{sync_project["id"]}/tasks/{native_tasks[0]["id"]}',{'title':'Paca 改名回写','tags':['双向验证']})
for _ in range(120):
    sync_pull()
    local=ui_page.evaluate('async path=>app.plugins.plugins.tasknotes.api.tasks.get(path)',sync_links()[first['sync_id']]['path'])
    if local['title']=='Paca 改名回写':break
    time.sleep(.5)
else:raise AssertionError('Paca PATCH did not update official TaskNotes')
open_edit(local)
ui_page.locator('.title-input:visible,.title-input-detailed:visible').first.fill('TaskNotes 界面修改')
ui_page.locator('.tn-task-modal__button-bar button.mod-cta').click()
for _ in range(120):
    sync_pull()
    core=request('GET',f'/projects/{sync_project["id"]}/tasks/{native_tasks[0]["id"]}')['data']
    if core['title']=='TaskNotes 界面修改':break
    time.sleep(.5)
else:raise AssertionError('official TaskNotes UI edit was not synced to the same Paca task')
no_sync_problems()
def current_local():return ui_page.evaluate('async path=>app.plugins.plugins.tasknotes.api.tasks.get(path)',sync_links()[first['sync_id']]['path'])
def core_wait(predicate):
    for _ in range(120):
        sync_pull();data=request('GET',f'/projects/{sync_project["id"]}/tasks/{native_tasks[0]["id"]}')['data']
        if predicate(data):return data
        time.sleep(.5)
    raise AssertionError({'core':data,'links':sync_links()})
# Real UI completion / restoration and archive folder moves retain one task.
open_edit(current_local());ui_page.locator('[data-type="status"]').click();ui_page.locator('.menu-item').filter(has_text=re.compile(r'^Done$')).click();ui_page.locator('.tn-task-modal__button-bar button.mod-cta').click()
core_wait(lambda t:t['status_id']==sync_status_map['done'])
open_edit(current_local());ui_page.locator('[data-type="status"]').click();ui_page.locator('.menu-item').filter(has_text=re.compile(r'^Open$')).click();ui_page.locator('.tn-task-modal__button-bar button.mod-cta').click()
core_wait(lambda t:t['status_id']==sync_status_map['open'])
open_edit(current_local());ui_page.locator('.tn-task-modal__archive-button').click()
core_wait(lambda t:t['status_id']==sync_archive['id'])
open_edit(current_local());ui_page.locator('.tn-task-modal__archive-button').click()
core_wait(lambda t:t['status_id']==sync_status_map['open'])
no_sync_problems()
request('DELETE',f'/projects/{sync_project["id"]}/tasks/{native_tasks[1]["id"]}',expected=200)
second=next(item for item in request('GET',sync_base+'/sync-preview')['items'] if item['task_id']==native_tasks[1]['id'])
second_path=sync_links()[second['sync_id']]['path']
for _ in range(180):
    sync_pull()
    present=ui_page.evaluate('path=>Boolean(app.vault.getAbstractFileByPath(path))',second_path)
    if not present:break
    time.sleep(.5)
else:raise AssertionError('Paca delete did not trash the linked note')
request('GET',f'/projects/{sync_project["id"]}/tasks/{native_tasks[0]["id"]}')
ui_page.screenshot(path=str(ROOT/'verification/obsidian-bidirectional-tasks.png'))
(ROOT/'verification/bidirectional-ui-report.json').write_text(json.dumps({'d_source':os.environ['GITHUB_SHA'],'a_source':os.environ['PACA_A_SHA'],'c_source':os.environ['PACA_C_SHA'],'real_official_obsidian':True,'paca_api_batch_without_checkin':True,'all_completed_archived_imported':True,'same_title_remains_separate':True,'repeated_sync_no_duplicate':True,'paca_patch_to_tasknotes':True,'tasknotes_ui_patch_same_paca_task':True,'paca_delete_trashes_note':True,'tasknotes_ui_complete_restore_archive_unarchive':True,'real_phone':False},ensure_ascii=False,indent=2))
