const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { findScheduleHeaderRow, getScheduleRecords } = require("./excel-header");

test("finds the company schedule header after title and revision rows", () => {
    const rows = [
        ["IFB Industries"],
        [],
        ["Monthly Plan: Oct'26 (FIRM) and (TENTATIVE 2 months)"],
        ["Sl No", "Customer", "Customer code", "Customer name2", "PART No.", "Description", "Oct-26", "Nov-26", "Dec-26"],
        [1, "ACME", "C001", "Acme Industries", "P-10", "Part", 100, 120, 130]
    ];

    assert.equal(findScheduleHeaderRow(rows), 3);
});

test("returns no match when customer and part headers are not both present", () => {
    assert.equal(findScheduleHeaderRow([["Customer", "Description", "Oct-26"]]), -1);
});

test("parses rows under the company title and monthly plan headings", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
        ["IFB Industries"],
        [],
        ["Monthly Plan: Oct'26 (FIRM) and (TENTATIVE 2 months)"],
        ["Sl No", "Customer", "Customer code", "Customer name2", "PART No.", "Helper", "Customer Part No", "Line", "Model", "OEM's", "Description", "Oct-26", "Nov-26", "Dec-26"],
        [1, "ACME Group", "C001", "Acme Industries", "P-10", "H1", "CP-10", "L1", "M1", "OEM", "Part description", 500, 600, 700]
    ]);

    const rows = getScheduleRecords(sheet, XLSX);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]["Customer name2"], "Acme Industries");
    assert.equal(rows[0]["PART No."], "P-10");
    assert.equal(rows[0]["Oct-26"], "500");
    assert.equal(rows[0]["Dec-26"], "700");
});
