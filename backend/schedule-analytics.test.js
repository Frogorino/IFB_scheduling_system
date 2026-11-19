const test = require("node:test");
const assert = require("node:assert/strict");
const {
    calculateScheduleAnalytics,
    getDemandSnapshotTimeline,
    compareDifferentSheets,
    compareWithinSameSheet,
    getSnapshotComparisonMeta
} = require("./schedule-analytics");

test("demand revision WAPE compares like parts across the latest two snapshots", () => {
    const snapshots = [
        {
            snapshotDate: "2026-08-01",
            capturedAt: "2026-08-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 500 } }]
        },
        {
            snapshotDate: "2026-09-01",
            capturedAt: "2026-09-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1000 } }]
        }
    ];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-01T00:00:00Z"));
    assert.equal(result.demandRevisionWape.value, 50);
    assert.equal(result.demandRevisionWape.status, "available");
    assert.equal(result.demandRevisionWape.comparedParts, 1);
    assert.deepEqual(result.demandRevisionWape.revisions, [{
        customer: "Alpha",
        partNo: "P1",
        previousDemand: 500,
        latestDemand: 1000,
        change: 500
    }]);
});

test("demand revision accepts month names and short years in delivery-month values", () => {
    const snapshots = [
        {
            snapshotDate: "2026-08-01",
            capturedAt: "2026-08-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", deliveryMonth: "Oct-26", currentMonth: 500 }]
        },
        {
            snapshotDate: "2026-09-01",
            capturedAt: "2026-09-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", deliveryMonth: "Oct-26", currentMonth: 1000 }]
        }
    ];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-01T00:00:00Z"));
    assert.equal(result.demandRevisionWape.value, 50);
});

test("demand revision keeps distinct customer part lines separate", () => {
    const snapshots = [
        {
            snapshotDate: "2026-08-01",
            capturedAt: "2026-08-01T10:00:00.000Z",
            rows: [
                { customer: "Alpha", partNo: "P1", customerPartNo: "CP1", line: "L1", monthlySchedules: { "2026-10": 100 } },
                { customer: "Alpha", partNo: "P1", customerPartNo: "CP2", line: "L2", monthlySchedules: { "2026-10": 100 } }
            ]
        },
        {
            snapshotDate: "2026-09-01",
            capturedAt: "2026-09-01T10:00:00.000Z",
            rows: [
                { customer: "Alpha", partNo: "P1", customerPartNo: "CP1", line: "L1", monthlySchedules: { "2026-10": 100 } },
                { customer: "Alpha", partNo: "P1", customerPartNo: "CP2", line: "L2", monthlySchedules: { "2026-10": 0 } }
            ]
        }
    ];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-01T00:00:00Z"));
    assert.equal(result.demandRevisionWape.comparedParts, 2);
    assert.equal(result.demandRevisionWape.value, 100);
});

test("historical demand can compare a selected pair of dated 2025 snapshots", () => {
    const snapshots = [
        {
            snapshotId: "2025-08-rev1",
            snapshotDate: "2025-08-01",
            capturedAt: "2025-08-01T09:00:00.000Z",
            source: "customer-aug.xlsx",
            rows: [{ customer: "Alpha", customerCode: "C001", partNo: "P1", monthlySchedules: { "2025-10": 500 } }]
        },
        {
            snapshotId: "2025-09-rev1",
            snapshotDate: "2025-09-01",
            capturedAt: "2025-09-01T09:00:00.000Z",
            source: "customer-sep.xlsx",
            rows: [{ customer: "Alpha", customerCode: "C001", partNo: "P1", monthlySchedules: { "2025-10": 1000 } }]
        },
        {
            snapshotId: "2025-10-rev1",
            snapshotDate: "2025-10-01",
            capturedAt: "2025-10-01T09:00:00.000Z",
            source: "customer-oct.xlsx",
            rows: [{ customer: "Alpha", customerCode: "C001", partNo: "P1", monthlySchedules: { "2025-10": 1200 } }]
        }
    ];

    const result = calculateScheduleAnalytics(
        snapshots,
        "2025-10",
        "Alpha",
        new Date("2025-11-01T00:00:00Z"),
        { previousSnapshotId: "2025-08-rev1", currentSnapshotId: "2025-09-rev1" }
    );

    assert.equal(result.demandRevisionWape.value, 50);
    assert.equal(result.demandRevisionWape.previousSnapshotDate, "2025-08-01");
    assert.equal(result.demandRevisionWape.latestSnapshotDate, "2025-09-01");
    assert.equal(result.demandRevisionWape.previousSource, "customer-aug.xlsx");
    assert.equal(result.demandRevisionWape.latestSource, "customer-sep.xlsx");
});

