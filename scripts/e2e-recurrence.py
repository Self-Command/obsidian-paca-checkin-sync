"""Official Obsidian materializes server periods, reuses them, and keeps histories."""
conn_settings=next(c for c in request('GET',f'/plugins/{plugin_id}/projects/{sync_project["id"]}/connections')['items'] if c['id']==sync_conn['id'])
request('PUT',sync_base+'/sync-config',{'mode':'enabled','revision':conn_settings['revision'],'reverse_status_map':{sync_archive['id']:'open'},'recurrence_enabled':True})
cycle=request('POST',f'/projects/{sync_project["id"]}/tasks',{'title':'服务器每天阅读','status_id':sync_status_map['open'],'importance':75},201)['data']
cycle_route=f'/plugins/{plugin_id}/projects/{sync_project["id"]}/tasks/{cycle["id"]}/recurrence'
for _ in range(180):
    info=request('GET',cycle_route)['items']
    if len(info)==1:break
    time.sleep(.5)
else:raise AssertionError('Native recurring task was not reconciled')
future=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).strftime('%Y-%m-%d')
request('PUT',cycle_route,{'connection_id':sync_conn['id'],'revision':info[0]['revision'],'op_id':str(__import__('uuid').uuid4()),'recurrence':'FREQ=DAILY;COUNT=2','recurrence_anchor':'scheduled','scheduled':future+'T09:00:00','due':future+'T10:00:00'},202)
# Do not call D during generation: the server must work while Obsidian is offline.
for _ in range(240):
    series=request('GET',cycle_route)['items'][0]
    if len(series['periods'])==2 and all(p['task_id'] for p in series['periods']):break
    assert not series['error'],series
    time.sleep(.5)
else:raise AssertionError('Independent server recurrence did not create periods')
period_ids={p['task_id'] for p in series['periods']}
for _ in range(150):
    sync_pull()
    data=ui_page.evaluate('async()=>{const d=app.plugins.plugins["obsidian-paca-checkin-sync"];const result=[];for(const [id,link] of Object.entries(d.taskState.links)){const task=await app.plugins.plugins.tasknotes.api.tasks.get(link.path);if(task)result.push({id,task})}return {result,problems:d.taskState.problems}}')
    occurrences=[r for r in data['result'] if r['task'].get('occurrence_date') in {p['date'] for p in series['periods']} and r['task']['title']=='服务器每天阅读']
    if len(occurrences)==2 and not data['problems']:break
    time.sleep(.5)
else:raise AssertionError(data)
parent=next(r for r in data['result'] if r['id']==series['sync_id'])
for occurrence in occurrences:
    assert occurrence['task'].get('recurrence') in (None,''),'Child retained its own recurrence rule'
    assert parent['task']['path'].removesuffix('.md') in occurrence['task']['recurrence_parent']
paths={r['task']['path'] for r in occurrences}
sync_pull();sync_pull()
listed_periods=ui_page.evaluate('async()=>{const tasks=await app.plugins.plugins.tasknotes.api.tasks.list();return tasks.filter(t=>t.occurrence_date&&t.title=="服务器每天阅读")}')
(ROOT/'verification/recurrence-notes-diagnostic.json').write_text(json.dumps({'paths':sorted(paths),'listed':listed_periods,'links':sync_links()},ensure_ascii=False,indent=2))
assert {t['path'] for t in listed_periods}==paths,'Occurrence notes were duplicated or lost TaskNotes recognition'
assert len(listed_periods)==2,'Each official period must appear once in the task list' 
# The normal official TaskNotes status menu reconciles the parent automatically.
chosen=occurrences[0]['task']
open_edit(chosen);ui_page.locator('[data-type="status"]').click();ui_page.locator('.menu-item').filter(has_text=re.compile(r'^Done$')).click();ui_page.locator('.tn-task-modal__button-bar button.mod-cta').click()
for _ in range(180):
    sync_pull()
    core_periods=[request('GET',f'/projects/{sync_project["id"]}/tasks/{task_id}')['data'] for task_id in period_ids]
    state=request('GET',cycle_route)['items'][0]
    if chosen['occurrence_date'] in (state['snapshot'].get('complete_instances') or []) and any(t['status_id']==sync_status_map['done'] for t in core_periods):break
    time.sleep(.5)
else:raise AssertionError('Official occurrence completion did not reconcile the shared series')
no_sync_problems()
ui_page.screenshot(path=str(ROOT/'verification/obsidian-recurring-periods.png'))
(ROOT/'verification/recurrence-ui-report.json').write_text(json.dumps({'a_source':os.environ['PACA_A_SHA'],'c_source':os.environ['PACA_C_SHA'],'d_source':os.environ['GITHUB_SHA'],'server_generates_without_sync':True,'official_materialization_api':True,'one_note_per_period':True,'children_no_second_recurrence':True,'repeat_pull_no_duplicates':True,'official_ui_completion_updates_parent_and_core':True,'real_phone':False},ensure_ascii=False,indent=2))
