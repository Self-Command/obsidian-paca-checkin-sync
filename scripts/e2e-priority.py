"""Priority rules on real TaskNotes, with local changes queued before upload."""
ui_page.evaluate('async()=>{const tn=app.plugins.plugins.tasknotes;for(const hook of tn.settings.webhooks)hook.active=false;await tn.saveSettings();const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.auto=false;await d.persist();d.setAutomatic()}')

def priority_pull_until(predicate):
    for _ in range(160):
        sync_pull()
        if predicate():return
        time.sleep(.5)
    diagnostic=ui_page.evaluate('()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];return {mode:d.settings.syncPriority,status:d.status,tasks:d.taskState}}')
    diagnostic['native_tasks']=request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']
    diagnostic['preview']=request('GET',sync_base+'/sync-preview')
    (ROOT/'verification/sync-priority-failure.json').write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2))
    raise AssertionError({'status':diagnostic['status'],'mode':diagnostic['mode'],'problems':diagnostic['tasks']['problems'],'operations':diagnostic['tasks']['operations']})

def priority_note(identity):
    return ui_page.evaluate('async id=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];return d.taskState.links[id]?app.plugins.plugins.tasknotes.api.tasks.get(d.taskState.links[id].path):null}',identity)

def priority_new_native(title):
    task=request('POST',f'/projects/{sync_project["id"]}/tasks',{'title':title,'status_id':sync_status_map['open']},201)['data']
    for _ in range(160):
        sync_pull()
        item=next((x for x in request('GET',sync_base+'/sync-preview')['items'] if x['task_id']==task['id']),None)
        if item and priority_note(item['sync_id']):
            priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))
            return task,item['sync_id']
        time.sleep(.5)
    raise AssertionError('Native task did not arrive for '+title)

