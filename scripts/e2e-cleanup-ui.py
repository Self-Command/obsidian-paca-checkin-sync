"""Click the real installed Obsidian cleanup UI and verify remote/local effects."""
record_state=ui_page.evaluate('record=>app.plugins.plugins["obsidian-paca-checkin-sync"].state.pending[record]',record_id)
assert record_state and record_state['recordWritten']
ui_page.evaluate('async record=>app.plugins.plugins["obsidian-paca-checkin-sync"].engine.action(record,"ignore")',record_id)
before=ui_page.evaluate('async path=>({text:await app.vault.read(app.vault.getAbstractFileByPath(path)),photos:app.vault.getFiles().filter(f=>f.path.startsWith("PushGo附件/")).map(f=>f.path)})',history_source['path'])
ui_page.evaluate('()=>app.commands.executeCommandById("app:open-settings")')
for _ in range(60):
    cleanup_settings=next((page for page in context.pages if page.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').count()),None)
    if cleanup_settings:break
    time.sleep(.25)
else:raise AssertionError('Obsidian settings did not open')
cleanup_settings.locator('.vertical-tab-nav-item').filter(has_text='Paca 任务同步').click()
cleanup_settings.locator('.setting-item').filter(has_text='显示已忽略及已归档记录').locator('.checkbox-container').click()
button=cleanup_settings.get_by_role('button',name='彻底清理',exact=True).first
button.click()
cleanup_settings.get_by_text('彻底清理打卡记录',exact=True).wait_for()
cleanup_settings.get_by_role('button',name='取消',exact=True).last.click()
assert any(row['record_id']==record_id for row in request('GET',cp+'/sync-deliveries')['items'])
button.click()
cleanup_settings.get_by_role('button',name='确认永久删除',exact=True).click()
cleanup_settings.get_by_role('button',name='彻底清理',exact=True).wait_for(state='hidden',timeout=30000)
for _ in range(60):
    if not any(row['record_id']==record_id for row in request('GET',cp+'/sync-deliveries')['items']):break
    time.sleep(.5)
else:raise AssertionError('Obsidian cleanup did not delete the server record')
after=ui_page.evaluate('async path=>({text:await app.vault.read(app.vault.getAbstractFileByPath(path)),photos:app.vault.getFiles().filter(f=>f.path.startsWith("PushGo附件/")).map(f=>f.path)})',history_source['path'])
assert before==after,'cleanup changed a saved local note or photo'
assert ui_page.evaluate('record=>["purging","purged"].includes(app.plugins.plugins["obsidian-paca-checkin-sync"].state.deliveries[record].policy)',record_id)
cleanup_settings.screenshot(path=str(ROOT/'verification/obsidian-cleanup.png'))
(ROOT/'verification/obsidian-cleanup-report.json').write_text(json.dumps({'d_source':os.environ['GITHUB_SHA'],'c_source':os.environ['PACA_C_SHA'],'real_settings_cleanup_button':True,'cancel_keeps_record':True,'confirm_removes_pending_item':True,'server_record_deleted':True,'local_note_and_photo_unchanged':True},indent=2))
