import assert from "node:assert/strict";
import { test } from "node:test";
import { GEAR_RATIOS, gearRatioLabel, hasGearRatioChange } from "../lib/gearRatios.ts";
import { canAccessCarPages, canAcknowledgeGearRatio, canChangeGearRatio, getLoginRedirect } from "../lib/userAccess.ts";

test("all technical bulletin gear pairs and display names are exact", () => {
  assert.deepEqual(GEAR_RATIOS.STD.gears, ["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"]);
  assert.deepEqual(GEAR_RATIOS.LONG.gears, ["12:37", "15:35", "18:33", "18:27", "20:25", "20:22"]);
  assert.deepEqual(GEAR_RATIOS.EXTRA_LONG.gears, ["12:37", "15:35", "18:33", "18:27", "19:23", "25:26"]);
  assert.deepEqual(Object.keys(GEAR_RATIOS).map(gearRatioLabel), ["STD", "LONG", "EXTRA LONG"]);
  assert.equal(gearRatioLabel(null), "NOT SET");
  assert.equal(gearRatioLabel(undefined), "NOT SET");
});

test("acknowledgement clears only versions already seen", () => {
  assert.equal(hasGearRatioChange(undefined, 0), false);
  assert.equal(hasGearRatioChange(1, 0), true);
  assert.equal(hasGearRatioChange(1, 1), false);
  assert.equal(hasGearRatioChange(2, 1), true);
  assert.equal(hasGearRatioChange(2, 2), false);
  assert.equal(hasGearRatioChange(1, 2), false);
});

test("only the existing Chief role can change ratios", () => {
  assert.equal(canChangeGearRatio(" DAN.CRAIN@rodinmotorsport.com "), true);
  for (const email of ["simon.crain", "olli.moss", "jack.carter", "ben.southern", "charlie.lawman", "jimmy", "alec.dixon", "guest", "unknown"]) {
    assert.equal(canChangeGearRatio(`${email}@rodinmotorsport.com`), false, email);
  }
  assert.equal(canChangeGearRatio(null), false);
});

test("mechanics can only view and acknowledge their assigned car", () => {
  for (const [name, assigned] of [["simon.crain", 1], ["olli.moss", 2], ["jack.carter", 3]]) {
    const email = `${name}@rodinmotorsport.com`;
    for (const carId of [1, 2, 3]) {
      assert.equal(canAccessCarPages(email, carId), carId === assigned);
      assert.equal(canAcknowledgeGearRatio(email, carId), carId === assigned);
    }
    assert.equal(getLoginRedirect(email), `/car/${assigned}/job-list`);
  }
});

test("engineer/guest viewing and Number 2 routing remain unchanged", () => {
  for (const name of ["jimmy", "alec.dixon", "guest", "dan.crain"]) {
    for (const carId of [1, 2, 3]) {
      const email = `${name}@rodinmotorsport.com`;
      assert.equal(canAccessCarPages(email, carId), true);
      assert.equal(canAcknowledgeGearRatio(email, carId), false);
    }
  }
  for (const name of ["ben.southern", "charlie.lawman"]) {
    const email = `${name}@rodinmotorsport.com`;
    assert.equal(getLoginRedirect(email), "/drain-out");
    for (const carId of [1, 2, 3]) {
      assert.equal(canAccessCarPages(email, carId), false);
      assert.equal(canAcknowledgeGearRatio(email, carId), false);
    }
  }
});