test("snapshot timeline indicates which dated uploads contain demand for the selected month", () => {
    const snapshots = [
        {
            snapshotId: "first",
            snapshotDate: "2025-08-01",
            capturedAt: "2025-08-01T09:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2025-10": 500 } }]
        },
        {
            snapshotId: "second",
            snapshotDate: "2025-09-01",
            capturedAt: "2025-09-01T09:00:00.000Z",
            rows: [{ customer: "Beta", partNo: "P2", monthlySchedules: { "2025-10": 1000 } }]
        }
    ];

    const timeline = getDemandSnapshotTimeline(snapshots, "2025-10", "Alpha");
    assert.equal(timeline[0].snapshotId, "first");
    assert.equal(timeline[0].hasDemand, true);
    assert.equal(timeline[0].duplicateOfPrevious, false);
    assert.equal(timeline[1].hasDemand, false);
});

test("default WAPE skips a duplicate upload as the second comparison point", () => {
    const snapshots = [
        {
            snapshotId: "baseline",
            snapshotDate: "2025-09-03",
            capturedAt: "2025-10-08T09:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 500 } }]
        },
        {
            snapshotId: "current",
            snapshotDate: "2025-10-03",
            capturedAt: "2025-10-08T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1000 } }]
        },
        {
            snapshotId: "duplicate-current",
            snapshotDate: "2025-10-03",
            capturedAt: "2025-10-08T11:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1000 } }]
        }
    ];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-10-08T00:00:00Z"));
    assert.equal(result.demandRevisionWape.value, 50);
    assert.equal(result.demandRevisionWape.previousSnapshotId, "baseline");
    assert.equal(result.demandRevisionWape.latestSnapshotId, "current");
    const timeline = getDemandSnapshotTimeline(snapshots, "2026-10", "Alpha");
    assert.equal(timeline[2].duplicateOfPrevious, true);
});

test("selected snapshot comparison requires chronological earlier and later dates", () => {
    const snapshots = [
        {
            snapshotId: "first",
            snapshotDate: "2025-08-01",
            capturedAt: "2025-08-01T09:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2025-10": 500 } }]
        },
        {
            snapshotId: "second",
            snapshotDate: "2025-09-01",
            capturedAt: "2025-09-01T09:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2025-10": 1000 } }]
        }
    ];

    const result = calculateScheduleAnalytics(
        snapshots,
        "2025-10",
        "Alpha",
        new Date("2025-11-01T00:00:00Z"),
        { previousSnapshotId: "second", currentSnapshotId: "first" }
    );
    assert.equal(result.demandRevisionWape.status, "snapshots_out_of_order");
    assert.equal(result.demandRevisionWape.value, null);
});

test("on-time performance accepts dispatches on the due date and reports both rate types", () => {
    const snapshots = [{
        snapshotDate: "2026-11-01",
        capturedAt: "2026-11-01T10:00:00.000Z",
        rows: [
            {
                customer: "Alpha",
                partNo: "P1",
                monthlyCommitments: { "2026-10": 100 },
                monthlyDispatches: { "2026-10": 80 },
                monthlyDispatchDates: { "2026-10": "31/10/2026" }
            },
            {
                customer: "Alpha",
                partNo: "P2",
                monthlyCommitments: { "2026-10": 100 },
                monthlyDispatches: { "2026-10": 100 },
                monthlyDispatchDates: { "2026-10": "2026-11-01" }
            },
            {
                customer: "Alpha",
                partNo: "P3",
                monthlyCommitments: { "2026-10": 100 },
                monthlyDispatches: { "2026-10": 100 },
                monthlyDispatchDates: { "2026-10": "2026-10-20" }
            }
        ]
    }];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-02T00:00:00Z"));
    assert.equal(result.onTime.quantityRate, 60);
    assert.ok(Math.abs(result.onTime.lineRate - 100 / 3) < 1e-10);
    assert.equal(result.onTime.status, "available");
    assert.deepEqual(result.onTime.issues.map(issue => issue.type).sort(), ["Late dispatch", "Short dispatch"]);
});

