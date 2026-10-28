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

test("parses multi-row stacked headers with merged month headers", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
        ["IFB Industries"],
        ["", "", "", "", "", "", "", "", "Apr-26", "", "", "May-26"],
        ["Sl No", "Customer", "Customer code", "PART No.", "Helper", "Customer Part No", "Line", "Description", "Actual customer scheule", "Apr'26 schedule", "Dispatch QTY", "Actual customer scheule", "May'26 schedule", "Dispatch QTY"],
        [1, "MATS, Pune1", 100859, "40001394", "H-1", "CP-1", "Radiator", "Rad Diesel", 100, 100, 0, 100, 100, 96]
    ]);
    sheet["!merges"] = [
        { s: { r: 1, c: 8 }, e: { r: 1, c: 10 } },
        { s: { r: 1, c: 11 }, e: { r: 1, c: 13 } }
    ];

    const records = getScheduleRecords(sheet, XLSX);
    assert.equal(records.length, 1);
    assert.equal(records[0]["Customer"], "MATS, Pune1");
    assert.equal(records[0]["PART No."], "40001394");
    assert.equal(records[0]["Apr-26 Actual customer scheule"], "100");
    assert.equal(records[0]["Apr'26 schedule"], "100");
    assert.equal(records[0]["Apr-26 Dispatch QTY"], "0");
    assert.equal(records[0]["May-26 Dispatch QTY"], "96");
});

test("finds the best schedule sheet when first sheet is a cover or instructions page", () => {
    const { findBestScheduleSheet } = require("./excel-header");
    const workbook = XLSX.utils.book_new();
    const coverSheet = XLSX.utils.aoa_to_sheet([["Welcome"], ["Instructions: Read carefully"]]);
    const scheduleSheet = XLSX.utils.aoa_to_sheet([
        ["Sl No", "Customer", "Customer code", "PART No.", "Oct-26", "Nov-26"],
        [1, "Tata Motors", "C100", "P200", 50, 60]
    ]);

    XLSX.utils.book_append_sheet(workbook, coverSheet, "Cover");
    XLSX.utils.book_append_sheet(workbook, scheduleSheet, "Schedule_Data");

    const best = findBestScheduleSheet(workbook, XLSX);
    assert.equal(best.sheetName, "Schedule_Data");
    assert.equal(best.headerRowIndex, 0);
});
