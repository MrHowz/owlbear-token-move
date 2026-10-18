import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {Motion, type MotionAdapter} from "../src/motion";
import {durationMs, positionAt} from "../src/shared";

function fixture(scaleX=2,type="IMAGE") {
  let items = [{id:"one",name:"One",type,scale:{x:scaleX,y:3}, position:{x:0,y:0}, locked:false}, {id:"two",name:"Two",type:"IMAGE",scale:{x:1,y:1}, position:{x:50,y:100}, locked:false}] as Item[];
  let live=structuredClone(items);
  let interactions = 0, stops = 0, commits = 0;
  const adapter: MotionAdapter = {
    read: async ids => structuredClone(items.filter(i => ids.includes(i.id)).reverse()),
    interact: async base => {
      interactions++;
      let current = structuredClone(base);
      return [recipe => {current = structuredClone(current); recipe(current); live=structuredClone(current); return structuredClone(current);}, () => {stops++;}];
    },
    commit: async updated => {commits++; items = structuredClone(updated);}
  };
  return {adapter,motor:new Motion(adapter), initial:structuredClone(items), items:() => items, live:()=>live, counts:() => ({interactions,stops,commits}), remove:() => {items=[];}};
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
  for(const now of [20000,40000,60000,80000]){
    await f.motor.tick(now);await f.motor.waitForMaintenance();await f.motor.tick(now);
  }
  await f.motor.tick(100000);
  assert.equal(f.motor.running,false);
  assert.deepEqual(f.items()[0].position,{x:10000,y:0});
  assert.equal(f.counts().interactions,5);
});
test("deleted items cannot be restarted and stopping on scene change does not commit", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0);
  await f.motor.tick(500); await f.motor.stop(false);
  assert.equal(f.counts().commits,0);
  f.remove(); await assert.rejects(f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0));
});
test("patrol flips on arrival at each endpoint without changing size or Y scale",async()=>{
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:false});
  assert.deepEqual(f.live()[0].scale,{x:2,y:3});
  await f.motor.tick(1000); assert.equal(f.motor.direction,"return");assert.deepEqual(f.live()[0].scale,{x:-2,y:3});
  await f.motor.tick(2000);assert.equal(f.motor.direction,"outbound");assert.deepEqual(f.live()[0].scale,{x:2,y:3});
});
test("left-facing artwork and a route going left use the correct flip",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0,{flip:true,facing:"left",resume:false});
  assert.equal(f.live()[0].scale.x,2);await f.motor.tick(1000);assert.equal(f.live()[0].scale.x,-2);
});
test("stop and resume on the return leg keeps moving home",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  assert.equal(f.items()[0].position.x,50);
  await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,2000,{flip:true,facing:"right",resume:true});
  assert.equal(f.live()[0].scale.x,-2);await f.motor.tick(2500);assert.equal(f.live()[0].position.x,0);
});
test("vertical routes flip on return and keep the flip when resumed",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:0,y:100},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  assert.equal(f.items()[0].scale.x,-2);
  await f.motor.start(f.initial,{x:0,y:100},100,1,true,false,2000,{flip:true,facing:"right",resume:true});assert.equal(f.live()[0].scale.x,-2);
});

test("switching a paused return leg to one-way heads toward B",async()=>{
  const f=fixture();const options={flip:true,facing:"right" as const,resume:true};
  await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,options);
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  await f.motor.start(f.initial,{x:100,y:0},100,1,false,false,2000,options);
  assert.equal(f.motor.direction,"outbound");assert.equal(f.live()[0].scale.x,2);
  await f.motor.tick(2500);assert.equal(f.items()[0].position.x,100);assert.equal(f.motor.running,false);
});
test("disabled flip preserves already mirrored artwork",async()=>{
  const f=fixture(-2);
  await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0);
  await f.motor.tick(1000);assert.equal(f.live()[0].scale.x,-2);
});
test("non-image items move but are not flipped",async()=>{
  const f=fixture(2,"SHAPE");await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(500);assert.equal(f.live()[0].position.x,-50);assert.equal(f.live()[0].scale.x,2);
});

test("LINE follows every corner at the configured speed and preserves group offsets",async()=>{
  const f=fixture();const waypoints=[{x:100,y:0},{x:100,y:100},{x:200,y:100}];
  await f.motor.start(f.initial,waypoints[2],100,1,false,false,0,{flip:true,facing:"right",resume:true,waypoints});
  await f.motor.tick(1500);assert.deepEqual(f.live()[0].position,{x:100,y:50});
  assert.deepEqual(f.live()[1].position,{x:150,y:150});assert.equal(f.motor.waypointIndex,2);
  await f.motor.tick(3000);assert.deepEqual(f.items()[0].position,{x:200,y:100});assert.equal(f.motor.running,false);assert.equal(f.motor.progress,1);
});

test("LINE patrol retraces the same cells instead of returning diagonally",async()=>{
  const f=fixture();const waypoints=[{x:100,y:0},{x:100,y:100}];
  await f.motor.start(f.initial,waypoints[1],100,1,true,false,0,{flip:true,facing:"right",resume:true,waypoints});
  await f.motor.tick(2000);assert.equal(f.motor.direction,"return");
  await f.motor.tick(2500);assert.deepEqual(f.live()[0].position,{x:100,y:50});
  await f.motor.tick(3500);assert.deepEqual(f.live()[0].position,{x:50,y:0});assert.equal(f.live()[0].scale.x,-2);
  await f.motor.tick(4000);assert.equal(f.motor.direction,"outbound");assert.deepEqual(f.live()[0].position,{x:0,y:0});assert.equal(f.live()[0].scale.x,2);
});

