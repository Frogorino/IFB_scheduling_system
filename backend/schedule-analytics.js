function normalizeMonth(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}$/.test(text)) return text;
    const namedMonth = text.match(/^([a-z]+)[\s/-]+(\d{2}|\d{4})$/i);
    if (namedMonth) {
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const monthIndex = months.indexOf(namedMonth[1].slice(0, 3).toLowerCase());
        if (monthIndex !== -1) {
            const year = namedMonth[2].length === 2 ? Number(`20${namedMonth[2]}`) : Number(namedMonth[2]);
            return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
        }
    }
    const numericMonth = text.match(/^(0?[1-9]|1[0-2])[-/](\d{4})$/);
    if (numericMonth) return `${numericMonth[2]}-${numericMonth[1].padStart(2, "0")}`;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 7) : "";
}

function getMonthEnd(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999));
}

function extractDateFromText(text) {
    if (!text) return null;
    const str = String(text).trim();

    // 1. Check DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = str.match(/(?:^|[^\d])(\d{1,2})[._/-](\d{1,2})[._/-](\d{4})(?:[^\d]|$)/);
    if (dmyMatch) {
        let day = Number(dmyMatch[1]);
        let month = Number(dmyMatch[2]);
        const year = Number(dmyMatch[3]);
        if (day > 12 && month <= 12) {
            // Day.Month.Year
        } else if (month > 12 && day <= 12) {
            [day, month] = [month, day];
        }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }

    // 2. Check named month + year (e.g. Sep26, Sep-26, Oct26)
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const namedMatch = str.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s._-]*(\d{2,4})/i);
    if (namedMatch) {
        const monthIndex = monthNames.indexOf(namedMatch[1].slice(0, 3).toLowerCase());
        if (monthIndex !== -1) {
            const rawYear = namedMatch[2];
            const year = rawYear.length === 2 ? Number(`20${rawYear}`) : Number(rawYear);
            return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
        }
    }

    return null;
}

function getSnapshotEffectiveDate(snapshot) {
    if (!snapshot) return "2000-01-01";
    const sourceDate = extractDateFromText(snapshot.source);
    if (sourceDate) return sourceDate;

    const validSnapshotDate = snapshot.snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.snapshotDate)
        ? snapshot.snapshotDate
        : null;

    let earliestRowMonth = null;
    for (const row of snapshot.rows || []) {
        if (row.monthlySchedules) {
            for (const key of Object.keys(row.monthlySchedules)) {
                const norm = normalizeMonth(key);
                if (norm && (!earliestRowMonth || norm < earliestRowMonth)) {
                    earliestRowMonth = norm;
                }
            }
        }
        const dm = normalizeMonth(row.deliveryMonth);
        if (dm && (!earliestRowMonth || dm < earliestRowMonth)) {
            earliestRowMonth = dm;
        }
    }

    if (validSnapshotDate) {
        if (!earliestRowMonth || validSnapshotDate.slice(0, 7) <= earliestRowMonth) {
            return validSnapshotDate;
        }
    }

    if (earliestRowMonth) {
        return `${earliestRowMonth}-01`;
    }

    if (validSnapshotDate) {
        return validSnapshotDate;
    }

    const captured = String(snapshot.capturedAt || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(captured)) {
        return captured.slice(0, 10);
    }
    return "2000-01-01";
}

function getSnapshotOrderKey(snapshot) {
    const effectiveDate = getSnapshotEffectiveDate(snapshot);
    const uploadedAt = String(snapshot.capturedAt || snapshot.snapshotDate || "");
    const uploadTime = uploadedAt.includes("T") ? uploadedAt.slice(uploadedAt.indexOf("T")) : "";
    const snapshotId = String(snapshot.snapshotId || "");
    return `${effectiveDate}${uploadTime}_${snapshotId}`;
}

function getEntityKey(row) {
    return [
        row.customerCode || row.customer || "",
        row.partNo || "",
        row.customerPartNo || "",
        row.line || "",
        row.model || ""
    ].map(value => String(value).trim().toLowerCase()).join("|");
}

function getVersionRank(version) {
    const value = String(version || "").trim();
    if (/^(current|latest|final)$/i.test(value)) return [2, Infinity];
    const match = value.match(/^(?:v(?:ersion)?\s*)?(\d+(?:\.\d+)?)$/i);
    return match ? [1, Number(match[1])] : [0, value.toLowerCase()];
}