for prefer in ('latest','server','local'):
    ui_page.evaluate('async value=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.syncPriority=value;await d.persist();d.resetEngine()}',prefer)
    native=request('POST',f'/projects/{sync_project["id"]}/tasks',{'title':'优先规则验收 '+prefer,'status_id':sync_status_map['open']},201)['data']
    identity=None
    for _ in range(160):
        sync_pull()
        entries=request('GET',sync_base+'/sync-preview')['items']
        entry=next((x for x in entries if x['task_id']==native['id']),None)
        if entry and priority_note(entry['sync_id']):identity=entry['sync_id'];break
        time.sleep(.5)
    assert identity
    local=priority_note(identity)
    ui_page.evaluate('async path=>app.plugins.plugins.tasknotes.api.tasks.update(path,{title:"离线标题",priority:"high"})',local['path'])
    ui_page.wait_for_function('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length>0')
    request('PATCH',f'/projects/{sync_project["id"]}/tasks/{native["id"]}',{'title':'服务器标题','tags':['保留服务器字段']})
    expected_title='服务器标题' if prefer=='server' else '离线标题'
    def priority_equal():
        core=request('GET',f'/projects/{sync_project["id"]}/tasks/{native["id"]}')['data']
        note=priority_note(identity)
        return core['title']==expected_title and core['importance']==75 and note and note['title']==expected_title and note['priority']=='high' and '保留服务器字段' in note.get('tags',[])
    priority_pull_until(priority_equal)
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))

    # A server-only edit remains bidirectional even with fixed local priority.
    core_rows=request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']
    live=next(t for t in core_rows if t['title']==expected_title)
    request('PATCH',f'/projects/{sync_project["id"]}/tasks/{live["id"]}',{'title':'服务器单边修改 '+prefer})
    priority_pull_until(lambda:(priority_note(identity) or {}).get('title')=='服务器单边修改 '+prefer)
    # Only a persisted offline edit can win against a server deletion.
    local=priority_note(identity)
    ui_page.evaluate('async path=>app.plugins.plugins.tasknotes.api.tasks.update(path,{title:"离线保留内容"})',local['path'])
    ui_page.wait_for_function('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length>0')
    request('DELETE',f'/projects/{sync_project["id"]}/tasks/{native["id"]}')
    if prefer=='server':
        priority_pull_until(lambda:priority_note(identity) is None)
    else:
        def restored_native():
            core=request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']
            return any(t['title']=='离线保留内容' for t in core) and priority_note(identity) is not None
        priority_pull_until(restored_native)
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))

    # The official API really renames notes here. Several offline edits followed
    # by deletion cannot reject this device's own prior queued modifications.
    queued_core,queued_id=priority_new_native('离线连续修改后删除 '+prefer)
    queued_note=priority_note(queued_id)
    ui_page.evaluate('''async cfg=>{
      const d=app.plugins.plugins["obsidian-paca-checkin-sync"],api=app.plugins.plugins.tasknotes.api;
      await api.tasks.update(cfg.path,{title:"离线连续 B "+cfg.mode});await d.captures;
      let note=await api.tasks.get(d.taskState.links[cfg.id].path);
      await api.tasks.update(note.path,{title:"离线连续 C "+cfg.mode,priority:"high"});await d.captures;
      note=await api.tasks.get(d.taskState.links[cfg.id].path);
      await api.tasks.delete(note.path);await d.captures;
    }''',{'path':queued_note['path'],'id':queued_id,'mode':prefer})
    assert ui_page.evaluate('id=>Object.values(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).some(x=>x.body.sync_id===id&&x.body.kind==="delete")',queued_id)
    def queued_deleted():
        rows=request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']
        return not any(x['id']==queued_core['id'] for x in rows) and priority_note(queued_id) is None
    priority_pull_until(queued_deleted)
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))

    # Conversely, an offline local delete against a remote edit either restores
    # one note (server priority) or removes the core task (later/local priority).
    deleted_core,deleted_id=priority_new_native('本地删除与服务器修改 '+prefer)
    deleted_note=priority_note(deleted_id)
    ui_page.evaluate('async path=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];await app.plugins.plugins.tasknotes.api.tasks.delete(path);await d.captures}',deleted_note['path'])
    request('PATCH',f'/projects/{sync_project["id"]}/tasks/{deleted_core["id"]}',{'title':'服务器保留 '+prefer})
    if prefer=='server':
        priority_pull_until(lambda:(priority_note(deleted_id) or {}).get('title')=='服务器保留 '+prefer)
        marker_count=ui_page.evaluate('async id=>{let count=0;for(const task of await app.plugins.plugins.tasknotes.api.tasks.list()){const f=app.vault.getAbstractFileByPath(task.path);if(f&&(await app.vault.read(f)).includes("<!-- paca-sync-id:"+id+" -->"))count++}return count}',deleted_id)
        assert marker_count==1,'A rejected local delete restored duplicate notes'
    else:
        priority_pull_until(lambda:not any(x['id']==deleted_core['id'] for x in request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']))
        assert priority_note(deleted_id) is None
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))
    no_sync_problems()

    # A completely new offline task, with its template and later edits, creates
    # one native task and can then be deleted through the same official API.
    offline=ui_page.evaluate('''async mode=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"],api=app.plugins.plugins.tasknotes.api;
      let note=await api.tasks.create({title:"离线新建 "+mode,status:"open",priority:"normal",details:"首次任务说明"});await d.captures;
      note=await api.tasks.update(note.path,{title:"离线新建后修改 "+mode,priority:"high"});await d.captures;return note;
    }''',prefer)
    assert ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length')>0
    def offline_created_once():
        rows=[x for x in request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items'] if x['title']=='离线新建后修改 '+prefer]
        assert len(rows)<=1,'Offline creation generated duplicate native tasks'
        return len(rows)==1 and rows[0]['importance']==75
    priority_pull_until(offline_created_once)
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))
    no_sync_problems()
    ui_page.evaluate('async path=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];await app.plugins.plugins.tasknotes.api.tasks.delete(path);await d.captures}',offline['path'])
    deleted_offline=ui_page.evaluate('()=>app.plugins.plugins["obsidian-paca-checkin-sync"].taskState')
    (ROOT/'verification'/('sync-priority-offline-delete-'+prefer+'.json')).write_text(json.dumps({'client':deleted_offline,'preview':request('GET',sync_base+'/sync-preview')},ensure_ascii=False,indent=2))
    priority_pull_until(lambda:not any(x['title']=='离线新建后修改 '+prefer for x in request('GET',f'/projects/{sync_project["id"]}/tasks?page_size=200')['data']['items']))
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))
    no_sync_problems()

