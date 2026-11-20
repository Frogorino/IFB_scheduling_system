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

function getSnapshotOrderKey(snapshot) {
    const uploadedAt = String(snapshot.capturedAt || snapshot.snapshotDate || "");
    const uploadTime = uploadedAt.includes("T") ? uploadedAt.slice(uploadedAt.indexOf("T")) : "";
    const snapshotDate = String(snapshot.snapshotDate || uploadedAt.slice(0, 10));
    return `${snapshotDate}${uploadTime}`;
}

function getEntityKey(row) {
    return [
        row.customerCode || row.customer || "",
        row.partNo || "",
        row.customerPartNo || "",
        row.line || ""
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
                snapshotDate: snapshot.snapshotDate,
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
        if (getSnapshotOrderKey(previous.snapshot) >= getSnapshotOrderKey(latest.snapshot)) {
            return { value: null, status: "snapshots_out_of_order", comparedParts: 0, revisions: [] };
        }
        if (previous.demand.size === 0 || latest.demand.size === 0) {
            return {
                value: null,
                status: "snapshot_has_no_month_data",
                comparedParts: 0,
                revisions: [],
                previousSnapshotDate: previous.snapshot.snapshotDate,
                latestSnapshotDate: latest.snapshot.snapshotDate
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
        previousSnapshotDate: previous.snapshot.snapshotDate,
        latestSnapshotDate: latest.snapshot.snapshotDate,
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

function formatNumberEn(value) {
    if (value === null || value === undefined || isNaN(value)) return "0";
    return new Intl.NumberFormat("en-IN").format(Math.round(Number(value)));
}

function formatMonthLabel(monthKey) {
    if (!monthKey || monthKey === "ALL") return "All Months";
    const [year, month] = monthKey.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const idx = parseInt(month, 10) - 1;
    if (idx >= 0 && idx < 12) {
        return `${monthNames[idx]}'${year.slice(2)}`;
    }
    return monthKey;
}

function getDemandTotal(row, month) {
    if (month && month !== "ALL") {
        return getDemandForMonth(row, month);
    }
    if (row.monthlySchedules && typeof row.monthlySchedules === "object") {
        const values = Object.values(row.monthlySchedules).map(Number).filter(Number.isFinite);
        if (values.length > 0) {
            return values.reduce((sum, v) => sum + v, 0);
        }
    }
    const fallback = Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule);
    return Number.isFinite(fallback) ? fallback : 0;
}

function compareDifferentSheets(snapshots, options = {}) {
    if (!snapshots || snapshots.length === 0) {
        return {
            status: "no_snapshots",
            message: "No schedule sheets have been uploaded yet. Upload Excel files to begin comparison.",
            summary: null,
            rows: []
        };
    }

    const { baseSnapshotId, compareSnapshotId, month = "ALL", customer = "ALL" } = options;

    let baseSnap = baseSnapshotId ? snapshots.find(s => s.snapshotId === baseSnapshotId) : null;
    let compareSnap = compareSnapshotId ? snapshots.find(s => s.snapshotId === compareSnapshotId) : null;

    if (!baseSnap && snapshots.length >= 2) {
        baseSnap = snapshots[snapshots.length - 2];
    } else if (!baseSnap && snapshots.length === 1) {
        baseSnap = snapshots[0];
    }

    if (!compareSnap && snapshots.length >= 2) {
        compareSnap = snapshots[snapshots.length - 1];
    } else if (!compareSnap && snapshots.length === 1) {
        compareSnap = snapshots[0];
    }

    if (!baseSnap || !compareSnap) {
        return {
            status: "needs_selection",
            message: "Please select two Excel sheets to compare.",
            summary: null,
            rows: []
        };
    }

    const baseRows = (baseSnap.rows || []).filter(r => matchesCustomer(r, customer));
    const compareRows = (compareSnap.rows || []).filter(r => matchesCustomer(r, customer));

    const baseEntityMap = new Map();
    for (const row of baseRows) {
        const qty = getDemandTotal(row, month);
        if (qty === null) continue;
        const key = getEntityKey(row);
        if (key === "||||") continue;
        const existing = baseEntityMap.get(key);
        if (!existing || isHigherVersion(row.version, existing.row.version)) {
            baseEntityMap.set(key, { row, demand: qty });
        }
    }

    const compareEntityMap = new Map();
    for (const row of compareRows) {
        const qty = getDemandTotal(row, month);
        if (qty === null) continue;
        const key = getEntityKey(row);
        if (key === "||||") continue;
        const existing = compareEntityMap.get(key);
        if (!existing || isHigherVersion(row.version, existing.row.version)) {
            compareEntityMap.set(key, { row, demand: qty });
        }
    }

    const allKeys = new Set([...baseEntityMap.keys(), ...compareEntityMap.keys()]);
    let baseTotal = 0;
    let compareTotal = 0;
    let absoluteDiffSum = 0;
    let partsIncreased = 0;
    let partsDecreased = 0;
    let partsUnchanged = 0;
    let partsAdded = 0;
    let partsRemoved = 0;

    const rows = [];
    for (const key of allKeys) {
        const b = baseEntityMap.get(key);
        const c = compareEntityMap.get(key);
        const baseQty = b ? b.demand : 0;
        const compareQty = c ? c.demand : 0;
        const row = c?.row || b?.row;

        baseTotal += baseQty;
        compareTotal += compareQty;
        const change = compareQty - baseQty;
        absoluteDiffSum += Math.abs(change);

        let status = "unchanged";
        if (!b && c && compareQty > 0) {
            status = "added";
            partsAdded++;
        } else if (b && (!c || compareQty === 0) && baseQty > 0) {
            status = "removed";
            partsRemoved++;
        } else if (change > 0) {
            status = "increased";
            partsIncreased++;
        } else if (change < 0) {
            status = "decreased";
            partsDecreased++;
        } else {
            partsUnchanged++;
        }

        const percentChange = baseQty > 0
            ? ((compareQty - baseQty) / baseQty) * 100
            : (compareQty > 0 ? 100 : 0);

        rows.push({
            customer: row.customer || row.customerCode || "Unknown",
            customerCode: row.customerCode || "",
            partNo: row.partNo || "-",
            customerPartNo: row.customerPartNo || "-",
            productDescription: row.productDescription || "-",
            line: row.line || "-",
            baseQty,
            compareQty,
            change,
            percentChange,
            status
        });
    }

    rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    const netChange = compareTotal - baseTotal;
    const percentChange = baseTotal > 0 ? (netChange / baseTotal) * 100 : (compareTotal > 0 ? 100 : 0);
    const wape = compareTotal > 0 ? (absoluteDiffSum / compareTotal) * 100 : (baseTotal > 0 ? (absoluteDiffSum / baseTotal) * 100 : 0);

    let stabilityLabel = "High Stability (Minimal Changes)";
    let stabilityClass = "stable";
    if (wape > 25) {
        stabilityLabel = "High Volatility (Major Plan Shifts)";
        stabilityClass = "high-volatility";
    } else if (wape > 10) {
        stabilityLabel = "Moderate Volatility";
        stabilityClass = "moderate";
    } else if (wape > 2) {
        stabilityLabel = "Low Volatility (Minor Adjustments)";
        stabilityClass = "low-volatility";
    }

    const monthDisplay = formatMonthLabel(month);
    let takeaway = "";
    if (allKeys.size === 0) {
        takeaway = `No schedule demand found for ${monthDisplay} and selected customer.`;
    } else if (netChange === 0 && partsIncreased === 0 && partsDecreased === 0 && partsAdded === 0 && partsRemoved === 0) {
        takeaway = `Both sheets have identical demand (${formatNumberEn(compareTotal)} units) for ${monthDisplay}. No quantity changes were detected across all ${allKeys.size} parts.`;
    } else {
        const changeSign = netChange >= 0 ? "+" : "";
        takeaway = `Overall demand shifted from ${formatNumberEn(baseTotal)} to ${formatNumberEn(compareTotal)} units (${changeSign}${formatNumberEn(netChange)} units or ${changeSign}${percentChange.toFixed(1)}%) for ${monthDisplay}. Out of ${allKeys.size} parts compared: ${partsIncreased} increased, ${partsDecreased} decreased${partsAdded ? `, ${partsAdded} newly introduced` : ""}${partsRemoved ? `, ${partsRemoved} removed` : ""}.`;
    }

    return {
        status: "available",
        baseSheet: {
            snapshotId: baseSnap.snapshotId,
            source: baseSnap.source || "Sheet A",
            date: baseSnap.snapshotDate || baseSnap.capturedAt?.slice(0, 10) || ""
        },
        compareSheet: {
            snapshotId: compareSnap.snapshotId,
            source: compareSnap.source || "Sheet B",
            date: compareSnap.snapshotDate || compareSnap.capturedAt?.slice(0, 10) || ""
        },
        month,
        monthLabel: monthDisplay,
        customer,
        summary: {
            baseTotal,
            compareTotal,
            netChange,
            percentChange,
            wape,
            stabilityLabel,
            stabilityClass,
            partsTotal: allKeys.size,
            partsIncreased,
            partsDecreased,
            partsUnchanged,
            partsAdded,
            partsRemoved,
            takeaway
        },
        rows
    };
}

function getMetricValue(row, metric, month) {
    if (metric === "schedule") {
        if (month && month !== "ALL") {
            const val = getDemandForMonth(row, month);
            if (val !== null) return val;
        } else if (row.monthlySchedules && typeof row.monthlySchedules === "object") {
            const values = Object.values(row.monthlySchedules).map(Number).filter(Number.isFinite);
            if (values.length > 0) return values.reduce((sum, v) => sum + v, 0);
        }
        return Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule ?? 0);
    }
    if (metric === "commitment") {
        if (month && month !== "ALL") {
            const val = getMonthQuantity(row, "monthlyCommitments", month, "companyCommitment", "companyCommitmentProvided");
            if (val !== null) return val;
        } else if (row.monthlyCommitments && typeof row.monthlyCommitments === "object") {
            const values = Object.values(row.monthlyCommitments).map(Number).filter(Number.isFinite);
            if (values.length > 0) return values.reduce((sum, v) => sum + v, 0);
        }
        return Number(row.companyCommitment ?? 0);
    }
    if (metric === "dispatch") {
        if (month && month !== "ALL") {
            const val = getMonthQuantity(row, "monthlyDispatches", month, "actualDispatch", "actualDispatchProvided");
            if (val !== null) return val;
        } else if (row.monthlyDispatches && typeof row.monthlyDispatches === "object") {
            const values = Object.values(row.monthlyDispatches).map(Number).filter(Number.isFinite);
            if (values.length > 0) return values.reduce((sum, v) => sum + v, 0);
        }
        return Number(row.actualDispatch ?? 0);
    }
    if (metric === "production") {
        return Number(row.actualProductionQty ?? 0);
    }
    if (metric === "balance") {
        return Number(row.balance ?? 0);
    }
    if (metric === "originalSchedule") {
        return Number(row.originalCustomerSchedule ?? row.scheduleReceivedQty ?? row.currentCustomerSchedule ?? 0);
    }
    return 0;
}

const METRIC_LABELS = {
    schedule: "Customer Schedule",
    commitment: "Company Commitment",
    dispatch: "Actual Dispatch",
    production: "Actual Production",
    balance: "Backlog / Balance",
    originalSchedule: "Original Schedule"
};

function compareWithinSameSheet(snapshots, options = {}) {
    if (!snapshots || snapshots.length === 0) {
        return {
            status: "no_snapshots",
            message: "No schedule sheets have been uploaded yet. Upload an Excel file to begin.",
            summary: null,
            rows: []
        };
    }

    const {
        snapshotId,
        mode = "months",
        monthA,
        monthB,
        metricA = "commitment",
        metricB = "dispatch",
        month = "ALL",
        customer = "ALL"
    } = options;

    let targetSnap = snapshotId ? snapshots.find(s => s.snapshotId === snapshotId) : null;
    if (!targetSnap) {
        targetSnap = snapshots[snapshots.length - 1];
    }

    if (!targetSnap) {
        return {
            status: "snapshot_not_found",
            message: "Selected Excel sheet was not found.",
            summary: null,
            rows: []
        };
    }

    const matchedRows = (targetSnap.rows || []).filter(r => matchesCustomer(r, customer));

    if (mode === "months") {
        const allMonthsInSheet = new Set();
        matchedRows.forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => allMonthsInSheet.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) allMonthsInSheet.add(dm);
        });
        const sortedMonths = Array.from(allMonthsInSheet).sort();

        const targetMonthA = monthA || (sortedMonths.length > 0 ? sortedMonths[0] : "");
        const targetMonthB = monthB || (sortedMonths.length > 1 ? sortedMonths[1] : targetMonthA);

        if (!targetMonthA) {
            return {
                status: "no_months_in_sheet",
                message: "No monthly schedule columns found in this sheet.",
                summary: null,
                rows: []
            };
        }

        const byEntity = new Map();
        for (const row of matchedRows) {
            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.version)) {
                byEntity.set(key, row);
            }
        }

        let totalA = 0;
        let totalB = 0;
        let diffAbsSum = 0;
        let partsIncreased = 0;
        let partsDecreased = 0;
        let partsUnchanged = 0;

        const rows = [];
        for (const row of byEntity.values()) {
            const qtyA = Number(getDemandForMonth(row, targetMonthA) || 0);
            const qtyB = Number(getDemandForMonth(row, targetMonthB) || 0);
            if (qtyA === 0 && qtyB === 0) continue;

            totalA += qtyA;
            totalB += qtyB;
            const change = qtyB - qtyA;
            diffAbsSum += Math.abs(change);

            let status = "unchanged";
            if (qtyA === 0 && qtyB > 0) {
                status = "added";
                partsIncreased++;
            } else if (qtyA > 0 && qtyB === 0) {
                status = "removed";
                partsDecreased++;
            } else if (change > 0) {
                status = "increased";
                partsIncreased++;
            } else if (change < 0) {
                status = "decreased";
                partsDecreased++;
            } else {
                partsUnchanged++;
            }

            const percentChange = qtyA > 0 ? (change / qtyA) * 100 : (qtyB > 0 ? 100 : 0);

            rows.push({
                customer: row.customer || row.customerCode || "Unknown",
                customerCode: row.customerCode || "",
                partNo: row.partNo || "-",
                customerPartNo: row.customerPartNo || "-",
                productDescription: row.productDescription || "-",
                line: row.line || "-",
                qtyA,
                qtyB,
                change,
                percentChange,
                status
            });
        }

        rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        const netChange = totalB - totalA;
        const percentChange = totalA > 0 ? (netChange / totalA) * 100 : (totalB > 0 ? 100 : 0);
        const labelA = formatMonthLabel(targetMonthA);
        const labelB = formatMonthLabel(targetMonthB);
        const changeSign = netChange >= 0 ? "+" : "";

        const takeaway = rows.length === 0
            ? `No records found comparing ${labelA} and ${labelB}.`
            : `Across the production timeline, demand shifts from ${formatNumberEn(totalA)} in ${labelA} to ${formatNumberEn(totalB)} in ${labelB} (${changeSign}${formatNumberEn(netChange)} units or ${changeSign}${percentChange.toFixed(1)}%). Of ${rows.length} parts: ${partsIncreased} ramp up, ${partsDecreased} ramp down, and ${partsUnchanged} stay flat.`;

        return {
            status: "available",
            mode: "months",
            sheet: {
                snapshotId: targetSnap.snapshotId,
                source: targetSnap.source || "Current Sheet",
                date: targetSnap.snapshotDate || targetSnap.capturedAt?.slice(0, 10) || ""
            },
            monthA: targetMonthA,
            monthB: targetMonthB,
            labelA,
            labelB,
            summary: {
                totalA,
                totalB,
                netChange,
                percentChange,
                partsTotal: rows.length,
                partsIncreased,
                partsDecreased,
                partsUnchanged,
                takeaway
            },
            rows
        };
    } else {
        const labelA = METRIC_LABELS[metricA] || metricA;
        const labelB = METRIC_LABELS[metricB] || metricB;

        const byEntity = new Map();
        for (const row of matchedRows) {
            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.version)) {
                byEntity.set(key, row);
            }
        }

        let totalA = 0;
        let totalB = 0;
        let partsFulfilled = 0;
        let partsShortfall = 0;
        let partsSurplus = 0;
        let shortfallQty = 0;
        let surplusQty = 0;

        const rows = [];
        for (const row of byEntity.values()) {
            const qtyA = getMetricValue(row, metricA, month);
            const qtyB = getMetricValue(row, metricB, month);
            if (qtyA === 0 && qtyB === 0) continue;

            totalA += qtyA;
            totalB += qtyB;
            const diff = qtyB - qtyA;

            let status = "fulfilled";
            if (diff < 0) {
                status = "shortfall";
                partsShortfall++;
                shortfallQty += Math.abs(diff);
            } else if (diff > 0) {
                status = "surplus";
                partsSurplus++;
                surplusQty += diff;
            } else {
                partsFulfilled++;
            }

            const fulfillmentRate = qtyA > 0 ? (qtyB / qtyA) * 100 : (qtyB >= 0 ? 100 : 0);

            rows.push({
                customer: row.customer || row.customerCode || "Unknown",
                customerCode: row.customerCode || "",
                partNo: row.partNo || "-",
                customerPartNo: row.customerPartNo || "-",
                productDescription: row.productDescription || "-",
                line: row.line || "-",
                qtyA,
                qtyB,
                diff,
                fulfillmentRate,
                status
            });
        }

        rows.sort((a, b) => a.diff - b.diff);
        const netDiff = totalB - totalA;
        const fulfillmentRate = totalA > 0 ? (totalB / totalA) * 100 : (totalB >= 0 ? 100 : 0);
        const monthLabel = formatMonthLabel(month);

        let takeaway = "";
        if (rows.length === 0) {
            takeaway = `No data found comparing ${labelA} vs ${labelB} for ${monthLabel}.`;
        } else if (partsShortfall === 0) {
            takeaway = `100% fulfilled! ${labelB} completely met or exceeded ${labelA} (${formatNumberEn(totalB)} of ${formatNumberEn(totalA)} units) across all ${rows.length} parts for ${monthLabel}.`;
        } else {
            takeaway = `${labelB} achieved ${fulfillmentRate.toFixed(1)}% of ${labelA} (${formatNumberEn(totalB)} of ${formatNumberEn(totalA)} units) for ${monthLabel}. ${partsShortfall} parts experienced shortfalls totaling ${formatNumberEn(shortfallQty)} units.`;
        }

        return {
            status: "available",
            mode: "metrics",
            sheet: {
                snapshotId: targetSnap.snapshotId,
                source: targetSnap.source || "Current Sheet",
                date: targetSnap.snapshotDate || targetSnap.capturedAt?.slice(0, 10) || ""
            },
            metricA,
            metricB,
            labelA,
            labelB,
            month,
            monthLabel,
            summary: {
                totalA,
                totalB,
                netDiff,
                fulfillmentRate,
                partsTotal: rows.length,
                partsFulfilled,
                partsShortfall,
                partsSurplus,
                shortfallQty,
                surplusQty,
                takeaway
            },
            rows
        };
    }
}

