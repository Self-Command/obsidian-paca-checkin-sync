import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedTaskTags,localTaskTags} from '../src/task-tags';
test('configured identification and archive tags are excluded without removing user tags',()=>{const cfg={taskTag:'任务',fieldMapping:{archiveTag:'已归档'}};assert.deepEqual(sharedTaskTags(['#任务','学习','已归档','学习'],cfg),['学习']);assert.deepEqual(sharedTaskTags(undefined,cfg),[]);assert.deepEqual(sharedTaskTags(['task','archived'],cfg),['archived','task'])});
test('writing shared tags retains task recognition and existing archive state',()=>{const cfg={taskTag:'任务',fieldMapping:{archiveTag:'已归档'}};assert.deepEqual(localTaskTags([],false,cfg),['任务']);assert.deepEqual(localTaskTags(['学习'],true,cfg),['任务','学习','已归档']);assert.deepEqual(sharedTaskTags(localTaskTags(['学习'],true,cfg),cfg),['学习']);assert.deepEqual(localTaskTags([],false,{...cfg,taskIdentificationMethod:'property'}),[])});
