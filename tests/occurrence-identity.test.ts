import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyOccurrence} from '../src/occurrence-identity';

const id='11111111-1111-4111-8111-111111111111';
const task={path:'任务/本期.md',title:'任务',status:'open',recurrence_parent:'[[任务/母任务]]',occurrence_date:'2026-10-09'};
test('materialization may only write the requested parent and date',()=>{
 assert.doesNotThrow(()=>verifyOccurrence(task,'任务/母任务.md','2026-10-09',id,undefined,''));
 assert.throws(()=>verifyOccurrence({...task,occurrence_date:'2026-10-10'},'任务/母任务.md','2026-10-09',id,undefined,''));
 assert.throws(()=>verifyOccurrence({...task,recurrence_parent:'[[另一个任务]]'},'任务/母任务.md','2026-10-09',id,undefined,''));
});
test('a reused note with another stable marker is never overwritten',()=>{
 assert.throws(()=>verifyOccurrence(task,'任务/母任务.md','2026-10-09',id,'22222222-2222-4222-8222-222222222222',''));
 assert.throws(()=>verifyOccurrence(task,'任务/母任务.md','2026-10-09',id,undefined,'<!-- paca-sync-id:22222222-2222-4222-8222-222222222222 -->'));
});
