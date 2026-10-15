const test = require("node:test");
const assert = require("node:assert/strict");
const {
    calculateScheduleAnalytics,
    getDemandSnapshotTimeline,
    calculateCustomerConsistency,
    calculateCustomerActivity
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

test("customer consistency identifies stable demand with low coefficient of variation", () => {
    const snapshots = [{
        snapshotId: "snap-1",
        snapshotDate: "2026-10-01",
        capturedAt: "2026-10-01T10:00:00.000Z",
        rows: [
            { customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1000, "2026-11": 1020, "2026-12": 990 } }
        ]
    }];

    const result = calculateCustomerConsistency(snapshots, "Alpha");
    assert.equal(result.status, "consistent");
    assert.equal(result.consistency.rating, "Highly Consistent");
    assert.ok(result.consistency.cv < 0.15);
    assert.ok(result.consistency.score >= 90);
    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0].partNo, "P1");
    assert.equal(result.parts[0].status, "consistent");
});

test("customer consistency detects volatile demand when order volumes swing widely", () => {
    const snapshots = [{
        snapshotId: "snap-1",
        snapshotDate: "2026-10-01",
        capturedAt: "2026-10-01T10:00:00.000Z",
        rows: [
            { customer: "Beta", partNo: "P2", monthlySchedules: { "2026-10": 500, "2026-11": 1100, "2026-12": 600 } }
        ]
    }];

    const result = calculateCustomerConsistency(snapshots, "Beta");
    assert.ok(result.consistency.cv > 0.35);
    assert.ok(result.consistency.cv <= 0.60);
    assert.equal(result.consistency.status, "volatile");
    assert.ok(result.consistency.score < 70);
});

test("customer consistency detects erratic demand when swings exceed 60 percent variation", () => {
    const snapshots = [{
        snapshotId: "snap-1",
        snapshotDate: "2026-10-01",
        capturedAt: "2026-10-01T10:00:00.000Z",
        rows: [
            { customer: "Gamma", partNo: "P3", monthlySchedules: { "2026-10": 200, "2026-11": 1500, "2026-12": 300 } }
        ]
    }];

    const result = calculateCustomerConsistency(snapshots, "Gamma");
    assert.ok(result.consistency.cv > 0.60);
    assert.equal(result.consistency.status, "erratic");
    assert.ok(result.consistency.score <= 40);
});

test("horizon drift detects tentative demand erosion when firm orders drop", () => {
    const snapshots = [
        {
            snapshotId: "aug-upload",
            snapshotDate: "2026-08-01",
            capturedAt: "2026-08-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 2000 } }]
        },
        {
            snapshotId: "sep-upload",
            snapshotDate: "2026-09-01",
            capturedAt: "2026-09-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1500 } }]
        },
        {
            snapshotId: "oct-upload",
            snapshotDate: "2026-10-01",
            capturedAt: "2026-10-01T10:00:00.000Z",
            rows: [{ customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1200 } }]
        }
    ];

    const result = calculateCustomerConsistency(snapshots, "Alpha");
    assert.equal(result.horizonDrift.status, "available");
    assert.equal(result.horizonDrift.records.length, 1);
    assert.equal(result.horizonDrift.records[0].earliestDemand, 2000);
    assert.equal(result.horizonDrift.records[0].latestDemand, 1200);
    assert.equal(result.horizonDrift.records[0].change, -800);
    assert.equal(result.horizonDrift.records[0].driftPct, -40);
    assert.equal(result.horizonDrift.biasType, "Over-Forecasting (Tentative Demand Erosion)");
    assert.ok(result.insight.includes("tentative forecast erosion"));
});

test("portfolio consistency aggregates distinct customers with rankings", () => {
    const snapshots = [{
        snapshotId: "snap-1",
        snapshotDate: "2026-10-01",
        capturedAt: "2026-10-01T10:00:00.000Z",
        rows: [
            { customer: "Alpha", partNo: "P1", monthlySchedules: { "2026-10": 1000, "2026-11": 1000 } },
            { customer: "Beta", partNo: "P2", monthlySchedules: { "2026-10": 100, "2026-11": 900 } }
        ]
    }];

    const result = calculateCustomerConsistency(snapshots, "ALL");
    assert.equal(result.customerBreakdown.length, 2);
    assert.equal(result.customerBreakdown[0].customer, "Alpha"); // Alpha has higher consistency score
    assert.equal(result.customerBreakdown[0].status, "consistent");
    assert.equal(result.customerBreakdown[1].customer, "Beta");
});

test("customer activity identifies active, zero-order, and dormant accounts", () => {
    const snapshots = [
        {
            snapshotId: "snap-may",
            snapshotDate: "2026-05-01",
            capturedAt: "2026-05-01T10:00:00.000Z",
            rows: [
                { customer: "DormantClient", partNo: "P1", monthlySchedules: { "2026-05": 500 } }
            ]
        },
        {
            snapshotId: "snap-sep",
            snapshotDate: "2026-09-01",
            capturedAt: "2026-09-01T10:00:00.000Z",
            rows: [
                { customer: "SepOnlyClient", partNo: "P2", monthlySchedules: { "2026-09": 800, "2026-10": 0 } },
                { customer: "ActiveClient", partNo: "P3", monthlySchedules: { "2026-09": 1000, "2026-10": 1200 } }
            ]
        },
        {
            snapshotId: "snap-oct",
            snapshotDate: "2026-10-01",
            capturedAt: "2026-10-01T10:00:00.000Z",
            rows: [
                { customer: "SepOnlyClient", partNo: "P2", monthlySchedules: { "2026-10": 0 } },
                { customer: "ActiveClient", partNo: "P3", monthlySchedules: { "2026-10": 1500 } }
            ]
        }
    ];

    const result = calculateCustomerActivity(snapshots, "2026-10");
    assert.equal(result.summary.totalCustomers, 3);
    assert.equal(result.summary.activeCount, 1);
    assert.equal(result.summary.zeroMonthCount, 1);
    assert.equal(result.summary.dormantCount, 1);

    const active = result.customers.find(c => c.customer === "ActiveClient");
    assert.equal(active.status, "active");
    assert.equal(active.targetMonthDemand, 1500);
    assert.equal(active.monthsInactive, 0);

    const zeroThisMonth = result.customers.find(c => c.customer === "SepOnlyClient");
    assert.equal(zeroThisMonth.status, "zero_this_month");
    assert.equal(zeroThisMonth.targetMonthDemand, 0);
    assert.equal(zeroThisMonth.lastActiveMonth, "2026-09");
    assert.equal(zeroThisMonth.monthsInactive, 1);

    const dormant = result.customers.find(c => c.customer === "DormantClient");
    assert.equal(dormant.status, "dormant");
    assert.equal(dormant.targetMonthDemand, 0);
    assert.equal(dormant.lastActiveMonth, "2026-05");
    assert.equal(dormant.monthsInactive, 5); // 5 months since May
});