function isHigherVersion(candidate, existing) {
    const left = getVersionRank(candidate);
    const right = getVersionRank(existing);
    if (left[0] !== right[0]) return left[0] > right[0];
    if (typeof left[1] === "number" && typeof right[1] === "number") return left[1] > right[1];
    return String(left[1]).localeCompare(String(right[1])) > 0;
}

function matchesCustomer(row, customer) {
    return !customer || customer === "ALL"
        || String(row.customer || "").trim() === customer
        || String(row.customerCode || "").trim() === customer;
}

function getDemandForMonth(row, month) {
    if (row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, month)) {
        const quantity = Number(row.monthlySchedules[month]);
        return Number.isFinite(quantity) ? quantity : null;
    }

    const deliveryMonth = normalizeMonth(row.deliveryMonth);
    if (deliveryMonth === month || (!deliveryMonth && row.referenceMonth === month)) {
        const quantity = Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule);
        return Number.isFinite(quantity) ? quantity : null;
    }
    return null;
}

function getDemandByEntity(snapshot, month, customer) {
    const rowsByEntity = new Map();
    for (const row of snapshot.rows || []) {
        if (!matchesCustomer(row, customer)) continue;
        const demand = getDemandForMonth(row, month);
        if (demand === null) continue;
        const key = getEntityKey(row);
        if (key === "||||") continue;
        const existing = rowsByEntity.get(key);
        if (!existing || isHigherVersion(row.version, existing.row.version)) {
            rowsByEntity.set(key, { row, demand });
        }
    }
    return rowsByEntity;
}

function getDemandStateSignature(demand) {
    return JSON.stringify(Array.from(demand.entries())
        .map(([key, value]) => [key, value.demand])
        .sort(([left], [right]) => left.localeCompare(right)));
}

function getDemandSnapshotTimeline(snapshots, month, customer) {
    let previousSignature = null;
    return snapshots
        .map(snapshot => ({ snapshot, demand: getDemandByEntity(snapshot, month, customer) }))
        .sort((left, right) => getSnapshotOrderKey(left.snapshot).localeCompare(getSnapshotOrderKey(right.snapshot)))
        .map(({ snapshot, demand }) => {
            const signature = demand.size ? getDemandStateSignature(demand) : null;
            const duplicateOfPrevious = signature !== null && signature === previousSignature;
            if (signature !== null) previousSignature = signature;
            return {
                snapshotId: snapshot.snapshotId || `${snapshot.capturedAt || snapshot.snapshotDate}`,
                snapshotDate: getSnapshotEffectiveDate(snapshot),
                capturedAt: snapshot.capturedAt || snapshot.snapshotDate,
                source: snapshot.source || "",
                rowCount: (snapshot.rows || []).length,
                demandRows: demand.size,
                hasDemand: demand.size > 0,
                duplicateOfPrevious
            };
        });
}

