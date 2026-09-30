import assert from "node:assert/strict";
import test from "node:test";
import { normaliseClutchSerial } from "../lib/clutchSerial.ts";
import { canAllocateClutchForCar, canManageCars } from "../lib/userAccess.ts";

test("clutch serial comparison ignores case and surrounding whitespace", () => {
  assert.equal(normaliseClutchSerial("  CL-28819  "), "cl-28819");
  assert.equal(normaliseClutchSerial("cl-28819"), "cl-28819");
  assert.equal(normaliseClutchSerial(null), "");
});

test("only Chief and the assigned Number 1 can invoke the narrow allocation action", () => {
  assert.equal(canAllocateClutchForCar("dan.crain@rodinmotorsport.com", 3), true);
  assert.equal(canAllocateClutchForCar("simon.crain@rodinmotorsport.com", 1), true);
  assert.equal(canAllocateClutchForCar("simon.crain@rodinmotorsport.com", 2), false);
  assert.equal(canAllocateClutchForCar("olli.moss@rodinmotorsport.com", 2), true);
  assert.equal(canAllocateClutchForCar("jack.carter@rodinmotorsport.com", 3), true);
  for (const email of [
    "ben.southern@rodinmotorsport.com",
    "jimmy@rodinmotorsport.com",
    "guest@rodinmotorsport.com",
    null,
  ]) {
    assert.equal(canAllocateClutchForCar(email, 1), false);
  }
});

test("assigned allocation permission does not grant general car management", () => {
  assert.equal(canManageCars("simon.crain@rodinmotorsport.com"), false);
  assert.equal(canManageCars("dan.crain@rodinmotorsport.com"), true);
});
