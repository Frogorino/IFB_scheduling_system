const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");
const dbConfig = require("./dbconfig");
const {
    calculateScheduleAnalytics,
    getDemandSnapshotTimeline,
    calculateCustomerConsistency,
    calculateCustomerActivity,
    getSnapshotEffectiveDate
} = require("./schedule-analytics");
const {
    getScheduleRecords,
    findBestScheduleSheet,
    formatMonthLabel
} = require("./excel-header");
const { normalizeCustomer } = require("./customer-normalizer");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.join(__dirname, "../upload");
const scheduleDataPath = path.join(__dirname, "../database/schedule-records.json");
const scheduleSnapshotsPath = path.join(__dirname, "../database/schedule-snapshots.json");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

let latestScheduleData = [];
let scheduleSnapshots = [];
let pool;

async function initializeDatabase() {
    if (!dbConfig.enabled) {
        console.log("Oracle connection disabled. Set DB_ENABLED=true to enable it.");
        return;
    }

    if (!dbConfig.user || !dbConfig.password) {
        console.warn("Oracle credentials are missing. Set DB_USER and DB_PASSWORD before starting the server.");
        return;
    }

    try {
        const oracleClientDir = process.env.ORACLE_CLIENT_LIB_DIR
            || "C:\\oraclexe\\app\\oracle\\product\\11.2.0\\server\\bin";
        if (!oracledb.oracleClientVersionString) {
            oracledb.initOracleClient({ libDir: oracleClientDir });
        }

        pool = await oracledb.createPool({
            ...dbConfig,
            poolAlias: "default",
            enableStatistics: true
        });
        const connection = await pool.getConnection();
        await connection.close();
        console.log("Oracle DB pool initialized successfully.");
    } catch (error) {
        console.error("Oracle connection failed:", error.message);
        if (pool) {
            await pool.close(0);
            pool = undefined;
        }
    }
}

function normalizeHeader(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;

    if (typeof value === "number") return Number.isFinite(value) ? value : 0;

    const cleaned = String(value).replace(/[^0-9.-]/g, "");
    if (!cleaned) return 0;

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
}

function hasCellValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function getHeaderIndex(headers, aliases) {
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));

    for (const alias of aliases) {
        const aliasKey = normalizeHeader(alias);
        const index = normalizedHeaders.findIndex((header) => header === aliasKey);
        if (index !== -1) return index;
    }

    for (const alias of aliases) {
        const aliasKey = normalizeHeader(alias);
        const index = normalizedHeaders.findIndex((header) => header.includes(aliasKey));
        if (index !== -1) return index;
    }

    return -1;
}