test("on-time can use explicit commitment and dispatch fields aligned to a delivery month", () => {
    const snapshots = [{
        snapshotDate: "2026-11-01",
        capturedAt: "2026-11-01T10:00:00.000Z",
        rows: [{
            customer: "Alpha",
            partNo: "P1",
            deliveryMonth: "Oct-26",
            companyCommitment: 100,
            companyCommitmentProvided: true,
            actualDispatch: 100,
            actualDispatchProvided: true,
            actualDispatchMonthAligned: true,
            dispatchDate: "2026-10-31"
        }]
    }];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-02T00:00:00Z"));
    assert.equal(result.onTime.quantityRate, 100);
    assert.equal(result.onTime.lineRate, 100);
});

test("on-time metric remains unavailable when dispatch evidence is missing", () => {
    const snapshots = [{
        snapshotDate: "2026-11-01",
        capturedAt: "2026-11-01T10:00:00.000Z",
        rows: [{
            customer: "Alpha",
            partNo: "P1",
            monthlyCommitments: { "2026-10": 100 },
            monthlyDispatches: { "2026-10": 80 }
        }]
    }];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-02T00:00:00Z"));
    assert.equal(result.onTime.quantityRate, null);
    assert.equal(result.onTime.status, "missing_dispatch_dates");
    assert.equal(result.onTime.issues[0].type, "Missing dispatch date");
});

test("future delivery months are marked as not yet due", () => {
    const snapshots = [{
        snapshotDate: "2026-10-01",
        capturedAt: "2026-10-01T10:00:00.000Z",
        rows: [{
            customer: "Alpha",
            partNo: "P1",
            monthlyCommitments: { "2026-10": 100 },
            monthlyDispatches: { "2026-10": 0 }
        }]
    }];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-10-15T00:00:00Z"));
    assert.equal(result.onTime.quantityRate, null);
    assert.equal(result.onTime.status, "due_date_not_passed");
});

test("on-time performance does not use a snapshot captured before the due date", () => {
    const snapshots = [{
        snapshotDate: "2026-10-15",
        capturedAt: "2026-10-15T10:00:00.000Z",
        rows: [{
            customer: "Alpha",
            partNo: "P1",
            monthlyCommitments: { "2026-10": 100 },
            monthlyDispatches: { "2026-10": 0 }
        }]
    }];

    const result = calculateScheduleAnalytics(snapshots, "2026-10", "Alpha", new Date("2026-11-02T00:00:00Z"));
    assert.equal(result.onTime.status, "snapshot_before_due_date");
    assert.equal(result.onTime.quantityRate, null);
});

test("compareDifferentSheets compares two sheets with revisions, additions, and removals", () => {
    const snapshots = [
        {
            snapshotId: "sheet-1",
            source: "Motor_Plan_Rev1.xlsx",
            snapshotDate: "2026-10-01",
            rows: [
                { customer: "Whirlpool", partNo: "MTR-01", productDescription: "Motor A", monthlySchedules: { "2026-10": 1000 } },
                { customer: "Whirlpool", partNo: "MTR-02", productDescription: "Motor B", monthlySchedules: { "2026-10": 500 } },
                { customer: "Bosch", partNo: "MTR-03", productDescription: "Motor C", monthlySchedules: { "2026-10": 300 } }
            ]
        },
        {
            snapshotId: "sheet-2",
            source: "Motor_Plan_Rev2.xlsx",
            snapshotDate: "2026-10-10",
            rows: [
                { customer: "Whirlpool", partNo: "MTR-01", productDescription: "Motor A", monthlySchedules: { "2026-10": 1200 } }, // +200
                { customer: "Whirlpool", partNo: "MTR-02", productDescription: "Motor B", monthlySchedules: { "2026-10": 400 } },  // -100
                { customer: "Godrej", partNo: "MTR-04", productDescription: "Motor D", monthlySchedules: { "2026-10": 600 } }      // added
                // MTR-03 removed
            ]
        }
    ];

    const result = compareDifferentSheets(snapshots, {
        baseSnapshotId: "sheet-1",
        compareSnapshotId: "sheet-2",
        month: "2026-10",
        customer: "ALL"
    });

    assert.equal(result.status, "available");
    assert.equal(result.summary.baseTotal, 1800);
    assert.equal(result.summary.compareTotal, 2200);
    assert.equal(result.summary.netChange, 400);
    assert.equal(result.summary.partsIncreased, 1);
    assert.equal(result.summary.partsDecreased, 1);
    assert.equal(result.summary.partsAdded, 1);
    assert.equal(result.summary.partsRemoved, 1);
    assert.ok(result.summary.takeaway.includes("Overall demand shifted"));

    // Whirlpool only
    const wpResult = compareDifferentSheets(snapshots, {
        baseSnapshotId: "sheet-1",
        compareSnapshotId: "sheet-2",
        month: "2026-10",
        customer: "Whirlpool"
    });
    assert.equal(wpResult.summary.baseTotal, 1500);
    assert.equal(wpResult.summary.compareTotal, 1600);
});

