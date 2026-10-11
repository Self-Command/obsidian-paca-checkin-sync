"""Priority rules on real TaskNotes, with local changes queued before upload."""
ui_page.evaluate('async()=>{const tn=app.plugins.plugins.tasknotes;for(const hook of tn.settings.webhooks)hook.enabled=false;await tn.saveSettings();const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.auto=false;await d.persist();d.setAutomatic()}')

def priority_pull_until(predicate):
    for _ in range(160):
        sync_pull()
        if predicate():return
        time.sleep(.5)
    raise AssertionError(ui_page.evaluate('()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];return {status:d.status,problems:d.taskState.problems,operations:d.taskState.operations}}'))

def priority_note(identity):
    return ui_page.evaluate('async id=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];return d.taskState.links[id]?app.plugins.plugins.tasknotes.api.tasks.get(d.taskState.links[id].path):null}',identity)

for prefer in ('server','local'):
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

# The priority selector is visible and the former per-item choices are absent.
ui_page.evaluate('()=>app.commands.executeCommandById("app:open-settings")')
for _ in range(60):
    priority_settings=next((page for page in context.pages if page.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').count()),None)
    if priority_settings:break
    time.sleep(.25)
assert priority_settings
priority_settings.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').click()
priority_row=priority_settings.locator('.setting-item').filter(has_text='同步优先规则')
assert priority_row.locator('select option').all_text_contents()==['以服务器为准','以 Obsidian 为准']
assert priority_settings.get_by_role('button',name='采用服务器内容',exact=True).count()==0
assert priority_settings.get_by_role('button',name='采用本地内容',exact=True).count()==0
priority_settings.screenshot(path=str(ROOT/'verification/obsidian-sync-priority.png'))
if priority_settings==ui_page:ui_page.evaluate('()=>app.setting.close()')
else:priority_settings.close()
ui_page.evaluate('async()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];d.settings.syncPriority="server";await d.persist();d.resetEngine()}')
(ROOT/'verification/sync-priority-ui-report.json').write_text(json.dumps({'server_priority_both_directions':True,'obsidian_priority_both_directions':True,'unrelated_fields_preserved':True,'offline_edit_against_delete_automatic':True,'selector_two_options':True,'manual_conflict_buttons_removed':True,'official_tasknotes_runtime':True},indent=2))
