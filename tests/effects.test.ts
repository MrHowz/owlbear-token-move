import {test} from "node:test";
import assert from "node:assert/strict";
import {effectOffset,noEffect} from "../src/effects";
import {defaultSettings,normalizedSettings,validSettings} from "../src/shared";

test("disabled effects and the start of every effect have zero offsets",()=>{
  for(const effect of ["none","shake","wiggle"] as const)assert.deepEqual(effectOffset({...noEffect,effect},0,100),{x:0,y:0,rotation:0});
  assert.deepEqual(effectOffset(noEffect,1234,100),{x:0,y:0,rotation:0});
});
test("wiggle angle and tempo controls change the actual angle and timing",()=>{
  const settings={...noEffect,effect:"wiggle" as const,wiggleAngle:20};
  assert.equal(effectOffset(settings,1000/6,100).rotation,20);
  assert.equal(effectOffset({...settings,effectSpeed:2},1000/12,100).rotation,20);
  assert.equal(effectOffset(settings,500,100).rotation,-20);
});
test("shake distance scales with the scene grid and ignores token size",()=>{
  const a=effectOffset({...noEffect,effect:"shake"},123,100),b=effectOffset({...noEffect,effect:"shake"},123,200);
  assert.equal(b.x,a.x*2);assert.equal(b.y,a.y*2);assert.equal(b.rotation,0);
});
test("old settings default to unmodified LINE and malformed effects cannot enter saved groups",()=>{
  const old={speed:2,mode:"patrol" as const,smooth:false,flip:true,facing:"right" as const};
  assert.equal(validSettings(old),true);assert.equal(normalizedSettings(old).effect,"none");assert.equal(normalizedSettings(old).movement,"line");
  for(const patch of [{effect:"bad"},{movement:"bad"},{wiggleAngle:31},{wiggleAngle:NaN},{shakeDistance:0},{effectSpeed:Infinity},{effectSpeed:.1}])assert.equal(validSettings({...defaultSettings,...patch} as typeof defaultSettings),false);
});