function getSnapshotComparisonMeta(snapshots, snapshotId) {
    if (!snapshots || snapshots.length === 0) {
        return {
            snapshots: [],
            availableMonths: [],
            availableCustomers: [],
            availableMetrics: [
                { id: "schedule", label: "Customer Schedule" },
                { id: "commitment", label: "Company Commitment" },
                { id: "dispatch", label: "Actual Dispatch" },
                { id: "production", label: "Actual Production" },
                { id: "originalSchedule", label: "Original Customer Schedule" }
            ]
        };
    }

    const snapshotList = snapshots.map((s, idx) => {
        const months = new Set();
        (s.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => months.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) months.add(dm);
        });
        return {
            snapshotId: s.snapshotId || `snap-${idx}`,
            source: s.source || `Excel upload #${idx + 1}`,
            date: s.snapshotDate || s.capturedAt?.slice(0, 10) || "",
            rowCount: (s.rows || []).length,
            months: Array.from(months).sort()
        };
    });

    let targetSnap = snapshotId ? snapshots.find(s => s.snapshotId === snapshotId) : snapshots[snapshots.length - 1];
    if (!targetSnap && snapshots.length > 0) targetSnap = snapshots[snapshots.length - 1];

    const months = new Set();
    const customers = new Set();
    if (targetSnap) {
        (targetSnap.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => months.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) months.add(dm);
            const cust = r.customerGroup || r.customer || r.customerCode;
            if (cust) customers.add(cust);
        });
    }

    const allMonths = new Set();
    const allCustomers = new Set();
    snapshots.forEach(s => {
        (s.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => allMonths.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) allMonths.add(dm);
            const cust = r.customerGroup || r.customer || r.customerCode;
            if (cust) allCustomers.add(cust);
        });
    });

    return {
        snapshots: snapshotList,
        currentSnapshotId: targetSnap?.snapshotId || "",
        availableMonths: Array.from(months).sort(),
        availableCustomers: Array.from(customers).sort(),
        allMonths: Array.from(allMonths).sort(),
        allCustomers: Array.from(allCustomers).sort(),
        availableMetrics: [
            { id: "schedule", label: "Customer Schedule" },
            { id: "commitment", label: "Company Commitment" },
            { id: "dispatch", label: "Actual Dispatch" },
            { id: "production", label: "Actual Production" },
            { id: "originalSchedule", label: "Original Customer Schedule" }
        ]
    };
}

module.exports = {
    calculateScheduleAnalytics,
    calculateDemandRevisionWape,
    calculateOnTime,
    getDemandSnapshotTimeline,
    compareDifferentSheets,
    compareWithinSameSheet,
    getSnapshotComparisonMeta
};
