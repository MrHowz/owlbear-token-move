import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {Motion, type MotionAdapter} from "../src/motion";
import {durationMs, positionAt} from "../src/shared";

function fixture() {
  let items = [{id:"one", position:{x:0,y:0}, locked:false}, {id:"two", position:{x:50,y:100}, locked:false}] as Item[];
  let interactions = 0, stops = 0, commits = 0;
  const adapter: MotionAdapter = {
    read: async ids => structuredClone(items.filter(i => ids.includes(i.id)).reverse()),
    interact: async base => {
      interactions++;
      let current = structuredClone(base);
      return [recipe => {current = structuredClone(current); recipe(current); return structuredClone(current);}, () => {stops++;}];
    },
    commit: async updated => {commits++; items = structuredClone(updated);}
  };
  return {motor:new Motion(adapter), initial:structuredClone(items), items:() => items, counts:() => ({interactions,stops,commits}), remove:() => {items=[];}};
}
test("grid speed converts to duration and invalid inputs fail", () => {
  assert.equal(durationMs({x:0,y:0},{x:300,y:400},100,2),2500);
  for (const speed of [0,-1,NaN,Infinity,21]) assert.throws(() => durationMs({x:0,y:0},{x:1,y:1},100,speed));
  assert.throws(() => durationMs({x:0,y:0},{x:1,y:1},0,1));
});
test("easing preserves endpoints and clamps elapsed time", () => {
  assert.deepEqual(positionAt({x:0,y:0},{x:100,y:200},-1,true),{x:0,y:0});
  assert.deepEqual(positionAt({x:0,y:0},{x:100,y:200},2,true),{x:100,y:200});
  assert.equal(positionAt({x:0,y:0},{x:100,y:0},.25,true).x,15.625);
});
test("one-way movement lands exactly on B while preserving group offsets", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:300,y:0},100,1,false,false,0);
  await f.motor.tick(3000);
  assert.equal(f.motor.running,false);
  assert.deepEqual(f.items().map(i=>i.position),[{x:300,y:0},{x:350,y:100}]);
  assert.equal(f.counts().commits,1);
});
test("stop saves the intermediate position and subsequent ticks do nothing", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:300,y:0},100,1,false,false,0);
  await f.motor.tick(1500); await f.motor.stop(); await f.motor.tick(3000);
  assert.deepEqual(f.items()[0].position,{x:150,y:0});
});
test("patrol returns to A and continues toward B", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0);
  await f.motor.tick(1000); await f.motor.tick(2000); await f.motor.stop();
  assert.deepEqual(f.items().map(i=>i.position),f.initial.map(i=>i.position));
});
test("long movements renew interactions before the SDK timeout", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:10000,y:0},100,1,false,false,0);
  await f.motor.tick(10000); await f.motor.tick(20000); await f.motor.tick(40000); await f.motor.tick(100000);
  assert.equal(f.motor.running,false);
  assert.deepEqual(f.items()[0].position,{x:10000,y:0});
  assert.equal(f.counts().interactions,4);
});
test("deleted items cannot be restarted and stopping on scene change does not commit", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0);
  await f.motor.tick(500); await f.motor.stop(false);
  assert.equal(f.counts().commits,0);
  f.remove(); await assert.rejects(f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0));
});