function calculateDemandRevisionWape(snapshots, month, customer, comparison = {}) {
    const demandSnapshots = snapshots
        .map(snapshot => ({ snapshot, demand: getDemandByEntity(snapshot, month, customer) }))
        .sort((left, right) => getSnapshotOrderKey(left.snapshot).localeCompare(getSnapshotOrderKey(right.snapshot)));
    let previous;
    let latest;

    if (comparison.previousSnapshotId || comparison.currentSnapshotId) {
        previous = demandSnapshots.find(item =>
            (item.snapshot.snapshotId || String(item.snapshot.capturedAt || item.snapshot.snapshotDate))
                === comparison.previousSnapshotId);
        latest = demandSnapshots.find(item =>
            (item.snapshot.snapshotId || String(item.snapshot.capturedAt || item.snapshot.snapshotDate))
                === comparison.currentSnapshotId);
        if (!previous || !latest) {
            return { value: null, status: "selected_snapshot_unavailable", comparedParts: 0, revisions: [] };
        }
        if (previous === latest) {
            return { value: null, status: "select_two_snapshots", comparedParts: 0, revisions: [] };
        }
        if (getSnapshotOrderKey(previous.snapshot) > getSnapshotOrderKey(latest.snapshot)) {
            return { value: null, status: "snapshots_out_of_order", comparedParts: 0, revisions: [] };
        }
        if (previous.demand.size === 0 || latest.demand.size === 0) {
            return {
                value: null,
                status: "snapshot_has_no_month_data",
                comparedParts: 0,
                revisions: [],
                previousSnapshotDate: getSnapshotEffectiveDate(previous.snapshot),
                latestSnapshotDate: getSnapshotEffectiveDate(latest.snapshot)
            };
        }
    } else {
        let previousSignature = null;
        const available = demandSnapshots.filter(item => {
            if (!item.demand.size) return false;
            const signature = getDemandStateSignature(item.demand);
            const duplicateOfPrevious = signature === previousSignature;
            previousSignature = signature;
            return !duplicateOfPrevious;
        });
        if (available.length < 2) {
            return { value: null, status: "needs_two_snapshots", comparedParts: 0, revisions: [] };
        }
        previous = available[available.length - 2];
        latest = available[available.length - 1];
    }

    const entities = new Set([...previous.demand.keys(), ...latest.demand.keys()]);
    let absoluteRevision = 0;
    let latestDemandTotal = 0;
    const revisions = [];
    for (const entity of entities) {
        const previousEntry = previous.demand.get(entity);
        const latestEntry = latest.demand.get(entity);
        const before = previousEntry?.demand || 0;
        const after = latestEntry?.demand || 0;
        const row = latestEntry?.row || previousEntry.row;
        absoluteRevision += Math.abs(after - before);
        latestDemandTotal += after;
        if (before !== after) {
            revisions.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                previousDemand: before,
                latestDemand: after,
                change: after - before
            });
        }
    }
    revisions.sort((left, right) => Math.abs(right.change) - Math.abs(left.change));

    return {
        value: latestDemandTotal > 0 ? absoluteRevision / latestDemandTotal * 100 : null,
        status: latestDemandTotal > 0 ? "available" : "zero_latest_demand",
        comparedParts: entities.size,
        revisions,
        previousSnapshotId: previous.snapshot.snapshotId,
        latestSnapshotId: latest.snapshot.snapshotId,
        previousSnapshotDate: getSnapshotEffectiveDate(previous.snapshot),
        latestSnapshotDate: getSnapshotEffectiveDate(latest.snapshot),
        previousSource: previous.snapshot.source || "",
        latestSource: latest.snapshot.source || ""
    };
}

function getMonthQuantity(row, field, month, scalarField, scalarPresentField) {
    const monthly = row[field];
    if (monthly && Object.prototype.hasOwnProperty.call(monthly, month)) {
        const quantity = Number(monthly[month]);
        return Number.isFinite(quantity) ? quantity : null;
    }

    if (row[scalarPresentField] === true
        && (scalarField !== "actualDispatch" || row.actualDispatchMonthAligned !== false)
        && normalizeMonth(row.deliveryMonth) === month) {
        const quantity = Number(row[scalarField]);
        return Number.isFinite(quantity) ? quantity : null;
    }
    return null;
}

function parseDispatchDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (dayFirst) {
        let day = Number(dayFirst[1]);
        let month = Number(dayFirst[2]);
        if (day <= 12 && month > 12) [day, month] = [month, day];
        let year = Number(dayFirst[3]);
        if (year < 100) year += 2000;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return date;
    }

    const namedDate = text.match(/^(\d{1,2})[-\s]([a-z]{3,})[-\s,]+(\d{2,4})$/i);
    if (namedDate) {
        const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            .indexOf(namedDate[2].slice(0, 3).toLowerCase());
        let year = Number(namedDate[3]);
        if (year < 100) year += 2000;
        if (month === -1) return null;
        const date = new Date(Date.UTC(year, month, Number(namedDate[1]), 23, 59, 59, 999));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== Number(namedDate[1])) return null;
        return date;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function calculateOnTime(snapshots, month, customer, now = new Date()) {
    const dueDate = getMonthEnd(month);
    if (!dueDate) return { quantityRate: null, lineRate: null, status: "invalid_month" };

    const eligibleSnapshots = [...snapshots].sort((left, right) =>
        String(right.capturedAt || right.snapshotDate).localeCompare(String(left.capturedAt || left.snapshotDate)));

    let selectedSnapshot;
    let commitments = [];
    for (const snapshot of eligibleSnapshots) {
        const byEntity = new Map();
        for (const row of snapshot.rows || []) {
            if (!matchesCustomer(row, customer)) continue;
            const committed = getMonthQuantity(
                row, "monthlyCommitments", month, "companyCommitment", "companyCommitmentProvided"
            );
            if (committed === null) continue;

            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.row.version)) {
                byEntity.set(key, { row, committed });
            }
        }
        if (byEntity.size) {
            selectedSnapshot = snapshot;
            commitments = Array.from(byEntity.values());
            break;
        }
    }

    if (!selectedSnapshot) {
        return { quantityRate: null, lineRate: null, status: "no_month_aligned_commitments" };
    }

    if (dueDate.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
        return {
            quantityRate: null,
            lineRate: null,
            status: "due_date_not_passed",
            dueDate: dueDate.toISOString().slice(0, 10)
        };
    }

    if (Date.parse(selectedSnapshot.capturedAt || selectedSnapshot.snapshotDate) <= dueDate.getTime()) {
        return {
            quantityRate: null,
            lineRate: null,
            status: "snapshot_before_due_date",
            dueDate: dueDate.toISOString().slice(0, 10)
        };
    }

    let committedTotal = 0;
    let onTimeQuantity = 0;
    let commitmentLines = 0;
    let onTimeLines = 0;
    let missingDispatchData = false;
    let missingDispatchDates = false;
    const issues = [];

    for (const { row, committed } of commitments) {
        if (committed <= 0) continue;
        commitmentLines += 1;
        committedTotal += committed;

        const dispatched = getMonthQuantity(
            row, "monthlyDispatches", month, "actualDispatch", "actualDispatchProvided"
        );
        if (dispatched === null) {
            missingDispatchData = true;
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: "Missing dispatch quantity",
                committedQty: committed,
                dispatchedQty: null,
                dispatchDate: ""
            });
            continue;
        }

        const dispatchDateValue = row.monthlyDispatchDates
            && Object.prototype.hasOwnProperty.call(row.monthlyDispatchDates, month)
            ? row.monthlyDispatchDates[month]
            : normalizeMonth(row.deliveryMonth) === month ? row.dispatchDate : "";
        const dispatchDate = parseDispatchDate(dispatchDateValue);
        if (dispatched > 0 && !dispatchDate) {
            missingDispatchDates = true;
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: "Missing dispatch date",
                committedQty: committed,
                dispatchedQty: dispatched,
                dispatchDate: ""
            });
            continue;
        }

        const wasOnTime = dispatched > 0 && dispatchDate <= dueDate;
        if (wasOnTime) {
            onTimeQuantity += Math.min(dispatched, committed);
            if (dispatched >= committed) onTimeLines += 1;
        }

        const issueTypes = [];
        if (dispatched < committed) issueTypes.push("Short dispatch");
        if (dispatched > 0 && dispatchDate > dueDate) issueTypes.push("Late dispatch");
        if (issueTypes.length) {
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: issueTypes.join(" + "),
                committedQty: committed,
                dispatchedQty: dispatched,
                dispatchDate: dispatchDate ? dispatchDate.toISOString().slice(0, 10) : ""
            });
        }
    }

    if (!committedTotal) {
        return { quantityRate: null, lineRate: null, status: "zero_commitment", dueDate: dueDate.toISOString().slice(0, 10) };
    }
    if (missingDispatchData || missingDispatchDates) {
        return {
            quantityRate: null,
            lineRate: null,
            status: missingDispatchDates ? "missing_dispatch_dates" : "missing_dispatch_quantities",
            dueDate: dueDate.toISOString().slice(0, 10),
            committedQty: committedTotal,
            issues
        };
    }

    return {
        quantityRate: onTimeQuantity / committedTotal * 100,
        lineRate: onTimeLines / commitmentLines * 100,
        status: "available",
        dueDate: dueDate.toISOString().slice(0, 10),
        committedQty: committedTotal,
        onTimeQty: onTimeQuantity,
        commitmentLines,
        onTimeLines,
        snapshotDate: selectedSnapshot.snapshotDate,
        issues
    };
}

function calculateScheduleAnalytics(snapshots, month, customer, now = new Date(), comparison = {}) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return { month, customer: customer || "ALL", demandRevisionWape: { value: null, status: "invalid_month" }, onTime: { quantityRate: null, lineRate: null, status: "invalid_month" } };
    }

    return {
        month,
        customer: customer || "ALL",
        demandRevisionWape: calculateDemandRevisionWape(snapshots, month, customer, comparison),
        onTime: calculateOnTime(snapshots, month, customer, now)
    };
}

function getDistinctCustomers(snapshots) {
    const customers = new Set();
    for (const snapshot of snapshots) {
        for (const row of snapshot.rows || []) {
            const name = String(row.customer || row.customerName2 || row.customerCode || "").trim();
            if (name) customers.add(name);
        }
    }
    return Array.from(customers).sort();
}