function getMonthKeyFromHeader(header) {
    if (!header) return null;
    const normalized = normalizeHeader(header);
    if (/^(?:monthly plan|annual plan|plan|ifb|rev|revision|tentative|firm)\b/.test(normalized)) {
        return null;
    }
    const match = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s*['\- ]?\s*(\d{2}|\d{4})\b/);
    if (!match) return null;

    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(match[1].slice(0, 3));
    if (monthIndex === -1) return null;

    const yearStr = match[2];
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function getMonthMetricFromHeader(header) {
    if (!header) return null;
    const normalized = normalizeHeader(header);
    if (/^(?:monthly plan|annual plan|plan|ifb|rev|revision|tentative|firm)\b/.test(normalized)) {
        return null;
    }
    const match = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s*['\- ]?\s*(\d{2}|\d{4})\b/);
    if (!match) return null;

    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(match[1].slice(0, 3));
    if (monthIndex === -1) return null;

    const yearStr = match[2];
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const remainder = (normalized.slice(0, match.index) + " " + normalized.slice(match.index + match[0].length)).trim().replace(/\s+/g, " ");

    if (/\b(?:dispatch|dispatches|delivery|delivered|actual dispatch|billed|invoiced)\b/.test(remainder)) {
        if (/\bdate\b/.test(remainder)) {
            return { monthKey, metric: "dispatchDate" };
        }
        return { monthKey, metric: "dispatch" };
    }

    if (/\b(?:customer|actual customer|client)\s*(?:sche?d?u[le]+|demand|order|po)\b/.test(remainder)) {
        return { monthKey, metric: "customerSchedule" };
    }

    if (/\b(?:company commitment|commitment|firm|internal schedule|plant schedule)\b/.test(remainder)) {
        return { monthKey, metric: "commitment" };
    }

    if (/\b(?:sche?d?u[le]+|plan|demand)\b/.test(remainder) || remainder === "") {
        return { monthKey, metric: "schedule" };
    }

    return { monthKey, metric: "schedule" };
}

function mapScheduleRow(record) {
    const keys = Object.keys(record);
    const values = keys.map((key) => record[key]);

    const serialNoIndex = getHeaderIndex(keys, [
        "sl no", "sl. no", "sl. no.", "sl no.", "serial no", "serial number", "s no", "s.no", "slno"
    ]);
    const customerIndex = getHeaderIndex(keys, [
        "customer",
        "customer name",
        "customer_name",
        "soldtoparty",
        "sold to party",
        "soldtoparty name",
        "party",
        "party name",
        "client",
        "account",
        "buyer"
    ]);
    const customerName2Index = getHeaderIndex(keys, ["customer name2", "customer name 2", "customer_name2"]);
    const customerCodeIndex = getHeaderIndex(keys, ["customer code", "customer id", "cust code", "cust id", "soldtoparty"]);
    const customerPartNoIndex = getHeaderIndex(keys, ["customer part no", "customer part no.", "customer part number", "cust part no"]);
    const helperIndex = getHeaderIndex(keys, ["helper"]);
    const lineIndex = getHeaderIndex(keys, ["line", "prod line", "production line"]);
    const modelIndex = getHeaderIndex(keys, ["model", "model no", "model name"]);
    const oemIndex = getHeaderIndex(keys, ["oem", "oem's", "oems", "oem s"]);
    const partIndex = getHeaderIndex(keys, [
        "part no",
        "part no.",
        "part number",
        "part number no",
        "part",
        "part_no",
        "part no number",
        "part#",
        "part #",
        "material",
        "material no",
        "material number",
        "item",
        "item code",
        "fg part",
        "fg code",
        "fg part no"
    ]);
    const applicationIndex = getHeaderIndex(keys, ["application", "product application"]);
    const descriptionIndex = getHeaderIndex(keys, ["description", "product description", "part description"]);
    const deliveryMonthIndex = getHeaderIndex(keys, ["delivery month"]);
    const scheduleStartMonthIndex = getHeaderIndex(keys, ["schedule start month"]);
    const scheduleEndMonthIndex = getHeaderIndex(keys, ["schedule end month"]);
    const versionIndex = getHeaderIndex(keys, [
        "version",
        "version no",
        "schedule version",
        "version number"
    ]);
    const previousMonthIndex = getHeaderIndex(keys, [
        "previous month",
        "prev month",
        "previous month schedule",
        "previous",
        "prev",
        "last month",
        "past month"
    ]);
    const originalCustomerScheduleIndex = getHeaderIndex(keys, [
        "original customer schedule",
        "original customer schedule qty",
        "original customer schedule quantity"
    ]);
    const currentCustomerScheduleIndex = getHeaderIndex(keys, [
        "current customer schedule",
        "current customer schedule qty",
        "current customer schedule quantity"
    ]);
    const currentMonthHeaderAliases = [
        "current month schedule quantity",
        "current month schedule qty",
        "current customer schedule quantity",
        "current customer schedule qty",
        "current month schedule",
        "current customer schedule",
        "current month",
        "schedule quantity",
        "schedule qty",
        "customer schedule quantity",
        "customer schedule qty",
        "customer schedule"
    ].map(normalizeHeader);
    const currentMonthIndex = currentCustomerScheduleIndex !== -1
        ? currentCustomerScheduleIndex
        : keys.findIndex((key) => {
            const header = normalizeHeader(key);
            return currentMonthHeaderAliases.some((alias) => header === alias || header.startsWith(`${alias} `));
        });
    const legacyCustomerScheduleIndex = keys.findIndex((key) => normalizeHeader(key) === "customer schedule");
    const scheduleIndex = currentMonthIndex !== -1 ? currentMonthIndex : legacyCustomerScheduleIndex;
    const comingMonthIndex = getHeaderIndex(keys, [
        "coming month",
        "coming month schedule",
        "next month",
        "next month schedule",
        "next",
        "future month",
        "coming"
    ]);
    const commitmentIndex = getHeaderIndex(keys, [
        "company commitment",
        "company commitment qty",
        "company commitment quantity",
        "commitment",
        "commitment qty"
    ]);
    const dispatchIndex = getHeaderIndex(keys, [
        "last month dispatch",
        "previous month dispatch",
        "last month dispatch qty",
        "previous month dispatch qty",
        "actual dispatch",
        "actual dispatch qty",
        "actual dispatch quantity",
        "dispatch",
        "dispatch qty",
        "actual dispatches",
        "actual delivery"
    ]);
    const balanceIndex = getHeaderIndex(keys, [
        "backlog",
        "backlog qty",
        "backlog quantity",
        "balance",
        "balance qty",
        "closing balance",
        "balance quantity",
        "pending balance"
    ]);
    const scheduleReceivedQtyIndex = getHeaderIndex(keys, [
        "schedule received qty",
        "schedule received quantity",
        "received schedule qty",
        "received schedule quantity"
    ]);
    const scheduleReceivedDateIndex = getHeaderIndex(keys, [
        "schedule received date",
        "received date"
    ]);
    const scheduleReceivedIndex = scheduleReceivedDateIndex !== -1
        ? scheduleReceivedDateIndex
        : keys.findIndex((key, index) =>
            normalizeHeader(key) === "schedule received" && index !== scheduleReceivedQtyIndex
        );
    const actualProductionIndex = getHeaderIndex(keys, [
        "actual production qty",
        "actual production quantity"
    ]);
    const dispatchDateIndex = getHeaderIndex(keys, ["dispatch date"]);
    const dispatchHeader = dispatchIndex !== -1 ? normalizeHeader(keys[dispatchIndex]) : "";
    const actualDispatchMonthAligned = dispatchIndex !== -1
        && !/\b(?:last|previous|prev) month\b/.test(dispatchHeader);
    const varianceReasonIndex = getHeaderIndex(keys, ["variance reason"]);
    const netCustomerRevisionIndex = getHeaderIndex(keys, ["net customer revision"]);
    const finalScheduleVarianceIndex = getHeaderIndex(keys, ["final schedule variance"]);
    const achievementIndex = getHeaderIndex(keys, ["achievement"]);
    const monthlySchedules = {};
    const monthlyCommitments = {};
    const monthlyDispatches = {};
    const monthlyDispatchDates = {};

    keys.forEach((key, index) => {
        const val = values[index];
        if (!hasCellValue(val)) return;

        const metricInfo = getMonthMetricFromHeader(key);
        if (metricInfo) {
            const num = toNumber(val);
            if (metricInfo.metric === "customerSchedule") {
                monthlySchedules[metricInfo.monthKey] = num;
            } else if (metricInfo.metric === "commitment") {
                monthlyCommitments[metricInfo.monthKey] = num;
            } else if (metricInfo.metric === "dispatch") {
                monthlyDispatches[metricInfo.monthKey] = num;
            } else if (metricInfo.metric === "dispatchDate") {
                monthlyDispatchDates[metricInfo.monthKey] = String(val || "").trim();
            } else if (metricInfo.metric === "schedule") {
                if (monthlySchedules[metricInfo.monthKey] !== undefined) {
                    monthlyCommitments[metricInfo.monthKey] = num;
                } else {
                    monthlySchedules[metricInfo.monthKey] = num;
                }
            }
        }
    });

    const sortedMonths = Object.keys(monthlySchedules).sort();

    const customer = customerIndex !== -1 ? values[customerIndex] : "";
    const customerName2 = customerName2Index !== -1 ? values[customerName2Index] : "";
    const customerCode = customerCodeIndex !== -1 ? values[customerCodeIndex] : customer;
    const partNo = partIndex !== -1 ? values[partIndex] : "";
    const version = versionIndex !== -1 ? values[versionIndex] : "Current";

    let deliveryMonth = deliveryMonthIndex !== -1 ? String(values[deliveryMonthIndex] || "").trim() : "";
    if (!deliveryMonth && sortedMonths.length > 0) {
        deliveryMonth = formatMonthLabel(sortedMonths[0]);
    }
    const deliveryMonthKey = getMonthKeyFromHeader(deliveryMonth);

    let previousMonth = previousMonthIndex !== -1 ? toNumber(values[previousMonthIndex]) : 0;
    let currentMonth = scheduleIndex !== -1 ? toNumber(values[scheduleIndex]) : 0;
    let comingMonth = comingMonthIndex !== -1 ? toNumber(values[comingMonthIndex]) : 0;

    if (scheduleIndex === -1 && sortedMonths.length > 0) {
        const monthsWithDispatches = Object.keys(monthlyDispatches);
        const primaryMonth = monthsWithDispatches.length > 0
            ? sortedMonths[sortedMonths.length - 1]
            : sortedMonths[0];
        currentMonth = monthlySchedules[primaryMonth] ?? 0;
        const pIdx = sortedMonths.indexOf(primaryMonth);
        if (pIdx > 0) previousMonth = monthlySchedules[sortedMonths[pIdx - 1]] ?? 0;
        if (pIdx < sortedMonths.length - 1) comingMonth = monthlySchedules[sortedMonths[pIdx + 1]] ?? 0;
    }

    if (deliveryMonthKey && scheduleIndex !== -1 && hasCellValue(values[scheduleIndex])
        && !Object.prototype.hasOwnProperty.call(monthlySchedules, deliveryMonthKey)) {
        monthlySchedules[deliveryMonthKey] = currentMonth;
    }

    const companyCommitmentProvided = commitmentIndex !== -1 && hasCellValue(values[commitmentIndex]);
    const actualDispatchProvided = dispatchIndex !== -1 && hasCellValue(values[dispatchIndex]);
    const companyCommitment = commitmentIndex !== -1
        ? toNumber(values[commitmentIndex])
        : (sortedMonths.length > 0 && monthlyCommitments[sortedMonths[0]] !== undefined ? monthlyCommitments[sortedMonths[0]] : currentMonth);
    const actualDispatch = dispatchIndex !== -1
        ? toNumber(values[dispatchIndex])
        : (sortedMonths.length > 0 && monthlyDispatches[sortedMonths[0]] !== undefined ? monthlyDispatches[sortedMonths[0]] : 0);

    const backlogValue = balanceIndex !== -1 ? values[balanceIndex] : null;
    const balance = backlogValue !== null && String(backlogValue).trim() !== ""
        ? toNumber(backlogValue)
        : (companyCommitment - actualDispatch);

    const normCustomer = normalizeCustomer(customer, customerName2, customerCode);

    return {
        serialNo: serialNoIndex !== -1 ? String(values[serialNoIndex] || "").trim() : "",
        customer: normCustomer.name,
        customerGroup: normCustomer.group,
        customerName2: normCustomer.legalName || String(customerName2 || "").trim(),
        customerCode: normCustomer.code || String(customerCode || "").trim(),
        customerPartNo: customerPartNoIndex !== -1 ? String(values[customerPartNoIndex] || "").trim() : "",
        helper: helperIndex !== -1 ? String(values[helperIndex] || "").trim() : "",
        line: lineIndex !== -1 ? String(values[lineIndex] || "").trim() : "",
        model: modelIndex !== -1 ? String(values[modelIndex] || "").trim() : "",
        oem: oemIndex !== -1 ? String(values[oemIndex] || "").trim() : "",
        partNo: String(partNo || "").trim(),
        application: applicationIndex !== -1 ? String(values[applicationIndex] || "").trim() : "",
        productDescription: descriptionIndex !== -1 ? String(values[descriptionIndex] || "").trim() : "",
        version: String(version || "Current").trim(),
        deliveryMonth,
        scheduleReceivedDate: scheduleReceivedIndex !== -1 ? String(values[scheduleReceivedIndex] || "").trim() : "",
        scheduleStartMonth: scheduleStartMonthIndex !== -1 ? String(values[scheduleStartMonthIndex] || "").trim() : "",
        scheduleEndMonth: scheduleEndMonthIndex !== -1 ? String(values[scheduleEndMonthIndex] || "").trim() : "",
        scheduleReceivedQty: scheduleReceivedQtyIndex !== -1
            ? toNumber(values[scheduleReceivedQtyIndex])
            : originalCustomerScheduleIndex !== -1
                ? toNumber(values[originalCustomerScheduleIndex])
                : null,
        originalCustomerSchedule: originalCustomerScheduleIndex !== -1
            ? toNumber(values[originalCustomerScheduleIndex])
            : null,
        currentCustomerSchedule: currentCustomerScheduleIndex !== -1
            ? toNumber(values[currentCustomerScheduleIndex])
            : null,
        monthlySchedules,
        monthlyCommitments,
        monthlyDispatches,
        monthlyDispatchDates,
        actualProductionQty: actualProductionIndex !== -1 ? toNumber(values[actualProductionIndex]) : 0,
        dispatchDate: dispatchDateIndex !== -1 ? String(values[dispatchDateIndex] || "").trim() : "",
        varianceReason: varianceReasonIndex !== -1 ? String(values[varianceReasonIndex] || "").trim() : "",
        netCustomerRevision: netCustomerRevisionIndex !== -1 ? toNumber(values[netCustomerRevisionIndex]) : null,
        finalScheduleVariance: finalScheduleVarianceIndex !== -1 ? toNumber(values[finalScheduleVarianceIndex]) : null,
        achievement: achievementIndex !== -1 ? toNumber(values[achievementIndex]) : null,
        previousMonth,
        currentMonth,
        comingMonth,
        customerSchedule: currentMonth,
        companyCommitment,
        companyCommitmentProvided,
        actualDispatch,
        actualDispatchProvided,
        actualDispatchMonthAligned,
        balance
    };
}

function getScheduleRowKey(row) {
    return [
        row.customerCode || row.customer || "",
        row.partNo || "",
        row.version || "Current",
        row.deliveryMonth || "No month supplied"
    ].map(value => String(value).trim().toLowerCase()).join("|");
}

function mergeScheduleRows(existingRows, incomingRows) {
    const merged = [...existingRows];
    const indexes = new Map(merged.map((row, index) => [getScheduleRowKey(row), index]));

    for (const row of incomingRows) {
        const key = getScheduleRowKey(row);
        const existingIndex = indexes.get(key);
        if (existingIndex === undefined) {
            indexes.set(key, merged.length);
            merged.push(row);
        } else {
            merged[existingIndex] = row;
        }
    }

    return merged;
}

function saveScheduleData(rows) {
    const tempPath = `${scheduleDataPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(rows, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleDataPath);
}

function saveScheduleSnapshot(snapshot) {
    const updatedSnapshots = [...scheduleSnapshots, snapshot];
    const tempPath = `${scheduleSnapshotsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(updatedSnapshots, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleSnapshotsPath);
    scheduleSnapshots = updatedSnapshots;
}

function saveScheduleSnapshotData(snapshots) {
    const tempPath = `${scheduleSnapshotsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(snapshots, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleSnapshotsPath);
    scheduleSnapshots = snapshots;
}

function loadScheduleData() {
    if (!fs.existsSync(scheduleDataPath)) return [];

    const savedRows = JSON.parse(fs.readFileSync(scheduleDataPath, "utf8"));
    if (!Array.isArray(savedRows)) {
        throw new Error(`Schedule history file must contain an array: ${scheduleDataPath}`);
    }
    return savedRows;
}

function loadScheduleSnapshots() {
    if (!fs.existsSync(scheduleSnapshotsPath)) return [];

    const savedSnapshots = JSON.parse(fs.readFileSync(scheduleSnapshotsPath, "utf8"));
    if (!Array.isArray(savedSnapshots)) {
        throw new Error(`Schedule snapshots file must contain an array: ${scheduleSnapshotsPath}`);
    }
    return savedSnapshots;
}

function parseScheduleWorkbook(workbook) {
    const { sheetName, sheet } = findBestScheduleSheet(workbook, XLSX);
    if (!sheet) {
        return [];
    }
    const rawRows = getScheduleRecords(sheet, XLSX);

    if (!rawRows.length) {
        return [];
    }

    const rows = rawRows
        .map((row) => mapScheduleRow(row))
        .filter((row) => {
            const cust = String(row.customer || "").trim();
            const part = String(row.partNo || "").trim();
            if (!cust || !part) return false;
            if (/^(?:total|grand total|product line|summary|totals)\b/i.test(cust)) return false;
            if (/^(?:oct'\d+|schedule qty|schedule value)/i.test(part)) return false;
            const hasMonthly = Object.keys(row.monthlySchedules || {}).length > 0;
            const hasLegacySchedule = row.currentMonth !== 0 || row.previousMonth !== 0 || row.comingMonth !== 0 || row.actualDispatch !== 0;
            return hasMonthly || hasLegacySchedule;
        });

    rows.sheetName = sheetName;
    return rows;
}

function getDashboardSummary(rows) {
    const customerList = Array.from(new Set(rows.map((row) => row.customer).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const parts = new Set(rows.map((row) => row.partNo).filter(Boolean)).size;
    const totalPreviousMonth = rows.reduce((sum, row) => sum + (row.previousMonth || 0), 0);
    const totalCurrentMonth = rows.reduce((sum, row) => sum + (row.currentMonth || row.customerSchedule || 0), 0);
    const totalComingMonth = rows.reduce((sum, row) => sum + (row.comingMonth || 0), 0);
    const totalDispatch = rows.reduce((sum, row) => sum + (row.actualDispatch || 0), 0);
    const totalBalance = rows.reduce((sum, row) => sum + (row.balance || 0), 0);

    return {
        customer: customerList.length > 0 ? customerList[0] : "",
        customers: customerList.length,
        customerList,
        parts,
        previousMonth: totalPreviousMonth,
        currentMonth: totalCurrentMonth,
        comingMonth: totalComingMonth,
        actualDispatch: totalDispatch,
        balance: totalBalance,
        schedule: totalCurrentMonth,
        dispatch: totalDispatch
    };
}

function normalizeValue(value, fallback = "") {
    return value === null || value === undefined || value === "" ? fallback : String(value).trim();
}

function makeCustomerCode(customerName) {
    const code = normalizeValue(customerName, "CUST")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
    return code ? code.substring(0, 30) : "CUST";
}

async function saveScheduleRowsToOracle(rows) {
    if (!pool) {
        throw new Error("Oracle database is not configured or not reachable.");
    }

    const connection = await pool.getConnection();

    try {
        for (const row of rows) {
            const customerCode = makeCustomerCode(row.customer);
            const customerName = normalizeValue(row.customer, "Unknown Customer");
            const partNo = normalizeValue(row.partNo, "UNKNOWN");
            const version = normalizeValue(row.version, "Current");

            let customerId;
            const customerResult = await connection.execute(
                `SELECT customer_id FROM customers WHERE customer_code = :customerCode`,
                { customerCode }
            );

            if (customerResult.rows && customerResult.rows.length > 0) {
                customerId = customerResult.rows[0][0];
            } else {
                const customerInsert = await connection.execute(
                    `INSERT INTO customers (customer_id, customer_code, customer_name, location, created_at)
                     VALUES (customer_seq.NEXTVAL, :customerCode, :customerName, :location, SYSDATE)
                     RETURNING customer_id INTO :customerId`,
                    {
                        customerCode,
                        customerName,
                        location: "N/A",
                        customerId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                customerId = customerInsert.outBinds.customerId[0];
            }

            let partId;
            const partResult = await connection.execute(
                `SELECT part_id FROM parts WHERE part_no = :partNo`,
                { partNo }
            );

            if (partResult.rows && partResult.rows.length > 0) {
                partId = partResult.rows[0][0];
            } else {
                const partInsert = await connection.execute(
                    `INSERT INTO parts (part_id, part_no, product_description, application, created_at)
                     VALUES (part_seq.NEXTVAL, :partNo, :productDescription, :application, SYSDATE)
                     RETURNING part_id INTO :partId`,
                    {
                        partNo,
                        productDescription: `Imported part ${partNo}`,
                        application: "Schedule upload",
                        partId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                partId = partInsert.outBinds.partId[0];
            }

            let scheduleId;
            const scheduleResult = await connection.execute(
                `SELECT schedule_id FROM schedules
                 WHERE customer_id = :customerId AND part_id = :partId AND schedule_version = :version`,
                { customerId, partId, version }
            );

            if (scheduleResult.rows && scheduleResult.rows.length > 0) {
                scheduleId = scheduleResult.rows[0][0];
            } else {
                const scheduleInsert = await connection.execute(
                    `INSERT INTO schedules (schedule_id, customer_id, part_id, schedule_version, schedule_received_date, schedule_start_month, schedule_end_month, is_current)
                     VALUES (schedule_seq.NEXTVAL, :customerId, :partId, :version, SYSDATE, TRUNC(SYSDATE, 'MM'), ADD_MONTHS(TRUNC(SYSDATE,'MM'), 1), 'Y')
                     RETURNING schedule_id INTO :scheduleId`,
                    {
                        customerId,
                        partId,
                        version,
                        scheduleId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                scheduleId = scheduleInsert.outBinds.scheduleId[0];
            }

            const scheduleDetailInsert = await connection.execute(
                `INSERT INTO schedule_details (schedule_detail_id, schedule_id, delivery_month, customer_schedule, company_commitment)
                 VALUES (schedule_detail_seq.NEXTVAL, :scheduleId, TRUNC(SYSDATE, 'MM'), :customerSchedule, :companyCommitment)
                 RETURNING schedule_detail_id INTO :scheduleDetailId`,
                {
                    scheduleId,
                    customerSchedule: row.customerSchedule,
                    companyCommitment: row.companyCommitment,
                    scheduleDetailId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );

            const scheduleDetailId = scheduleDetailInsert.outBinds.scheduleDetailId[0];
            const actualDispatch = row.actualDispatch || 0;

            await connection.execute(
                `INSERT INTO performance (performance_id, schedule_detail_id, actual_production_qty, actual_dispatch_qty, dispatch_date, variance_reason)
                 VALUES (performance_seq.NEXTVAL, :scheduleDetailId, :actualProduction, :actualDispatch, NVL(TO_DATE(:dispatchDate, 'YYYY-MM-DD'), SYSDATE), :varianceReason)`,
                {
                    scheduleDetailId,
                    actualProduction: row.actualProduction || 0,
                    actualDispatch,
                    dispatchDate: row.dispatchDate || null,
                    varianceReason: row.varianceReason || (row.balance >= 0 ? "Within plan" : "Shortfall")
                }
            );
        }

        await connection.commit();
    } finally {
        connection.release();
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = [".xlsx", ".xls", ".csv"];
        const extension = path.extname(file.originalname).toLowerCase();
        if (!allowed.includes(extension)) {
            return cb(new Error("Unsupported file type. Choose an .xlsx, .xls, or .csv spreadsheet."));
        }
        cb(null, true);
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// Serve index.html explicitly for root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Download sample Excel schedule template
app.get("/api/sample-template", (req, res) => {
    try {
        const headers = [[
            "Sl No", "Customer", "Customer code", "Customer name2", "PART No.", "Helper",
            "Customer Part No", "Line", "Model", "OEM's", "Description", "Application",
            "Schedule Received Date", "Schedule Start Month", "Schedule End Month", "Schedule Version",
            "Previous Month", "Current Month", "Coming Month", "Original Customer Schedule",
            "Current Customer Schedule", "Actual Production Qty", "Actual Dispatch Qty",
            "Dispatch Date", "Variance Reason", "Net Customer Revision",
            "Final Schedule Variance", "Achievement", "Backlog"
        ]];
        const worksheet = XLSX.utils.aoa_to_sheet(headers);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        res.setHeader("Content-Disposition", "attachment; filename=\"IFB_Schedule_Template.xlsx\"");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: "Failed to generate template", details: err.message });
    }
});

app.delete("/api/schedule-row/:index", (req, res) => {
    const idx = parseInt(req.params.index, 10);
    if (!isNaN(idx) && idx >= 0 && idx < latestScheduleData.length) {
        const updatedRows = latestScheduleData.filter((_, index) => index !== idx);
        try {
            saveScheduleData(updatedRows);
        } catch (error) {
            console.error("Unable to persist schedule deletion:", error.message);
            return res.status(500).json({ error: "Unable to save schedule history after deletion." });
        }
        latestScheduleData = updatedRows;
        return res.json({ success: true, rows: latestScheduleData, summary: getDashboardSummary(latestScheduleData) });
    }
    return res.status(400).json({ error: "Invalid row index" });
});

app.get("/master-data", (req, res) => {
    const customersByName = new Map();
    const catalog = {};

    const allKnownRows = [
        ...latestScheduleData,
        ...scheduleSnapshots.flatMap(snapshot => snapshot.rows || [])
    ];
    for (const row of allKnownRows) {
        const norm = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        const name = norm.name || String(row.customer || "").trim();
        const code = norm.code || row.customerCode || makeCustomerCode(name);
        if (name && !customersByName.has(name)) {
            customersByName.set(name, {
                name,
                code,
                group: norm.group,
                legalName: norm.legalName
            });
        }
        if (row.partNo) {
            const application = row.application || "Imported";
            if (!catalog[application]) catalog[application] = [];
            if (!catalog[application].some((part) => part.partNo === row.partNo)) {
                catalog[application].push({
                    partNo: row.partNo,
                    description: row.productDescription || ""
                });
            }
        }
    }

    const sortedCustomers = Array.from(customersByName.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
    );

    res.json({
        customers: sortedCustomers,
        catalog,
        varianceReasons: []
    });
});

app.get("/dashboard", (req, res) => {
    res.json({
        summary: getDashboardSummary(latestScheduleData),
        rows: latestScheduleData
    });
});

app.get("/analytics/historical", (req, res) => {
    const month = String(req.query.month || "");
    const customer = String(req.query.customer || "ALL");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ message: "A valid delivery month is required (YYYY-MM)." });
    }
    return res.json(calculateScheduleAnalytics(
        scheduleSnapshots,
        month,
        customer,
        new Date(),
        {
            previousSnapshotId: String(req.query.previousSnapshotId || ""),
            currentSnapshotId: String(req.query.currentSnapshotId || "")
        }
    ));
});

app.get("/analytics/snapshots", (req, res) => {
    const month = String(req.query.month || "");
    const customer = String(req.query.customer || "ALL");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ message: "A valid delivery month is required (YYYY-MM)." });
    }
    return res.json({
        snapshots: getDemandSnapshotTimeline(scheduleSnapshots, month, customer)
    });
});

app.get("/analytics/customer-consistency", (req, res) => {
    const customer = String(req.query.customer || "ALL").trim();
    return res.json(calculateCustomerConsistency(scheduleSnapshots, customer));
});

app.get("/analytics/customer-activity", (req, res) => {
    const month = String(req.query.month || "").trim();
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ message: "A valid delivery month is required (YYYY-MM)." });
    }
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    return res.json(calculateCustomerActivity(scheduleSnapshots, targetMonth));
});

app.get("/api/imported-files", (req, res) => {
    const list = scheduleSnapshots.map((s, index) => ({
        snapshotId: s.snapshotId,
        source: s.source || "Excel upload",
        snapshotDate: s.snapshotDate || s.capturedAt?.slice(0, 10) || "-",
        capturedAt: s.capturedAt || "-",
        rowCount: s.rows ? s.rows.length : 0,
        filename: s.source || `Schedule_${s.snapshotDate || index + 1}.xlsx`
    }));
    res.json(list.slice().reverse());
});

app.get("/api/download-file/:snapshotId", (req, res) => {
    const { snapshotId } = req.params;
    const snapshot = scheduleSnapshots.find(s => s.snapshotId === snapshotId);
    if (!snapshot) {
        return res.status(404).json({ error: "Snapshot not found" });
    }

    const safeSource = path.basename(snapshot.source || "schedule.xlsx");
    const possiblePaths = [
        path.join(uploadDir, `${snapshotId}-${safeSource}`),
        path.join(uploadDir, safeSource)
    ];
    for (const p of possiblePaths) {
        if (safeSource && fs.existsSync(p)) {
            return res.download(p, safeSource);
        }
    }

    try {
        const rows = (snapshot.rows || []).map((r, i) => {
            const rowData = {
                "Sl No": r.serialNo || i + 1,
                "Customer": r.customerGroup || r.customer || "",
                "Customer code": r.customerCode || "",
                "Customer name2": r.customerName2 || "",
                "PART No.": r.partNo || "",
                "Helper": r.helper || "",
                "Customer Part No": r.customerPartNo || "",
                "Line": r.line || "",
                "Model": r.model || "",
                "OEM's": r.oem || "",
                "Description": r.productDescription || ""
            };
            if (r.monthlySchedules && typeof r.monthlySchedules === "object") {
                Object.entries(r.monthlySchedules).forEach(([m, q]) => {
                    rowData[m] = q;
                });
            }
            rowData["Delivery Month"] = r.deliveryMonth || "";
            rowData["Version"] = r.version || "Current";
            rowData["Actual Dispatch"] = r.actualDispatch || 0;
            rowData["Balance"] = r.balance ?? "";
            return rowData;
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        const downloadName = safeSource.endsWith(".xlsx") ? safeSource : `${safeSource}.xlsx`;
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return res.send(buffer);
    } catch (err) {
        return res.status(500).json({ error: "Failed to generate Excel download", details: err.message });
    }
});

app.delete("/api/imported-file/:snapshotId", (req, res) => {
    const { snapshotId } = req.params;
    const index = scheduleSnapshots.findIndex(s => s.snapshotId === snapshotId);
    if (index === -1) {
        return res.status(404).json({ error: "Snapshot not found" });
    }

    const removedSnapshot = scheduleSnapshots[index];
    const updatedSnapshots = scheduleSnapshots.filter(s => s.snapshotId !== snapshotId);
    saveScheduleSnapshotData(updatedSnapshots);

    const safeSource = path.basename(removedSnapshot.source || "");
    const possiblePaths = [
        path.join(uploadDir, `${snapshotId}-${safeSource}`),
        path.join(uploadDir, safeSource)
    ];
    possiblePaths.forEach(p => {
        if (safeSource && fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }
    });

    if (updatedSnapshots.length > 0) {
        const remainingRows = [];
        updatedSnapshots.forEach(snap => {
            if (snap.rows && Array.isArray(snap.rows)) {
                remainingRows.push(...snap.rows);
            }
        });
        const rebuilt = mergeScheduleRows([], remainingRows);
        latestScheduleData = rebuilt;
        saveScheduleData(rebuilt);
    } else {
        latestScheduleData = latestScheduleData.filter(r => r.source !== removedSnapshot.source);
        saveScheduleData(latestScheduleData);
    }

    return res.json({
        success: true,
        message: "Snapshot and associated data deleted successfully.",
        remainingSnapshots: scheduleSnapshots.length,
        rows: latestScheduleData,
        summary: getDashboardSummary(latestScheduleData)
    });
});

app.post("/upload-excel", upload.single("excelFile"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: "No Excel file uploaded."
        });
    }

    const uploadedPath = req.file.path;

    try {
        const workbook = XLSX.readFile(uploadedPath);
        const rows = parseScheduleWorkbook(workbook);

        if (!rows.length) {
            return res.status(400).json({
                message: "No valid schedule rows found in the uploaded file. Please check the headers and columns."
            });
        }

        const importedAt = new Date().toISOString();
        const todayDate = importedAt.slice(0, 10);
        const requestedSnapshotDate = String(req.body.snapshotDate || "").trim();
        if (requestedSnapshotDate && !isValidDateOnly(requestedSnapshotDate)) {
            return res.status(400).json({ message: "Snapshot date must be a valid calendar date." });
        }
        let snapshotDate;
        if (!requestedSnapshotDate || requestedSnapshotDate === todayDate) {
            const effectiveDate = getSnapshotEffectiveDate({
                source: req.file.originalname,
                rows,
                snapshotDate: requestedSnapshotDate
            });
            snapshotDate = effectiveDate || todayDate;
        } else {
            snapshotDate = requestedSnapshotDate;
        }
        const importedRows = rows.map(row => ({
            ...row,
            deliveryMonth: row.deliveryMonth || "No month supplied",
            importedAt,
            scheduleReceivedDate: row.scheduleReceivedDate || importedAt.slice(0, 10),
            referenceMonth: new Date(importedAt).toISOString().slice(0, 7),
            source: req.file.originalname
        }));
        const snapshotId = `${importedAt.replace(/[:.]/g, "-")}-${scheduleSnapshots.length + 1}`;
        const snapshot = {
            snapshotId,
            snapshotDate,
            capturedAt: importedAt,
            source: req.file.originalname,
            rows: importedRows
        };

        const safeOriginalName = path.basename(req.file.originalname);
        const storedCopyPath = path.join(uploadDir, `${snapshotId}-${safeOriginalName}`);
        try {
            fs.copyFileSync(uploadedPath, storedCopyPath);
        } catch (copyErr) {
            console.warn("Could not preserve file copy in upload directory:", copyErr.message);
        }

        let dbSaved = false;
        let dbWarning = null;

        if (pool) {
            try {
                await saveScheduleRowsToOracle(importedRows);
                dbSaved = true;
            } catch (dbError) {
                dbWarning = dbError.message;
                console.error("Database save failed:", dbWarning);
            }
        }

        const updatedRows = mergeScheduleRows(latestScheduleData, importedRows);
        saveScheduleSnapshot(snapshot);
        saveScheduleData(updatedRows);
        latestScheduleData = updatedRows;
        const summary = getDashboardSummary(updatedRows);

        const detectedMonths = Array.from(new Set(importedRows.flatMap(r => Object.keys(r.monthlySchedules || {})))).sort();
        const hasDispatches = importedRows.some(r => Object.keys(r.monthlyDispatches || {}).length > 0);

        return res.json({
            message: dbSaved
                ? "Excel file uploaded and schedule data processed successfully."
                : "Excel file uploaded successfully. Local processing completed; Oracle DB save is not available.",
            filename: req.file.originalname,
            sheetName: rows.sheetName || "",
            importedCount: importedRows.length,
            detectedMonths,
            hasDispatches,
            snapshotId,
            snapshotDate,
            summary,
            rows: updatedRows,
            database: dbSaved ? "saved to Oracle" : "local only",
            dbWarning
        });
    } catch (error) {
        console.error(error);
        return res.status(400).json({
            message: "Unable to process the Excel file. Please upload a valid XLSX or XLS file.",
            error: error.message
        });
    } finally {
        if (fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
        }
    }
});

app.use((error, req, res, next) => {
    if (req.path !== "/upload-excel") {
        return next(error);
    }

    console.error("Spreadsheet upload request failed:", error.message);
    const message = error instanceof multer.MulterError
        ? error.code === "LIMIT_FILE_SIZE"
            ? "The spreadsheet is too large to upload."
            : `The upload could not be accepted (${error.message}). Please try selecting the file again.`
        : error.message || "Unable to receive the spreadsheet.";
    return res.status(400).json({ message });
});

function normalizeRowCustomer(row) {
    if (!row) return row;
    const norm = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
    return {
        ...row,
        customer: norm.name,
        customerGroup: norm.group,
        customerName2: norm.legalName || row.customerName2 || "",
        customerCode: norm.code || row.customerCode || ""
    };
}

async function startServer() {
    latestScheduleData = loadScheduleData().map(normalizeRowCustomer);
    console.log(`Loaded ${latestScheduleData.length} saved schedule records.`);
    scheduleSnapshots = loadScheduleSnapshots().map(s => ({
        ...s,
        rows: (s.rows || []).map(normalizeRowCustomer)
    }));
    console.log(`Loaded ${scheduleSnapshots.length} historical schedule snapshots.`);
    try {
        saveScheduleData(latestScheduleData);
        saveScheduleSnapshotData(scheduleSnapshots);
    } catch (saveErr) {
        console.warn("Could not re-persist normalized records during startup:", saveErr.message);
    }
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

startServer();
