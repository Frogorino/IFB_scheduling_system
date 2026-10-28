const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCustomer } = require("./customer-normalizer");

test("normalizes customer code 100860 variations into MATS, Pune2", () => {
    assert.equal(normalizeCustomer("MATS", "", "100860").name, "MATS, Pune2");
    assert.equal(normalizeCustomer("MATS, Pune2", "", "100860").name, "MATS, Pune2");
    assert.equal(normalizeCustomer("Mahle Pune2", "", "100860").name, "MATS, Pune2");
    assert.equal(normalizeCustomer("MATS").name, "MATS, Pune2");
});

test("normalizes TTR Rudrapur into TTR, Rudrapur with standard comma", () => {
    assert.equal(normalizeCustomer("TTR Rudrapur", "", "100851").name, "TTR, Rudrapur");
    assert.equal(normalizeCustomer("TTR Pantnagar", "", "100851").name, "TTR, Rudrapur");
    assert.equal(normalizeCustomer("TTR Rudrapur").name, "TTR, Rudrapur");
});

test("normalizes trailing spaces on customer names", () => {
    assert.equal(normalizeCustomer("TVS MOTOR ", "", "100058").name, "TVS MOTOR");
    assert.equal(normalizeCustomer("PEE AAR ", "", "101569").name, "PEE AAR");
    assert.equal(normalizeCustomer("MATS, Chennai ", "", "101294").name, "MATS, Chennai");
});

test("maps TTR Pune plants into unified TTR, Pune", () => {
    assert.equal(normalizeCustomer("TTR, Pune", "", "101338").name, "TTR, Pune");
    assert.equal(normalizeCustomer("TTR, Pune", "", "100837").name, "TTR, Pune");
    assert.equal(normalizeCustomer("TTR Pune 1", "", "100837").name, "TTR, Pune");
    assert.equal(normalizeCustomer("TTR Pune 2", "", "101338").name, "TTR, Pune");
});

test("assigns correct customer parent group", () => {
    assert.equal(normalizeCustomer("MATS, Pune1", "", "100859").group, "MATS");
    assert.equal(normalizeCustomer("Subros, Pune", "", "100836").group, "Subros");
    assert.equal(normalizeCustomer("Sanden, Palwal", "", "100855").group, "Sanden");
});