function getAllDeliveryMonths(snapshots, customer) {
    const months = new Set();
    for (const snapshot of snapshots) {
        for (const row of snapshot.rows || []) {
            if (!matchesCustomer(row, customer)) continue;
            if (row.monthlySchedules) {
                for (const key of Object.keys(row.monthlySchedules)) {
                    const norm = normalizeMonth(key);
                    if (norm) months.add(norm);
                }
            }
            const dm = normalizeMonth(row.deliveryMonth);
            if (dm) months.add(dm);
            const rm = normalizeMonth(row.referenceMonth);
            if (rm) months.add(rm);
        }
    }
    return Array.from(months).sort();
}

function calculateConsistencyForSeries(demands) {
    const valid = demands.filter(d => typeof d === "number" && Number.isFinite(d));
    if (!valid.length) {
        return {
            mean: 0,
            stdDev: 0,
            cv: 0,
            score: null,
            rating: "No Data",
            status: "no_data",
            min: 0,
            max: 0,
            total: 0
        };
    }

    const total = valid.reduce((sum, v) => sum + v, 0);
    const mean = total / valid.length;
    if (mean === 0) {
        return {
            mean: 0,
            stdDev: 0,
            cv: 0,
            score: 100,
            rating: "Zero Demand",
            status: "consistent",
            min: 0,
            max: 0,
            total: 0
        };
    }

    const variance = valid.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    let score;
    let rating;
    let status;

    if (cv <= 0.15) {
        score = Math.round(100 - (cv / 0.15) * 10);
        rating = "Highly Consistent";
        status = "consistent";
    } else if (cv <= 0.35) {
        score = Math.round(90 - ((cv - 0.15) / 0.20) * 20);
        rating = "Moderately Consistent";
        status = "moderate";
    } else if (cv <= 0.60) {
        score = Math.round(70 - ((cv - 0.35) / 0.25) * 30);
        rating = "Volatile";
        status = "volatile";
    } else {
        score = Math.max(10, Math.round(40 - Math.min(cv - 0.60, 0.60) * 50));
        rating = "Erratic / Unpredictable";
        status = "erratic";
    }

    return {
        mean: Math.round(mean * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        cv: Math.round(cv * 1000) / 1000,
        score,
        rating,
        status,
        min: Math.min(...valid),
        max: Math.max(...valid),
        total
    };
}

function calculateHorizonDrift(snapshots, customer) {
    const sorted = [...snapshots].sort((a, b) =>
        getSnapshotOrderKey(a).localeCompare(getSnapshotOrderKey(b))
    );

    const allMonths = getAllDeliveryMonths(sorted, customer);
    const horizonRecords = [];

    for (const month of allMonths) {
        const monthSnapshots = [];
        for (const snapshot of sorted) {
            const entities = getDemandByEntity(snapshot, month, customer);
            if (!entities.size) continue;
            let total = 0;
            for (const item of entities.values()) {
                total += item.demand || 0;
            }
            monthSnapshots.push({
                snapshotId: snapshot.snapshotId,
                snapshotDate: snapshot.snapshotDate,
                capturedAt: snapshot.capturedAt,
                source: snapshot.source,
                demand: total
            });
        }

        if (monthSnapshots.length >= 2) {
            const tentative = monthSnapshots[0].demand;
            const firm = monthSnapshots[monthSnapshots.length - 1].demand;
            const change = firm - tentative;
            const driftPct = tentative > 0 ? (change / tentative) * 100 : 0;
            const stages = monthSnapshots.map(s => ({
                snapshotDate: s.snapshotDate,
                source: s.source,
                demand: s.demand
            }));

            horizonRecords.push({
                deliveryMonth: month,
                earliestForecastDate: monthSnapshots[0].snapshotDate,
                earliestDemand: tentative,
                latestDemand: firm,
                stages,
                change,
                driftPct: Math.round(driftPct * 100) / 100
            });
        }
    }

    if (!horizonRecords.length) {
        return {
            status: sorted.length < 2 ? "needs_multiple_snapshots" : "no_overlapping_months",
            averageDriftPct: null,
            biasPct: null,
            biasType: "Insufficient Historical Overlap",
            records: []
        };
    }

    const totalTentative = horizonRecords.reduce((sum, r) => sum + r.earliestDemand, 0);
    const totalFirm = horizonRecords.reduce((sum, r) => sum + r.latestDemand, 0);
    const totalChange = totalFirm - totalTentative;
    const biasPct = totalTentative > 0 ? (totalChange / totalTentative) * 100 : 0;
    const avgDrift = horizonRecords.reduce((sum, r) => sum + r.driftPct, 0) / horizonRecords.length;

    let biasType = "Balanced Forecast";
    if (biasPct < -10) {
        biasType = "Over-Forecasting (Tentative Demand Erosion)";
    } else if (biasPct > 10) {
        biasType = "Under-Forecasting (Late Demand Surges)";
    }

    return {
        status: "available",
        averageDriftPct: Math.round(avgDrift * 100) / 100,
        biasPct: Math.round(biasPct * 100) / 100,
        biasType,
        evaluatedMonthsCount: horizonRecords.length,
        records: horizonRecords
    };
}

function calculatePartConsistency(snapshots, customer) {
    const sorted = [...snapshots].sort((a, b) =>
        getSnapshotOrderKey(a).localeCompare(getSnapshotOrderKey(b))
    );
    const latestSnapshot = sorted[sorted.length - 1];
    if (!latestSnapshot) return [];

    const partsMap = new Map();
    for (const row of latestSnapshot.rows || []) {
        if (!matchesCustomer(row, customer)) continue;
        const partNo = row.partNo || "UNKNOWN";
        const existing = partsMap.get(partNo) || {
            partNo,
            productDescription: row.productDescription || "",
            application: row.application || "",
            monthlyDemands: {}
        };

        if (row.monthlySchedules) {
            for (const [m, q] of Object.entries(row.monthlySchedules)) {
                const norm = normalizeMonth(m);
                if (norm) {
                    existing.monthlyDemands[norm] = (existing.monthlyDemands[norm] || 0) + Number(q || 0);
                }
            }
        }
        const dm = normalizeMonth(row.deliveryMonth);
        if (dm && !existing.monthlyDemands[dm]) {
            existing.monthlyDemands[dm] = Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule ?? 0);
        }
        partsMap.set(partNo, existing);
    }

    const partResults = [];
    for (const [, item] of partsMap.entries()) {
        const demandValues = Object.values(item.monthlyDemands);
        const stats = calculateConsistencyForSeries(demandValues);
        partResults.push({
            partNo: item.partNo,
            productDescription: item.productDescription,
            application: item.application,
            monthsCount: demandValues.length,
            totalDemand: stats.total,
            meanDemand: stats.mean,
            stdDev: stats.stdDev,
            cv: stats.cv,
            score: stats.score,
            rating: stats.rating,
            status: stats.status,
            minDemand: stats.min,
            maxDemand: stats.max
        });
    }

    partResults.sort((a, b) => b.totalDemand - a.totalDemand);
    return partResults;
}