test("compareWithinSameSheet compares Month A vs Month B in single sheet", () => {
    const snapshots = [
        {
            snapshotId: "single-sheet",
            source: "Monthly_Horizon.xlsx",
            snapshotDate: "2026-10-01",
            rows: [
                { customer: "Samsung", partNo: "M1", monthlySchedules: { "2026-10": 1000, "2026-11": 1200, "2026-12": 800 } },
                { customer: "Samsung", partNo: "M2", monthlySchedules: { "2026-10": 500, "2026-11": 400, "2026-12": 300 } }
            ]
        }
    ];

    const result = compareWithinSameSheet(snapshots, {
        snapshotId: "single-sheet",
        mode: "months",
        monthA: "2026-10",
        monthB: "2026-11"
    });

    assert.equal(result.status, "available");
    assert.equal(result.summary.totalA, 1500);
    assert.equal(result.summary.totalB, 1600);
    assert.equal(result.summary.netChange, 100);
    assert.equal(result.summary.partsIncreased, 1);
    assert.equal(result.summary.partsDecreased, 1);
    assert.ok(result.summary.takeaway.includes("Oct'26") || result.summary.takeaway.includes("2026-10"));
});

test("compareWithinSameSheet compares Customer Schedule vs Company Commitment vs Dispatch", () => {
    const snapshots = [
        {
            snapshotId: "ops-sheet",
            source: "Operations.xlsx",
            snapshotDate: "2026-10-01",
            rows: [
                {
                    customer: "LG",
                    partNo: "L1",
                    monthlySchedules: { "2026-10": 1000 },
                    monthlyCommitments: { "2026-10": 900 },
                    monthlyDispatches: { "2026-10": 850 }
                },
                {
                    customer: "LG",
                    partNo: "L2",
                    monthlySchedules: { "2026-10": 500 },
                    monthlyCommitments: { "2026-10": 500 },
                    monthlyDispatches: { "2026-10": 500 }
                }
            ]
        }
    ];

    // Schedule vs Commitment
    const resSchedComm = compareWithinSameSheet(snapshots, {
        snapshotId: "ops-sheet",
        mode: "metrics",
        metricA: "schedule",
        metricB: "commitment",
        month: "2026-10"
    });
    assert.equal(resSchedComm.status, "available");
    assert.equal(resSchedComm.summary.totalA, 1500); // Schedule
    assert.equal(resSchedComm.summary.totalB, 1400); // Commitment
    assert.equal(resSchedComm.summary.partsShortfall, 1);
    assert.equal(resSchedComm.summary.shortfallQty, 100);

    // Commitment vs Dispatch
    const resCommDisp = compareWithinSameSheet(snapshots, {
        snapshotId: "ops-sheet",
        mode: "metrics",
        metricA: "commitment",
        metricB: "dispatch",
        month: "2026-10"
    });
    assert.equal(resCommDisp.summary.totalA, 1400); // Commitment
    assert.equal(resCommDisp.summary.totalB, 1350); // Dispatch
    assert.equal(resCommDisp.summary.partsShortfall, 1);
    assert.equal(resCommDisp.summary.shortfallQty, 50);
});

test("getSnapshotComparisonMeta extracts available months and customers", () => {
    const snapshots = [
        {
            snapshotId: "s1",
            source: "plan.xlsx",
            rows: [
                { customer: "CustA", monthlySchedules: { "2026-10": 100, "2026-11": 200 } },
                { customer: "CustB", monthlySchedules: { "2026-10": 300 } }
            ]
        }
    ];
    const meta = getSnapshotComparisonMeta(snapshots, "s1");
    assert.deepEqual(meta.availableMonths, ["2026-10", "2026-11"]);
    assert.deepEqual(meta.availableCustomers, ["CustA", "CustB"]);
    assert.equal(meta.snapshots.length, 1);
});