test("a stopped LINE resumes the current return segment and keeps later corners",async()=>{
  const f=fixture();const waypoints=[{x:100,y:0},{x:100,y:100},{x:200,y:100}];
  const options={flip:true,facing:"right" as const,resume:true,waypoints};
  await f.motor.start(f.initial,waypoints[2],100,1,true,false,0,options);
  await f.motor.tick(3500);await f.motor.stop();assert.deepEqual(f.items()[0].position,{x:150,y:100});
  await f.motor.start(f.initial,waypoints[2],100,1,true,false,4000,options);
  await f.motor.tick(5000);assert.deepEqual(f.live()[0].position,{x:100,y:50});assert.equal(f.motor.direction,"return");
});

test("LINE flips at horizontal direction changes even before the final B",async()=>{
  const f=fixture();const waypoints=[{x:100,y:0},{x:0,y:0},{x:100,y:0}];
  await f.motor.start(f.initial,waypoints[2],100,1,false,false,0,{flip:true,facing:"right",resume:true,waypoints});
  await f.motor.tick(1000);assert.equal(f.live()[0].scale.x,-2);
  await f.motor.tick(2000);assert.equal(f.live()[0].scale.x,2);
});

test("long suspension skips whole LINE cycles and resumes at the correct cell",async()=>{
  const f=fixture();const waypoints=[{x:100,y:0},{x:100,y:100}];
  await f.motor.start(f.initial,waypoints[1],100,1,true,false,0,{flip:true,facing:"right",resume:true,waypoints});
  await f.motor.tick(4_000_050);assert.deepEqual(f.live()[0].position,{x:5,y:0});assert.equal(f.motor.direction,"outbound");
});

function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
function near(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-7,`${actual} ≈ ${expected}`);}

test("frames keep moving while renewal read, checkpoint and replacement each wait for I/O",{timeout:2000},async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:10000,y:0},100,1,false,false,0);
  const readGate=gate(),commitGate=gate(),openGate=gate(),committing=gate(),opening=gate();
  const read=f.adapter.read,commit=f.adapter.commit,interact=f.adapter.interact;
  f.adapter.read=async ids=>{await readGate.promise;return read(ids);};
  f.adapter.commit=async items=>{committing.release();await commitGate.promise;return commit(items);};
  f.adapter.interact=async items=>{opening.release();await openGate.promise;return interact(items);};
  await f.motor.tick(20000);assert.equal(f.live()[0].position.x,2000);
  await f.motor.tick(20016);near(f.live()[0].position.x,2001.6);assert.equal(f.counts().stops,0);
  readGate.release();await committing.promise;
  await f.motor.tick(20100);near(f.live()[0].position.x,2010);assert.equal(f.counts().stops,0);
  commitGate.release();await opening.promise;
  await f.motor.tick(20200);near(f.live()[0].position.x,2020);assert.equal(f.counts().stops,0);
  openGate.release();await f.motor.waitForMaintenance();await f.motor.tick(20216);
  near(f.live()[0].position.x,2021.6);near(f.live()[1].position.x,2071.6);
  assert.equal(f.counts().interactions,2);assert.equal(f.counts().stops,1);
});

test("stopping during a slow renewal checkpoint leaves the final position as the last write",{timeout:2000},async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:10000,y:0},100,1,false,false,0);
  const blocked=gate(),started=gate();const commit=f.adapter.commit;let first=true;
  f.adapter.commit=async items=>{if(first){first=false;started.release();await blocked.promise;}return commit(items);};
  await f.motor.tick(20000);await started.promise;await f.motor.tick(20100);
  const stopped=f.motor.stop();assert.equal(f.motor.running,false);
  blocked.release();await stopped;await f.motor.waitForMaintenance();
  near(f.items()[0].position.x,2010);assert.equal(f.counts().interactions,1);
});

test("a replacement arriving after cancellation cannot revive or replace a newer run",{timeout:2000},async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:10000,y:0},100,1,false,false,0);
  const blocked=gate(),opening=gate();const interact=f.adapter.interact;let delayNext=true;
  f.adapter.interact=async items=>{if(delayNext){delayNext=false;opening.release();await blocked.promise;}return interact(items);};
  await f.motor.tick(20000);await opening.promise;await f.motor.stop(false);
  await f.motor.start(f.initial,{x:5000,y:0},100,1,false,false,20100);
  blocked.release();await new Promise<void>(resolve=>setImmediate(resolve));
  await f.motor.tick(20200);
  assert.equal(f.motor.running,true);assert.equal(f.live()[0].position.x,2010);assert.equal(f.counts().stops,2);
});

test("the movement clock begins when initial interaction is ready, not before the RPC wait",async()=>{
  const f=fixture();let readyAt=0;
  const interact=f.adapter.interact;f.adapter.interact=async items=>{readyAt=1000;return interact(items);};
  const motor=new Motion(f.adapter,()=>readyAt);
  await motor.start(f.initial,{x:1000,y:0},100,1,false,false,0);
  await motor.tick(1000);assert.equal(f.live()[0].position.x,0);
  await motor.tick(1016);assert.equal(f.live()[0].position.x,1.6);
});