function generateConsistencyInsight(consistency, horizon) {
    if (consistency.status === "no_data") {
        return "Upload customer schedules to generate demand consistency insights.";
    }

    const parts = [];
    if (consistency.status === "consistent") {
        parts.push(`Customer displays high ordering stability with low monthly volatility (CV: ${consistency.cv.toFixed(3)}, Score: ${consistency.score}/100). Production can be level-scheduled with low safety stock.`);
    } else if (consistency.status === "moderate") {
        parts.push(`Customer has moderate monthly volatility (CV: ${consistency.cv.toFixed(3)}, Score: ${consistency.score}/100), typical for regular manufacturing operations.`);
    } else if (consistency.status === "volatile") {
        parts.push(`Customer exhibits volatile ordering patterns (CV: ${consistency.cv.toFixed(3)}, Score: ${consistency.score}/100) with wide monthly swings. Active capacity buffering recommended.`);
    } else {
        parts.push(`Customer exhibits highly erratic/sporadic ordering (CV: ${consistency.cv.toFixed(3)}, Score: ${consistency.score}/100). Recommend strict firm-order frozen zones.`);
    }

    if (horizon && horizon.status === "available") {
        if (horizon.biasPct < -10) {
            parts.push(`Significant tentative forecast erosion detected: firm demand averages ${Math.abs(horizon.biasPct).toFixed(1)}% lower than tentative forecasts. Discount tentative projections when committing long-lead material.`);
        } else if (horizon.biasPct > 10) {
            parts.push(`Late demand spikes detected: firm demand averages +${horizon.biasPct.toFixed(1)}% higher than tentative projections. Maintain buffer stock to avoid stockouts.`);
        } else {
            parts.push(`Tentative forecasts track closely with firm execution (net drift: ${horizon.biasPct > 0 ? "+" : ""}${horizon.biasPct.toFixed(1)}%).`);
        }
    } else {
        parts.push("Additional dated schedule uploads are needed to evaluate multi-month horizon drift.");
    }

    return parts.join(" ");
}