# A source can still use the official webhook while the companion does not
# capture the mutation. That source must honor the same selected preference.
for prefer in ('latest','server','local'):
    ui_page.evaluate('async mode=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.syncPriority=mode;await d.persist();d.resetEngine()}',prefer)
    webhook_core,webhook_id=priority_new_native('官方 Webhook 优先规则 '+prefer)
    webhook_note=priority_note(webhook_id)
    request('PATCH',f'/projects/{sync_project["id"]}/tasks/{webhook_core["id"]}',{'title':'Webhook 服务器修改 '+prefer})
    ui_page.evaluate('async()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.taskSync=false;const tn=app.plugins.plugins.tasknotes;for(const hook of tn.settings.webhooks)hook.active=true;await tn.saveSettings();await d.persist() }')
    ui_page.evaluate('async cfg=>app.plugins.plugins.tasknotes.api.tasks.update(cfg.path,{title:"Webhook 本地修改 "+cfg.mode,priority:"high"})',{'path':webhook_note['path'],'mode':prefer})
    expected='Webhook 服务器修改 '+prefer if prefer=='server' else 'Webhook 本地修改 '+prefer
    for _ in range(160):
        core=request('GET',f'/projects/{sync_project["id"]}/tasks/{webhook_core["id"]}')['data']
        if core['title']==expected and core['importance']==75:break
        time.sleep(.5)
    else:raise AssertionError('Official webhook ignored selected preference: '+prefer)
    ui_page.evaluate('async()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.taskSync=true;await d.persist();d.resetEngine()}')
    priority_pull_until(lambda:(priority_note(webhook_id) or {}).get('title')==expected)
    priority_pull_until(lambda:not ui_page.evaluate('()=>Object.keys(app.plugins.plugins["obsidian-paca-checkin-sync"].taskState.operations).length'))
    no_sync_problems()
    ui_page.evaluate('async()=>{const tn=app.plugins.plugins.tasknotes;for(const hook of tn.settings.webhooks)hook.active=false;await tn.saveSettings()}')

(ROOT/'verification/sync-priority-runtime-report.json').write_text(json.dumps({'three_modes':['latest','server','local'],'field_collisions_passed':True,'both_directions_passed':True,'offline_create_edit_delete_passed':True,'queued_rename_then_delete_passed':True,'webhook_three_modes_passed':True,'operations_empty':True,'problems_empty':True},indent=2))
# The priority selector is visible and the former per-item choices are absent.
ui_page.evaluate('()=>app.commands.executeCommandById("app:open-settings")')
for _ in range(60):
    priority_settings=next((page for page in context.pages if page.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').count()),None)
    if priority_settings:break
    time.sleep(.25)
assert priority_settings
priority_settings.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').click()
priority_row=priority_settings.locator('.setting-item').filter(has_text='同步优先规则')
try:
    priority_row.locator('select').wait_for(state='visible',timeout=30000)
    labels=priority_row.locator('select option').all_text_contents()
    assert labels==['普通双向同步','以服务器为准','以 Obsidian 为准'],labels
    for selected in ('latest','server','local','server'):
        priority_row.locator('select').select_option(selected)
        ui_page.wait_for_function('value=>app.plugins.plugins["obsidian-paca-checkin-sync"].settings.syncPriority===value',selected)
        no_sync_problems()
        priority_row.locator('select').wait_for(state='visible',timeout=30000)
except Exception:
    priority_settings.screenshot(path=str(ROOT/'verification/obsidian-priority-settings-failure.png'))
    (ROOT/'verification/obsidian-priority-settings-failure.json').write_text(json.dumps({'body':priority_settings.locator('body').inner_text(),'options':priority_row.locator('select option').all_text_contents()},ensure_ascii=False,indent=2))
    raise
assert priority_settings.get_by_role('button',name='采用服务器内容',exact=True).count()==0
assert priority_settings.get_by_role('button',name='采用本地内容',exact=True).count()==0
priority_settings.screenshot(path=str(ROOT/'verification/obsidian-sync-priority.png'))
if priority_settings==ui_page:ui_page.evaluate('()=>app.setting.close()')
else:priority_settings.close()
ui_page.evaluate('async()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.syncPriority="server";await d.persist();d.resetEngine()}')
(ROOT/'verification/sync-priority-ui-report.json').write_text(json.dumps({'server_priority_both_directions':True,'obsidian_priority_both_directions':True,'unrelated_fields_preserved':True,'offline_edit_against_delete_automatic':True,'offline_edits_then_delete_three_modes':True,'offline_create_edit_delete_three_modes':True,'official_webhook_three_priorities':True,'local_delete_against_server_edit_three_modes':True,'no_duplicate_restoration':True,'selector_three_options':True,'selector_changes_actual_preference':True,'ordinary_server_received_order':True,'manual_conflict_buttons_removed':True,'official_tasknotes_runtime':True},indent=2))