function calculateCustomerConsistency(snapshots, customer = "ALL") {
    if (!snapshots || !snapshots.length) {
        return {
            customer: customer || "ALL",
            status: "no_data",
            message: "No snapshots available for analysis.",
            consistency: calculateConsistencyForSeries([]),
            horizonDrift: { status: "no_data", records: [] },
            parts: [],
            customerBreakdown: [],
            insight: "Upload customer schedule spreadsheets to begin consistency tracking."
        };
    }

    const distinctCustomers = getDistinctCustomers(snapshots);
    const sorted = [...snapshots].sort((a, b) =>
        getSnapshotOrderKey(a).localeCompare(getSnapshotOrderKey(b))
    );
    const latestSnapshot = sorted[sorted.length - 1];

    const allMonths = getAllDeliveryMonths(sorted, customer);
    const monthlyTotals = [];
    for (const m of allMonths) {
        const entities = getDemandByEntity(latestSnapshot, m, customer);
        let monthSum = 0;
        for (const item of entities.values()) {
            monthSum += item.demand || 0;
        }
        if (entities.size > 0) {
            monthlyTotals.push(monthSum);
        }
    }

    const consistency = calculateConsistencyForSeries(monthlyTotals);
    const horizonDrift = calculateHorizonDrift(snapshots, customer);
    const parts = calculatePartConsistency(snapshots, customer);
    const insight = generateConsistencyInsight(consistency, horizonDrift);

    const customerBreakdown = distinctCustomers.map(custName => {
        const custMonths = getAllDeliveryMonths(sorted, custName);
        const custTotals = [];
        for (const m of custMonths) {
            const entities = getDemandByEntity(latestSnapshot, m, custName);
            let s = 0;
            for (const item of entities.values()) s += item.demand || 0;
            if (entities.size > 0) custTotals.push(s);
        }
        const custConsistency = calculateConsistencyForSeries(custTotals);
        const custHorizon = calculateHorizonDrift(snapshots, custName);
        return {
            customer: custName,
            score: custConsistency.score,
            rating: custConsistency.rating,
            status: custConsistency.status,
            cv: custConsistency.cv,
            meanDemand: custConsistency.mean,
            totalDemand: custConsistency.total,
            biasPct: custHorizon.biasPct,
            biasType: custHorizon.biasType
        };
    }).sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
        customer: customer || "ALL",
        status: consistency.status,
        consistency,
        horizonDrift,
        parts,
        customerBreakdown,
        insight,
        monthsEvaluated: allMonths
    };
}

function getMonthDiff(fromMonth, toMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth)) return null;
    const [y1, m1] = fromMonth.split("-").map(Number);
    const [y2, m2] = toMonth.split("-").map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
}

function calculateCustomerActivity(snapshots, targetMonth) {
    if (!snapshots || !snapshots.length || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
        return {
            targetMonth: targetMonth || "",
            summary: {
                totalCustomers: 0,
                activeCount: 0,
                zeroMonthCount: 0,
                atRiskCount: 0,
                dormantCount: 0
            },
            customers: []
        };
    }

    const sorted = [...snapshots].sort((a, b) =>
        getSnapshotOrderKey(a).localeCompare(getSnapshotOrderKey(b))
    );
    const latestSnapshot = sorted[sorted.length - 1];
    const distinctCustomers = getDistinctCustomers(snapshots);

    // Collect all recorded active delivery months for each customer
    const customerMonthlyActive = new Map();
    for (const cust of distinctCustomers) {
        customerMonthlyActive.set(cust, new Map());
    }

    // Evaluate latest snapshot rows for the latest view of each month
    for (const row of latestSnapshot.rows || []) {
        const cust = String(row.customer || row.customerName2 || row.customerCode || "").trim();
        if (!cust || !customerMonthlyActive.has(cust)) continue;

        const custMap = customerMonthlyActive.get(cust);
        if (row.monthlySchedules) {
            for (const [m, q] of Object.entries(row.monthlySchedules)) {
                const norm = normalizeMonth(m);
                if (norm) {
                    custMap.set(norm, (custMap.get(norm) || 0) + Number(q || 0));
                }
            }
        }
        const dm = normalizeMonth(row.deliveryMonth);
        if (dm && !custMap.has(dm)) {
            custMap.set(dm, Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule ?? 0));
        }
    }

    // Also scan earlier snapshots in case an earlier snapshot recorded positive demand for an older month
    for (const snapshot of sorted) {
        for (const row of snapshot.rows || []) {
            const cust = String(row.customer || row.customerName2 || row.customerCode || "").trim();
            if (!cust || !customerMonthlyActive.has(cust)) continue;
            const custMap = customerMonthlyActive.get(cust);
            if (row.monthlySchedules) {
                for (const [m, q] of Object.entries(row.monthlySchedules)) {
                    const norm = normalizeMonth(m);
                    if (norm && !custMap.has(norm) && Number(q) > 0) {
                        custMap.set(norm, Number(q));
                    }
                }
            }
            const dm = normalizeMonth(row.deliveryMonth);
            if (dm && !custMap.has(dm)) {
                const q = Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule ?? 0);
                if (q > 0) custMap.set(dm, q);
            }
        }
    }

    const customers = distinctCustomers.map(custName => {
        const custMap = customerMonthlyActive.get(custName) || new Map();
        const targetMonthDemand = custMap.get(targetMonth) || 0;

        // Find all past or present months with positive demand (<= targetMonth)
        const pastActiveMonths = [];
        let lifetimeTotalDemand = 0;
        let positiveMonthCount = 0;

        for (const [m, demand] of custMap.entries()) {
            if (demand > 0) {
                lifetimeTotalDemand += demand;
                positiveMonthCount += 1;
                if (m <= targetMonth) {
                    pastActiveMonths.push(m);
                }
            }
        }
        pastActiveMonths.sort();

        let lastActiveMonth = null;
        let monthsInactive = null;
        let status = "never_ordered";
        let statusLabel = "No Order History";
        let statusSeverity = "neutral";

        if (targetMonthDemand > 0) {
            status = "active";
            statusLabel = "Active";
            statusSeverity = "success";
            lastActiveMonth = targetMonth;
            monthsInactive = 0;
        } else if (pastActiveMonths.length > 0) {
            lastActiveMonth = pastActiveMonths[pastActiveMonths.length - 1];
            monthsInactive = getMonthDiff(lastActiveMonth, targetMonth);

            if (monthsInactive <= 1) {
                status = "zero_this_month";
                statusLabel = "Zero This Month";
                statusSeverity = "warning";
            } else if (monthsInactive >= 2 && monthsInactive <= 3) {
                status = "at_risk";
                statusLabel = `At Risk (${monthsInactive}m ago)`;
                statusSeverity = "warning";
            } else {
                status = "dormant";
                statusLabel = `Dormant (${monthsInactive}m ago)`;
                statusSeverity = "danger";
            }
        } else if (lifetimeTotalDemand > 0) {
            status = "zero_this_month";
            statusLabel = "Tentative Future Only";
            statusSeverity = "warning";
            monthsInactive = null;
        } else {
            status = "never_ordered";
            statusLabel = "No Order History";
            statusSeverity = "neutral";
            monthsInactive = null;
        }

        const meanDemand = positiveMonthCount > 0 ? Math.round(lifetimeTotalDemand / positiveMonthCount) : 0;

        return {
            customer: custName,
            targetMonthDemand,
            lastActiveMonth,
            monthsInactive,
            status,
            statusLabel,
            statusSeverity,
            lifetimeTotalDemand,
            meanDemand
        };
    });

    const activeCount = customers.filter(c => c.status === "active").length;
    const zeroMonthCount = customers.filter(c => c.status === "zero_this_month").length;
    const atRiskCount = customers.filter(c => c.status === "at_risk").length;
    const dormantCount = customers.filter(c => c.status === "dormant" || c.status === "never_ordered").length;

    return {
        targetMonth,
        summary: {
            totalCustomers: customers.length,
            activeCount,
            zeroMonthCount,
            atRiskCount,
            dormantCount
        },
        customers
    };
}

module.exports = {
    calculateScheduleAnalytics,
    calculateDemandRevisionWape,
    calculateOnTime,
    getDemandSnapshotTimeline,
    calculateCustomerConsistency,
    calculateCustomerActivity,
    getSnapshotEffectiveDate,
    extractDateFromText
};

